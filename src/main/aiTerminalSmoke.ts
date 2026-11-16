import type { BrowserWindow } from 'electron'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { ptyTaps } from './terminals'
import { sendToWindow } from './window'
import type { HookEvent } from '../shared/types'
import { describeTool } from '../shared/agentActivity'

// A stand-in `claude` for the test: prints a colored banner with a file path, then echoes every keystroke it gets.
const FAKE_CLAUDE = `
const colors = [31, 32, 33, 34, 35, 36, 91, 92, 93, 94, 95, 96].map((c) => '\\x1b[' + c + 'm\\u2588\\u2588\\x1b[0m').join(' ')
process.stdout.write('\\x1b[1;38;5;209m\\u2733 Fake Claude\\x1b[0m  ready  \\u2714 \\ud83d\\ude80\\r\\n' + colors + '\\r\\n')
process.stdout.write('Edited \\x1b[36msrc/App.tsx:3\\x1b[0m and see https://example.com\\r\\n')
// Bracketed paste on, as Claude Code does; without it Windows' ConPTY drops the paste markers.
process.stdout.write('\\x1b[?2004h')
if (process.stdin.isTTY) process.stdin.setRawMode(true)
let n = 0
process.stdin.on('data', (d) => process.stdout.write('GOT' + ++n + ':' + JSON.stringify(d.toString()) + '\\r\\n'))
`

/**
 * MC_SMOKE_TERM: the AI terminal (ADR 0043) with no model calls. Puts a fake `claude` first on PATH, opens it as a
 * Claude agent, feeds the app made-up hook events, and checks the activity strip, the changed-files chip, the
 * approval bar's Allow key, the prompt box (send, multi-line paste, history, Esc, quick commands) and file links.
 */
