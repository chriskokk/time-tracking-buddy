// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  app,
  BrowserWindow,
  ipcMain,
  screen,
  Menu,
  dialog,
  Notification,
  systemPreferences,
  shell
} from 'electron'
import { join } from 'path'
import { promises as fsp } from 'fs'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { createTray } from './tray'
import {
  initDb,
  closeDb,
  getSamplesSince,
  replaceTimeEntries,
  getTimeEntriesForDate,
  countTimeEntries,
  getReflection,
  saveReflection,
  getSetting,
  setSetting,
  pruneOldActivity,
  getTimeEntriesInRange,
  getReflectionsInRange,
  deleteTimeEntriesForDate,
  getDistinctTickets,
  type TimeEntryRow
} from './db'
import {
  startTracker,
  stopTracker,
  flushBuffer,
  dumpLastHour,
  setPollInterval,
  setExcludedRegexes,
  setIdleDetection,
  setIdleThresholdMinutes,
  setPaused,
  isPaused,
  MAX_SESSION_S
} from './tracker'
import {
  testSummarize,
  printRequest,
  summarizeDay,
  refineBlocks,
  detectClaude,
  isClaudeAvailable,
  detectOllama,
  isOllamaAvailable
} from './ai'
import {
  startScheduler,
  stopScheduler,
  getCurrentState,
  forceState,
  setTestSchedule,
  resetSchedule,
  setConfiguredSchedule,
  setDayPolicy,
  trackTodayAnyway,
  endReview
} from './scheduler'
import { initSettings, getSettings, updateSetting, resetAllSettings, DEFAULT_SETTINGS } from './settings'
import { runAutoBackup, runManualBackup } from './backup'
import { DEFAULT_SCHEDULE, type ScheduleConfig } from '../shared/config'
import { localDateStr, pad2, parseHHMMToMinutes, isValidDateStr } from '../shared/datetime'
import type {
  CompanionState,
  DayBlock,
  CachedBlock,
  ChatMessage,
  ReviewState,
  ReviewResult,
  RefineResult,
  SaveResult,
  Settings,
  HistoryRange,
  HistoryDay,
  HistoryEntry
} from '../shared/types'

const SCREEN_MARGIN = 24

let companionWindow: BrowserWindow | null = null
let chatWindow: BrowserWindow | null = null
let settingsWindow: BrowserWindow | null = null
let scratchpadWindow: BrowserWindow | null = null
let historyWindow: BrowserWindow | null = null

const CHAT_WIDTH = 400
const CHAT_HEIGHT = 600
const SETTINGS_WIDTH = 500
const SETTINGS_HEIGHT = 650
const SCRATCHPAD_WIDTH = 400
const SCRATCHPAD_HEIGHT = 500
const HISTORY_WIDTH = 720
const HISTORY_HEIGHT = 600

const nowSeconds = (): number => Math.floor(Date.now() / 1000)

/** Epoch seconds at local midnight today — the start of "today's" samples. */
function localMidnightEpoch(): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return Math.floor(d.getTime() / 1000)
}

/** Reverse of the timezone contract: local "YYYY-MM-DD" + "HH:MM" -> epoch
 *  seconds, using the OS local timezone.
 *
 *  Timezone-contract assumptions:
 *  - The DB stores epoch seconds; all HH:MM ↔ epoch conversion happens at
 *    serialize/save boundaries in this process, in the OS local timezone.
 *  - The app runs in a SINGLE timezone — the one the OS reports right now. We
 *    do not re-serialize on TZ change; a user who flies across timezones will
 *    see saved blocks shift relative to wall clock.
 *  - DST transitions are not specially handled. The work-hours window must not
 *    overlap the DST flip (e.g. Europe/Athens flips at 03:00↔04:00, safely
 *    outside 09:00–17:30). A duplicated HH:MM on fall-back day would resolve
 *    to an arbitrary one of the two epochs. */
function hhmmToEpochSeconds(dateStr: string, hhmm: string): number | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr)
  // parseHHMMToMinutes range-checks hours/minutes — the Date constructor would
  // otherwise roll values like "24:30" into the next day.
  const mins = parseHHMMToMinutes(hhmm)
  if (!dm || mins === null) return null
  const d = new Date(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), Math.floor(mins / 60), mins % 60, 0, 0)
  return Math.floor(d.getTime() / 1000)
}

// --- retention pruning ---

const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000 // 24h
let pruneTimer: NodeJS.Timeout | null = null

/** Run one prune pass against the current activityRetentionDays setting and
 *  log the row count. Safe to call repeatedly; respects the 0 = forever guard
 *  inside pruneOldActivity(). */
function runPrune(): void {
  const days = getSettings().activityRetentionDays
  if (days <= 0) {
    console.log('[prune] retention disabled (activityRetentionDays=0) — skipping')
    return
  }
  const t0 = Date.now()
  const removed = pruneOldActivity(days)
  const ms = Date.now() - t0
  console.log(`[prune] removed ${removed} activity_samples older than ${days}d (${ms}ms)`)
}

function startPruneTimer(): void {
  if (pruneTimer) clearInterval(pruneTimer)
  pruneTimer = setInterval(runPrune, PRUNE_INTERVAL_MS)
}

// --- periodic auto-backup ---
//
// runAutoBackup self-gates at 24h since the newest backup, so re-checking every
// 6h is cheap and keeps a long-running tray instance backed up.
const BACKUP_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
let backupTimer: NodeJS.Timeout | null = null

function startBackupTimer(): void {
  if (backupTimer) clearInterval(backupTimer)
  backupTimer = setInterval(() => void runAutoBackup(), BACKUP_CHECK_INTERVAL_MS)
}

// --- settings live-apply ---

function scheduleFromSettings(s: Settings): ScheduleConfig {
  const startMin = parseHHMMToMinutes(s.workStartHour)
  const closeMin = parseHHMMToMinutes(s.workCloseHour)
  if (startMin === null) {
    console.warn(`[settings] workStartHour "${s.workStartHour}" invalid — using default ${DEFAULT_SCHEDULE.startMinutes}m`)
  }
  if (closeMin === null) {
    console.warn(`[settings] workCloseHour "${s.workCloseHour}" invalid — using default ${DEFAULT_SCHEDULE.closeMinutes}m`)
  }
  const start = startMin ?? DEFAULT_SCHEDULE.startMinutes
  const close = closeMin ?? DEFAULT_SCHEDULE.closeMinutes
  // Inverted schedules (close <= start) wedge the state machine: asleep until
  // the "start" hour, then straight to closed/talking — capture never runs.
  // The settings UI validates the pair, but the stored rows could predate that.
  if (close <= start) {
    console.warn(
      `[settings] work hours inverted (start=${start}m close=${close}m) — using defaults`
    )
    return { ...DEFAULT_SCHEDULE, alertOffsetMinutes: s.preCloseAlertMinutes }
  }
  return {
    startMinutes: start,
    closeMinutes: close,
    alertOffsetMinutes: s.preCloseAlertMinutes
  }
}

/** Derive the non-tracking-day policy from settings: the weekend toggle plus the
 *  parsed list of excluded YYYY-MM-DD dates (one per line, malformed lines
 *  dropped). */
function dayPolicyFromSettings(s: Settings): { trackWeekends: boolean; excludedDates: string[] } {
  const excludedDates = s.excludedDates
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(isValidDateStr) // real calendar dates only — "2026-13-45" would silently never match
  return { trackWeekends: s.trackWeekends, excludedDates }
}

