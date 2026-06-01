// SPDX-License-Identifier: AGPL-3.0-or-later
// End-of-day review panel. Blocks + chat arrive from main via IPC.
// State (blocks with provenance + chat log) is pushed back up to main on every
// change so reopening restores it without re-summarizing. Inline edits
// stay local (no Ollama). NOTE: no em dashes in rendered strings.

import { localDateStr, pad2, parseHHMMToMinutes } from '../../shared/datetime'
import type { DayBlock, ReviewState, ChatMessage, SummaryMeta } from '../../shared/types'

type Confidence = 'low' | 'medium' | 'high'

interface ReviewBlock {
  start: string
  end: string
  durationMinutes: number
  label: string
  confidence: Confidence
  ticket: string
  notes: string
  userEdited: boolean
  userCreated: boolean
}

/** Clean shape that leaves the panel (export/save/refine) - no provenance.
 *  `notes` is included for save; main strips it before any LLM request. */
interface CleanBlock {
  start: string
  end: string
  durationMinutes: number
  label: string
  confidence: Confidence
  ticket: string
  notes: string
}

let blocks: ReviewBlock[] = []
let chatHistory: ChatMessage[] = []
let refining = false
let initialApplied = false
/** The date this panel is reviewing. Set from the initial ReviewState payload
 *  (supports reviewing past days). Used for the title, the reflection key, and
 *  the save target. Initialized to today as a defensive default — overwritten
 *  immediately by onReviewState. */
let reviewDate: string = localDateStr()
/** Captured last provider failure — surfaced again on Retry click so the
 *  user keeps seeing the same branched guidance. */
let lastErrorProvider: 'ollama' | 'claude-code' | undefined
/** The currently-configured AI provider ('ollama' | 'claude-code' | 'none').
 *  Resolved once on init (providerReady). Drives the chat-refine disable in
 *  No-AI mode and all provider-aware failure wording. Defaults to 'ollama' until
 *  the query lands. */
let activeProvider = 'ollama'

// Friendly phrases under the initial-summarize spinner. Rotate every 3s so the
// user knows the panel hasn't frozen on a slow local model.
const LOADING_PHRASES = [
  'Putting your day together...',
  'Looking back at what you got up to...',
  'Tallying up the hours...',
  'Almost there...'
]
const PHRASE_ROTATION_MS = 3000
let phraseTimer: ReturnType<typeof setInterval> | null = null

// --- helpers ---

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T
const blocksEl = byId('blocks')
const totalsEl = byId('totals')
const chatlogEl = byId('chatlog')

function durationMin(start: string, end: string): number | null {
  const a = parseHHMMToMinutes(start)
  const b = parseHHMMToMinutes(end)
  if (a === null || b === null) return null
  const d = b - a
  return d >= 0 ? d : null
}

function fmtDur(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h ? `${h}h ${m}m` : `${m}m`
}

function markEdited(b: ReviewBlock): void {
  if (!b.userCreated) b.userEdited = true
}

/** The small "what produced these blocks" label under the status bar. ASCII
 *  only (panel convention: no em dashes in rendered strings). */
function summaryMetaLabel(meta: SummaryMeta): string {
  if (meta.method === 'ollama') return `Summarized with Ollama / ${meta.model ?? 'model'}`
  if (meta.method === 'claude-code') return `Summarized with Claude Code / ${meta.model ?? 'model'}`
  // algorithmic
  if (meta.fellBack) {
    const from =
      meta.requested === 'claude-code'
        ? 'Claude Code'
        : meta.requested === 'ollama'
          ? 'Ollama'
          : 'AI'
    return `No AI (grouped by activity) - ${from} unavailable`
  }
  return 'No AI (grouped by activity)'
}

/** Show/hide the summary-source label. Absent meta (saved/cache/error) hides it. */
function renderSummaryMeta(meta?: SummaryMeta): void {
  const el = byId('summaryMeta')
  if (!meta) {
    el.hidden = true
    el.textContent = ''
    return
  }
  el.hidden = false
  el.textContent = summaryMetaLabel(meta)
}

/** Provider-specific remedy clause for failure messages. Empty for none/unknown
 *  so a message NEVER hardcodes the wrong product name. Leading space so it
 *  appends cleanly to a sentence. */
