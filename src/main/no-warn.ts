// SPDX-License-Identifier: AGPL-3.0-or-later
// Side-effect module. Import this FIRST in any file that triggers Node's
// "ExperimentalWarning: SQLite is an experimental feature" — node:sqlite is a
// stable-for-our-purposes built-in (Electron 42 / Node 24) and the warning
// would pollute the packaged-app stderr on every launch.
//
// ES-module evaluation order is source order, so `import './no-warn'` placed
// above `import 'node:sqlite'` runs this override before sqlite's load-time
// emitWarning call fires.

const origEmit = process.emitWarning.bind(process)

const isSqliteWarning = (w: string | Error): boolean => {
  const msg = typeof w === 'string' ? w : (w && w.message) || ''
  return /SQLite/i.test(msg) || /node:sqlite/i.test(msg)
}

// Cast: Node's emitWarning has 3 overloads with different optional shapes; the
// safe forward is to keep `arguments` intact and let the original handle them.
process.emitWarning = function (warning: string | Error, ...rest: unknown[]): void {
  if (isSqliteWarning(warning)) return
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (origEmit as any)(warning, ...rest)
} as typeof process.emitWarning
