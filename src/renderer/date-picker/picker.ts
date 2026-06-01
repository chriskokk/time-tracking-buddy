// SPDX-License-Identifier: AGPL-3.0-or-later
// "Review a day…" date picker. One date input + Open/Cancel. On Open we fire
// reviewOpenDate(date) and self-close; main routes through the parameterized
// beginReview() path.

import { localDateStr } from '../../shared/datetime'

const dateInput = document.getElementById('date') as HTMLInputElement
const openBtn = document.getElementById('open') as HTMLButtonElement
const cancelBtn = document.getElementById('cancel') as HTMLButtonElement

// Default to yesterday — most "review a missed day" cases land here.
const yesterday = new Date()
yesterday.setDate(yesterday.getDate() - 1)
dateInput.value = localDateStr(yesterday)
dateInput.max = localDateStr() // can't review the future

function submit(): void {
  const v = dateInput.value
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    dateInput.focus()
    return
  }
  window.api.reviewOpenDate(v)
  window.close()
}

openBtn.addEventListener('click', submit)
cancelBtn.addEventListener('click', () => window.close())
dateInput.addEventListener('keydown', (e) => {
  if ((e as KeyboardEvent).key === 'Enter') submit()
  if ((e as KeyboardEvent).key === 'Escape') window.close()
})
dateInput.focus()
