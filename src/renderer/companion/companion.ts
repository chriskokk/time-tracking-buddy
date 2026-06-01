// SPDX-License-Identifier: AGPL-3.0-or-later
// Companion renderer. All four avatars (musko, drago, gato, tido) use the
// CSS @keyframes + class-based state system: the root SVG gets
// class="avatar <name> <state>" plus optional .reading / .exiting / .dragging
// overlays, and per-avatar stylesheets drive the animations.
//
// The window starts click-through with { forward: true }, so the only events
// the OS delivers while click-through are mousemove — we hit-test off that
// stream.

import { musko } from './avatars/musko/musko'
import { drago } from './avatars/drago/drago'
import { gato } from './avatars/gato/gato'
import { tido } from './avatars/tido/tido'
import { VOICE_PROFILES } from '../../shared/config'
import { speak, whenVoicesReady } from '../voice'

const AVATARS: Record<string, string> = { musko, drago, gato, tido }

const sprite = document.getElementById('sprite')

// Module-scope so state/avatar/drag survive an avatar hot-swap.
let currentAvatar = 'musko'
let currentState = 'idle'
let dragging = false
// Reading is a scheduler-independent overlay driven by the scratchpad window
// open/close. Precedence: dragging > reading > scheduler state. `exiting` is
// the 0.3s window where the .reading class is still on so CSS can run the
// reverse animation (glasses lift + notepad drop) before the class is removed.
let reading = false
let exiting = false
let exitTimer: ReturnType<typeof setTimeout> | null = null
let avatarEl: SVGElement | null = null

const EXIT_MS = 300

// --- Deepening sleep ---
// While in the sleeping state the companion advances through four depth
// sub-stages over time (0 on entry, then progressively deeper). Each depth
// is applied as a class `sleep-depth-N` on the avatar root; per-avatar CSS
// uses .<avatar>.sleeping.sleep-depth-<N> selectors to drive the visuals.
// Resets to 0 on every leave-sleeping. A tray "Advance sleep depth" item
// can manually bump the stage for testing without waiting full intervals.
let sleepDepth = 0
let sleepDepthTimer: ReturnType<typeof setTimeout> | null = null
// Interval BEFORE advancing to the next depth, indexed by current depth.
// 0→1 at 90s, 1→2 at +90s (3min total), 2→3 at +120s (5min total). Depth 3
// is the deepest; no further advance.
const SLEEP_DEPTH_INTERVALS_MS = [90_000, 90_000, 120_000]

function scheduleSleepAdvance(): void {
  if (sleepDepthTimer) {
    clearTimeout(sleepDepthTimer)
    sleepDepthTimer = null
  }
  if (sleepDepth >= 3) return
  const ms = SLEEP_DEPTH_INTERVALS_MS[sleepDepth]
  sleepDepthTimer = setTimeout(() => {
    sleepDepthTimer = null
    sleepDepth++
    console.log(`[sleep] depth → ${sleepDepth} (timer)`)
    applyClasses()
    scheduleSleepAdvance()
  }, ms)
}

function resetSleepDepth(): void {
  if (sleepDepthTimer) {
    clearTimeout(sleepDepthTimer)
    sleepDepthTimer = null
  }
  if (sleepDepth !== 0) {
    sleepDepth = 0
    console.log('[sleep] depth reset to 0 (left sleeping)')
  }
}

/** Tray test affordance: bump depth by one, re-schedule the next timer.
 *  No-op unless we're ACTIVELY sleeping (an overlay suspends it) and below max. */
function advanceSleepDepthManual(): void {
  if (currentState !== 'sleeping' || reading || dragging) {
    console.log('[sleep] manual advance ignored — not actively sleeping')
    return
  }
  if (sleepDepth >= 3) {
    console.log('[sleep] manual advance ignored — already at max depth 3')
    return
  }
  sleepDepth++
  console.log(`[sleep] depth → ${sleepDepth} (manual)`)
  applyClasses()
  scheduleSleepAdvance()
}

