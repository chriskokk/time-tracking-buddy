// SPDX-License-Identifier: AGPL-3.0-or-later
/** Work-hours schedule. Boundaries are minutes since local midnight (e.g.
 *  09:00 -> 540), which is the natural unit for a daily-recurring schedule and
 *  for the "HH:MM" strings the settings UI stores. */
export interface ScheduleConfig {
  startMinutes: number
  closeMinutes: number
  /** Minutes before close to switch into the `alert` state. */
  alertOffsetMinutes: number
}

// Hardcoded schedule defaults. Reads of DEFAULT_SCHEDULE are backed by
// settings-table lookups — keep that wiring localized by sourcing the
// schedule only from here (and the scheduler's mutable working copy).
export const DEFAULT_SCHEDULE: ScheduleConfig = {
  startMinutes: 9 * 60, // 09:00
  closeMinutes: 17 * 60 + 30, // 17:30
  alertOffsetMinutes: 30
}

/** How often the scheduler re-evaluates which state "now" falls into. */
export const SCHEDULER_TICK_MS = 30_000

// --- Ollama / summarization ---
// All swappable for settings-table reads.
export const OLLAMA_HOST = 'http://localhost:11434'
export const OLLAMA_MODEL = 'gemma4:e4b'
/** Context window sent to Ollama. The server default is only 2048 tokens, which
 *  a full day of activity + the few-shot example can overflow (silently dropping
 *  the start of the day), so we raise it explicitly. Gemma 4 supports 32K, so
 *  16384 gives comfortable headroom for a busy 9-to-5. */
export const OLLAMA_NUM_CTX = 16384
/** Sessions shorter than this (seconds) are dropped before summarizing, to cut
 *  alt-tab noise. Set to 30 to effectively disable filtering — the tracker
 *  already drops sub-1s sessions and polls every 30s. */
export const MIN_SESSION_SECONDS = 60
/** Window titles are truncated to this many chars; the tail rarely adds signal. */
export const MAX_TITLE_CHARS = 80

/** Per-avatar speech character (applied to the alert utterance + Test voice).
 *  Same base voice, different pitch/rate so each companion sounds distinct. */
export const VOICE_PROFILES: Record<string, { pitch: number; rate: number }> = {
  musko: { pitch: 1.1, rate: 0.85 }, // soft, sleepy
  drago: { pitch: 0.85, rate: 0.9 }, // gruff
  gato: { pitch: 1.05, rate: 1.0 }, // perky
  tido: { pitch: 1.25, rate: 1.1 } // bright, bouncy (water turtle)
}

/** Compile one excluded-apps line into a RegExp, or null if blank/invalid.
 *  JavaScript's RegExp has no inline `(?i)` flag, so a leading `(?i)` is treated
 *  as the case-insensitive flag; matching is always case-insensitive (sensible
 *  for app names and window titles). Shared by the tracker (matching) and the
 *  settings UI (validation) so both agree on what's valid. */
export function compileExcludePattern(line: string): RegExp | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  // Length cap: these patterns run against every window title on every poll,
  // so a pathological (or maliciously injected) pattern is a CPU/ReDoS vector
  // inside the tracker loop. Real app-name patterns are short.
  if (trimmed.length > 200) return null
  const body = trimmed.replace(/^\(\?i\)/, '')
  try {
    return new RegExp(body, 'i')
  } catch {
    return null
  }
}