function resetCompanionPosition(): void {
  if (!companionWindow) return
  const { workArea } = screen.getPrimaryDisplay()
  const [w, h] = companionWindow.getSize()
  companionWindow.setPosition(
    workArea.x + workArea.width - w - SCREEN_MARGIN,
    workArea.y + workArea.height - h - SCREEN_MARGIN
  )
  saveCompanionBounds() // persist the reset so it survives a restart
}

// --- window-bounds persistence (settings-table keys, outside typed Settings) ---

interface SavedBounds {
  x: number
  y: number
  width?: number
  height?: number
}

/** Saved bounds are only trusted if they still intersect a connected display's
 *  work area — a monitor unplugged since last run would otherwise restore the
 *  window off-screen with no way to drag it back. */
function boundsOnScreen(b: SavedBounds): boolean {
  return screen.getAllDisplays().some((d) => {
    const a = d.workArea
    const w = b.width ?? 100
    const h = b.height ?? 100
    return b.x < a.x + a.width && b.x + w > a.x && b.y < a.y + a.height && b.y + h > a.y
  })
}

function readBounds(key: string): SavedBounds | null {
  const raw = getSetting(key)
  if (!raw) return null
  try {
    const b = JSON.parse(raw) as SavedBounds
    if (typeof b.x === 'number' && typeof b.y === 'number' && boundsOnScreen(b)) return b
  } catch {
    /* ignore malformed */
  }
  return null
}

function saveCompanionBounds(): void {
  if (!companionWindow || companionWindow.isDestroyed()) return
  const [x, y] = companionWindow.getPosition()
  setSetting('companion.bounds', JSON.stringify({ x, y }))
}

/** Resize the companion. The window is non-resizable (so the user can't drag it),
 *  but setSize() is a no-op on non-resizable windows on Windows — so we briefly
 *  toggle resizable around the call. */
function setCompanionSize(w: number, h: number): void {
  if (!companionWindow || companionWindow.isDestroyed()) return
  companionWindow.setResizable(true)
  companionWindow.setSize(Math.round(w), Math.round(h))
  companionWindow.setResizable(false)
}

/** Register/clear the OS "launch at login" item and read back the REAL state.
 *  Fixes three gaps in the old one-liner call:
 *   - passes an explicit exe path + args on Windows. The default registration
 *     can target the wrong path for a per-user (NSIS) install, so the toggle
 *     looked enabled but the app never actually launched at startup.
 *   - skips registration in dev: there `process.execPath` is electron.exe, so a
 *     login item would relaunch the bare runtime, not the app. Only effective in
 *     a packaged build.
 *   - returns `getLoginItemSettings().openAtLogin` so callers can reflect OS
 *     reality in the UI instead of the stored flag.
 *  Returns the actual OS login-item state after the change. */
function syncLoginItem(enabled: boolean): boolean {
  const winQuery = { path: process.execPath, args: [] as string[] }
  if (app.isPackaged) {
    app.setLoginItemSettings(
      process.platform === 'win32' ? { openAtLogin: enabled, ...winQuery } : { openAtLogin: enabled }
    )
  } else {
    console.log('[startup] dev build — setLoginItemSettings skipped (only effective when packaged)')
  }
  const actual = app.getLoginItemSettings(process.platform === 'win32' ? winQuery : undefined)
  console.log(`[startup] openAtLogin requested=${enabled} -> OS reports openAtLogin=${actual.openAtLogin}`)
  return actual.openAtLogin
}

/** Route a single changed setting to the subsystem that owns its live behavior. */
function applySettingChange(key: string): void {
  const s = getSettings()
  switch (key) {
    case 'workStartHour':
    case 'workCloseHour':
    case 'preCloseAlertMinutes':
      setConfiguredSchedule(scheduleFromSettings(s))
      break
    case 'captureIntervalSeconds':
      setPollInterval(s.captureIntervalSeconds)
      break
    case 'excludedAppsRegex':
      setExcludedRegexes(s.excludedAppsRegex)
      break
    case 'companionWidth':
    case 'companionHeight':
      setCompanionSize(s.companionWidth, s.companionHeight)
      break
    case 'startupOnBoot':
      syncLoginItem(s.startupOnBoot)
      break
    case 'avatar':
      companionWindow?.webContents.send('companion:avatar', s.avatar)
      break
    case 'voiceEnabled':
    case 'voicePhrase':
    case 'voiceName':
      companionWindow?.webContents.send('companion:voice', {
        enabled: s.voiceEnabled,
        phrase: s.voicePhrase,
        voiceName: s.voiceName
      })
      break
    case 'activityRetentionDays':
      // Changing the threshold should take effect now, not in 24h: run a
      // prune pass immediately so e.g. 30→1 reclaims storage on save.
      runPrune()
      break
    case 'idleDetectionEnabled':
      setIdleDetection(s.idleDetectionEnabled)
      break
    case 'idleThresholdMinutes':
      setIdleThresholdMinutes(s.idleThresholdMinutes)
      break
    case 'trackWeekends':
    case 'excludedDates':
      setDayPolicy(dayPolicyFromSettings(s))
      break
    // ollamaHost/ollamaModel/aiProvider/claudeCodeModel: read at call time.
  }
}

/** Apply every setting at once (startup, and after "Reset all to defaults").
 *  Must push every companion-side setting so the renderer isn't left with stale
 *  in-memory copies after a Reset All — mirrors the per-setting paths in
 *  applySettingChange. */
function applyAllSettings(): void {
  const s = getSettings()
  setConfiguredSchedule(scheduleFromSettings(s))
  setDayPolicy(dayPolicyFromSettings(s))
  setPollInterval(s.captureIntervalSeconds)
  setExcludedRegexes(s.excludedAppsRegex)
  setIdleDetection(s.idleDetectionEnabled)
  setIdleThresholdMinutes(s.idleThresholdMinutes)
  setCompanionSize(s.companionWidth, s.companionHeight)
  syncLoginItem(s.startupOnBoot)
  companionWindow?.webContents.send('companion:avatar', s.avatar)
  companionWindow?.webContents.send('companion:voice', {
    enabled: s.voiceEnabled,
    phrase: s.voicePhrase,
    voiceName: s.voiceName
  })
  runPrune() // pick up a new retention threshold immediately
}

// --- manual capture pause/resume (context menu) ---

function pauseCapture(): void {
  setPaused(true)
}

function resumeCapture(): void {
  setPaused(false)
  // Restart only if the schedule currently wants capture (i.e. not sleeping).
  const state = getCurrentState()
  if (state && state !== 'sleeping') startTracker()
}

// --- end-of-day review orchestration ---

// In-memory draft cache, keyed by local date. Survives panel close/reopen so we
// don't re-run summarizeDay every time. Cleared on Save/Discard.
// Not persisted across app restarts.
const reviewCache = new Map<string, { blocks: CachedBlock[]; chatLog: ChatMessage[] }>()
// The state to deliver on open, satisfying the renderer whether it asks before
// or after we're ready (handles the open/summarize race).
let pendingState: ReviewState | null = null
// The original proposal JSON per date, stored on each saved row as provenance.
const lastSummaryRawByDate = new Map<string, string | null>()
// Which date the review panel is currently reviewing. Set by beginReview() and
// consumed by review:save, review:summarize, and the cache-clear on Discard.
// null when no review panel is open.
let activeReviewDate: string | null = null

