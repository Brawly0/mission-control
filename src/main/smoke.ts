import { app, type BrowserWindow } from 'electron'
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { createTask, deleteTask, flushTasks, listTasks, startTask } from './tasks'
import type { HookEvent, TerminalInfo, TerminalSpec } from '../shared/types'
import { listProjects, listSessions, normalizePath, setProjectMeta } from './claudeData'
import { commitAll, createWorktree, getChanges, mergeWorktree, removeWorktree } from './git'
import { killTerminalsIn } from './pty'
import { updateStore } from './store'

interface SmokeDeps {
  launchTerminal: (spec: TerminalSpec) => TerminalInfo
  ptyTaps: Set<{ data?: (id: string, d: string) => void; exit?: (id: string, code: number) => void }>
  hookTaps: Set<(e: HookEvent) => void>
}

/** Logs to stdout, and to MC_SMOKE_LOG if set (a packaged Windows app has no console). */
const log = (...a: unknown[]) => {
  console.log('[smoke]', ...a)
  if (process.env.MC_SMOKE_LOG) {
    const line = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')
    appendFileSync(process.env.MC_SMOKE_LOG, `[smoke] ${line}\n`)
  }
}
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g, '').trim()

/** Runs a claude terminal to completion through the real launch path; returns its output and hook events. */
function runClaude(deps: SmokeDeps, spec: TerminalSpec): Promise<{ output: string; hooks: HookEvent[]; info: TerminalInfo }> {
  return new Promise((resolve) => {
    let output = ''
    const hooks: HookEvent[] = []
    let info: TerminalInfo
    const hookTap = (e: HookEvent) => info && e.agentId === info.id && hooks.push(e)
    const tap = {
      data: (id: string, d: string) => {
        if (info && id === info.id) output += d
      },
      exit: (id: string) => {
        if (!info || id !== info.id) return
        // Hooks are separate curl processes; give the last ones a moment to land.
        setTimeout(() => done(), 1500)
      }
    }
    const done = () => {
      deps.ptyTaps.delete(tap)
      deps.hookTaps.delete(hookTap)
      resolve({ output: stripAnsi(output), hooks, info })
    }
    deps.ptyTaps.add(tap)
    deps.hookTaps.add(hookTap)
    info = deps.launchTerminal(spec)
    setTimeout(done, 90_000)
  })
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * MC_SMOKE_UI=<git repo with a commit>: screenshots each screen, then runs the worktree flow on that
 * repo: create, change a file, read the diff, commit, merge into the base branch, delete.
 */
async function uiTour(win: BrowserWindow, outFile: string, repo: string): Promise<void> {
  const shot = async (name: string) => {
    await sleep(700)
    const file = outFile.replace(/\.png$/, `-${name}.png`)
    writeFileSync(file, (await win.webContents.capturePage()).toPNG())
    log('screenshot:', file)
  }
  const js = (code: string) => win.webContents.executeJavaScript(code)
  const click = (selector: string, text: string) =>
    js(`[...document.querySelectorAll(${JSON.stringify(selector)})].find(e => e.textContent.includes(${JSON.stringify(text)}))?.click()`)

  await js(`window.__mcSmoke.setView('home')`)
  await shot('home')

  // Wait for the chat index, then show Usage and a search.
  for (let i = 0; i < 120 && (await js('window.mc.indexStatus()')).lastRun === 0; i++) await sleep(500)
  log('index:', JSON.stringify(await js('window.mc.indexStatus()')))
  await js(`window.__mcSmoke.setView('usage')`)
  await sleep(800)
  await shot('usage')
  await js(`window.__mcSmoke.setView('search')`)
  await js(`(() => {
    const input = document.querySelector('.search-box input')
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    set.call(input, ${JSON.stringify(process.env.MC_SMOKE_QUERY || 'trading bot')})
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await sleep(800)
  log('search results shown:', await js(`document.querySelectorAll('.result').length`))
  await shot('search')

  // Show the throwaway repo as a project for the duration of the tour.
  updateStore((s) => {
    s.manualProjects.push(repo)
  })
  setProjectMeta(repo, {
    group: 'Demo',
    tags: ['test', 'ui'],
    status: 'active',
    notes: '## Next steps\n\n- Try a worktree agent\n- Merge its branch\n\nNotes are **Markdown** and save as you type.'
  })
  try {
    await projectTour()
  } finally {
    updateStore((s) => {
      s.manualProjects = s.manualProjects.filter((p) => p !== repo)
      delete s.projectMeta[normalizePath(repo)]
    })
  }

  async function projectTour() {
  await js(`window.__mcSmoke.refresh()`)
  await sleep(800)
  await js(`window.__mcSmoke.selectProject(${JSON.stringify(repo)}); window.__mcSmoke.setView('project')`)
  writeFileSync(join(repo, 'README.md'), '# Demo repo\n\nAn uncommitted edit in the main checkout.\n')
  await sleep(600)
  await shot('project-overview')
  await click('.page-tabs button', 'Changes')
  await shot('project-changes')
  await click('.page-tabs button', 'Docs')
  await shot('project-docs')
  // Restore the main checkout so the merge below can run.
  writeFileSync(join(repo, 'README.md'), '# Demo repo\n')

  await js(`window.__mcSmoke.openPalette()`)
  await shot('palette')
  await js(`document.querySelector('.overlay')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`)

  // Worktree flow against the throwaway repo.
  const wt = await createWorktree(repo)
  log('worktree:', wt.branch, 'from', wt.base, 'at', wt.path)
  writeFileSync(join(wt.path, 'agent-note.md'), '# Written by an agent\n\nHello from the worktree.\n')
  const before = await getChanges(wt.path, wt.base)
  log('changes before commit:', before.files.map((f) => `${f.status} ${f.path}`), 'commits:', before.commits.length)
  await commitAll(wt.path, 'Add agent note')
  const after = await getChanges(wt.path, wt.base)
  log('after commit: files', after.files.length, 'commits', after.commits)
  log('merge:', (await mergeWorktree(wt)).split('\n')[0])
  log('file in main checkout after merge:', existsSync(join(repo, 'agent-note.md')))

  // Show it in the UI: two agents in a grid, the first in the worktree, with the review panel open.
  await js(`window.__mcSmoke.launch({ cwd: ${JSON.stringify(wt.path)}, projectName: 'demo-repo', projectPath: ${JSON.stringify(repo)}, title: 'demo · ${wt.branch.replace('mc/', '')}', kind: 'shell', worktree: ${JSON.stringify(wt)} })`)
  writeFileSync(join(wt.path, 'agent-note.md'), '# Written by an agent\n\nHello from the worktree.\nA second, uncommitted line.\n')
  await js(`window.__mcSmoke.launch({ cwd: ${JSON.stringify(process.cwd())}, projectName: 'claude-hub', title: 'claude-hub · shell', kind: 'shell' })`)
  await click('.segmented button', 'Grid')
  await click('.agent-tab', 'agent-')
  await sleep(300)
  await click('.agent-bar-end button', 'Review')
  await sleep(2500)
  await shot('agents-review')

  // Same order as the Discard button: stop agents in the worktree, then delete it.
  log('stopped agents in worktree:', (await killTerminalsIn(wt.path)).length)
  await removeWorktree(wt)
  log('worktree removed:', !existsSync(wt.path))
  }
}

/**
 * MC_SMOKE_TASKS=<git repo with a commit>: runs one real headless task (Haiku, in a worktree, small
 * budget) through the board, screenshots the board while running and after, the drawer and the
 * composer, checks the result, then deletes the task and its worktree. Uses a little Claude usage.
 */
async function taskTour(win: BrowserWindow, outFile: string, repo: string): Promise<void> {
  const shot = async (name: string) => {
    await sleep(600)
    const file = outFile.replace(/\.png$/, `-${name}.png`)
    writeFileSync(file, (await win.webContents.capturePage()).toPNG())
    log('screenshot:', file)
  }
  const js = (code: string) => win.webContents.executeJavaScript(code)

  const task = createTask({
    title: 'Write a hello note',
    prompt: 'Create a file named NOTES.md containing exactly one line: "hello from a Mission Control task". Then reply with one short sentence saying it is done.',
    projectPath: repo,
    projectName: basename(repo),
    mode: 'headless',
    permission: 'acceptEdits',
    useWorktree: true,
    budgetUsd: 0.2,
    model: 'haiku'
  })
  const todo = createTask({
    title: 'Refactor the settings page',
    prompt: 'Split the settings page into smaller components.',
    projectPath: repo,
    projectName: basename(repo),
    mode: 'interactive',
    permission: 'auto',
    useWorktree: false
  })
  try {
    await js(`window.__mcSmoke.setView('tasks')`)
    await startTask(task.id)
    const started = Date.now()
    let shotRunning = false
    for (;;) {
      const t = listTasks().find((x) => x.id === task.id)!
      if (!shotRunning && t.run && t.run.toolCalls > 0) {
        await shot('tasks-running')
        shotRunning = true
      }
      if (t.column !== 'running' || Date.now() - started > 150_000) break
      await sleep(250)
    }
    const t = listTasks().find((x) => x.id === task.id)!
    log('task column:', t.column, '| error:', t.run?.error ?? 'none')
    log('task run:', `tools ${t.run?.toolCalls}, turns ${t.run?.turns}, cost $${t.run?.costUsd?.toFixed(4)}, session ${t.run?.sessionId}`)
    log('task result:', JSON.stringify((t.run?.result ?? '').slice(0, 160)))
    log('task events:', t.run?.events.map((e) => `${e.kind}: ${e.text.split('\n')[0].slice(0, 70)}`))
    if (t.worktree) {
      const note = join(t.worktree.path, 'NOTES.md')
      log('NOTES.md in worktree:', existsSync(note) ? JSON.stringify(readFileSync(note, 'utf8').trim()) : 'missing')
    }
    await shot('tasks-review')
    await js(`window.__mcSmoke.openTask(${JSON.stringify(task.id)})`)
    await sleep(400)
    await shot('task-drawer')
    await js(`window.__mcSmoke.openTask(null)`)
    await js(`window.__mcSmoke.openComposer()`)
    await shot('task-composer')
  } finally {
    const wt = listTasks().find((x) => x.id === task.id)?.worktree
    deleteTask(task.id)
    deleteTask(todo.id)
    flushTasks()
    if (wt) {
      await killTerminalsIn(wt.path)
      await removeWorktree(wt)
      log('task worktree removed:', !existsSync(wt.path))
    }
  }
}

/**
 * Self-test, run with MC_SMOKE=<output.png>. Scans projects, runs claude in a PTY, screenshots, quits.
 * With MC_SMOKE_HOOKS=<folder>, also sends one tiny real prompt there to check hook events end to end.
 */
export async function runSmoke(win: BrowserWindow, outFile: string, deps: SmokeDeps): Promise<void> {
  try {
    const projects = await listProjects()
    log('projects:', projects.length)
    const withSessions = projects.find((p) => p.key)
    if (withSessions) {
      const sessions = await listSessions(withSessions.key)
      log('sessions in', withSessions.name, ':', sessions.length, '-', sessions[0]?.title)
    }

    const version = await runClaude(deps, { cwd: process.cwd(), args: ['--version'], kind: 'claude', cols: 100, rows: 20 })
    log('pty output:', JSON.stringify(version.output))

    const hookDir = process.env.MC_SMOKE_HOOKS
    if (hookDir) {
      // MC_SMOKE_MODEL picks a cheaper or available model, e.g. haiku.
      const model = process.env.MC_SMOKE_MODEL
      const promptArgs = [...(model ? ['--model', model] : []), '-p', 'Reply with exactly the word: pong']
      const run = await runClaude(deps, {
        cwd: hookDir,
        args: promptArgs,
        kind: 'claude',
        cols: 100,
        rows: 20
      })
      log('prompt output:', JSON.stringify(run.output.slice(0, 200)))
      log('assigned session id:', run.info.sessionId)
      log('hook events:', run.hooks.map((h) => `${h.event}${h.sessionId === run.info.sessionId ? '' : ` (session ${h.sessionId})`}`))

      // Same thing through the UI: launch from the renderer and record the agent's status as it changes.
      const statuses: string[] = await win.webContents.executeJavaScript(`
        (async () => {
          const s = window.__mcSmoke
          const before = s.agents().length
          await s.launch({ cwd: ${JSON.stringify(hookDir)}, projectName: 'smoke', title: 'smoke agent',
                           args: ${JSON.stringify(promptArgs)} })
          const seen = []
          const started = Date.now()
          while (Date.now() - started < 90000) {
            const a = s.agents()[before]
            const st = a ? (a.hookStatus || 'none') + (a.exited ? '+exited' : '') : 'missing'
            if (seen[seen.length - 1] !== st) seen.push(st)
            if (a && a.exited) break
            await new Promise(r => setTimeout(r, 50))
          }
          return seen
        })()
      `)
      log('UI status sequence:', statuses.join(' -> '))
    }

    // Replay a full turn's hook events (same shape curl delivers) into a live UI agent and record its status.
    await win.webContents.executeJavaScript(`
      window.__mcSmoke.launch({ cwd: ${JSON.stringify(process.cwd())}, projectName: 'smoke', title: 'replay agent', kind: 'shell' })
    `)
    const agentId: string = await win.webContents.executeJavaScript(
      `window.__mcSmoke.agents()[window.__mcSmoke.agents().length - 1].id`
    )
    const turn = [
      { event: 'SessionStart', source: 'startup' },
      { event: 'UserPromptSubmit' },
      { event: 'PostToolUse' },
      { event: 'Notification', notificationType: 'permission_prompt', message: 'Claude needs your permission to use Bash' },
      { event: 'PostToolUse' },
      { event: 'Stop' },
      { event: 'Notification', notificationType: 'idle_prompt', message: 'Claude is waiting for your input' }
    ]
    const seen: string[] = []
    for (const e of turn) {
      win.webContents.send('hook:event', { agentId, sessionId: 'replay', at: Date.now(), ...e })
      await new Promise((r) => setTimeout(r, 150))
      const st: string = await win.webContents.executeJavaScript(
        `(() => { const a = window.__mcSmoke.agents().find(x => x.id === ${JSON.stringify(agentId)}); return a.hookStatus + (a.statusMessage ? ' (' + a.statusMessage + ')' : '') })()`
      )
      seen.push(`${e.event}${e.notificationType ? ':' + e.notificationType : ''} => ${st}`)
    }
    log('replayed turn:\n  ' + seen.join('\n  '))

    await new Promise((r) => setTimeout(r, 2000))
    const image = await win.webContents.capturePage()
    writeFileSync(outFile, image.toPNG())
    log('screenshot:', outFile)

    // The chat index runs in a worker; make sure it starts and answers (also inside a packaged build).
    for (let i = 0; i < 120 && (await win.webContents.executeJavaScript('window.mc.indexStatus()')).lastRun === 0; i++) await sleep(500)
    const idx = await win.webContents.executeJavaScript('window.mc.indexStatus()')
    log('index status:', `${idx.sessions} chats, ${idx.messages} messages${idx.error ? `, error: ${idx.error}` : ''}`)
    const hits = await win.webContents.executeJavaScript(`window.mc.search('claude', { limit: 5 }).then(h => h.length)`)
    log('index search hits:', hits)

    if (process.env.MC_SMOKE_UI) await uiTour(win, outFile, process.env.MC_SMOKE_UI)
    if (process.env.MC_SMOKE_TASKS) await taskTour(win, outFile, process.env.MC_SMOKE_TASKS)

    // Close the window while an agent is still printing, like a user clicking X with agents running.
    // Any main-process exception is logged instead of shown as a dialog, so the test can report it.
    process.on('uncaughtException', (e) => log('UNCAUGHT', e.message))
    const flood = deps.launchTerminal({
      cwd: process.cwd(),
      args: [],
      kind: 'shell',
      cols: 100,
      rows: 20
    })
    // Open a second agent in the UI too, so its output is mid-flight in the renderer path.
    await win.webContents.executeJavaScript(
      `window.__mcSmoke.launch({ cwd: ${JSON.stringify(process.cwd())}, projectName: 'smoke', title: 'flood', kind: 'shell' })`
    )
    const { writeTerminal } = await import('./pty')
    writeTerminal(flood.id, 'while ($true) { "flood $(Get-Date -Format o)" }\r')
    const uiId: string = await win.webContents.executeJavaScript(
      `window.__mcSmoke.agents()[window.__mcSmoke.agents().length - 1].id`
    )
    writeTerminal(uiId, 'while ($true) { "flood $(Get-Date -Format o)" }\r')
    await new Promise((r) => setTimeout(r, 1500))
    log('closing window with 2 agents printing')
    win.close()
    await new Promise((r) => setTimeout(r, 3000))
    log('close test finished')
  } catch (e) {
    log('FAILED', e)
  } finally {
    app.quit()
  }
}