/** Keep the sleep-depth progression in sync with whether sleeping is actually
 *  being SHOWN. Reading/dragging fully preempt sleeping (see applyClasses), so
 *  while an overlay is up we stop and reset the progression; when it clears and
 *  we're still in the sleeping state, we restart from depth 0. Called from every
 *  site that flips currentState, reading, dragging, or exiting. */
function refreshSleepMachine(): void {
  const sleepingShown = currentState === 'sleeping' && !reading && !dragging && !exiting
  if (sleepingShown) {
    // Resume/start only if not already counting (a running timer means we're
    // mid-progression and must be left alone).
    if (sleepDepthTimer === null && sleepDepth < 3) scheduleSleepAdvance()
  } else {
    resetSleepDepth()
  }
}

let lastClassString: string | null = null
function applyClasses(): void {
  if (!avatarEl) return
  // Reading/dragging fully preempt the scheduler state: while one is active we
  // must NOT emit `sleeping`/`sleep-depth-N`, or the sleep props (#blanket /
  // #sleepcap) bleed through under the reading/dragging props — those overlays
  // hide #glasses/#notepad/#zzz but never the sleep props. Substituting `idle`
  // gives a clean single scheduler-state with no leftover sleeping classes.
  const overlayPreempts = reading || dragging
  const effectiveState = overlayPreempts && currentState === 'sleeping' ? 'idle' : currentState
  const sleepClass = effectiveState === 'sleeping' ? ` sleep-depth-${sleepDepth}` : ''
  const overlay =
    (reading ? ' reading' : '') + (exiting ? ' exiting' : '') + (dragging ? ' dragging' : '')
  const next = `avatar ${currentAvatar} ${effectiveState}${sleepClass}${overlay}`
  if (next !== lastClassString) {
    // One-line diagnostic so the sleep-depth chain (and any future class
    // composition bug) can be verified from the renderer console.
    console.log(`[anim] class → "${next}"`)
    lastClassString = next
  }
  avatarEl.setAttribute('class', next)
}

function setReading(next: boolean): void {
  if (next === reading && !exiting) return
  if (next) {
    // Cancel any in-flight exit and snap back to reading.
    if (exitTimer) {
      clearTimeout(exitTimer)
      exitTimer = null
    }
    reading = true
    exiting = false
    refreshSleepMachine() // reading preempts sleeping: suspend the progression
    applyClasses()
    return
  }
  // false: if we weren't reading, nothing to do.
  if (!reading) return
  // Run the exit animation, then drop the class entirely.
  exiting = true
  applyClasses()
  if (exitTimer) clearTimeout(exitTimer)
  exitTimer = setTimeout(() => {
    exitTimer = null
    reading = false
    exiting = false
    refreshSleepMachine() // overlay cleared: resume sleeping if still in that state
    applyClasses()
  }, EXIT_MS)
}

/** Inject an avatar's SVG, preserving the current state + drag (and the window
 *  position is untouched, so a swap keeps everything in place). */
function loadAvatar(name: string): void {
  if (!sprite) return
  currentAvatar = AVATARS[name] ? name : 'musko'
  sprite.innerHTML = AVATARS[currentAvatar]
  avatarEl = sprite.querySelector('svg')
  applyClasses()
}

