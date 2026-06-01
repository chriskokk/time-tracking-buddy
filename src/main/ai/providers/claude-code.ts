// SPDX-License-Identifier: AGPL-3.0-or-later
// Claude Code provider: shells out to the `claude` CLI in print mode (pure chat,
// no agentic tools). Cross-platform notes:
//  - Windows needs shell:true to resolve claude.cmd/.exe on PATH; on Unix we use
//    shell:false (direct PATH lookup, and no glob expansion of the `*` arg).
//  - The system prompt + few-shot + user message are fed via STDIN, not as CLI
//    args, so multi-line/quoted content never touches the command line. (A small
//    deviation from --append-system-prompt, chosen for robustness.)
import { spawn, type ChildProcess } from 'node:child_process'
import { app } from 'electron'
import { getSettings } from '../../settings'
import { isRecord, type AiPrompt, type AiProvider } from '../core'

const isWindows = process.platform === 'win32'

/** Quote a single CLI arg for a Windows shell command STRING: wrap anything with
 *  shell-significant characters (notably the `*` in --disallowed-tools) in double
 *  quotes so cmd.exe passes it through literally and never glob/var-expands it. */
function winQuote(arg: string): string {
  return /[*\s"&|<>^()]/.test(arg) ? `"${arg.replace(/"/g, '""')}"` : arg
}

/** Kill the spawned process AND its descendants. Under shell:true on Windows the
 *  immediate child is cmd.exe, so child.kill() would orphan the real `claude`
 *  (node) grandchild and leave it running; taskkill /T reaps the whole tree. */
function killTree(child: ChildProcess): void {
  if (child.pid === undefined) return
  try {
    if (isWindows) {
      spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'])
    } else {
      child.kill('SIGKILL')
    }
  } catch {
    /* already exited */
  }
}

function modelId(): string {
  return getSettings().claudeCodeModel === 'sonnet' ? 'claude-sonnet-4-6' : 'claude-haiku-4-5'
}

/** Fold system + few-shot examples + the real user message into one prompt. */
function flatten(p: AiPrompt): string {
  const examples = p.examples
    .map((e) => `EXAMPLE INPUT:\n${e.user}\n\nEXAMPLE OUTPUT:\n${e.assistant}`)
    .join('\n\n')
  const parts = [p.system]
  if (examples) parts.push(examples)
  parts.push('Now produce the response for the following.\n\n' + p.user)
  return parts.join('\n\n')
}

interface RunResult {
  stdout: string
  stderr: string
  code: number | null
  spawnError?: NodeJS.ErrnoException
}

/** Watchdog: if `claude` stalls (interactive auth prompt opened in the user's
 *  terminal, network hang, model timeout, stdin EOF not reaching the CLI), the
 *  panel would sit on "Summarizing your day..." forever. After this many ms we
 *  kill the process tree and surface a synthetic spawnError so the calling code
 *  takes the normal failure path (which now falls back to the algorithmic
 *  no-AI summary). Kept tight so a stall is corrected in ~1 minute, never 6. */
const CLAUDE_TIMEOUT_MS = 60_000

function runClaude(args: string[], input?: string): Promise<RunResult> {
  return new Promise((resolve) => {
    let child: ChildProcess
    try {
      // Windows: `claude` is a .cmd shim Node can only launch through a shell, so
      // we pass a SINGLE pre-quoted command string (NOT an args array) — that
      // avoids DEP0190 and lets us quote `*` so cmd.exe never touches it.
      // Unix: args array with NO shell, so the literal `*` can't glob-expand.
      const cwd = app.getPath('userData')
      child = isWindows
        ? spawn(['claude', ...args.map(winQuote)].join(' '), { cwd, shell: true, windowsHide: true })
        : spawn('claude', args, { cwd, shell: false })
    } catch (err) {
      resolve({ stdout: '', stderr: '', code: null, spawnError: err as NodeJS.ErrnoException })
      return
    }
    let stdout = ''
    let stderr = ''
    // Single-settle guard: error/close/timeout can all fire in sequence — first
    // one wins; later ones become no-ops. Also lets us clear the watchdog cleanly.
    let settled = false
    const settle = (r: RunResult): void => {
      if (settled) return
      settled = true
      clearTimeout(watchdog)
      resolve(r)
    }
    const watchdog = setTimeout(() => {
      console.error(`[claude] CLI did not respond within ${CLAUDE_TIMEOUT_MS / 1000}s — killing process tree`)
      killTree(child)
      const err = Object.assign(new Error(`claude CLI timeout after ${CLAUDE_TIMEOUT_MS}ms`), { code: 'ETIMEDOUT' })
      settle({ stdout, stderr, code: null, spawnError: err as NodeJS.ErrnoException })
    }, CLAUDE_TIMEOUT_MS)

    child.stdout?.on('data', (d) => (stdout += d))
    child.stderr?.on('data', (d) => (stderr += d))
    child.on('error', (err) => settle({ stdout, stderr, code: null, spawnError: err as NodeJS.ErrnoException }))
    child.on('close', (code) => settle({ stdout, stderr, code }))
    // EPIPE / stream errors on stdin must not bubble up and crash main. Logged
    // for diagnosis; the child's own close/error handler delivers the real result.
    child.stdin?.on('error', (err) => console.error('[claude] stdin error:', err.message))
    // --print reads the prompt from stdin and only responds once it sees EOF, so
    // we MUST end() the stream. end() is unconditional (even with no input, e.g.
    // the --version probe) so stdin can never be left open waiting on a write.
    if (input !== undefined) child.stdin?.write(input)
    child.stdin?.end()
  })
}

// Cached availability (probed once at startup).
let available: boolean | null = null

export async function detectClaude(): Promise<boolean> {
  const r = await runClaude(['--version'])
  available = !r.spawnError && r.code === 0
  console.log(`[claude] CLI ${available ? 'detected' : 'not available'}`)
  return available
}

export function isClaudeAvailable(): boolean {
  return available === true
}

async function chat(prompt: AiPrompt): Promise<string | null> {
  const args = ['--print', '--model', modelId(), '--output-format', 'json', '--disallowed-tools', '*']
  const r = await runClaude(args, flatten(prompt))

  if (r.spawnError) {
    if (r.spawnError.code === 'ENOENT') {
      console.error('[claude] CLI not found in PATH. Install from https://claude.ai/download')
    } else {
      console.error('[claude] failed to launch:', r.spawnError.message)
    }
    return null
  }

  let env: unknown
  try {
    env = JSON.parse(r.stdout)
  } catch {
    console.error(
      `[claude] non-JSON output (exit ${r.code}). stdout: ${r.stdout.slice(0, 200)} | stderr: ${r.stderr.slice(0, 200)}`
    )
    return null
  }

  if (isRecord(env)) {
    // Auth failures / errors surface here as is_error or a non-success subtype.
    if (env.is_error === true || (typeof env.subtype === 'string' && env.subtype !== 'success')) {
      const detail = typeof env.result === 'string' ? env.result : JSON.stringify(env).slice(0, 200)
      console.error('[claude] CLI reported an error (auth? run `claude` once to log in):', detail)
      return null
    }
    if (typeof env.result === 'string') return env.result
  }

  console.error('[claude] unexpected CLI envelope:', JSON.stringify(env).slice(0, 200))
  return null
}

export const claudeProvider: AiProvider = { name: 'claude-code', chat }
