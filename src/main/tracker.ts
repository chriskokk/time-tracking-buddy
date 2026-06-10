// SPDX-License-Identifier: AGPL-3.0-or-later
import { activeWindow } from 'get-windows'
import { powerMonitor } from 'electron'
import { insertActivitySample, getSamplesSince } from './db'
import { compileExcludePattern } from '../shared/config'
import type { ActivitySample } from '../shared/types'

// Cap a single session so a window left focused for hours doesn't become one
// giant row — commit and start a fresh session once this elapses. Exported so
// day-boundary queries know the maximum span a single sample can cover.
export const MAX_SESSION_S = 30 * 60

/** The in-memory, not-yet-persisted current run of focus. */
interface Session {
  app: string
  title: string
  startTs: number
  endTs: number
}

let timer: NodeJS.Timeout | null = null
let current: Session | null = null
// Settings-driven. Defaults match the seeded settings.
let pollIntervalMs = 30_000
let excluded: RegExp[] = []
// Manual pause (context menu). Overrides scheduler gating: while paused,
// startTracker() is a no-op, so the scheduler can't resume capture behind it.
let paused = false
// Idle detection: when enabled and powerMonitor reports system-wide idle time
// >= idleThresholdS, we close out any in-flight session and stop writing new
// samples until activity resumes. inIdle is the tracker's own latch so we only
// log/commit on the transition (not on every poll while the user is still away).
let idleDetectionEnabled = true
let idleThresholdS = 300
let inIdle = false

const nowS = (): number => Math.floor(Date.now() / 1000)
const fmtTime = (ts: number): string => new Date(ts * 1000).toLocaleTimeString()

function formatDuration(totalS: number): string {
  const h = Math.floor(totalS / 3600)
  const m = Math.floor((totalS % 3600) / 60)
  const s = totalS % 60
  const parts: string[] = []
  if (h) parts.push(`${h}h`)
  if (m) parts.push(`${m}m`)
  parts.push(`${s}s`)
  return parts.join(' ')
}

/** Persist a session if it represents real elapsed time. Returns whether a row
 *  was written (a sub-second session is dropped as noise). */
function commit(session: Session): boolean {
  const duration = session.endTs - session.startTs
  if (duration < 1) return false
  const sample: ActivitySample = {
    startTs: session.startTs,
    endTs: session.endTs,
    app: session.app,
    title: session.title,
    durationS: duration
  }
  insertActivitySample(sample)
  console.log(`[tracker] committed ${formatDuration(duration)}  ${session.app} — ${session.title}`)
  return true
}

async function poll(): Promise<void> {
  const now = nowS()

  // Idle gating runs BEFORE active-window so we don't even probe the window
  // while the user is away — `powerMonitor.getSystemIdleTime()` returns seconds
  // since the last input event (mouse/keyboard system-wide, not just our app).
  if (idleDetectionEnabled) {
    const idleS = powerMonitor.getSystemIdleTime()
    if (idleS >= idleThresholdS) {
      // Entering idle: commit the in-flight session ending at idle ONSET — not
      // `now`, since that would count the idle minutes as work. The onset is
      // approximated as (now - idleS), which is when getSystemIdleTime says
      // the last input happened.
      if (!inIdle) {
        if (current) {
          current.endTs = Math.max(current.startTs, now - idleS)
          commit(current)
          current = null
        }
        inIdle = true
        console.log(`[tracker] entering idle (system idle ${idleS}s >= threshold ${idleThresholdS}s)`)
      }
      return
    }
    // Leaving idle: log once on the transition; the next sample below starts a
    // fresh session naturally (current is null, so the !current branch picks up).
    if (inIdle) {
      inIdle = false
      console.log(`[tracker] leaving idle (system idle ${idleS}s < threshold ${idleThresholdS}s)`)
    }
  }

  let app = 'Unknown'
  let title = ''
  try {
    const win = await activeWindow()
    if (win) {
      app = win.owner?.name || 'Unknown'
      title = win.title || ''
    }
  } catch (err) {
    console.error('[tracker] get-windows error:', err)
    return
  }

  // Re-check after the await: stopTracker()/setPaused(true) may have run while
  // the window probe was in flight — a stale poll must not re-create `current`
  // and record time across a privacy pause.
  if (paused || !timer) return

  // Excluded apps (password managers, banking, etc.): a match on EITHER the app
  // name or the window title drops the sample. Close out any in-flight session
  // (creating a gap) and record nothing for the excluded period.
  if (excluded.some((re) => re.test(app) || re.test(title))) {
    console.log(`[tracker] ${fmtTime(now)}  (excluded) ${app}`)
    if (current) {
      current.endTs = now
      commit(current)
      current = null
    }
    return
  }

  // One concise line per poll so the loop is observable without spamming.
  console.log(`[tracker] ${fmtTime(now)}  ${app} — ${title}`)

  if (!current) {
    current = { app, title, startTs: now, endTs: now }
    return
  }

  if (current.app === app && current.title === title) {
    current.endTs = now
    if (now - current.startTs >= MAX_SESSION_S) {
      commit(current)
      current = { app, title, startTs: now, endTs: now }
    }
    return
  }

  // Foreground changed: close the old session at `now` (keeps the timeline
  // gapless at 30s granularity) and open a new one.
  current.endTs = now
  commit(current)
  current = { app, title, startTs: now, endTs: now }
}

