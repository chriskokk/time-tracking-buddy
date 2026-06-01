// SPDX-License-Identifier: AGPL-3.0-or-later
// Persistent scratchpad: a single freeform text blob, debounced auto-save.
const text = document.getElementById('text') as HTMLTextAreaElement
const statusEl = document.getElementById('status') as HTMLDivElement

let saveTimer: ReturnType<typeof setTimeout> | null = null

function scheduleSave(): void {
  statusEl.textContent = 'editing…'
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    window.api.scratchpadSave(text.value)
    statusEl.textContent = 'saved ✓'
  }, 500)
}

text.addEventListener('input', scheduleSave)

// Flush a pending save if the window is closing.
window.addEventListener('beforeunload', () => {
  if (saveTimer) {
    clearTimeout(saveTimer)
    window.api.scratchpadSave(text.value)
  }
})

window.api.scratchpadGet().then((saved) => {
  text.value = saved
  statusEl.textContent = saved ? 'saved ✓' : ''
})