function providerRemedy(provider?: string): string {
  if (provider === 'ollama') return ' Check that Ollama is running.'
  if (provider === 'claude-code') return ' Check that Claude Code is installed and authenticated.'
  return ''
}

/** Provider-aware summarize-failure guidance. Stays provider-agnostic when the
 *  provider is unknown/none so we never blame the wrong product. */
function providerErrorMessage(provider?: string): string {
  const remedy = providerRemedy(provider)
  if (remedy) return `Couldn't summarize your day.${remedy} Or switch providers in Settings.`
  return "Couldn't summarize your day. Check your AI provider in Settings, or switch to No AI (group by activity)."
}

/** Refine failure wording. A 'transport' failure references the ACTIVE provider
 *  (never a hardcoded one); a 'parse' miss (e.g. the user asked a question
 *  instead of giving an edit) stays provider-agnostic. */
function refineFailureMessage(reason?: 'transport' | 'parse'): string {
  if (reason === 'transport') {
    const remedy = providerRemedy(activeProvider)
    return `I couldn't reach the AI provider.${remedy || ' Check your AI provider in Settings.'}`
  }
  return 'I couldn\'t apply that. Try phrasing it as an edit, e.g. "merge the first two".'
}

/** Initial "here's your day" line — drops the chat hint in No-AI mode, where the
 *  only way to adjust blocks is editing them directly. */
function summaryGreeting(): string {
  return activeProvider === 'none'
    ? 'Here is your day, grouped by activity. Edit the blocks above directly, then Save.'
    : 'Here is your day. Edit blocks inline, or tell me what to change.'
}

/** No-AI mode has no LLM to interpret chat instructions, so swap the chat input
 *  + Send for a short note (manual block editing stays fully functional). */
function applyProviderMode(): void {
  byId('composer').classList.toggle('no-ai', activeProvider === 'none')
}

function provenance(b: ReviewBlock): { glyph: string; title: string } {
  if (b.userCreated) return { glyph: '✦', title: 'added by you' }
  if (b.userEdited) return { glyph: '✎', title: 'edited' }
  return { glyph: '', title: '' }
}

function clean(): CleanBlock[] {
  return blocks.map((b) => ({
    start: b.start,
    end: b.end,
    durationMinutes: b.durationMinutes,
    label: b.label,
    confidence: b.confidence,
    ticket: b.ticket,
    notes: b.notes
  }))
}

/** DayBlock[] (from summary/refine) -> fresh review blocks (provenance reset).
 *  notes carry over (refine re-attaches them on identity-stable blocks). */
function toReviewBlocks(day: DayBlock[]): ReviewBlock[] {
  return day.map((d) => ({
    start: d.start,
    end: d.end,
    durationMinutes: d.durationMinutes,
    label: d.label,
    confidence: d.confidence,
    ticket: d.ticket ?? '',
    notes: d.notes ?? '',
    userEdited: false,
    userCreated: false
  }))
}

// --- cache push (renderer is source of truth; main persists) ---

let pushTimer: ReturnType<typeof setTimeout> | null = null

function pushCacheNow(): void {
  if (pushTimer) {
    clearTimeout(pushTimer)
    pushTimer = null
  }
  window.api.reviewUpdateCache({ blocks: blocks.map((b) => ({ ...b })), chatLog: chatHistory.slice() })
}

/** Debounced push for rapid inline edits (keystrokes). */
function schedulePush(): void {
  if (pushTimer) clearTimeout(pushTimer)
  pushTimer = setTimeout(() => {
    pushTimer = null
    pushCacheNow()
  }, 300)
}

// --- rendering (full re-render only on structural change) ---

function mkTimeInput(value: string): HTMLInputElement {
  const i = document.createElement('input')
  i.className = 't'
  i.value = value
  i.placeholder = 'HH:MM'
  i.maxLength = 5
  return i
}