const toCached = (b: DayBlock): CachedBlock => ({
  ...b,
  ticket: b.ticket ?? '',
  userEdited: false,
  userCreated: false
})

function epochToHHMM(ts: number | null): string {
  if (ts === null) return '00:00'
  const d = new Date(ts * 1000)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/** Load a saved day from time_entries as fresh review blocks. They're "your
 *  saved state": provenance reset, confidence high (you confirmed them). */
function loadSavedBlocks(date: string): CachedBlock[] {
  return getTimeEntriesForDate(date).map((r) => ({
    start: epochToHHMM(r.startTs),
    end: epochToHHMM(r.endTs),
    durationMinutes: Math.round(r.durationS / 60),
    label: r.label,
    confidence: 'high',
    ticket: r.ticketId ?? '',
    notes: r.notes ?? '',
    userEdited: false,
    userCreated: false
  }))
}

/** Epoch seconds at midnight on the local date `YYYY-MM-DD`. The renderer's
 *  past-day review feeds an arbitrary date here; "today" defers to the
 *  existing `localMidnightEpoch()`. */
function midnightOfDateEpoch(dateStr: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0)
  return Math.floor(d.getTime() / 1000)
}

/** Samples for one local date: [midnight, midnight+24h). For today this
 *  collapses to "everything since local midnight" — same data as runSummary
 *  used to read directly. */
function samplesForDate(dateStr: string): ReturnType<typeof getSamplesSince> {
  const start = midnightOfDateEpoch(dateStr)
  if (start === null) return []
  // Inclusive lower bound, exclusive upper bound — same shape as the today
  // path, with the day's end pinned to midnight+86400 rather than "now".
  const end = start + 86400
  // Fetch back one max-session span so a sample that STARTED before midnight
  // but ran into this day is included, then clamp every sample to the day's
  // bounds — midnight-spanning time is attributed to the day it occurred in
  // instead of wholly to the start day.
  return getSamplesSince(start - MAX_SESSION_S)
    .filter((s) => s.endTs > start && s.startTs < end)
    .map((s) => {
      const startTs = Math.max(s.startTs, start)
      const endTs = Math.min(s.endTs, end)
      return { ...s, startTs, endTs, durationS: endTs - startTs }
    })
    .filter((s) => s.durationS > 0)
}

async function runSummaryForDate(dateStr: string): Promise<ReviewResult> {
  const samples = samplesForDate(dateStr)
  // summarizeDay never fails now: a configured AI provider runs first, and on
  // any error it falls back to the deterministic algorithmic grouping. `meta`
  // records which path ran (and whether it was a fallback) for the panel label.
  const { blocks, meta } = await summarizeDay(samples)
  lastSummaryRawByDate.set(dateStr, blocks.length > 0 ? JSON.stringify(blocks) : null)
  return { ok: true, blocks, meta }
}

async function runSummary(): Promise<ReviewResult> {
  return runSummaryForDate(localDateStr())
}

// --- OS notifications ---
//
// Two firing points: alert (close approaching) and talking (review open). Both
// gated by the osNotificationEnabled setting. Clicking either notification
// brings the review forward — for the alert it's effectively "open it now",
// for the talking notification it just refocuses the panel we already opened.
function fireOsNotification(title: string, body: string, onClick: () => void): void {
  if (!getSettings().osNotificationEnabled) return
  if (!Notification.isSupported()) {
    console.warn('[notify] OS notifications not supported on this platform — skipping')
    return
  }
  const n = new Notification({ title, body, silent: false })
  n.on('click', onClick)
  n.show()
}

function notifyAlert(): void {
  const phrase = getSettings().voicePhrase || '30 minutes until end of day'
  fireOsNotification('Time-Tracking Buddy', phrase, () => requestManualReview())
}

function notifyReviewReady(): void {
  fireOsNotification('Time-Tracking Buddy', 'Your end-of-day review is ready.', () => {
    // Re-focus the existing panel if it's open; otherwise opening a manual
    // review path is the right next step.
    if (chatWindow && !chatWindow.isDestroyed()) {
      chatWindow.show()
      chatWindow.focus()
    } else {
      requestManualReview()
    }
  })
}

// Manual review flag — set by tray "Open end-of-day review now", companion
// right-click "Open end-of-day review now", and the notification-click path.
// Bypasses the "already saved today → skip auto-open" gate so the user can
// always re-open a saved day to inspect or refine it.
let manualReviewRequested = false

// Once-per-day guard for the "your end-of-day review is ready" notification.
// Fires AT MOST ONCE per local date, only on the automatic close-hour trigger,
// only after the summarize finishes successfully. In-memory only — a restart
// clears it (acceptable: a restart mid-day before review SHOULD re-prompt).
let lastAutoReviewNotifyDate: string | null = null

function sendState(): void {
  if (pendingState && chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.webContents.send('review:state', pendingState)
  }
}

/** Open the review panel for a specific date (defaults to today).
 *  Precedence: in-session cache > saved time_entries > summarizeDay. For
 *  past dates with no samples and no saved entries, returns an 'empty'
 *  state — the panel still opens so the user can add manual blocks.
 *
 *  `isAuto` is true ONLY when the call originates from the scheduler's
 *  natural close-hour transition (not from any manual path). It gates the
 *  "your end-of-day review is ready" OS notification — that notification
 *  fires once per day, after a successful fresh summarize, and never on
 *  manual / past-day / cache / saved / empty / error paths. */
async function beginReview(dateArg?: string, isAuto = false): Promise<void> {
  const date = dateArg ?? localDateStr()
  activeReviewDate = date
  pendingState = null
  createChatWindow()

  const cached = reviewCache.get(date)
  if (cached) {
    pendingState = { source: 'cache', blocks: cached.blocks, chatLog: cached.chatLog, date }
    console.log(`[review] restored cached draft for ${date} (${cached.blocks.length} block(s)); skipped summarize`)
    sendState()
    return
  }

  const saved = loadSavedBlocks(date)
  if (saved.length > 0) {
    pendingState = { source: 'saved', blocks: saved, chatLog: [], date }
    console.log(`[review] loaded ${saved.length} saved entries for ${date} from time_entries; skipped summarize`)
    sendState()
    return
  }

  // Today's in-flight tracker session isn't in the DB yet — flush it first so
  // the last <=30 minutes of activity make it into the summary.
  if (date === localDateStr()) flushBuffer()

  // No cache and no saved entries — see if there's any raw activity to
  // summarize. For past dates that have been pruned (or were never tracked)
  // we surface 'empty' rather than running an LLM on zero samples.
  const samples = samplesForDate(date)
  if (samples.length === 0) {
    pendingState = { source: 'empty', blocks: [], chatLog: [], date }
    console.log(`[review] no samples for ${date} — opening panel empty (manual entry only)`)
    sendState()
    return
  }

  const result = await runSummaryForDate(date)
  // A second beginReview may have started while this summarize was in flight;
  // its state owns the panel now. Applying ours would show — and later save —
  // one date's blocks under another date.
  if (activeReviewDate !== date) {
    console.log(`[review] stale summarize for ${date} discarded (panel now on ${activeReviewDate})`)
    return
  }
  // A usable result is always produced (AI, or the algorithmic fallback). Empty
  // blocks mean there was nothing meaningful to group (e.g. only sub-threshold
  // noise) — show the friendly empty state rather than a barren block list.
  pendingState =
    result.blocks.length > 0
      ? { source: 'summary', blocks: result.blocks.map(toCached), chatLog: [], date, meta: result.meta }
      : { source: 'empty', blocks: [], chatLog: [], date, meta: result.meta }
  sendState()

  // OS "review ready" notification — fires ONCE per local date, ONLY when:
  //   1. The trigger was the automatic close-hour transition (isAuto), so
  //      manual paths (tray "Open review", companion menu, "Review a day…",
  //      History day-click, the notification's own onClick) never fire it.
  //   2. The fresh summarize finished SUCCESSFULLY — so clicking the
  //      notification shows blocks, not a spinner or an error banner.
  //   3. We haven't already fired today's auto-review notification (in-memory
  //      once-per-day guard).
  // The cache / saved / empty / error paths return earlier and never reach
  // here, so the notification is impossible from those branches.
  if (isAuto && result.blocks.length > 0 && lastAutoReviewNotifyDate !== date) {
    lastAutoReviewNotifyDate = date
    notifyReviewReady()
  }
}

