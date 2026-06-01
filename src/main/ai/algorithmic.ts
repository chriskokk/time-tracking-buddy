// SPDX-License-Identifier: AGPL-3.0-or-later
// Deterministic, no-AI summarizer. Groups a day's raw activity_samples into the
// SAME DayBlock[] shape the LLM path produces, so the review flow is identical
// whether or not an AI provider ran. Used two ways:
//   1. As a first-class provider choice ("No AI (group by activity)").
//   2. As the automatic fallback when the configured AI provider is
//      unavailable / errors / times out — so the app ALWAYS produces a review.
//
// Algorithm: filter sub-threshold noise (parity with the AI path), sort by time,
// merge consecutive same-app samples separated by a small gap into one block,
// fold very short blocks into a neighbour, then project each block to a DayBlock.
import { MIN_SESSION_SECONDS } from '../../shared/config'
import { pad2 } from '../../shared/datetime'
import type { ActivitySample, Confidence, DayBlock } from '../../shared/types'

/** Same-app samples separated by a gap shorter than this merge into one block.
 *  3 min absorbs brief context switches (a quick alt-tab back) without welding
 *  genuinely separate sessions together. */
const GAP_MERGE_SECONDS = 180
/** Blocks shorter than this (active seconds) are folded into a neighbour rather
 *  than cluttering the review with sub-3-minute slivers. */
const MIN_BLOCK_SECONDS = 180

/** Epoch seconds -> local "HH:MM" (the DayBlock time contract). Mirrors the same
 *  one-liner in ai/core.ts and main/index.ts; kept local so this module has no
 *  cross-dependency on the AI core. */
const hhmm = (epochS: number): string => {
  const d = new Date(epochS * 1000)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/** A run of consecutive same-app samples, accumulated before projection. */
interface Group {
  app: string
  startTs: number
  endTs: number
  /** Summed sample durations (active time), NOT the wall-clock span — the span
   *  can include the small merged gaps. */
  activeS: number
  /** Per-title active seconds, to pick the most representative window title. */
  titleS: Map<string, number>
}

/** Group raw samples for one day into DayBlocks without any AI. */
export function summarizeAlgorithmic(samples: ActivitySample[]): DayBlock[] {
  // Drop sub-threshold noise first (parity with serializeSamples in the AI path)
  // and sort chronologically so the merge below is a single linear pass.
  const kept = samples
    .filter((s) => s.durationS >= MIN_SESSION_SECONDS)
    .sort((a, b) => a.startTs - b.startTs)
  if (kept.length === 0) return []

  const groups: Group[] = []
  for (const s of kept) {
    const last = groups[groups.length - 1]
    if (last && last.app === s.app && s.startTs - last.endTs <= GAP_MERGE_SECONDS) {
      last.endTs = Math.max(last.endTs, s.endTs)
      last.activeS += s.durationS
      last.titleS.set(s.title, (last.titleS.get(s.title) ?? 0) + s.durationS)
    } else {
      groups.push({
        app: s.app,
        startTs: s.startTs,
        endTs: s.endTs,
        activeS: s.durationS,
        titleS: new Map([[s.title, s.durationS]])
      })
    }
  }

  foldShortGroups(groups)
  return groups.map(toBlock)
}

/** Fold groups below MIN_BLOCK_SECONDS into an adjacent group. The neighbour with
 *  the smaller time gap wins (ties -> previous); the short group's span, active
 *  time, and titles are absorbed, but the neighbour keeps its own app identity —
 *  i.e. a brief detour is attributed to the surrounding block. Repeats until no
 *  foldable group remains or only one block is left. O(n^2) on the block count,
 *  which is tiny (a day is a handful of blocks). */
function foldShortGroups(groups: Group[]): void {
  let i = 0
  while (groups.length > 1 && i < groups.length) {
    const g = groups[i]
    if (g.activeS >= MIN_BLOCK_SECONDS) {
      i++
      continue
    }
    const prev = groups[i - 1]
    const next = groups[i + 1]
    // Pick the neighbour adjacent in time with the smaller gap. With no previous,
    // fold forward; with no next, fold back.
    const gapPrev = prev ? g.startTs - prev.endTs : Infinity
    const gapNext = next ? next.startTs - g.endTs : Infinity
    const target = gapPrev <= gapNext ? prev : next
    absorb(target, g)
    groups.splice(i, 1)
    // Re-check from the start: a merge can leave the absorbing group adjacent to
    // another short one. Cheap given the small block count.
    i = 0
  }
}

/** Merge `from` into `into`, preserving `into`'s app identity. */
function absorb(into: Group, from: Group): void {
  into.startTs = Math.min(into.startTs, from.startTs)
  into.endTs = Math.max(into.endTs, from.endTs)
  into.activeS += from.activeS
  for (const [title, secs] of from.titleS) {
    into.titleS.set(title, (into.titleS.get(title) ?? 0) + secs)
  }
}

/** The window title that occupied the most time in a group, plus its share of
 *  the group's titled time (0..1). Empty titles are ignored when a real one
 *  exists, so "VS Code — (untitled)" doesn't win over a real filename. */
function dominantTitle(g: Group): { title: string; share: number } {
  let total = 0
  let best = ''
  let bestSecs = 0
  for (const [title, secs] of g.titleS) {
    total += secs
    const t = title.trim()
    if (t && secs > bestSecs) {
      best = t
      bestSecs = secs
    }
  }
  if (!best) return { title: '', share: 0 }
  return { title: best, share: total > 0 ? bestSecs / total : 0 }
}

function toBlock(g: Group): DayBlock {
  const { title, share } = dominantTitle(g)
  const label = title ? `${g.app} — ${title}` : g.app
  // Duration is summed ACTIVE minutes (>= 1), not the wall-clock span — the
  // honest figure for time tracking when small gaps were merged in.
  const durationMinutes = Math.max(1, Math.round(g.activeS / 60))
  // No semantic understanding, so never "high". One title clearly dominating the
  // block reads as a reasonably confident grouping; anything mixed is "low".
  const confidence: Confidence = share >= 0.8 ? 'medium' : 'low'
  return {
    start: hhmm(g.startTs),
    end: hhmm(g.endTs),
    durationMinutes,
    label,
    confidence,
    ticket: ''
  }
}