function renderBlocks(): void {
  blocksEl.replaceChildren()

  for (const b of blocks) {
    const row = document.createElement('div')
    row.className = 'block'

    const main = document.createElement('div')
    main.className = 'block-main'

    const start = mkTimeInput(b.start)
    const sep = document.createElement('span')
    sep.className = 'sep'
    sep.textContent = '-'
    const end = mkTimeInput(b.end)

    const label = document.createElement('input')
    label.className = 'label'
    label.value = b.label
    label.placeholder = 'label'

    const chip = document.createElement('span')
    chip.className = `conf conf-${b.confidence}`
    chip.textContent = b.confidence === 'high' ? 'H' : b.confidence === 'medium' ? 'M' : 'L'
    chip.title = `model confidence: ${b.confidence}`

    const prov = document.createElement('span')
    prov.className = 'prov'

    main.append(start, sep, end, label, chip, prov)

    const sub = document.createElement('div')
    sub.className = 'block-sub'

    const dur = document.createElement('span')
    dur.className = 'dur'
    dur.textContent = fmtDur(b.durationMinutes)

    const ticket = document.createElement('input')
    ticket.className = 'ticket'
    ticket.value = b.ticket
    ticket.placeholder = 'ticket'
    // Native autocomplete from previously-used tickets — the datalist itself
    // is populated once at init from window.api.ticketsList().
    ticket.setAttribute('list', 'ticketSuggestions')

    // Note glyph: faint when empty, solid when the block has a private note.
    const noteBtn = document.createElement('button')
    noteBtn.className = 'note-btn'
    noteBtn.textContent = '🗒'
    noteBtn.title = 'Private note (not shared with the AI)'

    const del = document.createElement('button')
    del.className = 'del'
    del.textContent = '✕'
    del.title = 'Delete block'

    sub.append(dur, ticket, noteBtn, del)

    // Expandable private note area (hidden until the glyph is clicked).
    const noteWrap = document.createElement('div')
    noteWrap.className = 'block-note'
    const noteLabel = document.createElement('span')
    noteLabel.className = 'note-private'
    noteLabel.textContent = '🔒 private (never sent to the AI)'
    const noteArea = document.createElement('textarea')
    noteArea.className = 'note-area'
    noteArea.placeholder = 'note for this block…'
    noteArea.maxLength = 500
    noteArea.value = b.notes
    noteWrap.append(noteLabel, noteArea)

    row.append(main, sub, noteWrap)
    blocksEl.append(row)

    const refreshNoteGlyph = (): void => {
      noteBtn.classList.toggle('has-note', b.notes.trim().length > 0)
    }
    refreshNoteGlyph()
    if (b.notes.trim().length > 0) noteWrap.classList.add('open') // show existing notes

    const refreshProv = (): void => {
      const { glyph, title } = provenance(b)
      prov.textContent = glyph
      prov.title = title
    }
    refreshProv()

    noteBtn.addEventListener('click', () => {
      const open = noteWrap.classList.toggle('open')
      if (open) noteArea.focus()
    })
    // Enter inserts a newline naturally (textarea); we save state on input and
    // push to the cache on blur, not on Enter.
    noteArea.addEventListener('input', () => {
      b.notes = noteArea.value
      markEdited(b)
      refreshNoteGlyph()
      refreshProv()
    })
    noteArea.addEventListener('blur', () => pushCacheNow())

    label.addEventListener('input', () => {
      b.label = label.value
      markEdited(b)
      refreshProv()
      schedulePush()
    })
    ticket.addEventListener('input', () => {
      b.ticket = ticket.value
      markEdited(b)
      refreshProv()
      schedulePush()
    })

    const onTime = (input: HTMLInputElement, which: 'start' | 'end'): void => {
      b[which] = input.value
      markEdited(b)
      refreshProv()
      const d = durationMin(b.start, b.end)
      if (d === null) {
        input.classList.add('invalid')
      } else {
        start.classList.remove('invalid')
        end.classList.remove('invalid')
        b.durationMinutes = d
        dur.textContent = fmtDur(d)
        updateTotals()
      }
      schedulePush()
    }
    start.addEventListener('input', () => onTime(start, 'start'))
    end.addEventListener('input', () => onTime(end, 'end'))

    del.addEventListener('click', () => {
      blocks = blocks.filter((x) => x !== b)
      renderBlocks()
      updateTotals()
      pushCacheNow()
    })
  }
}

