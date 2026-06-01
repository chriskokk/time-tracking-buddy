// SPDX-License-Identifier: AGPL-3.0-or-later
import type { CompanionApi } from './index'

// Makes `window.api` strongly typed inside every renderer window.
declare global {
  interface Window {
    api: CompanionApi
  }
}

export {}