/** Exit the review (scheduler leaves talking) and close the panel. The draft
 *  cache is cleared only on Discard; on Save it stays so an immediate reopen
 *  shows the just-saved state from cache (a restart falls back to time_entries).
 *  Cache key is the date the panel was reviewing (not necessarily today). */
function finishReview(clearCache: boolean, dateArg?: string): void {
  const date = dateArg ?? activeReviewDate ?? localDateStr()
  if (clearCache) reviewCache.delete(date)
  activeReviewDate = null
  endReview(date)
  if (chatWindow && !chatWindow.isDestroyed()) chatWindow.close()
}

function createCompanionWindow(): BrowserWindow {
  // Anchor to the bottom-right of the *work area* (excludes the taskbar/dock),
  // so the companion never hides behind OS chrome.
  const { workArea } = screen.getPrimaryDisplay()
  const { companionWidth, companionHeight } = getSettings()
  // Restore the saved position; fall back to the bottom-right default.
  const saved = readBounds('companion.bounds')
  const x = saved ? saved.x : workArea.x + workArea.width - companionWidth - SCREEN_MARGIN
  const y = saved ? saved.y : workArea.y + workArea.height - companionHeight - SCREEN_MARGIN

  const win = new BrowserWindow({
    width: companionWidth,
    height: companionHeight,
    x,
    y,
    minWidth: 40,
    minHeight: 40,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    // All six windows leave webPreferences at Electron's secure defaults
    // (sandbox/contextIsolation on, nodeIntegration off); the preload only
    // uses contextBridge + ipcRenderer, both available inside the sandbox.
    webPreferences: {
      preload: join(__dirname, '../preload/index.js')
    }
  })

  // 'screen-saver' is the highest level — keeps the companion above full-screen
  // apps and other always-on-top windows.
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  // The window covers a 200x200 region but most of it is transparent. Start in
  // click-through mode so clicks pass to whatever is underneath; `forward: true`
  // still delivers mouse-move events to the page so the renderer can detect when
  // the cursor is over the sprite and ask us to re-enable interaction.
  win.setIgnoreMouseEvents(true, { forward: true })

  win.on('ready-to-show', () => win.show())
  win.on('closed', () => {
    companionWindow = null
  })

  // Push the current scheduler state once the page is ready. This covers the
  // startup race (scheduler emits its first state before the renderer has
  // finished loading) and any window re-creation.
  win.webContents.on('did-finish-load', () => {
    const state = getCurrentState()
    if (state) win.webContents.send('companion:state', state)
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/companion/index.html`)
  } else {
    win.loadFile(join(__dirname, '../renderer/companion/index.html'))
  }

  return win
}

/** The end-of-day review panel. Anchored to the left of the companion orb.
 *  Real summarized blocks are delivered over IPC once the page is ready. */
function createChatWindow(): BrowserWindow {
  if (chatWindow) {
    chatWindow.show()
    chatWindow.focus()
    return chatWindow
  }

  // Anchor to the display the companion actually lives on — the user may have
  // dragged it to a secondary monitor; the primary display would open the
  // panel on the wrong screen.
  const display =
    companionWindow && !companionWindow.isDestroyed()
      ? screen.getDisplayMatching(companionWindow.getBounds())
      : screen.getPrimaryDisplay()
  const { workArea } = display
  const gap = 16
  const x = workArea.x + workArea.width - getSettings().companionWidth - SCREEN_MARGIN - CHAT_WIDTH - gap
  const y = workArea.y + workArea.height - CHAT_HEIGHT - SCREEN_MARGIN

  const win = new BrowserWindow({
    width: CHAT_WIDTH,
    height: CHAT_HEIGHT,
    x: Math.max(workArea.x + SCREEN_MARGIN, x),
    y,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js')
    }
  })

  win.on('ready-to-show', () => {
    win.show()
    win.focus()
  })
  win.on('closed', () => {
    chatWindow = null
  })

  // If the state was prepared before the page finished loading, deliver it now.
  win.webContents.on('did-finish-load', () => {
    if (pendingState) win.webContents.send('review:state', pendingState)
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/chat/index.html`)
  } else {
    win.loadFile(join(__dirname, '../renderer/chat/index.html'))
  }

  chatWindow = win
  return win
}

/** The settings window. Framed (normal title bar), resizable, not modal,
 *  not always-on-top. Closing it does not quit the app. */
function createSettingsWindow(): BrowserWindow {
  if (settingsWindow) {
    settingsWindow.show()
    settingsWindow.focus()
    return settingsWindow
  }

  const win = new BrowserWindow({
    width: SETTINGS_WIDTH,
    height: SETTINGS_HEIGHT,
    show: false,
    resizable: true,
    minimizable: true,
    maximizable: false,
    skipTaskbar: false,
    title: 'Companion Settings',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js')
    }
  })

  win.setMenuBarVisibility(false)
  win.on('ready-to-show', () => win.show())
  win.on('closed', () => {
    settingsWindow = null
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/settings/index.html`)
  } else {
    win.loadFile(join(__dirname, '../renderer/settings/index.html'))
  }

  settingsWindow = win
  return win
}

/** True iff the scratchpad window is currently open. Drives the companion's
 *  "reading" overlay state — read on companion init and on every open/close. */
function isScratchpadOpen(): boolean {
  return scratchpadWindow !== null && !scratchpadWindow.isDestroyed()
}

function broadcastReading(reading: boolean): void {
  companionWindow?.webContents.send('companion:reading', reading)
}

/** The persistent scratchpad. Framed, resizable, position+size persisted across
 *  restarts (scratchpad.bounds). Works concurrently with the chat panel.
 *  Opening it puts the companion into "reading" overlay; closing clears it. */
function createScratchpadWindow(): BrowserWindow {
  if (scratchpadWindow) {
    scratchpadWindow.show()
    scratchpadWindow.focus()
    broadcastReading(true) // idempotent re-assert; renderer dedupes on transition
    return scratchpadWindow
  }

  const saved = readBounds('scratchpad.bounds')
  const win = new BrowserWindow({
    width: saved?.width ?? SCRATCHPAD_WIDTH,
    height: saved?.height ?? SCRATCHPAD_HEIGHT,
    x: saved?.x,
    y: saved?.y,
    show: false,
    resizable: true,
    minimizable: true,
    maximizable: false,
    skipTaskbar: false,
    title: 'Scratchpad',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js')
    }
  })

  win.setMenuBarVisibility(false)
  win.on('ready-to-show', () => win.show())

  // Persist bounds on move/resize (debounced).
  let boundsTimer: NodeJS.Timeout | null = null
  const persistBounds = (): void => {
    if (boundsTimer) clearTimeout(boundsTimer)
    boundsTimer = setTimeout(() => {
      if (!win.isDestroyed()) setSetting('scratchpad.bounds', JSON.stringify(win.getBounds()))
    }, 400)
  }
  win.on('moved', persistBounds)
  win.on('resized', persistBounds)

  // Cancel any pending bounds debounce before tearing down. The setTimeout
  // would otherwise fire and call setSetting on a destroyed window; the
  // isDestroyed() guard inside catches it but the timer still wastes a tick
  // and (rarely) writes a stale rect. Clearing here is cheap and tidy.
  win.on('closed', () => {
    if (boundsTimer) {
      clearTimeout(boundsTimer)
      boundsTimer = null
    }
    scratchpadWindow = null
    broadcastReading(false)
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/scratchpad/index.html`)
  } else {
    win.loadFile(join(__dirname, '../renderer/scratchpad/index.html'))
  }

  scratchpadWindow = win
  broadcastReading(true)
  return win
}