function updateTotals(): void {
  const total = blocks.reduce((s, b) => s + (b.durationMinutes || 0), 0)
  totalsEl.textContent = `Total: ${fmtDur(total)} (${blocks.length} ${blocks.length === 1 ? 'block' : 'blocks'})`
}

function addBlock(): void {
  const last = blocks[blocks.length - 1]
  const startStr = last ? last.end : '09:00'
  const sMin = parseHHMMToMinutes(startStr) ?? 540
  const eMin = Math.min(sMin + 30, 23 * 60 + 59)
  const endStr = `${pad2(Math.floor(eMin / 60))}:${pad2(eMin % 60)}`
  blocks.push({
    start: startStr,
    end: endStr,
    durationMinutes: durationMin(startStr, endStr) ?? 30,
    label: '',
    confidence: 'high',
    ticket: '',
    notes: '',
    userEdited: false,
    userCreated: true
  })
  renderBlocks()
  updateTotals()
  pushCacheNow()
}

// --- chat log ---

function appendChat(role: 'you' | 'companion', text: string, transient = false): HTMLDivElement {
  const m = document.createElement('div')
  m.className = `msg ${role}`
  const who = document.createElement('span')
  who.className = 'who'
  who.textContent = role === 'you' ? 'you' : 'companion'
  const body = document.createElement('span')
  body.className = 'body'
  body.textContent = text
  m.append(who, body)
  chatlogEl.append(m)
  chatlogEl.scrollTop = chatlogEl.scrollHeight
  if (!transient) chatHistory.push({ role, text })
  return m
}

async function send(): Promise<void> {
  if (refining) return
  if (activeProvider === 'none') return // chat refine is disabled without an LLM
  const input = byId<HTMLInputElement>('chatInput')
  const text = input.value.trim()
  if (!text) return
  appendChat('you', text)
  pushCacheNow()
  input.value = ''

  refining = true
  input.disabled = true
  byId<HTMLButtonElement>('send').disabled = true
  byId('refineSpinner').classList.add('show')
  const pending = appendChat('companion', 'thinking...', true)
  pending.classList.add('pending')

  try {
    const res = await window.api.reviewRefine(text, clean())
    pending.remove()
    if (res.ok) {
      blocks = toReviewBlocks(res.blocks)
      renderBlocks()
      updateTotals()
      appendChat('companion', res.reply)
    } else {
      appendChat('companion', refineFailureMessage(res.reason))
    }
    pushCacheNow()
  } catch (err) {
    console.error('[chat] refine failed:', err)
    pending.remove()
    appendChat('companion', 'Something went wrong applying that change.')
    pushCacheNow()
  } finally {
    refining = false
    input.disabled = false
    byId<HTMLButtonElement>('send').disabled = false
    byId('refineSpinner').classList.remove('show') // ALWAYS clears, even on throw
    input.focus()
  }
}

async function save(): Promise<void> {
  const btn = byId<HTMLButtonElement>('save')
  btn.disabled = true
  // Clear any prior error banner before retrying.
  if (byId('status').classList.contains('error')) clearStatus()
  try {
    const res = await window.api.reviewSave(clean())
    if (!res.ok) {
      showErrorBanner(`Save failed: ${res.error ?? 'unknown error'}`, false)
      btn.disabled = false
    }
    // On success, main persists, clears the cache, and closes this window.
  } catch (err) {
    console.error('[chat] save failed:', err)
    showErrorBanner('Save failed: unexpected error (see console)', false)
    btn.disabled = false
  }
}

function discard(): void {
  // Saved state survives a discard, so the wording is scoped to this session.
  if (window.confirm('Discard your changes since the last save?')) {
    window.api.reviewDiscard()
  }
}

// --- export ---

