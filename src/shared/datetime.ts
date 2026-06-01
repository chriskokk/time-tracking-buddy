// SPDX-License-Identifier: AGPL-3.0-or-later
// Shared date/time helpers. Both main and renderer import these so the
// parsing/formatting rules can't drift between processes.

export const pad2 = (n: number): string => String(n).padStart(2, '0')

/** Local date as "YYYY-MM-DD". Used for: cache keys, the time_entries.date
 *  column, reflection keys, panel titles. Always uses OS local timezone (per
 *  the timezone contract in main/index.ts: hhmmToEpochSeconds). */
export const localDateStr = (d: Date = new Date()): string =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`

/** Strict "HH:MM" → minutes-since-midnight. Returns null on bad input (NaN,
 *  out-of-range, missing colon). Callers MUST handle null — silent NaN→0
 *  fallback used to mask corrupt settings rows as "schedule wants midnight." */
export function parseHHMMToMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}
