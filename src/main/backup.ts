// SPDX-License-Identifier: AGPL-3.0-or-later
// Backup of companion.db. Two flows:
//
// 1. Automatic daily: on app start, if the newest file under userData/backups/
//    is older than 24h (or none exists), copy the DB there. Keep the 7 newest
//    and delete the rest. No toggle — the cost (a few MB) is dwarfed by the
//    cost of losing time_entries.
//
// 2. Manual: user picks a destination via Save dialog (tray + Settings).
//
// Both flows MUST issue PRAGMA wal_checkpoint(TRUNCATE) before copying. The
// DB is in WAL mode (see db.ts `journal_mode = WAL`), which means recent
// writes can live in a separate -wal file alongside companion.db. A naive
// copy of just companion.db without checkpointing would miss those writes
// and produce a backup that's silently behind reality. TRUNCATE writes every
// WAL page back into the main file AND zeros the WAL, so a single-file copy
// taken immediately after is a complete snapshot.

import { app } from 'electron'
import { promises as fs, statSync } from 'fs'
import { join } from 'path'
import { checkpointDb } from './db'

const KEEP = 7
const TWENTY_FOUR_H_MS = 24 * 60 * 60 * 1000

function backupsDir(): string {
  return join(app.getPath('userData'), 'backups')
}

function dbPath(): string {
  return join(app.getPath('userData'), 'companion.db')
}

/** YYYY-MM-DDTHHmmss in local time, file-system safe (no colons). */
function timestampSlug(): string {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  )
}

/** List existing backup files (companion-*.db), newest first by mtime. */
async function listBackups(): Promise<string[]> {
  try {
    const names = await fs.readdir(backupsDir())
    const matching = names.filter((n) => n.startsWith('companion-') && n.endsWith('.db'))
    const paths = matching.map((n) => join(backupsDir(), n))
    return paths.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  } catch {
    return [] // dir doesn't exist yet — first run
  }
}

/** Delete all but the newest KEEP backups. */
async function pruneOldBackups(): Promise<number> {
  const all = await listBackups()
  if (all.length <= KEEP) return 0
  const toDelete = all.slice(KEEP)
  let removed = 0
  for (const p of toDelete) {
    try {
      await fs.unlink(p)
      removed++
    } catch (err) {
      console.error('[backup] failed to delete old backup', p, err)
    }
  }
  return removed
}

/** Copy the DB to `dest`. Caller is responsible for any WAL checkpoint. */
async function copyDbTo(dest: string): Promise<void> {
  await fs.copyFile(dbPath(), dest)
}

/** Auto-backup on startup. No-op if a backup already exists within the last
 *  24h — avoids piling up backups when the user restarts the app several times
 *  in a day. Always retains the newest KEEP and prunes the rest. */
export async function runAutoBackup(): Promise<void> {
  try {
    await fs.mkdir(backupsDir(), { recursive: true })
    const existing = await listBackups()
    if (existing.length > 0) {
      const newestAgeMs = Date.now() - statSync(existing[0]).mtimeMs
      if (newestAgeMs < TWENTY_FOUR_H_MS) {
        console.log(
          `[backup] newest backup is ${Math.round(newestAgeMs / 60000)}min old (<24h) — skipping`
        )
        return
      }
    }
    checkpointDb()
    const dest = join(backupsDir(), `companion-${timestampSlug()}.db`)
    await copyDbTo(dest)
    const pruned = await pruneOldBackups()
    console.log(`[backup] wrote ${dest}${pruned ? ` (pruned ${pruned} old)` : ''}`)
  } catch (err) {
    console.error('[backup] auto-backup failed:', err)
  }
}

/** Manual backup to a user-chosen path. Returns a status the IPC handler can
 *  pass back to the renderer. */
export async function runManualBackup(dest: string): Promise<{ ok: boolean; path?: string; error?: string }> {
  try {
    checkpointDb()
    await copyDbTo(dest)
    console.log(`[backup] manual backup written to ${dest}`)
    return { ok: true, path: dest }
  } catch (err) {
    console.error('[backup] manual backup failed:', err)
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