function csvCell(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function toCsv(rows: CleanBlock[]): string {
  const head = 'start,end,durationMinutes,label,ticket,confidence'
  const lines = rows.map((r) =>
    [r.start, r.end, String(r.durationMinutes), csvCell(r.label), csvCell(r.ticket), r.confidence].join(',')
  )
  return [head, ...lines].join('\n')
}

function toText(rows: CleanBlock[]): string {
  const lines = rows.map((r) => {
    const tk = r.ticket ? ` [${r.ticket}]` : ''
    return `${r.start}-${r.end} (${fmtDur(r.durationMinutes)}) ${r.label}${tk} {${r.confidence}}`
  })
  const total = rows.reduce((s, r) => s + r.durationMinutes, 0)
  return [...lines, `Total: ${fmtDur(total)}`].join('\n')
}

function flash(btn: HTMLButtonElement): void {
  const old = btn.textContent
  btn.textContent = 'copied'
  btn.classList.add('flash')
  setTimeout(() => {
    btn.textContent = old
    btn.classList.remove('flash')
  }, 900)
}

// --- Export dropdown ---
// Single trigger + menu replaces the old three top-level buttons. The menu's
// HTML lives in index.html; this section only handles open/close/dismiss and
// re-routes the existing per-format copy logic so the export pathways are
// unchanged downstream.

const exportTrigger = byId<HTMLButtonElement>('exportTrigger')
const exportMenu = byId('exportMenu')

function closeExportMenu(): void {
  exportMenu.hidden = true
  exportTrigger.setAttribute('aria-expanded', 'false')
}
function openExportMenu(): void {
  exportMenu.hidden = false
  exportTrigger.setAttribute('aria-expanded', 'true')
}

exportTrigger.addEventListener('click', (e) => {
  // stopPropagation so the document-level "click outside" handler below
  // doesn't see this click and immediately re-close the menu we just opened.
  e.stopPropagation()
  if (exportMenu.hidden) openExportMenu()
  else closeExportMenu()
})

// Click anywhere outside the menu (and outside the trigger) closes it.
document.addEventListener('click', (e) => {
  if (exportMenu.hidden) return
  const t = e.target as Node
  if (!exportMenu.contains(t) && t !== exportTrigger) closeExportMenu()
})
document.addEventListener('keydown', (e) => {
  if ((e as KeyboardEvent).key === 'Escape' && !exportMenu.hidden) closeExportMenu()
})

document.querySelectorAll<HTMLButtonElement>('.exp').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const fmt = btn.dataset.fmt
    const rows = clean()
    const out = fmt === 'json' ? JSON.stringify(rows, null, 2) : fmt === 'csv' ? toCsv(rows) : toText(rows)
    try {
      await navigator.clipboard.writeText(out)
      // Close the menu first so the "copied" feedback is visible on the
      // trigger (which stays on screen) rather than the menu item (which
      // would be hidden again instantly).
      closeExportMenu()
      flash(exportTrigger)
    } catch (err) {
      console.error('[chat] clipboard write failed:', err)
      closeExportMenu()
      appendChat('companion', '(could not copy to clipboard)')
    }
  })
})

// --- status / mode ---

function setControlsEnabled(enabled: boolean): void {
  byId<HTMLButtonElement>('addBlock').disabled = !enabled
  byId<HTMLButtonElement>('send').disabled = !enabled
  byId<HTMLButtonElement>('save').disabled = !enabled
  byId<HTMLButtonElement>('refresh').disabled = !enabled
  byId<HTMLInputElement>('chatInput').disabled = !enabled
}

/** Dismiss the initial-summarize overlay AND stop the phrase rotation. Called
 *  from every code path that resolves the summarize (success, saved, cache,
 *  error, retry) — the interval would otherwise keep firing on a stale DOM. */
function hideLoading(): void {
  byId('loadingOverlay').classList.remove('show')
  if (phraseTimer) {
    clearInterval(phraseTimer)
    phraseTimer = null
  }
}

function clearStatus(): void {
  const s = byId('status')
  s.className = 'status'
  s.replaceChildren()
  hideLoading()
  setControlsEnabled(true)
}

function showLoading(): void {
  const overlay = byId('loadingOverlay')
  const phrase = byId('loadingPhrase')
  overlay.classList.add('show')
  let i = 0
  phrase.textContent = LOADING_PHRASES[0]
  if (phraseTimer) clearInterval(phraseTimer)
  phraseTimer = setInterval(() => {
    i = (i + 1) % LOADING_PHRASES.length
    phrase.textContent = LOADING_PHRASES[i]
  }, PHRASE_ROTATION_MS)
  setControlsEnabled(false)
}

