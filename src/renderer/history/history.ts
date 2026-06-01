// SPDX-License-Identifier: AGPL-3.0-or-later
// History/Reports window. Read-only view across a date range: per-day
// breakdown of saved time_entries + reflections, grand total, per-ticket
// totals, CSV export. No editing here — the review panel is still the only
// surface that mutates time_entries.

import { localDateStr, pad2 } from '../../shared/datetime'
import type { HistoryDay, HistoryEntry, HistoryRange } from '../../shared/types'

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T

const fromInput = byId<HTMLInputElement>('fromDate')
const toInput = byId<HTMLInputElement>('toDate')
const contentEl = byId('content')
const emptyEl = byId('empty')
const totalsEl = byId('totals')
const grandEl = byId('grandTotal')
const ticketBodyEl = byId('ticketBody')

let currentRange: HistoryRange | null = null

// --- date helpers (kept local; no epoch math leaks into renderer) ---

function dateAddDays(d: Date, days: number): Date {
  const out = new Date(d)
  out.setDate(out.getDate() + days)
  return out
}
function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}
function startOfWeek(d: Date): Date {
  // ISO-ish: Monday is the start of the week. JS getDay() is 0=Sun..6=Sat.
  const out = new Date(d)
  const dow = out.getDay()
  const back = dow === 0 ? 6 : dow - 1
  out.setHours(0, 0, 0, 0)
  out.setDate(out.getDate() - back)
  return out
}

/** Pretty-print "Mon, 5 Mar 2026" for a YYYY-MM-DD string. */
function prettyDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return iso
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}

function fmtHours(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h ? `${h}h ${m}m` : `${m}m`
}
function fmtDecimalHours(minutes: number): string {
  // Two decimals — billing-friendly.
  return (minutes / 60).toFixed(2)
}

// --- presets ---

function applyPreset(name: string): void {
  const today = new Date()
  let from: Date
  let to: Date
  if (name === 'this-week') {
    from = startOfWeek(today)
    to = dateAddDays(from, 6)
  } else if (name === 'last-week') {
    const thisWeekStart = startOfWeek(today)
    from = dateAddDays(thisWeekStart, -7)
    to = dateAddDays(from, 6)
  } else if (name === 'this-month') {
    from = new Date(today.getFullYear(), today.getMonth(), 1)
    to = new Date(today.getFullYear(), today.getMonth() + 1, 0) // last day of month
  } else {
    return
  }
  fromInput.value = fmtDate(from)
  toInput.value = fmtDate(to)
  void load()
}

// --- rendering ---

function renderEntry(e: HistoryEntry): HTMLElement {
  const row = document.createElement('div')
  row.className = 'entry'

  const time = document.createElement('div')
  time.className = 'entry-time'
  time.textContent = `${e.start} – ${e.end}`

  const label = document.createElement('div')
  label.className = 'entry-label'
  label.textContent = e.label || '(no label)'

  const ticket = document.createElement('div')
  if (e.ticket) {
    ticket.className = 'entry-ticket'
    ticket.textContent = e.ticket
  } else {
    ticket.className = 'entry-ticket empty'
    ticket.textContent = '(no ticket)'
  }

  const dur = document.createElement('div')
  dur.className = 'entry-dur'
  dur.textContent = fmtHours(e.durationMinutes)

  row.append(time, label, ticket, dur)

  if (e.notes && e.notes.trim().length > 0) {
    const notes = document.createElement('div')
    notes.className = 'entry-notes'
    notes.textContent = e.notes
    row.append(notes)
  }

  return row
}

