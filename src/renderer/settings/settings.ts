// SPDX-License-Identifier: AGPL-3.0-or-later
// Settings window. Live-apply: each field debounces 500ms, validates,
// and on a valid value persists via IPC (main does the per-setting live-apply).
// Invalid input shows a red border; the last valid value stays in effect.

import { compileExcludePattern, VOICE_PROFILES } from '../../shared/config'
import type { Settings } from '../../shared/types'
import { musko } from '../companion/avatars/musko/musko'
import { drago } from '../companion/avatars/drago/drago'
import { gato } from '../companion/avatars/gato/gato'
import { tido } from '../companion/avatars/tido/tido'
import { englishVoices, pickVoice, whenVoicesReady, speak } from '../voice'

const AVATAR_SVGS: Record<string, string> = { musko, drago, gato, tido }
const AVATAR_NAMES = ['musko', 'drago', 'gato', 'tido']
const titleCase = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

// The avatar currently chosen in the selector — drives Test voice's pitch/rate.
let selectedAvatar = 'musko'

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T

function debounce(fn: () => void, ms: number): () => void {
  let t: ReturnType<typeof setTimeout> | null = null
  return () => {
    if (t) clearTimeout(t)
    t = setTimeout(fn, ms)
  }
}

// --- validators ---

const isTime = (v: string): boolean => /^([01]?\d|2[0-3]):[0-5]\d$/.test(v.trim())
const isInt = (v: string, min: number, max: number): boolean => {
  const n = Number(v)
  return v.trim() !== '' && Number.isInteger(n) && n >= min && n <= max
}
const isUrl = (v: string): boolean => {
  try {
    const u = new URL(v.trim())
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}
const isModel = (v: string): boolean => v.trim().length > 0
const isExcluded = (v: string): boolean =>
  v.split(/\r?\n/).every((line) => line.trim() === '' || compileExcludePattern(line) !== null)
// Excluded dates: every non-blank line must be YYYY-MM-DD (same shape the
// scheduler parses; malformed lines are dropped there too).
const isExcludedDates = (v: string): boolean =>
  v.split(/\r?\n/).every((line) => line.trim() === '' || /^\d{4}-\d{2}-\d{2}$/.test(line.trim()))

function setInvalid(el: HTMLElement, invalid: boolean): void {
  el.classList.toggle('invalid', invalid)
}

/** Wire a text/number/textarea field: debounced validate -> persist if valid. */
function wireField(id: string, validate: (v: string) => boolean): void {
  const el = byId<HTMLInputElement | HTMLTextAreaElement>(id)
  const commit = debounce(() => {
    const v = el.value
    if (validate(v)) {
      setInvalid(el, false)
      window.api.settingsUpdate(id, v)
    } else {
      setInvalid(el, true)
    }
  }, 500)
  el.addEventListener('input', commit)
}

// --- populate from current settings ---

/** Build the three live-SVG avatar thumbnails and wire click -> live swap. */
function buildAvatarSelector(current: string): void {
  selectedAvatar = current
  const container = byId('avatars')
  container.replaceChildren()
  for (const name of AVATAR_NAMES) {
    const tile = document.createElement('button')
    tile.className = 'avatar-thumb' + (name === current ? ' selected' : '')
    tile.dataset.name = name

    const thumb = document.createElement('div')
    thumb.className = 'avatar-thumb-svg'
    thumb.innerHTML = AVATAR_SVGS[name]
    thumb.querySelector('svg')?.setAttribute('class', `avatar ${name} idle`)

    const label = document.createElement('span')
    label.className = 'avatar-label'
    label.textContent = titleCase(name)

    tile.append(thumb, label)
    tile.addEventListener('click', () => {
      selectedAvatar = name // so Test voice uses this avatar's pitch/rate
      window.api.settingsUpdate('avatar', name) // live-swaps the companion
      container.querySelectorAll('.avatar-thumb').forEach((t) => t.classList.remove('selected'))
      tile.classList.add('selected')
    })
    container.append(tile)
  }
}

function populate(s: Settings): void {
  buildAvatarSelector(s.avatar)
  byId<HTMLInputElement>('workStartHour').value = s.workStartHour
  byId<HTMLInputElement>('workCloseHour').value = s.workCloseHour
  byId<HTMLInputElement>('preCloseAlertMinutes').value = String(s.preCloseAlertMinutes)
  byId<HTMLInputElement>('trackWeekends').checked = s.trackWeekends
  byId<HTMLTextAreaElement>('excludedDates').value = s.excludedDates
  byId<HTMLInputElement>('captureIntervalSeconds').value = String(s.captureIntervalSeconds)
  byId<HTMLTextAreaElement>('excludedAppsRegex').value = s.excludedAppsRegex
  byId<HTMLInputElement>('ollamaHost').value = s.ollamaHost
  byId<HTMLInputElement>('ollamaModel').value = s.ollamaModel
  byId<HTMLInputElement>('companionWidth').value = String(s.companionWidth)
  byId<HTMLInputElement>('companionHeight').value = String(s.companionHeight)
  byId<HTMLInputElement>('startupOnBoot').checked = s.startupOnBoot
  byId<HTMLInputElement>('activityRetentionDays').value = String(s.activityRetentionDays)
  byId<HTMLInputElement>('idleDetectionEnabled').checked = s.idleDetectionEnabled
  byId<HTMLInputElement>('idleThresholdMinutes').value = String(s.idleThresholdMinutes)
  byId<HTMLSelectElement>('aiProvider').value = s.aiProvider
  byId<HTMLSelectElement>('claudeCodeModel').value = s.claudeCodeModel
  byId<HTMLInputElement>('voiceEnabled').checked = s.voiceEnabled
  byId<HTMLInputElement>('osNotificationEnabled').checked = s.osNotificationEnabled
  byId<HTMLInputElement>('voicePhrase').value = s.voicePhrase
  buildVoicePicker(s.voiceName)
  updateProviderVisibility(s.aiProvider)
  // Clear any stale red borders after a repopulate (e.g. reset-all).
  document.querySelectorAll('.invalid').forEach((el) => el.classList.remove('invalid'))
}

/** Populate the English-voice dropdown (waits for the async voice list). */
function buildVoicePicker(savedName: string): void {
  whenVoicesReady(() => {
    const select = byId<HTMLSelectElement>('voiceName')
    const hint = byId('voiceHint')
    const voices = englishVoices()
    select.replaceChildren()
    if (voices.length === 0) {
      select.disabled = true
      hint.classList.add('warn') // genuine "can't use this feature" warning
      hint.textContent =
        'No English voice available. Install one from Windows Settings → Time & Language → Speech.'
      return
    }
    select.disabled = false
    hint.classList.remove('warn')
    hint.textContent = ''
    for (const v of voices) {
      const opt = document.createElement('option')
      opt.value = v.name
      opt.textContent = `${v.name} (${v.lang})`
      select.append(opt)
    }
    // Select the saved voice, or the auto-picked default (female English voice).
    const chosen = pickVoice(savedName)
    if (chosen) select.value = chosen.name
  })
}

/** Show Ollama fields for the ollama provider, the Claude model field for
 *  claude-code. "none" (group by activity) shows neither. */
function updateProviderVisibility(provider: string): void {
  byId('section-ollama').style.display = provider === 'ollama' ? '' : 'none'
  byId('field-claudeModel').style.display = provider === 'claude-code' ? '' : 'none'
}

/** Enable/disable one provider option, swapping its label to carry the reason. */
function setOptionState(id: string, enabled: boolean, onLabel: string, offLabel: string): void {
  const opt = byId<HTMLOptionElement>(id)
  opt.disabled = !enabled
  opt.textContent = enabled ? onLabel : offLabel
}

/** Grey out providers that aren't detected, with a short reason. "No AI (group
 *  by activity)" is always available. The persisted selection is left untouched
 *  — at summarize time an unavailable provider falls back to the algorithmic
 *  grouping, so the app stays functional regardless. */
async function refreshProviderAvailability(redetect: boolean): Promise<void> {
  const hint = byId('aiHint')
  if (redetect) {
    hint.classList.remove('warn')
    hint.textContent = 'Checking…'
  }
  const status = redetect
    ? await window.api.aiRedetectProviders()
    : await window.api.aiProviderStatus()
  setOptionState('opt-ollama', status.ollama, 'Ollama (local)', 'Ollama (local) — not running')
  setOptionState('opt-claude', status.claude, 'Claude Code CLI', 'Claude Code CLI — not found')
  const notes: string[] = []
  if (!status.ollama) notes.push('Ollama not running')
  if (!status.claude) notes.push('Claude Code CLI not found')
  // Amber only when a provider is genuinely unavailable; otherwise calm grey.
  hint.classList.toggle('warn', notes.length > 0)
  hint.textContent = notes.length
    ? `${notes.join(' · ')}. "No AI (group by activity)" always works.`
    : 'Ollama and Claude Code both available.'
}

// --- wiring ---

wireField('workStartHour', isTime)
wireField('workCloseHour', isTime)
wireField('preCloseAlertMinutes', (v) => isInt(v, 0, 240))
wireField('excludedDates', isExcludedDates)
wireField('captureIntervalSeconds', (v) => isInt(v, 5, 3600))
wireField('idleThresholdMinutes', (v) => isInt(v, 1, 240))
wireField('activityRetentionDays', (v) => isInt(v, 0, 3650))
wireField('excludedAppsRegex', isExcluded)
wireField('ollamaHost', isUrl)
wireField('ollamaModel', isModel)
wireField('companionWidth', (v) => isInt(v, 50, 1000))
wireField('companionHeight', (v) => isInt(v, 50, 1000))

byId<HTMLInputElement>('startupOnBoot').addEventListener('change', (e) => {
  const want = (e.target as HTMLInputElement).checked
  window.api.settingsUpdate('startupOnBoot', String(want))
  // Reflect the REAL OS state after the toggle — it can differ from the request
  // (e.g. a dev build skips registration), so don't assume the click stuck.
  window.api.settingsLoginItemState().then((on) => {
    byId<HTMLInputElement>('startupOnBoot').checked = on
  })
})

byId<HTMLInputElement>('idleDetectionEnabled').addEventListener('change', (e) => {
  window.api.settingsUpdate('idleDetectionEnabled', String((e.target as HTMLInputElement).checked))
})

byId<HTMLInputElement>('trackWeekends').addEventListener('change', (e) => {
  window.api.settingsUpdate('trackWeekends', String((e.target as HTMLInputElement).checked))
})

// AI provider + model selects (no debounce; discrete choices).
byId<HTMLSelectElement>('aiProvider').addEventListener('change', (e) => {
  const v = (e.target as HTMLSelectElement).value
  window.api.settingsUpdate('aiProvider', v)
  updateProviderVisibility(v)
})
byId<HTMLSelectElement>('claudeCodeModel').addEventListener('change', (e) => {
  window.api.settingsUpdate('claudeCodeModel', (e.target as HTMLSelectElement).value)
})
// Re-check provider availability (the user may have started Ollama or installed
// the claude CLI after opening Settings).
byId('aiRecheck').addEventListener('click', () => void refreshProviderAvailability(true))

// Voice: checkbox + phrase + test button (speaks via the renderer's speechSynthesis).
byId<HTMLInputElement>('voiceEnabled').addEventListener('change', (e) => {
  window.api.settingsUpdate('voiceEnabled', String((e.target as HTMLInputElement).checked))
})
byId<HTMLInputElement>('osNotificationEnabled').addEventListener('change', (e) => {
  window.api.settingsUpdate('osNotificationEnabled', String((e.target as HTMLInputElement).checked))
})
wireField('voicePhrase', (v) => v.trim().length > 0)
byId<HTMLSelectElement>('voiceName').addEventListener('change', (e) => {
  window.api.settingsUpdate('voiceName', (e.target as HTMLSelectElement).value)
})
// Test voice: selected English voice + the CURRENTLY-SELECTED avatar's pitch/rate.
byId('testVoice').addEventListener('click', () => {
  const phrase = byId<HTMLInputElement>('voicePhrase').value
  const voiceName = byId<HTMLSelectElement>('voiceName').value
  const profile = VOICE_PROFILES[selectedAvatar] ?? VOICE_PROFILES.musko
  speak(phrase, voiceName, profile)
})

byId('resetPosition').addEventListener('click', () => window.api.settingsResetCompanionPosition())

// Backup now: native save dialog + checkpoint-copy is handled in main; we just
// fire-and-forget here. main pops its own info/error dialog with the result so
// the Settings window doesn't need to track outcome.
byId('backupNow').addEventListener('click', () => void window.api.dbBackupNow())

byId('resetAll').addEventListener('click', async () => {
  if (window.confirm('Reset all settings to defaults?')) {
    const s = await window.api.settingsResetAll()
    populate(s)
  }
})

byId('close').addEventListener('click', () => window.close())

// --- init ---

window.api.settingsGet().then(populate)

// Grey out any provider that wasn't detected at startup (with a re-check button
// for when the user starts one afterwards).
void refreshProviderAvailability(false)

// Reflect the REAL OS login-item state, not just the stored flag (the two can
// diverge — e.g. in a dev build registration is skipped).
window.api.settingsLoginItemState().then((on) => {
  byId<HTMLInputElement>('startupOnBoot').checked = on
})
