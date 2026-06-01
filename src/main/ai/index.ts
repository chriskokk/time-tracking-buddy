// SPDX-License-Identifier: AGPL-3.0-or-later
// Public AI API. Routes summarize/refine to the configured provider; all the
// prompt-building, parsing, retry, and note-privacy logic is shared (core.ts).
import { MIN_SESSION_SECONDS } from '../../shared/config'
import { getSettings } from '../settings'
import type { ActivitySample, DayBlock, SummaryMeta } from '../../shared/types'
import {
  serializeSamples,
  buildSummarizePrompt,
  buildRefinePrompt,
  parseBlocks,
  parseRefine,
  type AiProvider,
  type AiPrompt
} from './core'
import { summarizeAlgorithmic } from './algorithmic'
import { ollamaProvider, detectOllama, isOllamaAvailable } from './providers/ollama'
import { claudeProvider, detectClaude, isClaudeAvailable } from './providers/claude-code'

export { detectClaude, isClaudeAvailable, detectOllama, isOllamaAvailable }

/** Result of a summarize: the blocks plus what actually produced them. Never
 *  null — the algorithmic grouping is the floor, so a usable review is always
 *  returned (empty blocks only when there's genuinely nothing to group). */
export interface SummarizeResult {
  blocks: DayBlock[]
  meta: SummaryMeta
}

/** The AI provider for a settings value, or null for "none"/unknown. */
function aiProviderFor(name: string): AiProvider | null {
  if (name === 'claude-code') return claudeProvider
  if (name === 'ollama') return ollamaProvider
  return null
}

/** The AI provider used by the tray test affordances + refine. Defaults to
 *  Ollama for "none"/unknown so those paths keep a concrete transport. */
function getProvider(): AiProvider {
  return getSettings().aiProvider === 'claude-code' ? claudeProvider : ollamaProvider
}

/** Human label for the model behind a provider (for the log + review label). */
function modelLabel(providerName: string): string | undefined {
  if (providerName === 'ollama') return getSettings().ollamaModel
  if (providerName === 'claude-code') return getSettings().claudeCodeModel // "haiku" | "sonnet"
  return undefined
}

function logSummary(meta: SummaryMeta): void {
  const base = `[ai] provider=${meta.method} model=${meta.model ?? 'n/a'}`
  console.log(meta.fellBack ? `${base} (fell back from ${meta.requested})` : base)
}

/** Run one AI provider end to end (serialize -> chat -> parse, with the single
 *  stronger-instruction retry). Returns the blocks, or null on any failure
 *  (empty input, transport/auth/timeout error, or unparseable output) — every
 *  failure is logged and routes the caller to the algorithmic fallback. */
async function runProvider(provider: AiProvider, samples: ActivitySample[]): Promise<DayBlock[] | null> {
  const input = serializeSamples(samples)
  if (input.kept === 0) {
    console.warn('[ai] nothing to summarize (no sessions after filtering)')
    return null
  }

  let content = await provider.chat(buildSummarizePrompt(input, false))
  let blocks = content === null ? null : parseBlocks(content)
  if (blocks) return blocks
  if (content === null) return null // transport error already logged

  console.warn(`[ai] ${provider.name}: first response not parseable; retrying with a stronger instruction`)
  content = await provider.chat(buildSummarizePrompt(input, true))
  blocks = content === null ? null : parseBlocks(content)
  if (blocks) return blocks

  console.error(`[ai] ${provider.name}: could not parse a valid response after retry. Raw:\n`, content)
  return null
}

/** Summarize a day's samples into proposed blocks. The configured provider runs
 *  first; on ANY failure (or when "none" is selected) we fall back to the
 *  deterministic algorithmic grouping so a usable review is ALWAYS produced. */
