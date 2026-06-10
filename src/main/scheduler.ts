// SPDX-License-Identifier: AGPL-3.0-or-later
import type { CompanionState } from '../shared/types'
import { DEFAULT_SCHEDULE, SCHEDULER_TICK_MS, type ScheduleConfig } from '../shared/config'
import { startTracker, stopTracker, flushBuffer } from './tracker'

/** Why an evaluation ran — surfaced in every transition log line. */
type Trigger = 'startup' | 'tick' | 'force' | 'test' | 'reset' | 'reviewed' | 'settings' | 'override'

/** Raw time-of-day phase, before the sticky-talking mapping. */
type Phase = 'sleeping' | 'idle' | 'alert' | 'closed'

let timer: NodeJS.Timeout | null = null
let emit: ((state: CompanionState) => void) | null = null

// `configured` is the real schedule from settings; `schedule` is the active one
// (equal to configured normally, or a temporary test override). resetSchedule
// restores `configured`, so "Reset schedule" returns to the user's settings.
let configured: ScheduleConfig = { ...DEFAULT_SCHEDULE }
let schedule: ScheduleConfig = { ...DEFAULT_SCHEDULE }
// 'forced' = a tray "Force state" override is active and ignores the clock.
let mode: 'schedule' | 'forced' = 'schedule'
let forcedState: CompanionState | null = null
// null until the first evaluation emits (lets startup count as a transition).
let currentState: CompanionState | null = null
// Local date (YYYY-MM-DD) the user completed the review on. While it equals
// today, the post-close phase maps to `sleeping` instead of `talking` so the
// companion doesn't re-prompt after a save/discard. Cleared next day / on reset.
let reviewedDate: string | null = null

// --- non-tracking days (weekends / excluded dates) ---
// On a non-tracking day the work-hours machine doesn't run: desiredState forces
// `sleeping` all day, so capture is paused (the tracker gate stops it) and no
// alert/talking/auto-review fires. A one-shot override re-enables tracking for a
// single local date ("Track today anyway"); it auto-expires when the date rolls.
let trackWeekends = true
let excludedDates = new Set<string>()
let trackTodayOverride: string | null = null

const nowMinutes = (d: Date): number =>
  d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60