/** The History/Reports window. Framed, resizable, bounds persisted. Read-only
 *  (view + CSV export only). Independent of scratchpad/chat — you can
 *  have several of these open in concept; we keep it single-instance for now. */
function createHistoryWindow(): BrowserWindow {
  if (historyWindow) {
    historyWindow.show()
    historyWindow.focus()
    return historyWindow
  }

  const saved = readBounds('history.bounds')
  const win = new BrowserWindow({
    width: saved?.width ?? HISTORY_WIDTH,
    height: saved?.height ?? HISTORY_HEIGHT,
    x: saved?.x,
    y: saved?.y,
    show: false,
    resizable: true,
    minimizable: true,
    maximizable: true,
    skipTaskbar: false,
    title: 'History',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js')
    }
  })

  win.setMenuBarVisibility(false)
  win.on('ready-to-show', () => win.show())

  // Persist bounds (debounced) — same pattern as the scratchpad.
  let boundsTimer: NodeJS.Timeout | null = null
  const persistBounds = (): void => {
    if (boundsTimer) clearTimeout(boundsTimer)
    boundsTimer = setTimeout(() => {
      if (!win.isDestroyed()) setSetting('history.bounds', JSON.stringify(win.getBounds()))
    }, 400)
  }
  win.on('moved', persistBounds)
  win.on('resized', persistBounds)

  // Clear the bounds debounce timer on close so it doesn't fire on a
  // destroyed window (the isDestroyed() guard catches it but this is tidier).
  win.on('closed', () => {
    if (boundsTimer) {
      clearTimeout(boundsTimer)
      boundsTimer = null
    }
    historyWindow = null
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/history/index.html`)
  } else {
    win.loadFile(join(__dirname, '../renderer/history/index.html'))
  }

  historyWindow = win
  return win
}

/** Assemble the History payload for a date range. Reads time_entries + matching
 *  reflections, groups by date, computes per-day and grand totals + per-ticket
 *  breakdown. Read-only — no writes anywhere in this path. */
function buildHistoryRange(fromDate: string, toDate: string): HistoryRange {
  const rows = getTimeEntriesInRange(fromDate, toDate)
  const reflections = getReflectionsInRange(fromDate, toDate)

  // Group entries by their date string.
  const byDate = new Map<string, HistoryEntry[]>()
  let totalMinutes = 0
  const perTicketMins = new Map<string, number>()

  for (const r of rows) {
    const minutes = Math.round(r.durationS / 60)
    const entry: HistoryEntry = {
      start: epochToHHMM(r.startTs),
      end: epochToHHMM(r.endTs),
      durationMinutes: minutes,
      label: r.label,
      ticket: r.ticketId ?? '',
      notes: r.notes ?? ''
    }
    const list = byDate.get(r.date) ?? []
    list.push(entry)
    byDate.set(r.date, list)
    totalMinutes += minutes
    const tk = entry.ticket || '(no ticket)'
    perTicketMins.set(tk, (perTicketMins.get(tk) ?? 0) + minutes)
  }

  const days: HistoryDay[] = [...byDate.keys()]
    .sort()
    .map((date) => ({ date, entries: byDate.get(date)!, reflection: reflections.get(date) ?? '' }))

  // Sort tickets by minutes desc; push "(no ticket)" to the end regardless so
  // real tickets dominate the invoicing view.
  const perTicket = [...perTicketMins.entries()]
    .map(([ticket, minutes]) => ({ ticket, minutes }))
    .sort((a, b) => {
      if (a.ticket === '(no ticket)') return 1
      if (b.ticket === '(no ticket)') return -1
      return b.minutes - a.minutes
    })

  return { fromDate, toDate, days, totalMinutes, perTicket }
}

// --- tray action helpers (declared up here so createTray can wire them by reference) ---

/** Open Save dialog, then run a checkpoint-then-copy backup to the chosen
 *  path. Show a results dialog so the user gets confirmation either way. */
async function backupNowViaDialog(): Promise<void> {
  const suggested = `companion-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.db`
  const res = await dialog.showSaveDialog({
    title: 'Backup database',
    defaultPath: suggested,
    filters: [{ name: 'SQLite database', extensions: ['db'] }]
  })
  if (res.canceled || !res.filePath) return
  const out = await runManualBackup(res.filePath)
  if (out.ok) {
    await dialog.showMessageBox({
      type: 'info',
      title: 'Backup complete',
      message: 'Backup written',
      detail: out.path
    })
  } else {
    await dialog.showMessageBox({
      type: 'error',
      title: 'Backup failed',
      message: 'Backup failed',
      detail: out.error
    })
  }
}

/** Manual-review request: set the bypass flag, then transition the orb into
 *  talking. The scheduler callback below sees the flag and runs beginReview
 *  even if today is already saved. */
function requestManualReview(): void {
  // Already talking (e.g. the panel was closed via Alt+F4, so no save/discard
  // reset the state): forceState('talking') is a same-state no-op and the
  // scheduler callback never fires — open the review directly.
  if (getCurrentState() === 'talking') {
    void beginReview()
    return
  }
  manualReviewRequested = true
  forceState('talking')
}

/** "Review a day…" entry point — opens the small framed date-picker window.
 *  Picking a date in the picker fires the review:open-date IPC, which routes
 *  through beginReview(date). */
let datePickerWindow: BrowserWindow | null = null
function openReviewForDate(): void {
  if (datePickerWindow) {
    datePickerWindow.show()
    datePickerWindow.focus()
    return
  }
  const win = new BrowserWindow({
    width: 320,
    height: 180,
    show: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: false,
    title: 'Review a day',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js')
    }
  })
  win.setMenuBarVisibility(false)
  win.on('ready-to-show', () => {
    win.show()
    win.focus()
  })
  win.on('closed', () => {
    datePickerWindow = null
  })
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/date-picker/index.html`)
  } else {
    win.loadFile(join(__dirname, '../renderer/date-picker/index.html'))
  }
  datePickerWindow = win
}

/** Test affordance: push a one-shot "advance sleep depth" signal to the
 *  companion window. The renderer-side state machine ignores it outside the
 *  sleeping state and clamps at max depth, so it's safe to spam from the tray. */
function advanceSleepDepth(): void {
  companionWindow?.webContents.send('companion:advance-sleep-depth')
}

/** Confirm + DELETE FROM time_entries WHERE date = today. Also drops the
 *  in-session draft cache for today so a subsequent review opens fresh. The
 *  daily reflection is NOT touched (kept intentionally — reflection is the
 *  journal, entries are the billing record). */