export async function summarizeDay(samples: ActivitySample[]): Promise<SummarizeResult> {
  const requested = getSettings().aiProvider as 'ollama' | 'claude-code' | 'none'
  const provider = aiProviderFor(requested)

  // Explicit no-AI choice: group deterministically, no fallback semantics.
  if (!provider) {
    const meta: SummaryMeta = { method: 'algorithmic', fellBack: false, requested }
    logSummary(meta)
    return { blocks: summarizeAlgorithmic(samples), meta }
  }

  // AI path.
  const aiBlocks = await runProvider(provider, samples)
  if (aiBlocks) {
    const method = provider.name as 'ollama' | 'claude-code'
    const meta: SummaryMeta = { method, model: modelLabel(method), fellBack: false, requested }
    logSummary(meta)
    return { blocks: aiBlocks, meta }
  }

  // Fallback: the configured provider was unavailable / errored / unparseable.
  const meta: SummaryMeta = { method: 'algorithmic', fellBack: true, requested }
  logSummary(meta)
  return { blocks: summarizeAlgorithmic(samples), meta }
}

/** Outcome of a refine turn: the updated blocks, or a failure tagged with why —
 *  'transport' (provider unreachable/errored) vs 'parse' (model didn't return a
 *  usable edit, e.g. the user typed a question rather than an instruction). */
export type RefineOutcome =
  | { ok: true; reply: string; blocks: DayBlock[] }
  | { ok: false; error: 'transport' | 'parse' }

/** Apply one chat instruction to the current blocks. Notes are PRIVATE: stripped
 *  before the request, re-attached to identity-stable blocks afterward. */
export async function refineBlocks(message: string, current: DayBlock[]): Promise<RefineOutcome> {
  const provider = getProvider()
  const forModel: DayBlock[] = current.map((b) => {
    const { notes: _notes, ...rest } = b
    return rest
  })

  let content = await provider.chat(buildRefinePrompt(forModel, message, false))
  let result = content === null ? null : parseRefine(content)

  if (!result && content !== null) {
    console.warn(`[ai] ${provider.name}: refine not parseable; retrying with a stronger instruction`)
    content = await provider.chat(buildRefinePrompt(forModel, message, true))
    result = content === null ? null : parseRefine(content)
    if (!result && content !== null) {
      console.error(`[ai] ${provider.name}: could not parse refine after retry. Raw:\n`, content)
    }
  }
  // content === null at the point of giving up => a transport failure; otherwise
  // the model responded but we couldn't parse an edit out of it (a 'parse' miss).
  if (!result) return { ok: false, error: content === null ? 'transport' : 'parse' }

  const noteByKey = new Map<string, string>()
  for (const b of current) {
    if (b.notes) noteByKey.set(`${b.start}|${b.end}`, b.notes)
  }
  for (const b of result.blocks) {
    const note = noteByKey.get(`${b.start}|${b.end}`)
    if (note) b.notes = note
  }
  return { ok: true, reply: result.reply, blocks: result.blocks }
}

// --- tray test affordances ---

function previewPrompt(p: AiPrompt): string {
  return [`system:\n${p.system}`, ...p.examples.map((e) => `example:\n${e.user}\n-->\n${e.assistant}`), `user:\n${p.user}`].join(
    '\n\n'
  )
}

export async function testSummarize(samples: ActivitySample[], source: string): Promise<void> {
  const input = serializeSamples(samples)
  const provider = getProvider()
  console.log(`\n===== AI summarize test — ${source} (provider: ${provider.name}) =====`)
  console.log(`input: ${input.kept} sessions kept, ${input.dropped} dropped (<${MIN_SESSION_SECONDS}s)`)
  if (input.kept === 0) {
    console.log('(no sessions to send)\n==========================================\n')
    return
  }
  const content = await provider.chat(buildSummarizePrompt(input, false))
  if (content === null) {
    console.log('--- no usable response (error logged above) ---\n==========================================\n')
    return
  }
  console.log('--- raw response ---')
  console.log(content)
  const blocks = parseBlocks(content)
  console.log('--- parsed result ---')
  console.log(blocks ? JSON.stringify(blocks, null, 2) : '(unparseable — summarizeDay would retry once)')
  console.log('==========================================\n')
}

export function printRequest(samples: ActivitySample[]): void {
  const input = serializeSamples(samples)
  console.log(`\n===== AI request preview (no send, provider: ${getProvider().name}) =====`)
  console.log(`input: ${input.kept} sessions kept, ${input.dropped} dropped (<${MIN_SESSION_SECONDS}s)`)
  console.log(previewPrompt(buildSummarizePrompt(input, false)))
  console.log('============================================\n')
}