function showErrorBanner(message: string, withRetry: boolean): void {
  hideLoading() // overlay must come down before the banner appears
  const s = byId('status')
  s.className = 'status show error'
  s.replaceChildren()
  const span = document.createElement('span')
  span.textContent = message
  s.append(span)
  if (withRetry) {
    const retry = document.createElement('button')
    retry.className = 'ghost'
    retry.textContent = 'Retry'
    retry.addEventListener('click', () => void onRetry())
    s.append(retry)
  }
  setControlsEnabled(true)
}

// --- initial state + retry ---

async function onReviewState(state: ReviewState): Promise<void> {
  if (initialApplied) return
  initialApplied = true
  // Resolve the active provider before any greeting/mode decision. This is a
  // fast local IPC and providerReady never rejects, so it can't hang the panel.
  await providerReady

  // Adopt the date this review is for. main computes it; renderer
  // never recomputes from localDateStr() because that would be wrong when
  // reviewing a past day.
  reviewDate = state.date
  lastErrorProvider = state.errorProvider
  byId('title').textContent = `Today (${reviewDate})`
  initReflection(reviewDate)

  blocks = state.blocks.map((b) => ({ ...b, ticket: b.ticket ?? '', notes: b.notes ?? '' }))
  chatHistory = []
  chatlogEl.replaceChildren()
  for (const m of state.chatLog) appendChat(m.role, m.text)
  renderBlocks()
  updateTotals()
  // Label what produced these blocks (AI provider+model, or the no-AI grouping).
  // Absent on saved/cache/error — renderSummaryMeta hides it in that case.
  renderSummaryMeta(state.meta)

  if (state.source === 'error') {
    const msg = providerErrorMessage(state.errorProvider)
    showErrorBanner(msg, true)
    if (state.chatLog.length === 0) {
      appendChat('companion', msg)
    }
  } else if (state.source === 'empty') {
    // Resolve the initial loading overlay — without this the spinner runs
    // forever on an empty day (the AI path never returns to clear it).
    clearStatus()
    appendChat(
      'companion',
      'No activity data for this date. You can still add blocks manually below.'
    )
  } else {
    clearStatus()
    if (state.source === 'summary') {
      appendChat('companion', summaryGreeting())
      pushCacheNow()
    } else if (state.source === 'saved') {
      appendChat(
        'companion',
        activeProvider === 'none'
          ? 'Loaded your saved entries. Edit them above directly, then Save.'
          : 'Loaded your saved entries for today. Edit them, or tell me what to change.'
      )
      pushCacheNow()
    }
    // 'cache': restored verbatim, nothing extra to add or push.
  }
}

/** True if any block carries a user edit, a user-created flag, or a private note.
 *  Drives the confirm gate on Refresh — a fresh summarize would discard these. */
function isDirty(): boolean {
  return blocks.some((b) => b.userEdited || b.userCreated || b.notes.trim().length > 0)
}

/** Manual re-summarize. Same path as onRetry but: gates on a dirty check, and
 *  preserves existing blocks on failure (refresh is opt-in — losing valid blocks
 *  to a transient Ollama hiccup would be worse than the stale data). The daily
 *  reflection is untouched (it has its own save path keyed to the panel-open
 *  date) and nothing is persisted to time_entries — Save still does that. */
async function onRefresh(): Promise<void> {
  if (refining) return
  if (isDirty()) {
    const ok = window.confirm(
      "Re-summarize from scratch? This replaces the current blocks with a fresh AI summary of today's activity. Your manual edits and per-block notes will be lost. Your daily reflection is kept."
    )
    if (!ok) return
  }
  refining = true
  showLoading()
  try {
    const result = await window.api.reviewSummarize()
    if (result.ok) {
      blocks = toReviewBlocks(result.blocks)
      // Prior chat referenced the now-replaced blocks; clearing matches onRetry.
      chatHistory = []
      chatlogEl.replaceChildren()
      renderBlocks()
      updateTotals()
      clearStatus()
      renderSummaryMeta(result.meta)
      appendChat('companion', 'Refreshed. Here is an updated summary of your day so far.')
      pushCacheNow()
    } else {
      lastErrorProvider = result.provider ?? lastErrorProvider
      const provHelp = providerErrorMessage(lastErrorProvider)
      showErrorBanner(`Couldn't re-summarize. Current blocks unchanged. ${provHelp}`, false)
    }
  } catch (err) {
    console.error('[chat] refresh failed:', err)
    showErrorBanner("Couldn't re-summarize (see console). Your current blocks are unchanged.", false)
  } finally {
    refining = false
  }
}

