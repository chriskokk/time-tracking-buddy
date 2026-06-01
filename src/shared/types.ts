// SPDX-License-Identifier: AGPL-3.0-or-later
/** User-configurable settings. Stored in the `settings` table as
 *  strings; this is the parsed/typed view. */
export interface Settings {
  workStartHour: string // "HH:MM"
  workCloseHour: string // "HH:MM"
  preCloseAlertMinutes: number
  captureIntervalSeconds: number
  excludedAppsRegex: string // one pattern per line
  ollamaHost: string
  ollamaModel: string
  companionWidth: number
  companionHeight: number
  startupOnBoot: boolean
  /** Which companion character: "musko" | "drago" | "gato". */
  avatar: string
  /** AI backend: "ollama" | "claude-code" | "none" (deterministic grouping). */
  aiProvider: string
  /** Claude Code model when aiProvider is "claude-code": "haiku" | "sonnet". */
  claudeCodeModel: string
  /** Speak a phrase when entering the alert state. */
  voiceEnabled: boolean
  voicePhrase: string
  /** Chosen speech voice name; "" = auto-pick a female English voice. */
  voiceName: string
  /** Raw activity_samples rows older than this many days are pruned. 0 = never. */
  activityRetentionDays: number
  /** Pause capture while the OS reports the user has been idle for >= the threshold. */
  idleDetectionEnabled: boolean
  idleThresholdMinutes: number
  /** Fire a native OS notification at alert + on review-open at close. */
  osNotificationEnabled: boolean
  /** Track on Saturdays/Sundays. When false, weekends are non-tracking days:
   *  capture pauses, the work-hours state machine doesn't run (no alert /
   *  talking / auto end-of-day), and the companion stays asleep. */
  trackWeekends: boolean
  /** Extra non-tracking dates (bank holidays, PTO), one YYYY-MM-DD per line.
   *  Same treatment as a non-tracking weekend day. */
  excludedDates: string
}

/** The four companion animation states. The scheduler drives these; the
 *  renderer maps each to a distinct animation. */
export type CompanionState = 'idle' | 'sleeping' | 'alert' | 'talking'

/** Self-reported confidence of a summarized block. Enum (not a float) because
 *  small models calibrate categorical confidence far better than 0–1 numbers. */
export type Confidence = 'low' | 'medium' | 'high'

/** A proposed work block returned by summarizeDay(). `start`/`end` are local
 *  HH:MM strings (per the timezone contract: epoch→local conversion happens at
 *  serialization). `durationMinutes` is recomputed in code from start/end — the
 *  model's own number is only advisory. */
export interface DayBlock {
  start: string
  end: string
  durationMinutes: number
  label: string
  confidence: Confidence
  /** Ticket/tag. Absent from summarize output; set during the review. */
  ticket?: string
  /** Private per-block note. NEVER sent to the LLM; persisted to time_entries.notes. */
  notes?: string
}

/** Which path actually produced a set of blocks. Drives the small "Summarized
 *  with…" label in the review panel and the `[ai] provider=… model=…` log line.
 *  `method` is the path that ran; `fellBack` is true when an AI provider was
 *  configured but the deterministic algorithmic grouping was used instead
 *  (provider unavailable, errored, timed out, or returned no usable output). */
export interface SummaryMeta {
  method: 'ollama' | 'claude-code' | 'algorithmic'
  /** Ollama model name, or "haiku"/"sonnet" for Claude Code. Absent for the
   *  algorithmic grouping (no model involved). */
  model?: string
  fellBack: boolean
  /** The provider the user configured, for the fallback label. */
  requested?: 'ollama' | 'claude-code' | 'none'
}

/** Result of the initial summarize (or a Retry). With the algorithmic fallback
 *  in place a usable result is ALWAYS produced, so `ok` is effectively always
 *  true; the `error` branch is retained only for defensive renderer handling.
 *  `meta` describes what actually ran (AI provider+model, or the no-AI grouping
 *  and whether it was a fallback). */
export interface ReviewResult {
  ok: boolean
  blocks: DayBlock[]
  provider?: 'ollama' | 'claude-code'
  meta?: SummaryMeta
}

/** Result of one chat refine turn. On `ok: false`, `blocks` echoes the current
 *  blocks unchanged so the renderer never loses state on a model failure, and
 *  `reason` distinguishes a provider outage ('transport') from the model not
 *  understanding the instruction ('parse') so the renderer can word the reply
 *  accordingly (provider-aware vs provider-agnostic). */
export interface RefineResult {
  ok: boolean
  reply: string
  blocks: DayBlock[]
  reason?: 'transport' | 'parse'
}

/** Result of persisting the review to time_entries. */
export interface SaveResult {
  ok: boolean
  count?: number
  error?: string
}

/** One line in the review chat log (cached so it survives close/reopen). */
export interface ChatMessage {
  role: 'you' | 'companion'
  text: string
}

/** A block plus its renderer-only provenance — the unit cached in main so a
 *  reopened panel restores inline edits and added blocks exactly. */
export interface CachedBlock extends DayBlock {
  userEdited: boolean
  userCreated: boolean
}

/** Initial payload pushed to the panel on open:
 *  - 'summary': fresh summarizeDay output (blocks have provenance reset)
 *  - 'saved':   loaded from time_entries (a previously saved day; provenance reset)
 *  - 'cache':   restored prior in-session draft (blocks + chat log) for the date
 *  - 'error':   summarize failed; manual entry still available
 *  - 'empty':   chosen date has no samples and no saved entries (past day, pruned
 *               or never tracked) — friendly message + manual entry */
export interface ReviewState {
  source: 'summary' | 'saved' | 'cache' | 'error' | 'empty'
  blocks: CachedBlock[]
  chatLog: ChatMessage[]
  /** The local date (YYYY-MM-DD) this review is for. Renderer uses this for
   *  the title, reflection key, and save target — not its own localDateStr(),
   *  which would be wrong when reviewing a past day. */
  date: string
  /** On 'error', the provider that failed — drives the branched help text. */
  errorProvider?: 'ollama' | 'claude-code'
  /** On 'summary' (and 'empty' when a fresh summarize ran), what produced the
   *  blocks — drives the "Summarized with…" label. Absent for saved/cache. */
  meta?: SummaryMeta
}

/** One aggregated run of continuous focus on a single (app, title) pair.
 *  Timestamps are epoch SECONDS (matches the `_ts`/`_s` schema columns).
 *  `id` is present on rows read back from the DB, absent on inserts. */
export interface ActivitySample {
  id?: number
  startTs: number
  endTs: number
  app: string
  title: string
  durationS: number
}

/** One row in the History view's per-day breakdown. Times come back as HH:MM
 *  strings (same contract as DayBlock) so the renderer never touches epoch math. */
export interface HistoryEntry {
  start: string
  end: string
  durationMinutes: number
  label: string
  ticket: string
  notes: string
}

/** One day's worth of entries plus its (optional) reflection. */
export interface HistoryDay {
  date: string // YYYY-MM-DD
  entries: HistoryEntry[]
  reflection: string
}

/** The History window's payload for a given date range. Totals and the
 *  per-ticket breakdown are computed in main so the renderer can render flat. */
export interface HistoryRange {
  fromDate: string
  toDate: string
  days: HistoryDay[]
  /** Sum of every entry's durationMinutes across the range. */
  totalMinutes: number
  /** Per-ticket totals, sorted by minutes descending; entries with no ticket
   *  are aggregated under "(no ticket)" and pushed last. */
  perTicket: { ticket: string; minutes: number }[]
}