if (sprite) {
  let interactive = false
  let grabX = 0
  let grabY = 0

  function setInteractive(next: boolean): void {
    if (next === interactive) return
    interactive = next
    window.api.setIgnoreMouse(!next)
  }

  function setHot(hot: boolean): void {
    sprite!.classList.toggle('hot', hot)
  }

  // Hit-test against the painted creature (contains, not ===, since the cursor
  // lands on an SVG shape inside #sprite). Transparent gaps read as "off".
  window.addEventListener('mousemove', (e: MouseEvent) => {
    if (dragging) {
      window.api.moveTo(e.screenX - grabX, e.screenY - grabY)
      return
    }
    const el = document.elementFromPoint(e.clientX, e.clientY)
    const over = el !== null && sprite.contains(el)
    setInteractive(over)
    setHot(over)
  })

  sprite.addEventListener('mousedown', (e: MouseEvent) => {
    if (e.button !== 0) return // left only; right-click is the context menu
    e.preventDefault()
    dragging = true
    grabX = e.clientX
    grabY = e.clientY
    setInteractive(true)
    setHot(true)
    refreshSleepMachine() // dragging preempts sleeping: suspend the progression
    applyClasses() // startled "picked up" overlay (.dragging)
  })

  window.addEventListener('mouseup', () => {
    if (!dragging) return
    dragging = false
    refreshSleepMachine() // overlay cleared: resume sleeping if still in that state
    applyClasses() // scheduler state reasserts
    window.api.companionDragEnded() // main persists the new position
  })

  // Right-click the body opens the native context menu (hit-tested so gaps pass
  // through). Different mouse button than the drag, so they never interfere.
  window.addEventListener('contextmenu', (e: MouseEvent) => {
    const el = document.elementFromPoint(e.clientX, e.clientY)
    if (el !== null && sprite.contains(el)) {
      e.preventDefault()
      window.api.showContextMenu()
    }
  })
}

// Voice notification config (kept in sync from settings).
let voiceEnabled = false
let voicePhrase = ''
let voiceName = ''
window.api.companionGetVoice().then((cfg) => {
  voiceEnabled = cfg.enabled
  voicePhrase = cfg.phrase
  voiceName = cfg.voiceName
})
window.api.onVoiceChange((cfg) => {
  voiceEnabled = cfg.enabled
  voicePhrase = cfg.phrase
  voiceName = cfg.voiceName
})
whenVoicesReady(() => {}) // warm the voice list early so alert speech is ready

// Scheduler state -> animation (root class). No new IPC; same channel as before.
window.api.onCompanionState((state) => {
  const prev = currentState
  currentState = state
  // Sleep-depth state machine: kick off the timer on entry to sleeping, reset
  // on every leave (wake / alert / talking / etc.). Must run BEFORE applyClasses
  // so the right sleep-depth class is on the SVG when classes are rewritten.
  // refreshSleepMachine() gates the start on no overlay being active — entering
  // sleeping while the scratchpad is already open must NOT start a hidden
  // progression (it would surface the moment the scratchpad closes).
  if (state === 'sleeping' && prev !== 'sleeping') {
    sleepDepth = 0
    refreshSleepMachine()
  } else if (state !== 'sleeping' && prev === 'sleeping') {
    resetSleepDepth()
  }
  applyClasses()
  // Speak ONCE on the transition INTO alert, in the current avatar's voice character.
  if (state === 'alert' && prev !== 'alert' && voiceEnabled) {
    const profile = VOICE_PROFILES[currentAvatar] ?? VOICE_PROFILES.musko
    speak(voicePhrase, voiceName, profile)
  }
})

// Manual sleep-depth advance from the Advanced tray menu (test affordance).
window.api.onAdvanceSleepDepth(() => advanceSleepDepthManual())

// Live avatar swap from settings (state + position preserved).
window.api.onAvatarChange((name) => loadAvatar(name))

// Reading overlay: pushed by main when the scratchpad opens/closes.
window.api.onReadingChange((next) => setReading(next))

// Initial load: the configured avatar (falls back to musko on any error).
window.api
  .companionGetAvatar()
  .then((name) => loadAvatar(name))
  .catch(() => loadAvatar('musko'))

// If the scratchpad is already open when the companion starts, begin in reading.
// Run after the avatar load so .reading is applied to the freshly-injected SVG.
window.api.companionGetReading().then((open) => {
  if (open) setReading(true)
})
