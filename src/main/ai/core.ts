// SPDX-License-Identifier: AGPL-3.0-or-later
// Provider-agnostic AI core: prompts, serialization, parsing, and the shared
// request shape. Providers (ollama / claude-code) only implement transport.
import { MIN_SESSION_SECONDS, MAX_TITLE_CHARS } from '../../shared/config'
import { localDateStr, pad2, parseHHMMToMinutes } from '../../shared/datetime'
import type { ActivitySample, Confidence, DayBlock } from '../../shared/types'

// --- prompts ---

export const SYSTEM_PROMPT = `You convert a knowledge worker's raw computer-activity log into a short summary of their work day, broken into logical time blocks for time tracking.

You are given a chronological list of activity sessions. Each line has the form:
  START-END (DURATION) APP — WINDOW TITLE
Times are 24-hour local time.

Your task:
- Group related consecutive sessions into 3 to 6 logical work blocks. Fold short context switches (a quick browser lookup, a doc check, a glance at chat) into the surrounding block when they clearly belong to the same task.
- If the day's total activity is under 90 minutes, output 1 to 3 blocks rather than forcing fragmentation.
- Each block covers one contiguous time range. Blocks must be ordered by start time and must NOT overlap.
- Write a short, specific label (3-10 words) describing the work. Use concrete clues from the window titles: project names, branch names, file names, document titles, channels, or people. Prefer "Implementing audit middleware on feat/audit-middleware" over vague labels like "Coding".
- Set "confidence" to "low", "medium", or "high" for how sure you are the label describes that block. Use "high" when titles clearly identify the work, "low" for ambiguous activity such as mixed browsing, breaks, or unclear titles.
- Describe ONLY what the data supports. Do not invent meetings, tickets, or tasks that are not visible in the activity.

Respond with ONLY a JSON object of exactly this shape, and nothing else:
{
  "blocks": [
    { "start": "HH:MM", "end": "HH:MM", "durationMinutes": 0, "label": "", "confidence": "low" }
  ]
}`

const FEW_SHOT_INPUT = `Here is today's activity (2026-03-10). Summarize it into work blocks:

09:03-09:21 (18m) Google Chrome — Gmail - Inbox (3,412)
09:21-09:34 (13m) Microsoft Teams — General | Engineering
09:34-10:48 (1h14m) Visual Studio Code — auth_middleware.go — feat/audit-middleware
10:48-10:55 (7m) Google Chrome — pkg/context - Go Packages
10:55-12:10 (1h15m) Visual Studio Code — auth_middleware_test.go — feat/audit-middleware
12:10-12:18 (8m) Google Chrome — go context deadline exceeded - Stack Overflow
12:18-12:31 (13m) Slack — #backend
12:31-13:02 (31m) Google Chrome — YouTube
13:02-13:05 (3m) Microsoft Outlook — Re: Q3 planning`

const FEW_SHOT_OUTPUT = `{
  "blocks": [
    { "start": "09:03", "end": "09:34", "durationMinutes": 31, "label": "Email triage and Teams standup", "confidence": "high" },
    { "start": "09:34", "end": "12:18", "durationMinutes": 164, "label": "Implementing audit middleware on feat/audit-middleware", "confidence": "high" },
    { "start": "12:18", "end": "13:02", "durationMinutes": 44, "label": "Slack catch-up and break", "confidence": "low" },
    { "start": "13:02", "end": "13:05", "durationMinutes": 3, "label": "Reviewing Q3 planning email", "confidence": "medium" }
  ]
}`

const REFINE_SYSTEM = `You help the user refine a list of time-tracking work blocks through conversation.

You are given:
1. The CURRENT blocks as a JSON array.
2. A user instruction in natural language.

Apply the instruction to the blocks. Supported operations: merging blocks, splitting a block into parts, adding a block, removing a block, relabeling, changing start/end times, and tagging a block with a ticket id.

Rules:
- Return the COMPLETE updated list, not just the changed blocks. Preserve every block the instruction does not mention, unchanged.
- Keep blocks ordered by start time and non-overlapping.
- Times are 24-hour local "HH:MM". When adding or splitting, infer reasonable times from the instruction.
- "confidence" stays one of "low", "medium", "high"; use "high" for blocks the user explicitly edits or confirms.
- "ticket" is a short string like "TICKET-123", or "" if none.
- Tell the user what you changed in one short sentence.

Respond with ONLY this JSON object, nothing else:
{
  "reply": "<one short sentence describing what you changed>",
  "blocks": [
    { "start":"HH:MM","end":"HH:MM","durationMinutes":0,"label":"","confidence":"low","ticket":"" }
  ]
}`

const REFINE_FEW_SHOT_INPUT = `CURRENT BLOCKS:
[
  {"start":"09:03","end":"09:34","durationMinutes":31,"label":"Email triage and Teams standup","confidence":"high","ticket":""},
  {"start":"09:34","end":"12:18","durationMinutes":164,"label":"Implementing audit middleware","confidence":"high","ticket":""},
  {"start":"12:18","end":"13:02","durationMinutes":44,"label":"Slack catch-up and break","confidence":"low","ticket":""}
]

INSTRUCTION: merge the first two and tag the result PROJ-42`