async function deleteTodayEntriesWithConfirm(): Promise<void> {
  const date = localDateStr()
  const existing = countTimeEntries(date)
  if (existing === 0) {
    await dialog.showMessageBox({
      type: 'info',
      title: "No entries to delete",
      message: `No saved entries for ${date}.`
    })
    return
  }
  const res = await dialog.showMessageBox({
    type: 'warning',
    title: "Delete today's entries?",
    message: `Delete all ${existing} saved entr${existing === 1 ? 'y' : 'ies'} for ${date}?`,
    detail: 'This removes the billing record for today. Your daily reflection is kept.',
    buttons: ['Delete', 'Cancel'],
    defaultId: 1,
    cancelId: 1
  })
  if (res.response !== 0) return
  const removed = deleteTimeEntriesForDate(date)
  reviewCache.delete(date)
  console.log(`[review] deleted ${removed} entries for ${date}`)
  await dialog.showMessageBox({
    type: 'info',
    title: 'Deleted',
    message: `Deleted ${removed} entr${removed === 1 ? 'y' : 'ies'} for ${date}.`
  })
}

/** macOS only: reading window titles requires the Screen Recording permission
 *  (Accessibility helps for a few apps). Detect what's granted, log it, and — if
 *  Screen Recording is missing — point the user at the right System Settings
 *  pane. The app degrades gracefully either way: without the permission, capture
 *  still records which apps you use (titles come back empty) and the No-AI
 *  grouping + manual time entry work fully. Granting Screen Recording on macOS
 *  requires an app restart to take effect, so we tell the user that. No-op on
 *  Windows. */
function checkMacPermissions(): void {
  if (process.platform !== 'darwin') return
  // `screen` here is the imported module; the recording status is a separate
  // local to avoid shadowing it.
  const screenStatus = systemPreferences.getMediaAccessStatus('screen')
  const accessibility = systemPreferences.isTrustedAccessibilityClient(false)
  console.log(`[permissions] screen-recording=${screenStatus} accessibility=${accessibility}`)
  if (screenStatus === 'granted') return
  void dialog
    .showMessageBox({
      type: 'info',
      title: 'Enable activity capture',
      message: 'Time-Tracking Buddy needs Screen Recording permission to read window titles.',
      detail:
        'Without it the app still records which applications you use, and the No-AI grouping and ' +
        'manual time entry work normally — only window titles are unavailable.\n\n' +
        'Grant it in System Settings > Privacy & Security > Screen Recording, then restart the app.',
      buttons: ['Open System Settings', 'Continue without it'],
      defaultId: 0,
      cancelId: 1
    })
    .then((res) => {
      if (res.response === 0) {
        void shell.openExternal(
          'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
        )
      }
    })
}