// System sleep: a session left in flight across a suspend would have its endTs
// extended to the first poll after wake (the wake-up input resets the idle
// counter, so idle gating can't catch it), counting the sleep as work. Commit
// at suspend onset instead; the first poll after resume starts a fresh session
// naturally (current is null). Registered lazily on first startTracker():
// powerMonitor is only usable after app.whenReady(), and the tracker only
// starts after that.
let powerHooksInstalled = false

function installPowerHooks(): void {
  if (powerHooksInstalled) return
  powerHooksInstalled = true
  powerMonitor.on('suspend', () => {
    if (current) {
      current.endTs = nowS()
      commit(current)
      current = null
    }
    console.log('[tracker] system suspend — committed in-flight session')
  })
  powerMonitor.on('resume', () => {
    console.log('[tracker] system resume — next poll starts a fresh session')
  })
}

export function startTracker(): void {
  installPowerHooks()
  if (timer || paused) return
  console.log(`[tracker] started (poll every ${Math.round(pollIntervalMs / 1000)}s)`)
  void poll() // sample immediately rather than waiting a full interval
  timer = setInterval(() => void poll(), pollIntervalMs)
}

/** Settings live-apply: change the poll cadence. If running, flush the in-flight
 *  buffer and restart the timer with the new interval. */
export function setPollInterval(seconds: number): void {
  pollIntervalMs = Math.max(1, Math.round(seconds)) * 1000
  if (timer) {
    flushBuffer()
    clearInterval(timer)
    timer = setInterval(() => void poll(), pollIntervalMs)
    console.log(`[tracker] poll interval -> ${Math.round(pollIntervalMs / 1000)}s (restarted)`)
  }
}

/** Manual pause/resume (context menu). Pausing flushes + stops polling; the
 *  caller decides whether resuming should restart (based on scheduler state). */
export function setPaused(p: boolean): void {
  paused = p
  if (p) stopTracker() // flush in-flight + stop; startTracker no-ops while paused
  console.log(p ? '[tracker] capture paused' : '[tracker] capture resumed')
}

export function isPaused(): boolean {
  return paused
}

/** Settings live-apply: enable/disable idle detection. Disabling while we
 *  happen to be latched in idle clears the latch so the next poll resumes
 *  capture immediately rather than waiting for an idle→active transition we
 *  no longer track. */
export function setIdleDetection(enabled: boolean): void {
  idleDetectionEnabled = enabled
  if (!enabled && inIdle) inIdle = false
  console.log(`[tracker] idle detection ${enabled ? 'enabled' : 'disabled'} (threshold ${idleThresholdS}s)`)
}

/** Settings live-apply: change the idle threshold (minutes -> seconds). */
export function setIdleThresholdMinutes(minutes: number): void {
  idleThresholdS = Math.max(1, Math.round(minutes)) * 60
  console.log(`[tracker] idle threshold -> ${idleThresholdS}s`)
}

/** Settings live-apply: recompile the excluded-apps patterns. Applied to
 *  subsequent samples only; existing rows are not retroactively filtered. */
export function setExcludedRegexes(rawText: string): void {
  excluded = rawText
    .split(/\r?\n/)
    .map(compileExcludePattern)
    .filter((re): re is RegExp => re !== null)
  console.log(`[tracker] excluded patterns: ${excluded.length}`)
}

export function stopTracker(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  // Flush the in-flight session before exit so nothing is lost.
  if (current) {
    current.endTs = nowS()
    commit(current)
    current = null
  }
  console.log('[tracker] stopped')
}

/** Tray "Flush buffer now": commit the current session immediately, then keep
 *  capturing the same window seamlessly (so repeated flushes produce rows). */
export function flushBuffer(): void {
  if (!current) {
    console.log('[tracker] flush: nothing buffered')
    return
  }
  const now = nowS()
  current.endTs = now
  const wrote = commit(current)
  current = { app: current.app, title: current.title, startTs: now, endTs: now }
  if (!wrote) console.log('[tracker] flush: current session <1s old, nothing committed yet')
}

/** Tray "Dump last hour to console": pretty-prints committed samples (local
 *  time) plus the live buffered session. */
export function dumpLastHour(): void {
  const samples = getSamplesSince(nowS() - 3600)
  console.log('\n===== Activity — last hour =====')
  if (samples.length === 0) {
    console.log('(no committed samples yet)')
  } else {
    for (const s of samples) {
      console.log(
        `[${fmtTime(s.startTs)} → ${fmtTime(s.endTs)}]  ${formatDuration(s.durationS).padEnd(10)}  ${s.app} — ${s.title}`
      )
    }
    const total = samples.reduce((sum, s) => sum + s.durationS, 0)
    console.log('-------------------------------')
    console.log(`${samples.length} samples, ${formatDuration(total)} total`)
  }
  if (current) {
    const live = nowS() - current.startTs
    console.log(
      `(buffering) ${current.app} — ${current.title}  [since ${fmtTime(current.startTs)}, ${formatDuration(live)}]`
    )
  }
  console.log('================================\n')
}
