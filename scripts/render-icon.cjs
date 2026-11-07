// Renders build/icon.svg to build/icon.png (512x512) with Electron, for electron-builder.
// Run: npx electron scripts/render-icon.cjs
// NOTE: build/icon.png is now a downscale of build/icon-master.png (generated art, ADR 0038). Running this script replaces it with the flat SVG render.
const { app, BrowserWindow } = require('electron')
const { readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const SIZE = 512
const root = join(__dirname, '..')

app.whenReady().then(async () => {
  const svg = readFileSync(join(root, 'build', 'icon.svg'), 'utf8')
  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: { offscreen: true }
  })
  const html = `<html><body style="margin:0;background:transparent">${svg.replace('width="256" height="256"', `width="${SIZE}" height="${SIZE}"`)}</body></html>`
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  await new Promise((r) => setTimeout(r, 300))
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: SIZE, height: SIZE })
  writeFileSync(join(root, 'build', 'icon.png'), image.resize({ width: SIZE, height: SIZE }).toPNG())
  console.log('wrote build/icon.png', image.getSize())
  app.quit()
})