async function onRetry(): Promise<void> {
  showLoading()
  const result = await window.api.reviewSummarize()
  chatHistory = []
  chatlogEl.replaceChildren()
  if (result.ok) {
    blocks = toReviewBlocks(result.blocks)
    renderBlocks()
    updateTotals()
    clearStatus()
    renderSummaryMeta(result.meta)
    appendChat('companion', summaryGreeting())
    pushCacheNow()
  } else {
    blocks = []
    renderBlocks()
    updateTotals()
    lastErrorProvider = result.provider ?? lastErrorProvider
    const msg = providerErrorMessage(lastErrorProvider)
    showErrorBanner(msg, true)
    appendChat('companion', msg)
  }
}

// --- wiring ---

byId('addBlock').addEventListener('click', addBlock)
byId('send').addEventListener('click', () => void send())
byId('chatInput').addEventListener('keydown', (e) => {
  if ((e as KeyboardEvent).key === 'Enter') void send()
})
byId('save').addEventListener('click', () => void save())
byId('refresh').addEventListener('click', () => void onRefresh())
byId('close').addEventListener('click', discard)

// Resolve the active AI provider once on init: applies No-AI mode (hides chat
// refine) and seeds the provider-aware wording. Catches so it NEVER rejects —
// onReviewState awaits it and must not be left hanging.
const providerReady: Promise<string> = window.api
  .aiActiveProvider()
  .then((p) => {
    activeProvider = p
    applyProviderMode()
    return p
  })
  .catch(() => {
    applyProviderMode()
    return activeProvider
  })

window.api.onReviewState(onReviewState)

// --- daily reflection (independent of blocks: saves on its own, survives Discard) ---
//
// Wired once at module load; the date is captured by reference into reviewDate,
// which is set from the initial ReviewState (supports past dates).

const reflectionEl = byId('reflection')
const reflectText = byId<HTMLTextAreaElement>('reflectText')
const reflectDot = byId('reflectDot')

byId('reflectToggle').addEventListener('click', () => {
  const open = reflectionEl.classList.toggle('open')
  if (open) reflectText.focus()
})

function refreshReflectDot(): void {
  reflectDot.classList.toggle('on', reflectText.value.trim().length > 0)
}

// Auto-save on blur. Enter inserts a newline (textarea), never saves/submits.
// Date is PINNED to reviewDate (set when the state arrives): the panel
// represents the day it was opened for, so leaving it open past midnight
// does NOT move the reflection onto the next day's row.
reflectText.addEventListener('input', refreshReflectDot)
reflectText.addEventListener('blur', () => window.api.reflectionSave(reviewDate, reflectText.value))

/** Load the existing reflection for `date` into the textarea, auto-expand if
 *  present. Called by onReviewState once the date is known. */
function initReflection(date: string): void {
  window.api.reflectionGet(date).then((text) => {
    reflectText.value = text
    refreshReflectDot()
    if (text.trim().length > 0) reflectionEl.classList.add('open')
  })
}

// --- init ---

// Populate the ticket autocomplete from previously-used tickets.
// One-shot at panel open; new tickets entered in this session won't appear
// in the dropdown until the next open, which is fine for an offline DB.
void window.api.ticketsList().then((tickets) => {
  const datalist = byId('ticketSuggestions')
  datalist.replaceChildren()
  for (const t of tickets) {
    const opt = document.createElement('option')
    opt.value = t
    datalist.append(opt)
  }
})

// Flush the debounced cache push if the window closes before the timer
// fires. Mirrors the scratchpad's beforeunload guard — without this, the
// last few keystrokes can be lost between edit and close.
window.addEventListener('beforeunload', () => {
  if (pushTimer) {
    clearTimeout(pushTimer)
    pushTimer = null
    pushCacheNow()
  }
})

renderBlocks()
updateTotals()
showLoading()
