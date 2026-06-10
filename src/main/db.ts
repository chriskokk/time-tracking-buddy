// SPDX-License-Identifier: AGPL-3.0-or-later
// Must come BEFORE node:sqlite so the experimental warning is suppressed at
// the warning's emission time (ES modules evaluate imports in source order).
import './no-warn'
import { app } from 'electron'
import { join } from 'path'
// Electron 42 bundles Node 24, whose built-in SQLite we use instead of
// better-sqlite3 (which can't compile against Electron 42's V8 yet). The API is
// effectively a drop-in: synchronous, prepare/run/get/all, exec() for DDL.
import { DatabaseSync } from 'node:sqlite'
import type { ActivitySample } from '../shared/types'

let database: DatabaseSync | null = null

// Full canonical schema, created up front (idempotently). It's pure additive
// DDL, so defining every table here avoids fragmenting the schema.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS activity_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  start_ts INTEGER NOT NULL,
  end_ts INTEGER NOT NULL,
  app TEXT NOT NULL,
  title TEXT,
  duration_s INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_samples_start_ts ON activity_samples(start_ts);

CREATE TABLE IF NOT EXISTS time_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  start_ts INTEGER,
  end_ts INTEGER,
  duration_s INTEGER NOT NULL,
  label TEXT NOT NULL,
  ticket_id TEXT,
  notes TEXT,
  raw_summary TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_entries_date ON time_entries(date);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_reflections (
  date TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`

/** Bump when the schema changes shape (ALTER TABLE etc.). CREATE TABLE IF NOT
 *  EXISTS only covers brand-new tables — existing tables need a migration step
 *  keyed off the stored user_version. */
const SCHEMA_VERSION = 1

function migrate(db: DatabaseSync): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number }
  const from = row.user_version
  if (from >= SCHEMA_VERSION) return
  // Future migrations go here, gated per version:
  //   if (from < 2) db.exec('ALTER TABLE ...')
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
  console.log(`[db] schema migrated ${from} -> ${SCHEMA_VERSION}`)
}

export function initDb(): void {
  if (database) return
  const file = join(app.getPath('userData'), 'companion.db')
  database = new DatabaseSync(file)
  // WAL improves durability and lets reads not block on writes — cheap win.
  database.exec('PRAGMA journal_mode = WAL;')
  database.exec(SCHEMA)
  migrate(database)
  console.log('[db] opened', file)
}

function getDb(): DatabaseSync {
  if (!database) throw new Error('Database not initialised — call initDb() first')
  return database
}

export function closeDb(): void {
  if (!database) return
  database.close()
  database = null
  console.log('[db] closed')
}

/** Force a TRUNCATE-style WAL checkpoint so the main DB file is a complete
 *  on-disk snapshot. Required before any file-copy backup — without this, a
 *  copy of companion.db can miss writes still living in the -wal sidecar.
 *  TRUNCATE moves every WAL page into the main file AND zeros the WAL, so
 *  the next read starts fresh. Safe to call repeatedly; cheap when the WAL
 *  is already empty. */
export function checkpointDb(): void {
  getDb().exec('PRAGMA wal_checkpoint(TRUNCATE);')
}

export function insertActivitySample(s: ActivitySample): void {
  getDb()
    .prepare(
      `INSERT INTO activity_samples (start_ts, end_ts, app, title, duration_s)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(s.startTs, s.endTs, s.app, s.title, s.durationS)
}

/** Raw row shape as returned by node:sqlite (snake_case columns). */
interface SampleRow {
  id: number
  start_ts: number
  end_ts: number
  app: string
  title: string | null
  duration_s: number
}

/** A row ready to insert into time_entries. Timestamps are already epoch
 *  seconds (HH:MM -> epoch conversion happens in the caller, per the timezone
 *  contract). */
export interface TimeEntryRow {
  date: string
  startTs: number | null
  endTs: number | null
  durationS: number
  label: string
  ticketId: string | null
  notes: string | null
  rawSummary: string | null
  createdAt: number
}

/** REPLACE a day's entries atomically: delete all rows for the date, then
 *  insert the current set. Idempotent - saving twice yields the same state, no
 *  duplicates. The DELETE+INSERT live in one transaction so a saved day is never
 *  left half-deleted. */