const REFINE_FEW_SHOT_OUTPUT = `{
  "reply": "Merged the first two blocks into one and tagged it PROJ-42.",
  "blocks": [
    {"start":"09:03","end":"12:18","durationMinutes":195,"label":"Email, standup and audit middleware","confidence":"high","ticket":"PROJ-42"},
    {"start":"12:18","end":"13:02","durationMinutes":44,"label":"Slack catch-up and break","confidence":"low","ticket":""}
  ]
}`

const STRONGER = '\n\nIMPORTANT: Respond with ONLY the JSON object described above. No prose, no explanation, no markdown code fences.'

// --- the shared request shape every provider transports ---

export interface AiPrompt {
  system: string
  examples: { user: string; assistant: string }[]
  user: string
}

export interface AiProvider {
  readonly name: string
  chat(prompt: AiPrompt): Promise<string | null>
}

// --- serialization (epoch -> local HH:MM per the timezone contract) ---

const hhmm = (epochS: number): string => {
  const d = new Date(epochS * 1000)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

function durLabel(seconds: number): string {
  const m = Math.round(seconds / 60)
  if (m < 60) return `${m}m`
  const rem = m % 60
  return rem === 0 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 60)}h${rem}m`
}

export interface SerializedInput {
  text: string
  kept: number
  dropped: number
}

export function serializeSamples(samples: ActivitySample[]): SerializedInput {
  const kept = samples.filter((s) => s.durationS >= MIN_SESSION_SECONDS)
  const dropped = samples.length - kept.length
  const lines = kept.map((s) => {
    const title = (s.title || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE_CHARS)
    return `${hhmm(s.startTs)}-${hhmm(s.endTs)} (${durLabel(s.durationS)}) ${s.app} — ${title}`
  })
  const text = `Here is today's activity (${localDateStr()}). Summarize it into work blocks:\n\n${lines.join('\n')}`
  return { text, kept: kept.length, dropped }
}

// --- request builders ---

export function buildSummarizePrompt(input: SerializedInput, strongerRetry = false): AiPrompt {
  return {
    system: SYSTEM_PROMPT,
    examples: [{ user: FEW_SHOT_INPUT, assistant: FEW_SHOT_OUTPUT }],
    user: strongerRetry ? input.text + STRONGER : input.text
  }
}

export function buildRefinePrompt(current: DayBlock[], message: string, strongerRetry = false): AiPrompt {
  const base = `CURRENT BLOCKS:\n${JSON.stringify(current, null, 2)}\n\nINSTRUCTION: ${message}`
  return {
    system: REFINE_SYSTEM,
    examples: [{ user: REFINE_FEW_SHOT_INPUT, assistant: REFINE_FEW_SHOT_OUTPUT }],
    user: strongerRetry ? base + STRONGER : base
  }
}

// --- parsing (shared; code is the source of truth for durations) ---

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null

function computeDurationMinutes(start: string, end: string): number | null {
  const a = parseHHMMToMinutes(start)
  const b = parseHHMMToMinutes(end)
  if (a === null || b === null) return null
  const d = b - a
  return d >= 0 ? d : null
}

const coerceConfidence = (v: unknown): Confidence =>
  v === 'low' || v === 'medium' || v === 'high' ? v : 'low'

function coerceBlock(item: unknown): DayBlock | null {
  if (!isRecord(item)) return null
  const { start, end, label } = item
  if (typeof start !== 'string' || typeof end !== 'string' || typeof label !== 'string') {
    console.warn('[ai] skipping malformed block:', JSON.stringify(item))
    return null
  }
  const computed = computeDurationMinutes(start, end)
  const modelDur = typeof item.durationMinutes === 'number' ? item.durationMinutes : null
  if (modelDur !== null && computed !== null && Math.abs(modelDur - computed) > 1) {
    console.warn(`[ai] duration mismatch for "${label}": model=${modelDur}m vs computed=${computed}m (using computed)`)
  }
  return {
    start,
    end,
    label,
    durationMinutes: computed ?? modelDur ?? 0,
    confidence: coerceConfidence(item.confidence),
    ticket: typeof item.ticket === 'string' ? item.ticket : ''
  }
}

function coerceBlocks(raw: unknown): DayBlock[] | null {
  if (!Array.isArray(raw)) return null
  const out: DayBlock[] = []
  for (const item of raw) {
    const b = coerceBlock(item)
    if (b) out.push(b)
  }
  return out.length > 0 ? out : null
}

/** Pull the JSON object out of a model response that may be wrapped in markdown
 *  ```json fences or have surrounding prose. Ollama's format:"json" returns
 *  clean JSON, but the Claude CLI often fences it — so we slice from the first
 *  `{` to the last `}`. Returns the parsed value or null. */
function parseLooseJson(content: string): unknown {
  const t = content.trim()
  const first = t.indexOf('{')
  const last = t.lastIndexOf('}')
  if (first === -1 || last === -1 || last < first) return null
  try {
    return JSON.parse(t.slice(first, last + 1))
  } catch {
    return null
  }
}

export function parseBlocks(content: string): DayBlock[] | null {
  const parsed = parseLooseJson(content)
  if (!isRecord(parsed)) return null
  return coerceBlocks(parsed.blocks)
}

export function parseRefine(content: string): { reply: string; blocks: DayBlock[] } | null {
  const parsed = parseLooseJson(content)
  if (!isRecord(parsed)) return null
  const blocks = coerceBlocks(parsed.blocks)
  if (!blocks) return null
  const reply =
    typeof parsed.reply === 'string' && parsed.reply.trim() ? parsed.reply.trim() : 'Updated the blocks.'
  return { reply, blocks }
}