function renderDay(day: HistoryDay): HTMLElement {
  const card = document.createElement('div')
  card.className = 'day'

  const header = document.createElement('div')
  header.className = 'day-header'

  // Clickable day-date — opens the review panel for that day. Title hints at
  // the action; the look stays a header to avoid visual button noise.
  const date = document.createElement('button')
  date.className = 'day-date day-date-link'
  date.type = 'button'
  date.textContent = prettyDate(day.date)
  date.title = 'Open this day in the review panel'
  date.addEventListener('click', () => window.api.reviewOpenDate(day.date))

  const total = document.createElement('span')
  total.className = 'day-total'
  const dayMinutes = day.entries.reduce((s, e) => s + e.durationMinutes, 0)
  total.textContent = fmtHours(dayMinutes)

  header.append(date, total)
  card.append(header)

  const entries = document.createElement('div')
  entries.className = 'entries'
  for (const e of day.entries) entries.append(renderEntry(e))
  card.append(entries)

  if (day.reflection.trim().length > 0) {
    const block = document.createElement('div')
    block.className = 'reflection'
    const label = document.createElement('span')
    label.className = 'label'
    label.textContent = 'Reflection'
    const body = document.createElement('span')
    body.textContent = day.reflection
    block.append(label, body)
    card.append(block)
  }

  return card
}

function render(range: HistoryRange): void {
  contentEl.replaceChildren()
  if (range.days.length === 0) {
    emptyEl.textContent = 'No saved time entries in this range.'
    contentEl.append(emptyEl)
    totalsEl.hidden = true
    return
  }
  for (const d of range.days) contentEl.append(renderDay(d))

  grandEl.textContent = fmtHours(range.totalMinutes)
  ticketBodyEl.replaceChildren()
  for (const t of range.perTicket) {
    const tr = document.createElement('tr')
    const tk = document.createElement('td')
    if (t.ticket === '(no ticket)') {
      tk.className = 'no-ticket'
      tk.textContent = t.ticket
    } else {
      tk.textContent = t.ticket
    }
    const hr = document.createElement('td')
    hr.className = 'num'
    hr.textContent = fmtDecimalHours(t.minutes)
    tr.append(tk, hr)
    ticketBodyEl.append(tr)
  }
  totalsEl.hidden = false
}

async function load(): Promise<void> {
  const from = fromInput.value
  const to = toInput.value
  if (!from || !to) return
  // Allow inverted input gracefully — swap so the query is always valid.
  const [a, b] = from <= to ? [from, to] : [to, from]
  contentEl.replaceChildren()
  emptyEl.textContent = 'Loading…'
  contentEl.append(emptyEl)
  totalsEl.hidden = true
  try {
    const range = await window.api.historyGet(a, b)
    currentRange = range
    render(range)
  } catch (err) {
    console.error('[history] load failed:', err)
    emptyEl.textContent = "Couldn't load history (see console)."
  }
}

// --- CSV export ---

function csvCell(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function toCsv(range: HistoryRange): string {
  const head = 'date,start,end,duration_minutes,label,ticket,notes'
  const rows: string[] = []
  for (const day of range.days) {
    for (const e of day.entries) {
      rows.push(
        [
          day.date,
          e.start,
          e.end,
          String(e.durationMinutes),
          csvCell(e.label),
          csvCell(e.ticket),
          csvCell(e.notes)
        ].join(',')
      )
    }
  }
  return [head, ...rows].join('\n')
}

async function exportCsv(): Promise<void> {
  if (!currentRange) return
  const csv = toCsv(currentRange)
  try {
    await navigator.clipboard.writeText(csv)
    const btn = byId<HTMLButtonElement>('exportCsv')
    const old = btn.textContent
    btn.textContent = 'Copied'
    setTimeout(() => {
      btn.textContent = old
    }, 900)
  } catch (err) {
    console.error('[history] clipboard write failed:', err)
  }
}

// --- wiring ---

fromInput.addEventListener('change', () => void load())
toInput.addEventListener('change', () => void load())
document.querySelectorAll<HTMLButtonElement>('button[data-preset]').forEach((btn) => {
  btn.addEventListener('click', () => applyPreset(btn.dataset.preset!))
})
byId('exportCsv').addEventListener('click', () => void exportCsv())

// --- init: default range = last 7 days ending today ---

const today = new Date()
fromInput.value = fmtDate(dateAddDays(today, -6))
toInput.value = localDateStr(today)
void load()