export function replaceTimeEntries(date: string, rows: TimeEntryRow[]): void {
  const db = getDb()
  const del = db.prepare('DELETE FROM time_entries WHERE date = ?')
  const ins = db.prepare(
    `INSERT INTO time_entries
       (date, start_ts, end_ts, duration_s, label, ticket_id, notes, raw_summary, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  db.exec('BEGIN')
  try {
    del.run(date)
    for (const r of rows) {
      ins.run(r.date, r.startTs, r.endTs, r.durationS, r.label, r.ticketId, r.notes, r.rawSummary, r.createdAt)
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

/** A saved entry as read back for the review panel (timestamps still epoch). */
export interface SavedEntryRow {
  startTs: number | null
  endTs: number | null
  durationS: number
  label: string
  ticketId: string | null
  notes: string | null
}

/** Load a saved day's entries (source of truth for an already-reviewed date). */
export function getTimeEntriesForDate(date: string): SavedEntryRow[] {
  const rows = getDb()
    .prepare(
      `SELECT start_ts, end_ts, duration_s, label, ticket_id, notes
       FROM time_entries
       WHERE date = ?
       ORDER BY (start_ts IS NULL), start_ts ASC`
    )
    .all(date) as unknown as Array<{
    start_ts: number | null
    end_ts: number | null
    duration_s: number
    label: string
    ticket_id: string | null
    notes: string | null
  }>

  return rows.map((r) => ({
    startTs: r.start_ts,
    endTs: r.end_ts,
    durationS: r.duration_s,
    label: r.label,
    ticketId: r.ticket_id,
    notes: r.notes
  }))
}

// --- settings (key/value) ---

export function getAllSettingsRows(): { key: string; value: string }[] {
  return getDb().prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value)
}

/** Read one settings value (used for scratchpad + companion bounds, which live
 *  in the settings table but outside the typed Settings/getSettings cache). */
export function getSetting(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row ? row.value : null
}

// --- daily reflections ---

export function getReflection(date: string): string {
  const row = getDb().prepare('SELECT text FROM daily_reflections WHERE date = ?').get(date) as
    | { text: string }
    | undefined
  return row ? row.text : ''
}

export function saveReflection(date: string, text: string, updatedAt: number): void {
  getDb()
    .prepare(
      `INSERT INTO daily_reflections (date, text, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(date) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at`
    )
    .run(date, text, updatedAt)
}

/** Delete every saved entry for a single local date. Returns the row count.
 *  Used by the Advanced tray "Delete today's entries" (with a confirm), and as
 *  the inner half of REPLACE in replaceTimeEntries — but here it stands alone
 *  so the user can clear a day without re-saving an empty set. */
export function deleteTimeEntriesForDate(date: string): number {
  const res = getDb().prepare('DELETE FROM time_entries WHERE date = ?').run(date)
  return Number(res.changes ?? 0)
}

/** All distinct, non-empty ticket IDs across saved entries. Drives the review
 *  panel's ticket autocomplete <datalist>. Ordered alphabetically for a stable
 *  dropdown; cheap on a personal-scale DB. */
export function getDistinctTickets(): string[] {
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT ticket_id FROM time_entries
       WHERE ticket_id IS NOT NULL AND ticket_id != ''
       ORDER BY ticket_id ASC`
    )
    .all() as Array<{ ticket_id: string }>
  return rows.map((r) => r.ticket_id)
}

/** Count rows for a date — used as a post-save read-back diagnostic. */
export function countTimeEntries(date: string): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS c FROM time_entries WHERE date = ?')
    .get(date) as { c: number }
  return row.c
}

/** Delete activity_samples older than `retentionDays`. No-op when the input
 *  is zero or negative (means "keep forever"). Returns the row count deleted
 *  so the caller can log it. time_entries and daily_reflections are NEVER
 *  touched — they're the billing record and the journal, kept regardless. */
export function pruneOldActivity(retentionDays: number): number {
  if (retentionDays <= 0) return 0
  const cutoff = Math.floor(Date.now() / 1000) - retentionDays * 86400
  const res = getDb().prepare('DELETE FROM activity_samples WHERE start_ts < ?').run(cutoff)
  return Number(res.changes ?? 0)
}

/** History view: every saved entry inside [fromDate, toDate] (inclusive), in
 *  date-then-start order. Dates are local "YYYY-MM-DD" strings (the same
 *  shape stored in time_entries.date). */
export function getTimeEntriesInRange(fromDate: string, toDate: string): Array<SavedEntryRow & { date: string }> {
  const rows = getDb()
    .prepare(
      `SELECT date, start_ts, end_ts, duration_s, label, ticket_id, notes
       FROM time_entries
       WHERE date >= ? AND date <= ?
       ORDER BY date ASC, (start_ts IS NULL), start_ts ASC`
    )
    .all(fromDate, toDate) as unknown as Array<{
    date: string
    start_ts: number | null
    end_ts: number | null
    duration_s: number
    label: string
    ticket_id: string | null
    notes: string | null
  }>

  return rows.map((r) => ({
    date: r.date,
    startTs: r.start_ts,
    endTs: r.end_ts,
    durationS: r.duration_s,
    label: r.label,
    ticketId: r.ticket_id,
    notes: r.notes
  }))
}

/** History view: every reflection inside [fromDate, toDate]. Returned as a
 *  map for cheap per-day lookup during the per-day grouping pass in main. */
export function getReflectionsInRange(fromDate: string, toDate: string): Map<string, string> {
  const rows = getDb()
    .prepare('SELECT date, text FROM daily_reflections WHERE date >= ? AND date <= ?')
    .all(fromDate, toDate) as Array<{ date: string; text: string }>
  return new Map(rows.map((r) => [r.date, r.text]))
}

export function getSamplesSince(sinceTs: number): ActivitySample[] {
  const rows = getDb()
    .prepare(
      `SELECT id, start_ts, end_ts, app, title, duration_s
       FROM activity_samples
       WHERE start_ts >= ?
       ORDER BY start_ts ASC`
    )
    .all(sinceTs) as unknown as SampleRow[]

  return rows.map((r) => ({
    id: r.id,
    startTs: r.start_ts,
    endTs: r.end_ts,
    app: r.app,
    title: r.title ?? '',
    durationS: r.duration_s
  }))
}
