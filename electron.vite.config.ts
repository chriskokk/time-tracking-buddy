// SPDX-License-Identifier: AGPL-3.0-or-later
import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    build: {
      rollupOptions: {
        input: {
          // One entry per window — each is a separate HTML document.
          companion: resolve(__dirname, 'src/renderer/companion/index.html'),
          chat: resolve(__dirname, 'src/renderer/chat/index.html'),
          settings: resolve(__dirname, 'src/renderer/settings/index.html'),
          scratchpad: resolve(__dirname, 'src/renderer/scratchpad/index.html'),
          history: resolve(__dirname, 'src/renderer/history/index.html'),
          'date-picker': resolve(__dirname, 'src/renderer/date-picker/index.html')
        }
      }
    }
  }
})
