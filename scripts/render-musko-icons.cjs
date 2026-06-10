// SPDX-License-Identifier: AGPL-3.0-or-later
// One-off icon renderer. Rasterizes Musko (idle pose) to a PNG at the given
// size. Invoked TWICE from the npm `render:icons` script (1024 for the app
// icon, 64 for the tray icon) — running each in a fresh Electron process
// avoids offscreen-rendering state quirks across consecutive captures.
//
// Usage:  electron scripts/render-musko-icons.cjs <size> <outPath>
//
// Re-run with `npm run render:icons` after any Musko SVG/CSS change.

const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')

const argv = process.argv.slice(2)
const size = Number(argv[0])
const outRel = argv[1]
if (!Number.isFinite(size) || size <= 0 || !outRel) {
  console.error('usage: render-musko-icons.cjs <size> <outPath>')
  process.exit(2)
}
const outPath = path.isAbsolute(outRel) ? outRel : path.join(process.cwd(), outRel)

const ROOT = path.join(__dirname, '..')
const SRC = path.join(ROOT, 'src', 'renderer', 'companion')
const read = (p) => fs.readFileSync(path.join(SRC, p), 'utf8')

const baseCss = read('styles.css')
const muskoCss = read('avatars/musko/musko.css')
const muskoMatch = /export const \w+ = `([\s\S]*?)`/.exec(read('avatars/musko/musko.ts'))
if (!muskoMatch) {
  console.error('[render] could not extract the SVG template literal from avatars/musko/musko.ts')
  process.exit(2)
}
const muskoSvgRaw = muskoMatch[1]
// Inject the avatar+state classes that companion.ts sets at runtime.
const muskoSvg = muskoSvgRaw.replace('id="avatar"', 'id="avatar" class="avatar musko idle"')

fs.mkdirSync(path.dirname(outPath), { recursive: true })

app.disableHardwareAcceleration()

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: size,
    height: size,
    show: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: true }
  })
  win.webContents.setFrameRate(20)

  let lastFrame = null
  let captured = false
  win.webContents.on('paint', (_e, _dirty, img) => {
    lastFrame = img
  })

  win.webContents.on('did-finish-load', () => {
    // 500ms after load: animations have settled into the .idle pose (lid
    // scaleY(0.5) at t=0 of the 6s eye animation). Snapshot the latest paint.
    setTimeout(() => {
      if (captured) return
      if (!lastFrame) {
        console.error('[render] no paint received')
        app.exit(1)
        return
      }
      captured = true
      try {
        fs.writeFileSync(outPath, lastFrame.toPNG())
        console.log(`[render] ${outPath}  (${size}x${size}, ${fs.statSync(outPath).size} bytes)`)
        app.quit()
      } catch (err) {
        console.error('[render] write failed:', err)
        app.exit(1)
      }
    }, 500)
  })

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
html, body { margin: 0; height: 100%; background: transparent; overflow: hidden; }
body { display: flex; align-items: center; justify-content: center; }
.sprite { width: 100vw; height: 100vh; }
${baseCss}
${muskoCss}
</style></head>
<body><div class="sprite">${muskoSvg}</div></body>
</html>`
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
})
