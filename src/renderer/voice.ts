// SPDX-License-Identifier: AGPL-3.0-or-later
// Shared renderer voice helpers (used by the companion and the settings window).
// English-only, forced en-US locale, female-voice default heuristic.

const FEMALE_HINTS = ['zira', 'eva', 'susan', 'hazel', 'samantha', 'karen', 'victoria', 'allison', 'ava', 'female']

const synth = (): SpeechSynthesis | null =>
  typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null

/** All installed voices whose language is English (en*). */
export function englishVoices(): SpeechSynthesisVoice[] {
  const s = synth()
  if (!s) return []
  return s.getVoices().filter((v) => v.lang && v.lang.toLowerCase().startsWith('en'))
}

/** Resolve the voice to speak with: the saved name if still installed, else a
 *  female-named English voice, else the first English voice, else null. */
export function pickVoice(savedName: string): SpeechSynthesisVoice | null {
  const voices = englishVoices()
  if (voices.length === 0) return null
  if (savedName) {
    const exact = voices.find((v) => v.name === savedName)
    if (exact) return exact
  }
  const female = voices.find((v) => FEMALE_HINTS.some((h) => v.name.toLowerCase().includes(h)))
  return female ?? voices[0]
}

/** Run cb once the voice list is populated (getVoices() is async on first load). */
export function whenVoicesReady(cb: () => void): void {
  const s = synth()
  if (!s) {
    cb()
    return
  }
  if (s.getVoices().length > 0) {
    cb()
    return
  }
  const handler = (): void => {
    s.removeEventListener('voiceschanged', handler)
    cb()
  }
  s.addEventListener('voiceschanged', handler)
}

export interface VoiceProfile {
  pitch: number
  rate: number
}

/** Speak a phrase with the chosen English voice + per-avatar pitch/rate. */
export function speak(phrase: string, savedVoiceName: string, profile: VoiceProfile): void {
  const s = synth()
  if (!s || !phrase.trim()) return
  const u = new SpeechSynthesisUtterance(phrase)
  u.lang = 'en-US' // belt-and-suspenders against system-locale interference
  const v = pickVoice(savedVoiceName)
  if (v) u.voice = v
  u.pitch = profile.pitch
  u.rate = profile.rate
  s.cancel() // avoid overlap with a mid-utterance phrase
  s.speak(u)
}