// Single-instance guard: a second launch would run a second tracker against
// the same SQLite DB — double-counted samples, duplicate reviews, and
// node:sqlite SQLITE_BUSY errors on concurrent writes.
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    // The user tried to launch us again — surface the existing companion.
    companionWindow?.show()
    companionWindow?.focus()
  })
}

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return // quitting — don't initialise anything
  // Must match electron-builder.yml `appId` so Windows toast notifications and
  // taskbar grouping resolve to the installed shortcut.
  electronApp.setAppUserModelId('com.kokkinas.timetrackingbuddy')
  // macOS: this is a tray / menu-bar companion, not a Dock app — hide the Dock
  // icon (the macOS analog of the windows' skipTaskbar:true). The tray menu and
  // the companion overlay remain; quit from the tray.
  if (process.platform === 'darwin') app.dock?.hide()
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
    // No window in this app legitimately opens child windows or navigates away
    // from its bundled page — deny both, so a compromised renderer can't load
    // remote content with the preload bridge attached.
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event, url) => {
      const devBase = process.env['ELECTRON_RENDERER_URL']
      if ((devBase && url.startsWith(devBase)) || url.startsWith('file://')) return
      event.preventDefault()
      console.warn(`[security] blocked navigation to ${url}`)
    })
  })

  // Renderer toggles interactivity as the cursor moves on/off the sprite.
  ipcMain.on('companion:set-ignore-mouse', (_event, ignore: boolean) => {
    if (!companionWindow) return
    if (ignore) {
      companionWindow.setIgnoreMouseEvents(true, { forward: true })
    } else {
      companionWindow.setIgnoreMouseEvents(false)
    }
  })

  // Manual drag: the renderer computes the new top-left from the cursor's screen
  // position minus the grab offset and streams it here on every mousemove.
  ipcMain.on('companion:move-to', (_event, x: number, y: number) => {
    if (!companionWindow) return
    companionWindow.setPosition(Math.round(x), Math.round(y))
  })

  // Drag finished: persist the companion's position so it restores next launch.
  ipcMain.on('companion:drag-end', () => saveCompanionBounds())

  // Right-click context menu on the companion (user-facing items only — no
  // dev/test items). Popped at the cursor over the companion window.
  ipcMain.on('companion:show-context-menu', (event) => {
    const menu = Menu.buildFromTemplate([
      { label: 'Settings', click: () => createSettingsWindow() },
      { label: 'Scratchpad', click: () => createScratchpadWindow() },
      { label: 'History', click: () => createHistoryWindow() },
      { label: 'Hide companion', click: () => companionWindow?.hide() },
      {
        label: isPaused() ? 'Resume capture' : 'Pause capture',
        click: () => (isPaused() ? resumeCapture() : pauseCapture())
      },
      { type: 'separator' },
      { label: 'Open end-of-day review now', click: () => requestManualReview() },
      { label: 'Review a day…', click: () => openReviewForDate() },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() }
    ])
    const win = BrowserWindow.fromWebContents(event.sender)
    menu.popup(win ? { window: win } : {})
  })

  // Companion reads its avatar on init; live swaps arrive via 'companion:avatar'.
  ipcMain.handle('companion:get-avatar', (): string => getSettings().avatar)

  // Companion reads its voice config on init; updates arrive via 'companion:voice'.
  ipcMain.handle('companion:get-voice', () => ({
    enabled: getSettings().voiceEnabled,
    phrase: getSettings().voicePhrase,
    voiceName: getSettings().voiceName
  }))

  // Companion reads "is scratchpad open" on init so it starts in reading
  // if the user already had the scratchpad up when the companion came back.
  // Live updates arrive via 'companion:reading'.
  ipcMain.handle('companion:get-reading', (): boolean => isScratchpadOpen())

  // The review panel reads the active provider to disable chat refine in No-AI
  // mode and pick provider-aware error wording.
  ipcMain.handle('ai:active-provider', (): string => getSettings().aiProvider)

  // Settings asks which AI providers are present (to enable/grey the options).
  // Cached probe results from startup detection; "none" is always available.
  ipcMain.handle('ai:provider-status', (): { ollama: boolean; claude: boolean } => ({
    ollama: isOllamaAvailable(),
    claude: isClaudeAvailable()
  }))

  // Re-run detection on demand (the Settings "Re-check" button) — the user may
  // have started Ollama or installed the claude CLI after opening Settings.
  ipcMain.handle(
    'ai:redetect-providers',
    async (): Promise<{ ollama: boolean; claude: boolean }> => {
      const [ollama, claude] = await Promise.all([detectOllama(), detectClaude()])
      return { ollama, claude }
    }
  )

  // --- review panel IPC ---

  // Retry button: re-run the summary for the panel's active date and return
  // the fresh result directly. The renderer applies it and pushes the new
  // state back to the cache. Falls back to today's summary if the panel
  // somehow asked before activeReviewDate was set.
  ipcMain.handle('review:summarize', async (): Promise<ReviewResult> =>
    runSummaryForDate(activeReviewDate ?? localDateStr())
  )

  // One chat turn. On failure, echo the current blocks back unchanged and pass
  // the reason ('transport' vs 'parse') so the renderer words the reply right.
  ipcMain.handle(
    'review:refine',
    async (_event, payload: { message: string; blocks: DayBlock[] }): Promise<RefineResult> => {
      const res = await refineBlocks(payload.message, payload.blocks)
      if (!res.ok) return { ok: false, reply: '', blocks: payload.blocks, reason: res.error }
      return { ok: true, reply: res.reply, blocks: res.blocks }
    }
  )

  // Cache the panel's full state so reopening restores it without
  // re-summarizing. The renderer names the date it is reviewing — main's
  // activeReviewDate may already be null by the time the close-time
  // beforeunload flush arrives.
  ipcMain.on(
    'review:update-cache',
    (_event, payload: { date?: string; blocks: CachedBlock[]; chatLog: ChatMessage[] }) => {
      const date =
        payload.date && isValidDateStr(payload.date) ? payload.date : (activeReviewDate ?? localDateStr())
      reviewCache.set(date, { blocks: payload.blocks, chatLog: payload.chatLog })
    }
  )

  // Persist to time_entries (atomic). Verbose logging + pre-validation.
  // On ANY failure: log it, return the reason, and DO NOT close the panel.
  // Writes to the active review date (not always today).
  ipcMain.handle('review:save', (_event, payload: { date?: string; blocks: DayBlock[] }): SaveResult => {
    // The renderer names the date it is saving — an overlapping beginReview
    // can move activeReviewDate while this panel is still open.
    const date =
      payload.date && isValidDateStr(payload.date) ? payload.date : (activeReviewDate ?? localDateStr())
    const createdAt = nowSeconds()
    const blocks = payload.blocks
    console.log(`[review] save requested: ${blocks.length} block(s) for ${date}`)

    const failSave = (reason: string): SaveResult => {
      console.error(`[review] save REJECTED: ${reason}`)
      return { ok: false, error: reason }
    }

    if (blocks.length === 0) return failSave('no blocks to save')

    // Pre-validate every block, logging the computed epochs as we go.
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i]
      const startTs = hhmmToEpochSeconds(date, b.start)
      const endTs = hhmmToEpochSeconds(date, b.end)
      const tag = `block ${i + 1}${b.label ? ` ("${b.label}")` : ''}`
      console.log(
        `[review]   ${tag}: start="${b.start}"->${startTs} end="${b.end}"->${endTs} dur=${b.durationMinutes}m ticket="${b.ticket ?? ''}"`
      )
      if (startTs === null) return failSave(`${tag}: invalid start time "${b.start}"`)
      if (endTs === null) return failSave(`${tag}: invalid end time "${b.end}"`)
      if (endTs < startTs) return failSave(`${tag}: end (${b.end}) is before start (${b.start})`)
    }

    try {
      const rows: TimeEntryRow[] = blocks.map((b) => ({
        date,
        startTs: hhmmToEpochSeconds(date, b.start),
        endTs: hhmmToEpochSeconds(date, b.end),
        durationS: Math.round(b.durationMinutes * 60),
        label: b.label,
        ticketId: b.ticket && b.ticket.trim() ? b.ticket.trim() : null,
        notes: b.notes && b.notes.trim() ? b.notes : null,
        rawSummary: lastSummaryRawByDate.get(date) ?? null,
        createdAt
      }))
      replaceTimeEntries(date, rows)
      const readBack = countTimeEntries(date)
      console.log(
        `[review] saved ${rows.length} entries for ${date} (REPLACE); read-back: ${readBack} row(s) now exist for ${date}`
      )
      finishReview(false, date) // keep the cache so an immediate reopen shows this state
      return { ok: true, count: rows.length }
    } catch (err) {
      console.error('[review] save FAILED with exception:', err)
      return failSave(err instanceof Error ? err.message : String(err))
    }
  })

  // Discard: confirm happens in the renderer. Drops the in-session draft cache
  // but leaves time_entries untouched (a previously saved day stays saved).
  // The renderer names its date for the same race reason as review:save.
  ipcMain.on('review:discard', (_event, payload?: { date?: string }) =>
    finishReview(true, payload?.date && isValidDateStr(payload.date) ? payload.date : undefined)
  )

  // --- settings IPC ---

  ipcMain.handle('settings:get', (): Settings => getSettings())

  // One field changed: persist it, then live-apply just that subsystem.
  // Allowlist: the settings table also holds internal keys (window bounds,
  // scratchpad text) that renderers must not be able to overwrite through
  // this generic channel.
  const settingsKeys = new Set(Object.keys(DEFAULT_SETTINGS))
  ipcMain.on('settings:update', (_event, payload: { key: string; value: string }) => {
    if (
      typeof payload?.key !== 'string' ||
      typeof payload?.value !== 'string' ||
      !settingsKeys.has(payload.key)
    ) {
      console.warn(`[settings] update rejected: unknown key "${String(payload?.key)}"`)
      return
    }
    updateSetting(payload.key, payload.value)
    applySettingChange(payload.key)
  })

  // Reset everything to defaults, re-apply, and return them to repopulate the form.
  ipcMain.handle('settings:reset-all', (): Settings => {
    const s = resetAllSettings()
    applyAllSettings()
    return s
  })

  ipcMain.on('settings:reset-companion-position', () => resetCompanionPosition())

  // The REAL OS login-item state (Settings reflects this, not the stored flag).
  ipcMain.handle('settings:login-item-state', (): boolean => {
    const q = process.platform === 'win32' ? { path: process.execPath, args: [] as string[] } : undefined
    return app.getLoginItemSettings(q).openAtLogin
  })

  // --- daily reflection (independent of the review save/discard) ---

  ipcMain.handle('reflection:get', (_event, date: string): string => getReflection(date))
  ipcMain.on('reflection:save', (_event, payload: { date: string; text: string }) => {
    saveReflection(payload.date, payload.text, nowSeconds())
  })

  // --- scratchpad ---

  ipcMain.handle('scratchpad:get', (): string => getSetting('scratchpad.text') ?? '')
  ipcMain.on('scratchpad:save', (_event, text: string) => setSetting('scratchpad.text', text))

  // --- ticket autocomplete ---

  ipcMain.handle('tickets:list', (): string[] => getDistinctTickets())

  // --- review past day ---

  // Pick-a-date entry point. Sets the manual flag so the talking transition
  // doesn't skip auto-open, then runs the parameterized review.
  ipcMain.on('review:open-date', (_event, payload: { date: string }) => {
    if (!isValidDateStr(payload.date)) {
      console.warn(`[review] open-date rejected: malformed "${payload.date}"`)
      return
    }
    manualReviewRequested = true
    forceState('talking')
    void beginReview(payload.date)
  })

  // --- history (read-only) ---

  ipcMain.handle(
    'history:get',
    (_event, payload: { fromDate: string; toDate: string }): HistoryRange =>
      buildHistoryRange(payload.fromDate, payload.toDate)
  )

  // --- backup (manual: open save dialog, then copy + checkpoint) ---

  ipcMain.handle('db:backup-now', async (event): Promise<{ ok: boolean; path?: string; error?: string }> => {
    const parent = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const suggested = `companion-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.db`
    // Branch on the parent so each call picks the right showSaveDialog overload:
    // (window, options) when anchored to a window, (options) when parentless.
    const dialogOpts = {
      title: 'Backup database',
      defaultPath: suggested,
      filters: [{ name: 'SQLite database', extensions: ['db'] }]
    }
    const res = parent
      ? await dialog.showSaveDialog(parent, dialogOpts)
      : await dialog.showSaveDialog(dialogOpts)
    if (res.canceled || !res.filePath) return { ok: false, error: 'cancelled' }
    return runManualBackup(res.filePath)
  })

  // Write the History CSV to a user-chosen file. The renderer builds the CSV
  // (it owns the loaded range); clipboard copy remains available separately.
  ipcMain.handle(
    'history:export-csv',
    async (event, payload: { csv: string; suggestedName: string }): Promise<{ ok: boolean; path?: string; error?: string }> => {
      const parent = BrowserWindow.fromWebContents(event.sender) ?? undefined
      const dialogOpts = {
        title: 'Export CSV',
        defaultPath: payload.suggestedName,
        filters: [{ name: 'CSV', extensions: ['csv'] }]
      }
      const res = parent
        ? await dialog.showSaveDialog(parent, dialogOpts)
        : await dialog.showSaveDialog(dialogOpts)
      if (res.canceled || !res.filePath) return { ok: false, error: 'cancelled' }
      try {
        await fsp.writeFile(res.filePath, payload.csv, 'utf8')
        return { ok: true, path: res.filePath }
      } catch (err) {
        console.error('[history] CSV export failed:', err)
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  // A corrupt/unopenable DB must surface to the user and exit — an exception
  // escaping whenReady() leaves a zombie process with no window and no tray.
  try {
    initDb()
  } catch (err) {
    console.error('[db] failed to open database:', err)
    dialog.showErrorBox(
      'Time-Tracking Buddy — database error',
      `Could not open the database:\n${err instanceof Error ? err.message : String(err)}\n\n` +
        'The file may be corrupt. Backups live in the "backups" folder inside the app data ' +
        'directory — restore one over companion.db (with the app closed, and remove any ' +
        'companion.db-wal / companion.db-shm files), then start the app again.'
    )
    app.quit()
    return
  }
  // Best-effort auto-backup. Runs in the background so a slow disk doesn't
  // block startup; failures are logged but never propagated to the user.
  // The timer keeps a long-running tray instance backed up too — startup-only
  // backups left an unbounded data-loss window.
  void runAutoBackup()
  startBackupTimer()
  initSettings() // seed defaults on first run, load into cache
  void detectClaude() // probe the claude CLI once; cached for the Settings UI
  void detectOllama() // probe the Ollama host once; cached for the Settings UI
  const startup = getSettings()

  // Sync OS login item + push settings into the subsystems before anything runs.
  syncLoginItem(startup.startupOnBoot)
  setPollInterval(startup.captureIntervalSeconds)
  setExcludedRegexes(startup.excludedAppsRegex)
  setIdleDetection(startup.idleDetectionEnabled)
  setIdleThresholdMinutes(startup.idleThresholdMinutes)
  // Seed the non-tracking-day policy BEFORE startScheduler so the first
  // evaluate('startup') already knows whether today is a tracking day. (No
  // re-evaluate here: the scheduler isn't running yet — see setDayPolicy.)
  setDayPolicy(dayPolicyFromSettings(startup))

  // Retention: prune once at startup so a long-idle install reclaims storage,
  // then re-run every 24h so a long-running instance stays bounded too.
  runPrune()
  startPruneTimer()

  companionWindow = createCompanionWindow()

  // The scheduler owns tracker start/stop (it gates capture by work hours) and
  // is seeded with the work-hours schedule from settings. Entering talking
  // (real close-hour or a manual trigger) kicks off the review — but only if
  // today hasn't already been reviewed and saved. The DB is the source of
  // truth for "reviewed?", so a restart after save doesn't
  // re-trigger; manual paths set a flag to bypass that gate.
  startScheduler((state: CompanionState) => {
    companionWindow?.webContents.send('companion:state', state)
    if (state === 'alert') {
      notifyAlert()
    } else if (state === 'talking') {
      const todayHasSaved = countTimeEntries(localDateStr()) > 0
      const wasManual = manualReviewRequested
      manualReviewRequested = false
      if (wasManual || !todayHasSaved) {
        // isAuto = the talking transition was NOT user-requested. Drives
        // whether beginReview will fire the "review ready" OS notification
        // after its summarize completes (once-per-day, auto-only).
        void beginReview(undefined, !wasManual)
      } else {
        console.log(
          `[review] talking transition but ${localDateStr()} already has saved entries — not auto-opening`
        )
      }
    }
  }, scheduleFromSettings(startup))

  createTray({
    show: () => companionWindow?.show(),
    hide: () => companionWindow?.hide(),
    openSettings: () => createSettingsWindow(),
    openScratchpad: () => createScratchpadWindow(),
    openHistory: () => createHistoryWindow(),
    dumpLastHour: () => dumpLastHour(),
    flushBuffer: () => flushBuffer(),
    forceState: (state) => forceState(state),
    testSchedule: () => setTestSchedule(),
    resetSchedule: () => resetSchedule(),
    testSummarizeToday: () => void testSummarize(getSamplesSince(localMidnightEpoch()), 'today'),
    testSummarizeLast4h: () =>
      void testSummarize(getSamplesSince(nowSeconds() - 4 * 3600), 'last 4 hours'),
    printRequestOnly: () => printRequest(getSamplesSince(localMidnightEpoch())),
    // Route through the scheduler so the orb enters talking and the same
    // begin-review flow fires as at real close hour. Manual flag bypasses the
    // "already-saved → skip auto-open" gate.
    openReview: () => requestManualReview(),
    openReviewForDate: () => openReviewForDate(),
    backupNow: () => void backupNowViaDialog(),
    deleteTodayEntries: () => void deleteTodayEntriesWithConfirm(),
    advanceSleepDepth: () => advanceSleepDepth(),
    trackTodayAnyway: () => {
      // Flip today to a tracking day and re-evaluate FIRST, then resume capture.
      // resumeCapture() clears any manual pause and starts the tracker when the
      // (now re-evaluated) state wants it — without this, a prior manual pause
      // would leave startTracker() a no-op and capture would never resume.
      trackTodayAnyway()
      resumeCapture()
    }
  })

  // macOS permission check (no-op on Windows). Runs after the UI is up so the
  // guidance dialog has app context; non-blocking.
  checkMacPermissions()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      companionWindow = createCompanionWindow()
    }
  })
})

// This is a tray-resident overlay: closing the companion window must NOT quit the
// app. Quit happens only from the tray menu (or Cmd+Q on macOS by convention).
app.on('window-all-closed', () => {
  // Intentionally empty.
})

// On quit, stop the scheduler and flush the in-flight session while the DB is
// still open. The DB itself must NOT close here: before-quit fires BEFORE the
// windows close, and the renderers' beforeunload flushes (scratchpad text,
// reflection saves, review-cache pushes) arrive as the windows go down.
app.on('before-quit', () => {
  stopScheduler()
  stopTracker()
})

// will-quit fires after every window has closed, so the renderers' final IPC
// writes have been processed — now the DB can close.
app.on('will-quit', () => {
  closeDb()
})
