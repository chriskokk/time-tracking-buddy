// SPDX-License-Identifier: AGPL-3.0-or-later
// Ollama provider: POSTs to the local /api/chat endpoint. Sends the few-shot as
// real user/assistant turns (Ollama's API takes a messages array).
import { OLLAMA_NUM_CTX } from '../../../shared/config'
import { getSettings } from '../../settings'
import { isRecord, type AiPrompt, type AiProvider } from '../core'

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

function toMessages(p: AiPrompt): ChatMessage[] {
  return [
    { role: 'system', content: p.system },
    ...p.examples.flatMap((e): ChatMessage[] => [
      { role: 'user', content: e.user },
      { role: 'assistant', content: e.assistant }
    ]),
    { role: 'user', content: p.user }
  ]
}

/** Watchdog: a hung Ollama (slow model, server stall) would keep the review
 *  spinner spinning indefinitely. After this many ms, abort the request and
 *  return null so the panel takes the normal failure-with-retry path. Mirrors
 *  the Claude CLI watchdog in providers/claude-code.ts. */
const OLLAMA_TIMEOUT_MS = 90_000

async function chat(prompt: AiPrompt): Promise<string | null> {
  const { ollamaHost, ollamaModel } = getSettings()
  const body = {
    model: ollamaModel,
    stream: false,
    format: 'json',
    options: { num_ctx: OLLAMA_NUM_CTX },
    messages: toMessages(prompt)
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS)
  try {
    let res: Response
    try {
      res = await fetch(`${ollamaHost}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      })
    } catch (err) {
      // AbortError surfaces as a fetch failure; signal.aborted is the reliable
      // discriminator between "timed out" and "network/connection refused".
      if (controller.signal.aborted) {
        console.error(`[ollama] request timed out after ${OLLAMA_TIMEOUT_MS / 1000}s — model may be slow or hung`)
        return null
      }
      console.error(`[ollama] cannot reach Ollama at ${ollamaHost} — is it running? Start it with:  ollama serve`)
      console.error('[ollama]', err instanceof Error ? err.message : String(err))
      return null
    }

    let data: unknown
    try {
      data = await res.json()
    } catch {
      console.error(`[ollama] non-JSON response (HTTP ${res.status})`)
      return null
    }

    if (isRecord(data) && typeof data.error === 'string') {
      if (/not found|pull/i.test(data.error)) {
        console.error(`[ollama] model "${ollamaModel}" not found. Pull it with:\n  ollama pull ${ollamaModel}`)
      } else {
        console.error('[ollama] error:', data.error)
      }
      return null
    }

    if (!res.ok) {
      console.error(`[ollama] request failed: HTTP ${res.status} ${res.statusText}`)
      return null
    }

    if (isRecord(data) && isRecord(data.message) && typeof data.message.content === 'string') {
      return data.message.content
    }

    console.error('[ollama] unexpected response shape:', JSON.stringify(data))
    return null
  } finally {
    clearTimeout(timer)
  }
}

export const ollamaProvider: AiProvider = { name: 'ollama', chat }

// --- availability detection (mirrors detectClaude in providers/claude-code.ts) ---

/** Short timeout for the liveness probe — the Settings UI greys the option out
 *  while this is pending, so a hung host must not block the form for long. */
const DETECT_TIMEOUT_MS = 2500

// Cached availability; null = not probed yet.
let available: boolean | null = null

/** Probe the configured Ollama host with GET /api/tags. Available if it answers
 *  with a 2xx within the timeout. Re-runnable (the Settings "Re-check" button
 *  calls it after the user starts `ollama serve`). */
export async function detectOllama(): Promise<boolean> {
  const { ollamaHost } = getSettings()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DETECT_TIMEOUT_MS)
  try {
    const res = await fetch(`${ollamaHost}/api/tags`, { signal: controller.signal })
    available = res.ok
  } catch {
    // Connection refused / DNS / timeout all mean "not reachable".
    available = false
  } finally {
    clearTimeout(timer)
  }
  console.log(`[ollama] ${available ? 'detected' : 'not reachable'} at ${ollamaHost}`)
  return available
}

export function isOllamaAvailable(): boolean {
  return available === true
}
