import type { BrowserWindow } from 'electron'
import { writeFileSync } from 'node:fs'
import { loadStore, updateStore } from './store'

/** Read-only visual tour, using the isolated self-test profile and no model calls. */
export async function uiPolishSmoke(win: BrowserWindow, outFile: string, log: (...values: unknown[]) => void) {
  const settings = structuredClone(loadStore().settings)
  const js = async (code: string) => {
    try { return await win.webContents.executeJavaScript(code) }
    catch (e) { throw new Error(`UI script: ${code}\n${String(e)}`) }
  }
  const pause = (ms = 200) => new Promise(resolve => setTimeout(resolve, ms))
  const key = async (keyCode: string) => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode })
    await pause(50)
  }
  const until = async (code: string) => {
    for (let i = 0; i < 100; i++) { if (await js(code)) return; await pause(100) }
    throw new Error(`UI condition: ${code}`)
  }
  const shot = async (name: string) => {
    await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    await win.webContents.capturePage(); await pause()
    writeFileSync(outFile.replace(/\.png$/, `-${name}.png`), (await win.webContents.capturePage()).toPNG())
  }
  win.show(); win.focus(); win.webContents.setBackgroundThrottling(false)
  try {
    await until('!!window.__mcSmoke && !!document.querySelector(".project-name")')
    for (const theme of ['dark', 'light']) {
      await js(`if (document.documentElement.dataset.theme !== '${theme}') window.__mcSmoke.runShortcut('toggleTheme')`)
      await until(`document.documentElement.dataset.theme === '${theme}'`)
      for (const width of [1440, 960]) {
        win.setSize(width, width === 960 ? 640 : 900); await pause(400)
        for (const view of ['home', 'projects', 'tasks', 'search', 'usage']) {
          await js(`window.__mcSmoke.setView('${view}')`); await pause(600)
          await shot(`${theme}-${width}-${view}`)
          const overflow = await js(`(() => {
            const pane = document.querySelector('.view-pane:not(.hidden)'), top = document.querySelector('.topbar');
            return { view: pane.scrollWidth - pane.clientWidth, top: top.scrollWidth - top.clientWidth };
          })()`)
          log('layout', theme, width, view, overflow)
          if (overflow.top > 1 || overflow.view > 1) throw new Error(`Unexpected overflow in ${view}`)
        }
        // Actual keyboard events: open, navigate, dismiss and restore focus.
        await js(`document.querySelector('.topbar-new').focus()`)
        await key('Down')
        await until(`document.activeElement === document.querySelector('.menu-item:not(:disabled)')`)
        await key('End')
        await until(`document.activeElement === [...document.querySelectorAll('.menu-item:not(:disabled)')].at(-1)`)
        await key('Down')
        await until(`document.activeElement === document.querySelector('.menu-item:not(:disabled)')`)
        await key('Escape')
        await until(`!document.querySelector('.menu[role="menu"]') && document.activeElement === document.querySelector('.topbar-new')`)
        // Put the existing trigger at the bottom edge to exercise upward placement.
        await js(`window.__menuAnchor = document.querySelector('.topbar-new').closest('.menu-anchor'); window.__anchorStyle = window.__menuAnchor.getAttribute('style'); window.__menuAnchor.style.cssText = 'position:fixed;right:8px;bottom:4px;z-index:100'; document.querySelector('.topbar-new').click()`)
        await until(`!!document.querySelector('.menu[role="menu"]')`)
        await pause()
        const fits = await js(`(() => { const r = document.querySelector('.menu[role="menu"]').getBoundingClientRect(), a = window.__menuAnchor.getBoundingClientRect(); return r.top >= 7 && r.left >= 7 && r.right <= innerWidth - 7 && r.bottom <= a.top; })()`)
        if (!fits) throw new Error('Menu clipped at viewport edge')
        await shot(`${theme}-${width}-menu`)
        await key('Tab')
        await until(`!document.querySelector('.menu[role="menu"]')`)
        await js(`if (window.__anchorStyle === null) window.__menuAnchor.removeAttribute('style'); else window.__menuAnchor.setAttribute('style', window.__anchorStyle)`)
        log('menus: keyboard focus, wrapping navigation, Escape, Tab and upward placement passed', theme, width)
        await js('window.__mcSmoke.openSettings()')
        await until('!!document.querySelector(".settings-pane")')
        await shot(`${theme}-${width}-settings`)
        await js('document.querySelector(".settings .dialog-head button").click()')
        await until('!document.querySelector(".settings-pane")')
      }
    }
    await js(`window.__mcSmoke.setView('search')`)
    await until(`!!document.querySelector('[aria-label="Search chats"]')`)
    await js(`(() => { const input = document.querySelector('[aria-label="Search chats"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'MC_NO_MATCH_82734'); input.dispatchEvent(new Event('input', {bubbles:true})); })()`)
    await until(`document.querySelector('.search-results').getAttribute('aria-busy') === 'true'`)
    await until(`document.querySelector('.search-results').getAttribute('aria-busy') === 'false' && document.querySelector('.search-results').textContent.includes('No matches')`)
    await js(`document.querySelector('[aria-label="Search chats"]').focus()`)
    await key('Escape')
    await until(`document.querySelector('.search-results').textContent.includes('Search all your chats') && !document.querySelector('.search-results').textContent.includes('No matches')`)
    log('search: loading, no results and clearing query passed')
    await js(`window.__mcSmoke.setView('knowledge')`)
    await until(`document.querySelectorAll('.kn-doc').length >= 2`)
    for (const index of [0, 1]) {
      await js(`document.querySelectorAll('.kn-doc')[${index}].click()`)
      await until(`!![...document.querySelectorAll('.kn-view .doc-view button')].find(b => b.textContent.trim() === 'Edit' && !b.disabled)`)
      await js(`[...document.querySelectorAll('.kn-view .doc-view button')].find(b => b.textContent.trim() === 'Edit').click()`)
      await until(`!!document.querySelector('.kn-view .doc-editor')`)
      const correct = await js(`(async () => document.querySelector('.kn-view .doc-editor').value === await window.mc.readDoc(document.querySelectorAll('.kn-doc')[${index}].title))()`)
      if (!correct) throw new Error('Document editor shows another file or loading/error text')
      await js(`[...document.querySelectorAll('.kn-view .doc-view button')].find(b => b.textContent.trim() === 'Cancel').click()`)
    }
    await shot('document-reader')
    log('documents: switched files, loaded correct content and cancelled editing without saving')
    await js(`window.mc.setZoom(1.25); void 0`)
    await pause(400)
    await js('window.__mcSmoke.openSettings()')
    await until('!!document.querySelector(".settings-pane")')
    await shot('zoom-125-settings')
    const dialogFits = await js(`(() => { const r = document.querySelector('.settings').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; })()`)
    if (!dialogFits) throw new Error('Settings clipped at 125% zoom')
    log('UI polish tour: PASS')
  } finally {
    await js(`window.mc.setZoom(${settings.uiZoom || 1}); void 0`)
    updateStore(s => { s.settings = settings })
  }
}