export async function aiTerminalSmoke(win: BrowserWindow, outFile: string, log: (...values: unknown[]) => void) {
  const js = (code: string) => win.webContents.executeJavaScript(code)
  const pause = (ms = 300) => new Promise((resolve) => setTimeout(resolve, ms))
  const until = async (what: string, test: () => boolean | Promise<boolean>, tries = 100) => {
    for (let i = 0; i < tries; i++) {
      if (await test()) return
      await pause(100)
    }
    throw new Error(`Timed out waiting for ${what}`)
  }
  const shot = async (name: string) => {
    await js(`new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))`)
    await pause(250)
    writeFileSync(outFile.replace(/\.png$/, `-${name}.png`), (await win.webContents.capturePage()).toPNG())
  }
  const key = async (keyCode: string, modifiers: ('shift' | 'control')[] = []) => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
    await pause(120)
  }

  const root = mkdtempSync(join(tmpdir(), 'mc-term-smoke-'))
  const repo = join(root, 'repo')
  const bin = join(root, 'bin')
  mkdirSync(join(repo, 'src'), { recursive: true })
  mkdirSync(bin)
  writeFileSync(join(repo, 'src', 'App.tsx'), 'export {}\n')
  writeFileSync(join(bin, 'fake-claude.cjs'), FAKE_CLAUDE)
  writeFileSync(join(bin, 'claude.cmd'), '@node "%~dp0fake-claude.cjs" %*\r\n')
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, windowsHide: true, stdio: 'ignore' })
  git('init', '-q')
  git('add', '-A')
  git('-c', 'user.email=smoke@example.invalid', '-c', 'user.name=smoke', 'commit', '-qm', 'init')
  const oldPath = process.env.PATH
  process.env.PATH = `${bin}${delimiter}${oldPath}`

  let output = ''
  let id = ''
  const tap = { data: (tid: string, d: string) => { if (tid === id) output += d } }
  ptyTaps.add(tap)
  // Each echo is numbered: ConPTY repaints re-send old lines, so only echoes newer than the last check count.
  let seen = 0
  const echoes = () => {
    const all = new Map<number, string>()
    for (const m of output.matchAll(/GOT(\d+):("(?:[^"\\]|\\.)*")/g)) all.set(Number(m[1]), JSON.parse(m[2]) as string)
    return [...all].filter(([k]) => k > seen).sort((a, b) => a[0] - b[0])
  }
  const got = () => echoes().map(([, v]) => v).join('')
  const expectGot = async (what: string, text: string) => {
    await until(what, () => got().includes(text), 40)
    seen = Math.max(seen, ...echoes().map(([k]) => k))
  }
  const hook = (event: string, extra: Partial<HookEvent> = {}) => sendToWindow('hook:event', { agentId: id, event, at: Date.now(), ...extra } satisfies HookEvent)
  const strip = () => js(`document.querySelector('.agent-cell.focused .activity-strip')?.innerText ?? ''`) as Promise<string>

  win.show()
  win.setContentSize(1440, 900)
  try {
    await until('the UI', async () => !!(await js('!!window.__mcSmoke')), 150)
    await js(`document.documentElement.dataset.theme = 'dark'`)
    const info = await js(`window.__mcSmoke.launch({ cwd: ${JSON.stringify(repo)}, projectPath: ${JSON.stringify(repo)}, projectName: 'ai terminal', title: 'ai terminal', kind: 'claude' })`)
    id = info.id
    await until('the fake claude banner', () => output.includes('Fake Claude'), 150)
    await until('the prompt box', async () => !!(await js(`!!document.querySelector('.agent-cell.focused .composer textarea')`)))
    await until('the prompt box to take focus', async () => !!(await js(`document.activeElement?.matches('.composer textarea')`)))
    const gpu = await js(`!!document.querySelector('.agent-cell.focused .terminal-host canvas')`)
    log('GPU renderer:', gpu ? 'on' : 'off (fallback renderer)')

    // Activity strip: the tool Claude is on, then "Thinking" between tools, then the changed-files chip.
    hook('UserPromptSubmit')
    hook('PreToolUse', { tool: describeTool('Bash', { command: 'npm test -- --run' }) })
    await until('the strip to show the command', async () => (await strip()).includes('Running npm test -- --run'))
    await shot('term-working')
    hook('PostToolUse', { tool: describeTool('Edit', { file_path: join(repo, 'src', 'App.tsx') }) })
    await until('Thinking and the changed-files chip', async () => {
      const s = await strip()
      return s.includes('Thinking') && s.includes('1 file changed')
    })

    // Approval: the bar names the command; Allow presses Enter in the terminal and the bar goes away.
    hook('PreToolUse', { tool: describeTool('Bash', { command: 'rm -rf build' }) })
    hook('Notification', { message: 'Claude needs your permission to use Bash', notificationType: 'permission_prompt' })
    await until('the approval bar', async () => ((await js(`document.querySelector('.agent-cell.focused .approval-bar')?.innerText ?? ''`)) as string).includes('rm -rf build'))
    await shot('term-approval')
    await js(`document.querySelector('.agent-cell.focused .approval-btn.allow').click()`)
    await expectGot('Allow to press Enter', '\r')
    await until('the approval bar to close', async () => !(await js(`!!document.querySelector('.agent-cell.focused .approval-bar')`)))

    // Prompt box: one line, then several lines as one bracketed paste, then history, Esc and a quick command.
    await js(`document.querySelector('.agent-cell.focused .composer textarea').focus()`)
    win.webContents.insertText('hello from the prompt box')
    await pause(150)
    await key('Return')
    await expectGot('the prompt, then Enter', 'hello from the prompt box\r')
    win.webContents.insertText('line one\nline two')
    if ((await js(`document.querySelector('.agent-cell.focused .composer textarea').value`)) !== 'line one\nline two') throw new Error('the prompt box did not take two lines')
    await pause(150)
    await key('Return')
    await expectGot('a multi-line prompt as one bracketed paste', '\x1b[200~line one\rline two\x1b[201~\r')
    await key('Up')
    const recalled = await js(`document.querySelector('.agent-cell.focused .composer textarea').value`)
    if (recalled !== 'line one\nline two') throw new Error(`history recalled ${JSON.stringify(recalled)}`)
    await key('Escape')
    await key('Escape')
    await expectGot('Esc in an empty box to reach the agent', '\x1b')
    hook('Stop')
    await until('done', async () => (await strip()).includes('Done'))
    await js(`[...document.querySelectorAll('.agent-cell.focused .composer-chip')].find(b => b.textContent.includes('Compact')).click()`)
    await expectGot('the /compact quick command', '/compact')

    // File links only for files that exist.
    const exists = await js(`window.mc.filesExist(${JSON.stringify(repo)}, ['src/App.tsx', 'src/nope.ts'])`)
    if (JSON.stringify(exists) !== '[true,false]') throw new Error(`filesExist gave ${JSON.stringify(exists)}`)

    hook('Stop')
    await pause(300)
    await shot('term-done')
    await js(`document.documentElement.dataset.theme = 'light'`)
    await shot('term-light')
    await js(`document.documentElement.dataset.theme = 'dark'`)
    win.setContentSize(960, 700)
    await pause(400)
    await shot('term-narrow')
    log('ai terminal: strip, changed files, approval, prompt box, history, Esc, quick command and file check passed')
    log('ai terminal smoke: PASS')
  } catch (err) {
    log('terminal output:', JSON.stringify(output.slice(-1500)))
    await shot('term-failure').catch(() => undefined)
    throw err
  } finally {
    ptyTaps.delete(tap)
    process.env.PATH = oldPath
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 3 })
    } catch {
      /* the terminal may still hold the folder a moment */
    }
  }
}
