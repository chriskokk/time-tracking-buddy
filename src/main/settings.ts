// SPDX-License-Identifier: AGPL-3.0-or-later
import { DEFAULT_SCHEDULE, OLLAMA_HOST, OLLAMA_MODEL } from '../shared/config'
import { getAllSettingsRows, setSetting } from './db'
import type { Settings } from '../shared/types'

const pad2 = (n: number): string => String(n).padStart(2, '0')
const minToHHMM = (m: number): string => `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`

/** First-run defaults. Work-hours/Ollama defaults derive from config.ts so
 *  there's one source of truth; the rest are literal defaults. */
export const DEFAULT_SETTINGS: Settings = {
  workStartHour: minToHHMM(DEFAULT_SCHEDULE.startMinutes), // "09:00"
  workCloseHour: minToHHMM(DEFAULT_SCHEDULE.closeMinutes), // "17:30"
  preCloseAlertMinutes: DEFAULT_SCHEDULE.alertOffsetMinutes, // 30
  captureIntervalSeconds: 30,
  excludedAppsRegex: ['(?i)1Password', '(?i)Bitwarden', '(?i)KeePass', '(?i)LastPass', '(?i)bank'].join('\n'),
  ollamaHost: OLLAMA_HOST,
  ollamaModel: OLLAMA_MODEL,
  companionWidth: 200,
  companionHeight: 200,
  startupOnBoot: false,
  avatar: 'musko',
  aiProvider: 'ollama',
  claudeCodeModel: 'haiku',
  voiceEnabled: false,
  voicePhrase: '30 minutes until end of day',
  voiceName: '',
  activityRetentionDays: 30,
  idleDetectionEnabled: true,
  idleThresholdMinutes: 5,
  osNotificationEnabled: true,
  trackWeekends: true, // preserve existing behaviour; user opts into skipping
  excludedDates: ''
}

// Raw string-valued cache mirroring the settings table. getSettings() parses it
// into the typed view on demand (cheap), which sidesteps mixed-type assignment.
const raw = new Map<string, string>()

const numOr = (key: string, def: number): number => {
  const v = raw.get(key)
  if (v === undefined) return def
  const n = Number(v)
  if (!Number.isFinite(n)) {
    // Stored value is present but unparseable. Log a warning so a corrupted
    // settings row doesn't quietly mask a real misconfiguration.
    console.warn(`[settings] "${key}"="${v}" is not a finite number; using default ${def}`)
    return def
  }
  return n
}

/** Seed any missing defaults into the table and load all rows into the cache. */
export function initSettings(): void {
  raw.clear()
  for (const row of getAllSettingsRows()) raw.set(row.key, row.value)

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (!raw.has(key)) {
      const asString = String(value)
      setSetting(key, asString)
      raw.set(key, asString)
    }
  }
  console.log('[settings] loaded', getSettings())
}

export function getSettings(): Settings {
  return {
    workStartHour: raw.get('workStartHour') ?? DEFAULT_SETTINGS.workStartHour,
    workCloseHour: raw.get('workCloseHour') ?? DEFAULT_SETTINGS.workCloseHour,
    preCloseAlertMinutes: numOr('preCloseAlertMinutes', DEFAULT_SETTINGS.preCloseAlertMinutes),
    captureIntervalSeconds: numOr('captureIntervalSeconds', DEFAULT_SETTINGS.captureIntervalSeconds),
    excludedAppsRegex: raw.get('excludedAppsRegex') ?? DEFAULT_SETTINGS.excludedAppsRegex,
    ollamaHost: raw.get('ollamaHost') ?? DEFAULT_SETTINGS.ollamaHost,
    ollamaModel: raw.get('ollamaModel') ?? DEFAULT_SETTINGS.ollamaModel,
    companionWidth: numOr('companionWidth', DEFAULT_SETTINGS.companionWidth),
    companionHeight: numOr('companionHeight', DEFAULT_SETTINGS.companionHeight),
    startupOnBoot: (raw.get('startupOnBoot') ?? String(DEFAULT_SETTINGS.startupOnBoot)) === 'true',
    avatar: raw.get('avatar') ?? DEFAULT_SETTINGS.avatar,
    aiProvider: raw.get('aiProvider') ?? DEFAULT_SETTINGS.aiProvider,
    claudeCodeModel: raw.get('claudeCodeModel') ?? DEFAULT_SETTINGS.claudeCodeModel,
    voiceEnabled: (raw.get('voiceEnabled') ?? String(DEFAULT_SETTINGS.voiceEnabled)) === 'true',
    voicePhrase: raw.get('voicePhrase') ?? DEFAULT_SETTINGS.voicePhrase,
    voiceName: raw.get('voiceName') ?? DEFAULT_SETTINGS.voiceName,
    activityRetentionDays: numOr('activityRetentionDays', DEFAULT_SETTINGS.activityRetentionDays),
    idleDetectionEnabled:
      (raw.get('idleDetectionEnabled') ?? String(DEFAULT_SETTINGS.idleDetectionEnabled)) === 'true',
    idleThresholdMinutes: numOr('idleThresholdMinutes', DEFAULT_SETTINGS.idleThresholdMinutes),
    osNotificationEnabled:
      (raw.get('osNotificationEnabled') ?? String(DEFAULT_SETTINGS.osNotificationEnabled)) === 'true',
    trackWeekends: (raw.get('trackWeekends') ?? String(DEFAULT_SETTINGS.trackWeekends)) === 'true',
    excludedDates: raw.get('excludedDates') ?? DEFAULT_SETTINGS.excludedDates
  }
}

/** Persist one setting (value is the already-stringified form from the UI). */
export function updateSetting(key: string, value: string): void {
  raw.set(key, value)
  setSetting(key, value)
}

/** Reset every setting to its default (used by "Reset all to defaults"). */
export function resetAllSettings(): Settings {
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    const asString = String(value)
    setSetting(key, asString)
    raw.set(key, asString)
  }
  return getSettings()
}