const localDate = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function fmtMinutes(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

function phaseAt(now: Date, s: ScheduleConfig): Phase {
  const mins = nowMinutes(now)
  const alertStart = s.closeMinutes - s.alertOffsetMinutes
  if (mins < s.startMinutes) return 'sleeping'
  if (mins < alertStart) return 'idle'
  if (mins < s.closeMinutes) return 'alert'
  return 'closed'
}

/** Is `now`'s local date a tracking day? Non-tracking = a weekend (when weekend
 *  tracking is off) or an explicitly excluded date — unless the one-shot
 *  "Track today anyway" override names today. */
function isTrackingDay(now: Date): boolean {
  const ds = localDate(now)
  if (trackTodayOverride === ds) return true
  if (excludedDates.has(ds)) return false
  const dow = now.getDay() // 0 = Sunday, 6 = Saturday
  if (!trackWeekends && (dow === 0 || dow === 6)) return false
  return true
}

function desiredState(now: Date): CompanionState {
  if (mode === 'forced' && forcedState) return forcedState
  // Non-tracking day (weekend / excluded): sleep all day. Forced states above
  // still win (explicit tray override), but the normal schedule is suspended —
  // no alert, no talking, no auto end-of-day review, and capture stays paused.
  if (!isTrackingDay(now)) return 'sleeping'
  // 'closed' (at/after close hour) maps to talking and stays there for the rest
  // of the day — naturally sticky until reset or a forced state. Once the user
  // has reviewed today, it maps to sleeping instead so we stop prompting.
  const phase = phaseAt(now, schedule)
  if (phase === 'closed') {
    return reviewedDate === localDate(now) ? 'sleeping' : 'talking'
  }
  return phase
}

function applyState(next: CompanionState, trigger: Trigger, now: Date): void {
  if (next === currentState) return
  const prev = currentState
  currentState = next

  // Tracker gating: only `sleeping` pauses capture. Entering sleeping from an
  // active state flushes the in-flight buffer before stopping; leaving sleeping
  // (or the initial startup into an active state) resumes polling.
  if (next === 'sleeping') {
    if (prev !== null && prev !== 'sleeping') {
      flushBuffer()
      stopTracker()
    }
  } else if (prev === null || prev === 'sleeping') {
    startTracker()
  }

  console.log(
    `[scheduler] ${prev ?? '(none)'} → ${next}  trigger=${trigger}  ref=${now.toLocaleTimeString()}`
  )
  emit?.(next)
}

function evaluate(trigger: Trigger): void {
  const now = new Date()
  applyState(desiredState(now), trigger, now)
}

function restartTimer(): void {
  if (timer) clearInterval(timer)
  timer = setInterval(() => evaluate('tick'), SCHEDULER_TICK_MS)
}

export function startScheduler(
  emitFn: (state: CompanionState) => void,
  initialSchedule?: ScheduleConfig
): void {
  emit = emitFn
  if (initialSchedule) {
    configured = { ...initialSchedule }
    schedule = { ...initialSchedule }
  }
  evaluate('startup') // compute correct state for "now" immediately — no 30s lag
  restartTimer()
}

/** Apply a new work-hours config from settings: becomes the base schedule and
 *  the active one, and re-evaluates immediately (may trigger a transition). */
export function setConfiguredSchedule(cfg: ScheduleConfig): void {
  configured = { ...cfg }
  schedule = { ...cfg }
  evaluate('settings')
}

/** Set which calendar days are tracking days (weekends + excluded dates). Safe
 *  to call before startScheduler — it only re-evaluates once the scheduler is
 *  running (emit set), so it can seed the policy without racing the startup
 *  evaluate (which must be the first transition the renderer sees). */
export function setDayPolicy(policy: { trackWeekends: boolean; excludedDates: string[] }): void {
  trackWeekends = policy.trackWeekends
  excludedDates = new Set(policy.excludedDates)
  if (emit) evaluate('settings')
}

/** Tray "Track today anyway": force today to count as a tracking day, then
 *  re-evaluate so the companion wakes and capture resumes if we're in work
 *  hours. The override is keyed to today's date, so it self-expires tomorrow. */
export function trackTodayAnyway(): void {
  trackTodayOverride = localDate(new Date())
  console.log(`[scheduler] manual override: tracking forced on for ${trackTodayOverride}`)
  evaluate('override')
}

export function stopScheduler(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

export function getCurrentState(): CompanionState | null {
  return currentState
}

export function forceState(state: CompanionState): void {
  mode = 'forced'
  forcedState = state
  evaluate('force')
}

/** Called when the user saves or discards the end-of-day review. Marks the
 *  reviewed date as done, drops any forced state, and re-evaluates (which
 *  leaves `talking`: to `sleeping` after close, or back to the time-of-day
 *  phase if reviewed early via the tray). desiredState only maps
 *  closed→sleeping when reviewedDate equals today, so reviewing a past day
 *  does not suppress today's automatic review. */
export function endReview(reviewedDateStr?: string): void {
  reviewedDate = reviewedDateStr ?? localDate(new Date())
  mode = 'schedule'
  forcedState = null
  evaluate('reviewed')
}

/** Override the schedule so close is ~2 min out and alert ~1 min out, then
 *  realign the tick to land cleanly on those boundaries — lets a real timed
 *  alert → talking transition be watched in 2 minutes instead of at 17:30. */
export function setTestSchedule(): void {
  const mins = nowMinutes(new Date())
  schedule = {
    startMinutes: mins - 1, // already past start -> idle right now
    closeMinutes: mins + 2,
    alertOffsetMinutes: 1 // alert fires at close - 1 = now + 1 min
  }
  mode = 'schedule'
  forcedState = null
  reviewedDate = null // let the test run re-enter talking
  console.log(
    `[scheduler] TEST schedule: idle now, alert ${fmtMinutes(
      schedule.closeMinutes - schedule.alertOffsetMinutes
    )}, close ${fmtMinutes(schedule.closeMinutes)}`
  )
  evaluate('test')
  restartTimer() // realign ticks to now so +1min/+2min boundaries hit on time
}

export function resetSchedule(): void {
  schedule = { ...configured } // restore the settings schedule, not the hardcoded one
  mode = 'schedule'
  forcedState = null
  reviewedDate = null
  evaluate('reset')
  restartTimer()
}
