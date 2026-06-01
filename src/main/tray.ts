// SPDX-License-Identifier: AGPL-3.0-or-later
import { app, Menu, Tray, nativeImage } from 'electron'
import type { CompanionState } from '../shared/types'
// `?asset` is resolved by electron-vite: the file is copied next to the bundled
// main process and this import becomes the absolute path to it at runtime. This
// is the one reliable way to reference a static asset that works in both `dev`
// and a packaged build.
import trayIconPath from '../../assets/tray-icon.png?asset'

export interface TrayActions {
  show: () => void
  hide: () => void
  dumpLastHour: () => void
  flushBuffer: () => void
  forceState: (state: CompanionState) => void
  testSchedule: () => void
  resetSchedule: () => void
  testSummarizeToday: () => void
  testSummarizeLast4h: () => void
  printRequestOnly: () => void
  openReview: () => void
  openReviewForDate: () => void
  openSettings: () => void
  openScratchpad: () => void
  openHistory: () => void
  backupNow: () => void
  deleteTodayEntries: () => void
  advanceSleepDepth: () => void
  trackTodayAnyway: () => void
}

let tray: Tray | null = null

export function createTray(actions: TrayActions): Tray {
  let icon = nativeImage.createFromPath(trayIconPath)
  // macOS menu bar is ~22px tall, so the 64px brand icon must be downscaled to
  // render crisply. We keep it in COLOR (not a template image) so Musko stays
  // recognizable. On Windows the system tray scales the icon itself.
  if (process.platform === 'darwin' && !icon.isEmpty()) {
    icon = icon.resize({ width: 18, height: 18 })
  }
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon)
  tray.setToolTip('Time-Tracking Buddy')

  // Main tray is lean: 4 window items, the EoD review trigger, Advanced (all
  // diagnostics nested one level deeper, including the existing Force state
  // two-level submenu), Quit. Nothing is gated by build mode — Advanced just
  // makes the dev-only items less prominent for personal-power-user use.
  const menu = Menu.buildFromTemplate([
    { label: 'Show companion', click: () => actions.show() },
    { label: 'Hide companion', click: () => actions.hide() },
    { label: 'Settings', click: () => actions.openSettings() },
    { label: 'Scratchpad', click: () => actions.openScratchpad() },
    { label: 'History', click: () => actions.openHistory() },
    { type: 'separator' },
    // Force tracking on for today even if it's a normally non-tracking day
    // (weekend / excluded date). One-shot: self-expires tomorrow.
    { label: 'Track today anyway', click: () => actions.trackTodayAnyway() },
    { label: 'Open end-of-day review now', click: () => actions.openReview() },
    { label: 'Review a day…', click: () => actions.openReviewForDate() },
    { label: 'Backup database…', click: () => actions.backupNow() },
    {
      label: 'Advanced',
      submenu: [
        { label: 'Dump last hour to console', click: () => actions.dumpLastHour() },
        { label: 'Flush buffer now', click: () => actions.flushBuffer() },
        { type: 'separator' },
        {
          label: 'Force state',
          submenu: [
            { label: 'Idle', click: () => actions.forceState('idle') },
            { label: 'Sleeping', click: () => actions.forceState('sleeping') },
            { label: 'Alert', click: () => actions.forceState('alert') },
            { label: 'Talking', click: () => actions.forceState('talking') }
          ]
        },
        { label: 'Test schedule (close in 2 min)', click: () => actions.testSchedule() },
        { label: 'Reset schedule', click: () => actions.resetSchedule() },
        { label: 'Advance sleep depth', click: () => actions.advanceSleepDepth() },
        { type: 'separator' },
        { label: 'Test summarize today', click: () => actions.testSummarizeToday() },
        { label: 'Test summarize last 4 hours', click: () => actions.testSummarizeLast4h() },
        { label: 'Print request only (no send)', click: () => actions.printRequestOnly() },
        { type: 'separator' },
        { label: "Delete today's entries…", click: () => actions.deleteTodayEntries() }
      ]
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ])

  tray.setContextMenu(menu)
  return tray
}
