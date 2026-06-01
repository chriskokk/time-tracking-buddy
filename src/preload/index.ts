// SPDX-License-Identifier: AGPL-3.0-or-later
import { contextBridge, ipcRenderer } from 'electron'
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
  HistoryRange
} from '../shared/types'

// The single, typed surface the renderer is allowed to touch. Everything the
// companion window can do to the main process flows through here — keeping
// `contextIsolation` intact (no direct `ipcRenderer`/`require` in the page).
const api = {
  /** Toggle click-through. `false` = the window captures the mouse (cursor is
   *  over the sprite); `true` = clicks pass through to whatever is underneath. */
  setIgnoreMouse: (ignore: boolean): void =>
    ipcRenderer.send('companion:set-ignore-mouse', ignore),

  /** Move the window's top-left to absolute screen coordinates (used by drag). */
  moveTo: (x: number, y: number): void =>
    ipcRenderer.send('companion:move-to', x, y),

  /** Drag finished — main persists the companion's position (companion.bounds). */
  companionDragEnded: (): void => ipcRenderer.send('companion:drag-end'),

  /** Subscribe to companion-state changes pushed by the scheduler. */
  onCompanionState: (cb: (state: CompanionState) => void): void => {
    ipcRenderer.on('companion:state', (_event, state: CompanionState) => cb(state))
  },

  /** Ask main to pop the companion right-click context menu at the cursor. */
  showContextMenu: (): void => ipcRenderer.send('companion:show-context-menu'),

  /** The configured avatar name, read on companion init. */
  companionGetAvatar: (): Promise<string> => ipcRenderer.invoke('companion:get-avatar'),
  /** Live avatar swap pushed by main when the avatar setting changes. */
  onAvatarChange: (cb: (name: string) => void): void => {
    ipcRenderer.on('companion:avatar', (_event, name: string) => cb(name))
  },

  /** Voice config (enabled + phrase + voice name), read on companion init. */
  companionGetVoice: (): Promise<{ enabled: boolean; phrase: string; voiceName: string }> =>
    ipcRenderer.invoke('companion:get-voice'),
  /** Live voice-config updates pushed by main when the voice settings change. */
  onVoiceChange: (cb: (cfg: { enabled: boolean; phrase: string; voiceName: string }) => void): void => {
    ipcRenderer.on('companion:voice', (_event, cfg: { enabled: boolean; phrase: string; voiceName: string }) =>
      cb(cfg)
    )
  },

  /** Is the scratchpad currently open? Read on companion init so the companion
   *  starts in "reading" if the scratchpad was already open at companion start. */
  companionGetReading: (): Promise<boolean> => ipcRenderer.invoke('companion:get-reading'),
  /** Live reading-state push (true when scratchpad opens, false when it closes). */
  onReadingChange: (cb: (reading: boolean) => void): void => {
    ipcRenderer.on('companion:reading', (_event, reading: boolean) => cb(reading))
  },

  /** Manual sleep-depth bump from the Advanced tray menu (test affordance —
   *  saves having to wait 90s/3min/5min to verify each depth's visuals). */
  onAdvanceSleepDepth: (cb: () => void): void => {
    ipcRenderer.on('companion:advance-sleep-depth', () => cb())
  },

  // --- end-of-day review (chat panel) ---

  /** Initial state pushed by main on open: fresh summary, cached state, or error. */
  onReviewState: (cb: (state: ReviewState) => void): void => {
    ipcRenderer.on('review:state', (_event, state: ReviewState) => cb(state))
  },
  /** Push the panel's full state up to main so it's cached for the next open. */
  reviewUpdateCache: (payload: { blocks: CachedBlock[]; chatLog: ChatMessage[] }): void =>
    ipcRenderer.send('review:update-cache', payload),
  /** Re-run the summary (the Retry button). */
  reviewSummarize: (): Promise<ReviewResult> => ipcRenderer.invoke('review:summarize'),
  /** Apply one chat instruction to the current blocks via the refine prompt. */
  reviewRefine: (message: string, blocks: DayBlock[]): Promise<RefineResult> =>
    ipcRenderer.invoke('review:refine', { message, blocks }),
  /** Persist the blocks to time_entries; main closes the panel on success. */
  reviewSave: (blocks: DayBlock[]): Promise<SaveResult> =>
    ipcRenderer.invoke('review:save', { blocks }),
  /** Discard the review: main closes the panel and exits talking. */
  reviewDiscard: (): void => ipcRenderer.send('review:discard'),
  /** Open the review panel for a specific date (past-day review). */
  reviewOpenDate: (date: string): void => ipcRenderer.send('review:open-date', { date }),

  /** Distinct previously-used ticket IDs — drives the ticket autocomplete. */
  ticketsList: (): Promise<string[]> => ipcRenderer.invoke('tickets:list'),

  // --- settings window ---

  /** Read the current settings (to populate the form). */
  settingsGet: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
  /** Persist + live-apply one setting (value already stringified). */
  settingsUpdate: (key: string, value: string): void =>
    ipcRenderer.send('settings:update', { key, value }),
  /** Reset all settings to defaults; returns the new settings to repopulate. */
  settingsResetAll: (): Promise<Settings> => ipcRenderer.invoke('settings:reset-all'),
  /** Move the companion back to its default corner. */
  settingsResetCompanionPosition: (): void => ipcRenderer.send('settings:reset-companion-position'),

  // --- daily reflection (chat panel) ---

  reflectionGet: (date: string): Promise<string> => ipcRenderer.invoke('reflection:get', date),
  reflectionSave: (date: string, text: string): void =>
    ipcRenderer.send('reflection:save', { date, text }),

  // --- scratchpad window ---

  scratchpadGet: (): Promise<string> => ipcRenderer.invoke('scratchpad:get'),
  scratchpadSave: (text: string): void => ipcRenderer.send('scratchpad:save', text),

  // --- history (read-only) ---

  /** Load saved entries + reflections in [fromDate, toDate], with totals. */
  historyGet: (fromDate: string, toDate: string): Promise<HistoryRange> =>
    ipcRenderer.invoke('history:get', { fromDate, toDate }),

  // --- backup ---

  /** Open the native Save dialog, then checkpoint + copy the DB. */
  dbBackupNow: (): Promise<{ ok: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke('db:backup-now'),

  // --- AI provider (settings) ---

  /** The currently-configured AI provider ("ollama" | "claude-code" | "none").
   *  The review panel reads this to disable chat refine + pick provider-aware
   *  error wording. */
  aiActiveProvider: (): Promise<string> => ipcRenderer.invoke('ai:active-provider'),
  /** Cached availability of each detectable provider (probed at startup). */
  aiProviderStatus: (): Promise<{ ollama: boolean; claude: boolean }> =>
    ipcRenderer.invoke('ai:provider-status'),
  /** Re-run detection now (the Settings "Re-check" button) and return fresh state. */
  aiRedetectProviders: (): Promise<{ ollama: boolean; claude: boolean }> =>
    ipcRenderer.invoke('ai:redetect-providers'),

  // --- startup / login item ---

  /** The REAL OS login-item state (not the stored flag) — reflects whether the
   *  app is actually registered to launch at startup. */
  settingsLoginItemState: (): Promise<boolean> =>
    ipcRenderer.invoke('settings:login-item-state')
}

export type CompanionApi = typeof api

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // Fallback for the (unused) non-isolated case. Context isolation is on, so
  // this branch never runs; `globalThis` keeps it valid under the Node tsconfig.
  ;(globalThis as Record<string, unknown>).api = api
}
