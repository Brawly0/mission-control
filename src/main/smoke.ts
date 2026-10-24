import { app, type BrowserWindow } from 'electron'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync, spawn } from 'node:child_process'
import { basename, join } from 'node:path'
import { automationHold, claudeCommand, takeDueReminders, createTask, deleteTask, flushTasks, followUpTask, listTasks, pumpQueue, rerunChecks, startTask } from './tasks'
import { invalidateBudgets, projectBudget } from './budget'
import { reindex } from './indexer'
import { deleteTemplate, fillVariables, listTemplates, nextRunAfter, runDueTemplates, saveTemplate } from './templates'
import { checkForUpdates, initUpdater, updateStatus } from './updater'
import type { DocFile, HookEvent, TerminalInfo, TerminalSpec } from '../shared/types'
import { listProjects, listSessions, movedChatList, normalizePath, renameSession, setProjectMeta } from './claudeData'
import { commitAll, createWorktree, getChanges, initGit, mergeWorktree, previewGitInit, removeWorktree } from './git'
import { agentEnv, killTerminal, killTerminalsIn } from './pty'
import { contextUsage, launchArgs, startupReport } from './spend'
import { latestBriefing, listBriefings } from './briefings'
import { briefingFileName, briefingMarkdown } from '../shared/projectLook'
import { claudeStatus, createProject, deleteNote, knowledgeDocs, listNotes, quickChatFolder, saveNote, searchKnowledge, userName } from './hub'
import { queryIndex } from './indexer'
import { loadStore, updateStore } from './store'

interface SmokeDeps {
  launchTerminal: (spec: TerminalSpec) => TerminalInfo
  ptyTaps: Set<{ data?: (id: string, d: string) => void; exit?: (id: string, code: number) => void }>
  hookTaps: Set<(e: HookEvent) => void>
  listDocs: (projectPath: string) => Promise<DocFile[]>
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
 * MC_SMOKE_AUTOMATION=<git repo with a commit>: checks schedule math and template variables, fires a
 * due recurring template, and runs two real queued headless tasks (Haiku) with one slot, which must
 * run one after the other. Restores the queue settings and removes everything it made.
 */
async function automationTour(win: BrowserWindow, outFile: string, repo: string): Promise<void> {
  const shot = async (name: string) => {
    await sleep(600)
    const file = outFile.replace(/\.png$/, `-${name}.png`)
    writeFileSync(file, (await win.webContents.capturePage()).toPNG())
    log('screenshot:', file)
  }
  const js = (code: string) => win.webContents.executeJavaScript(code)
  const at = (iso: string) => new Date(iso).getTime()
  const fmt = (ms: number) => new Date(ms).toLocaleString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

  // Schedule math: Friday 2026-10-23 10:00 local.
  const fri = at('2026-10-23T10:00:00')
  const checks: [string, number, string][] = [
    ['daily 09:00 after Fri 10:00', nextRunAfter({ enabled: true, kind: 'daily', time: '09:00', then: 'todo' }, fri), 'Sat 24 Oct, 09:00'],
    ['daily 18:30 after Fri 10:00', nextRunAfter({ enabled: true, kind: 'daily', time: '18:30', then: 'todo' }, fri), 'Fri 23 Oct, 18:30'],
    ['weekdays 09:00 after Fri 10:00', nextRunAfter({ enabled: true, kind: 'weekdays', time: '09:00', then: 'todo' }, fri), 'Mon 26 Oct, 09:00'],
    ['weekly Wed 08:15 after Fri 10:00', nextRunAfter({ enabled: true, kind: 'weekly', weekday: 3, time: '08:15', then: 'todo' }, fri), 'Wed 28 Oct, 08:15'],
    ['every 6 hours after Fri 10:00', nextRunAfter({ enabled: true, kind: 'hourly', everyHours: 6, time: '00:00', then: 'todo' }, fri), 'Fri 23 Oct, 16:00']
  ]
  for (const [label, got, want] of checks) log(`schedule ${label}: ${fmt(got)} ${fmt(got) === want ? 'OK' : `EXPECTED ${want}`}`)
  log('variables:', fillVariables('Check {{project}} on {{weekday}} {{date}} ({{unknown}})', 'demo-repo', new Date(fri)))

  const settingsBefore = loadStore().settings
  const made: string[] = []
  let templateId = ''
  try {
    // A recurring template that is overdue fires once and plans its next run.
    const tpl = saveTemplate({
      name: 'Nightly check',
      title: 'Nightly check of {{project}} ({{date}})',
      prompt: 'Look for TODO comments.',
      projectPath: repo,
      projectName: basename(repo),
      mode: 'headless',
      permission: 'plan',
      useWorktree: false,
      schedule: { enabled: true, kind: 'daily', time: '23:00', then: 'todo' }
    })
    templateId = tpl.id
    updateStore((s) => {
      const t = s.templates.find((x) => x.id === tpl.id)!
      t.schedule!.nextRunAt = Date.now() - 60_000
    })
    await runDueTemplates()
    const fired = listTasks().filter((t) => t.templateId === tpl.id)
    const after = listTemplates().find((t) => t.id === tpl.id)!.schedule!
    log('recurring fired:', fired.length, 'task(s):', fired.map((t) => `"${t.title}" in ${t.column}`), '| next run', fmt(after.nextRunAt!))
    made.push(...fired.map((t) => t.id))

    // Two queued tasks, one slot: they must run one after the other.
    const mk = (n: number) =>
      createTask({
        title: `Queue test ${n}`,
        prompt: `Create a file named queue-${n}.txt containing the single word "${n}". Then reply with one short sentence.`,
        projectPath: repo,
        projectName: basename(repo),
        mode: 'headless',
        permission: 'acceptEdits',
        useWorktree: true,
        budgetUsd: 0.2,
        model: 'haiku',
        queued: true
      })
    const a = mk(1)
    const b = mk(2)
    made.push(a.id, b.id)
    await js(`window.__mcSmoke.setView('tasks')`)
    await shot('queue-waiting')
    updateStore((s) => {
      s.settings = { ...s.settings, queueEnabled: true, queueParallel: 1, queuePauseAtPercent: 0 }
    })
    await pumpQueue()
    let maxParallel = 0
    let shotRunning = false
    const started = Date.now()
    for (;;) {
      const ts = listTasks().filter((t) => t.id === a.id || t.id === b.id)
      const running = ts.filter((t) => t.column === 'running').length
      maxParallel = Math.max(maxParallel, running)
      if (!shotRunning && running > 0) {
        await shot('queue-running')
        shotRunning = true
      }
      if (ts.every((t) => t.column === 'review') || Date.now() - started > 240_000) break
      await sleep(300)
    }
    for (const id of [a.id, b.id]) {
      const t = listTasks().find((x) => x.id === id)!
      const file = t.worktree ? join(t.worktree.path, `${t.title.endsWith('1') ? 'queue-1' : 'queue-2'}.txt`) : ''
      log(`queued "${t.title}": ${t.column}, started ${t.run ? new Date(t.run.startedAt).toLocaleTimeString() : '-'}, finished ${t.run?.finishedAt ? new Date(t.run.finishedAt).toLocaleTimeString() : '-'}, cost $${t.run?.costUsd?.toFixed(3)}, error ${t.run?.error ?? 'none'}, file ${file && existsSync(file) ? 'written' : 'missing'}`)
    }
    const ta = listTasks().find((x) => x.id === a.id)!
    const tb = listTasks().find((x) => x.id === b.id)!
    log('queue ran one at a time:', maxParallel <= 1 && !!ta.run?.finishedAt && !!tb.run && tb.run.startedAt >= ta.run!.finishedAt! - 1000 ? 'yes' : `NO (max parallel ${maxParallel})`)
    await shot('queue-done')

    await js(`window.__mcSmoke.openTemplates()`)
    await shot('templates')
  } finally {
    updateStore((s) => {
      s.settings = settingsBefore
    })
    for (const id of made) {
      const wt = listTasks().find((t) => t.id === id)?.worktree
      deleteTask(id)
      if (wt) {
        await killTerminalsIn(wt.path)
        await removeWorktree(wt).catch(() => undefined)
      }
    }
    if (templateId) deleteTemplate(templateId)
    flushTasks()
    log('automation cleanup: tasks left', listTasks().length, '| templates left', listTemplates().length, '| queue setting restored', loadStore().settings.queueEnabled === settingsBefore.queueEnabled)
  }
}

/**
 * MC_SMOKE_HUB=<empty scratch folder>: v0.11. Notes round trip, Knowledge list and search, a new project
 * with CLAUDE.md and git, a quick-chat folder (must be hidden as scratch), a due-date reminder that
 * fires once, Claude Code status and the greeting name. Cleans up after itself. Free.
 */
let listDocsForSmoke: (p: string) => Promise<DocFile[]> = async () => []
async function hubTour(folder: string): Promise<void> {
  const note = saveNote({ title: 'Smoke note', body: '# hello\nfrom the smoke test' })
  log('hub: note saved', listNotes().some((n) => n.id === note.id) ? 'ok' : 'FAILED')
  saveNote({ id: note.id, pinned: true })
  log('hub: note pinned first', listNotes()[0]?.id === note.id ? 'ok' : 'FAILED')
  deleteNote(note.id)
  log('hub: note deleted', listNotes().some((n) => n.id === note.id) ? 'FAILED' : 'ok')

  const docs = await knowledgeDocs(listDocsForSmoke)
  log(`hub: knowledge has ${docs.length} docs in ${new Set(docs.map((d) => d.projectPath)).size} projects`)
  const hits = await searchKnowledge('roadmap', listDocsForSmoke)
  log('hub: search "roadmap":', hits.slice(0, 3).map((h) => `${h.doc.projectName}/${h.doc.name} (${h.snippets.length} lines)`).join(', ') || 'none')

  mkdirSync(folder, { recursive: true })
  const dir = await createProject({ parent: folder, name: 'smoke-project', claudeMd: true, git: true })
  log('hub: project created', existsSync(join(dir, 'CLAUDE.md')) && existsSync(join(dir, '.git')) ? 'ok (CLAUDE.md + git)' : 'FAILED')
  const listed = (await listProjects()).find((p) => normalizePath(p.path) === normalizePath(dir))
  log('hub: new project listed as', listed ? `"${listed.name}" [${listed.icon}]` : 'MISSING')
  updateStore((s) => {
    s.manualProjects = s.manualProjects.filter((p) => normalizePath(p) !== normalizePath(dir))
  })

  const quick = quickChatFolder()
  log('hub: quick chat folder', existsSync(quick) && /[\\/]AppData[\\/]Local[\\/]Temp[\\/]/i.test(quick) ? 'ok (hidden as scratch)' : `FAILED ${quick}`)

  const t = createTask({ title: 'Smoke due task', prompt: 'x', projectPath: folder, projectName: 'smoke', mode: 'headless', permission: 'plan', useWorktree: false, dueAt: Date.now() - 1000 })
  const first = takeDueReminders().filter((x) => x.id === t.id).length
  const second = takeDueReminders().filter((x) => x.id === t.id).length
  log('hub: due reminder fires once', first === 1 && second === 0 ? 'ok' : `FAILED (${first}, ${second})`)
  deleteTask(t.id)
  flushTasks()

  const status = await claudeStatus(true)
  log('hub: claude status', JSON.stringify({ installed: status.installed, version: status.version, loggedIn: status.loggedIn, plan: status.plan }))
  log('hub: greeting name', JSON.stringify(await userName()))
}

/**
 * MC_SMOKE_BRIEF=<empty scratch folder>: session briefings. Lists the compaction summaries in your chats,
 * writes the newest one as a briefing file into the scratch folder (never into your projects), checks
 * "latest briefing" finds it, and screenshots Knowledge → Session briefings. Free.
 */
async function briefTour(win: BrowserWindow, outFile: string, folder: string): Promise<void> {
  const js = (code: string) => win.webContents.executeJavaScript(code)
  for (let i = 0; i < 240 && (await js('window.mc.indexStatus()')).lastRun === 0; i++) await sleep(500)
  const list = await listBriefings()
  log(`brief: ${list.length} briefings found:`, list.slice(0, 8).map((b) => `"${b.title}" (${b.projectName}, ${b.trigger}, ${Math.round(b.preTokens / 1000)}K)`).join(', '))
  const b = list[0]
  if (!b) return
  const dir = join(folder, 'docs', 'briefings')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, briefingFileName(b.at, b.title))
  writeFileSync(file, briefingMarkdown(b), 'utf8')
  const md = readFileSync(file, 'utf8')
  log('brief: file starts with', JSON.stringify(md.split('\n').slice(0, 3).join(' | ').slice(0, 220)))
  log('brief: wrapper lines removed', !md.includes('tools-used-before-summary') && !md.includes('Continue the conversation from where') ? 'ok' : 'FAILED')
  log('brief: latest briefing found', (await latestBriefing(folder)) === file ? 'ok' : 'FAILED')
  log('brief: auto-save starts from', new Date(loadStore().briefingsFrom).toLocaleString(), '| saved so far', Object.keys(loadStore().briefingsSaved).length)

  win.show()
  win.focus()
  win.webContents.setBackgroundThrottling(false)
  await js(`window.__mcSmoke.setView('knowledge')`)
  await sleep(800)
  await js(`[...document.querySelectorAll('.kn-list .segmented button')].find(b => b.textContent.includes('Session briefings'))?.click()`)
  await sleep(1500)
  const shotFile = outFile.replace(/\.png$/, '-briefings.png')
  writeFileSync(shotFile, (await win.webContents.capturePage()).toPNG())
  log('screenshot:', shotFile)
}

/**
 * MC_SMOKE_SHOTS=<project folder name, e.g. bot>: screenshots every screen (Home, that project's tabs,
 * Tasks, Agents, Search, Usage, Settings, palette, shortcuts) as <MC_SMOKE>-shot-<name>.png. Free.
 */
async function shotsTour(win: BrowserWindow, outFile: string, folder: string): Promise<void> {
  const js = (code: string) => win.webContents.executeJavaScript(code)
  const shot = async (name: string, wait = 900) => {
    await sleep(wait)
    const file = outFile.replace(/\.png$/, `-shot-${name}.png`)
    writeFileSync(file, (await win.webContents.capturePage()).toPNG())
    log('screenshot:', file)
  }
  const key = (keyCode: string, modifiers: ('control' | 'shift' | 'alt')[] = []) => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
  }
  // Key presses and fresh frames need a focused, unthrottled window.
  win.show()
  win.focus()
  win.webContents.focus()
  win.webContents.setBackgroundThrottling(false)
  const closeDialogs = () => js(`document.querySelectorAll('.overlay').forEach((o) => o.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))`)
  for (let i = 0; i < 240 && (await js('window.mc.indexStatus()')).lastRun === 0; i++) await sleep(500)
  const project = (await listProjects()).find((p) => p.folderName.toLowerCase() === folder.toLowerCase())
  await js(`window.__mcSmoke.setView('home')`)
  await shot('home')
  await js(`document.querySelector('.home')?.scrollTo(0, 99999)`)
  await shot('home-bottom')
  await js(`document.querySelector('.home')?.scrollTo(0, 0)`)
  if (project) {
    await js(`window.__mcSmoke.selectProject(${JSON.stringify(project.path)}); window.__mcSmoke.setView('project')`)
    for (const tab of ['Chats', 'Overview', 'Docs']) {
      await js(`[...document.querySelectorAll('.page-tabs button')].find(b => b.textContent.includes(${JSON.stringify(tab)}))?.click()`)
      await shot(`project-${tab.toLowerCase()}`, 1200)
    }
  }
  for (const view of ['projects', 'notebook', 'knowledge', 'tasks', 'agents', 'usage']) {
    await js(`window.__mcSmoke.setView('${view}')`)
    await shot(view, 1200)
  }
  await js(`window.__mcSmoke.setView('search')`)
  await js(`(() => {
    const input = document.querySelector('.search-box input')
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    set.call(input, 'briefing')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await shot('search', 1200)
  await js(`window.__mcSmoke.setView('home')`)
  await js(`window.__mcSmoke.openPalette()`)
  await shot('palette')
  await closeDialogs()
  await js(`window.__mcSmoke.runShortcut?.('newProject')`)
  await shot('new-project')
  await closeDialogs()
  await js(`window.__mcSmoke.openSettings?.()`)
  await shot('settings')
  await closeDialogs()
  await js(`window.__mcSmoke.openShortcuts?.()`)
  await shot('shortcuts')
  await closeDialogs()
  await js(`window.__mcSmoke.setView('home')`)

  // Real key presses must reach the shortcut handler.
  const activeNav = () => js(`document.querySelector('.nav-item.active span')?.textContent ?? document.querySelector('.page-title h1')?.textContent ?? '?'`)
  await sleep(300)
  for (const [k, mods, expect] of [
    ['2', ['control'], 'Agents'],
    ['3', ['control'], 'Tasks'],
    ['5', ['control'], 'Usage & Insights'],
    ['F', ['control', 'shift'], 'Chats'],
    ['1', ['control'], 'Home']
  ] as const) {
    key(k, [...mods])
    await sleep(400)
    const got = await activeNav()
    log(`shortcut ${[...mods, k].join('+')}: ${got === expect ? 'ok' : `FAILED (got ${got})`}`)
  }
  key('/', ['control'])
  await sleep(400)
  log('shortcut Ctrl+/ opens the list:', (await js(`!!document.querySelector('.shortcuts-dialog')`)) ? 'ok' : 'FAILED')
  await closeDialogs()
  await sleep(300)
  key('B', ['control'])
  await shot('rail')
  log('shortcut Ctrl+B collapses the sidebar:', (await js(`!!document.querySelector('.sidebar.rail')`)) ? 'ok' : 'FAILED')
  key('B', ['control'])
  await sleep(300)

  const themeBefore = loadStore().settings.theme
  key('L', ['control', 'shift'])
  await sleep(600)
  log('shortcut Ctrl+Shift+L switches theme:', await js(`document.documentElement.dataset.theme`))
  await js(`window.__mcSmoke.setView('home')`)
  await shot('light-home', 1200)
  await js(`window.__mcSmoke.setView('knowledge')`)
  await shot('light-knowledge', 1200)
  if (project) {
    await js(`window.__mcSmoke.selectProject(${JSON.stringify(project.path)}); window.__mcSmoke.setView('project')`)
    key('C', ['alt'])
    await shot('light-chats', 1200)
    key('O', ['alt'])
    await shot('light-overview', 1200)
  }
  await js(`window.__mcSmoke.setView('usage')`)
  await shot('light-usage', 1200)
  await js(`window.__mcSmoke.openSettings?.()`)
  await shot('light-settings')
  await closeDialogs()
  await js(`window.mc.setSettings({ theme: ${JSON.stringify(themeBefore)} })`)
  await js(`window.__mcSmoke.setView('home')`)
}

/**
 * MC_SMOKE_SPEND=<empty scratch folder>: v0.9. Reads the size of an existing chat, builds the startup
 * report for the busiest project, limits the scratch folder to one MCP server with Haiku as its default
 * model, and checks that Claude really starts with only that server (read from its init event; the
 * process is stopped before any request is sent, so it costs nothing). Screenshots the Spending card
 * and an agent's size meter. Restores everything.
 */
async function spendTour(win: BrowserWindow, outFile: string, folder: string): Promise<void> {
  const shot = async (name: string) => {
    await sleep(900)
    const file = outFile.replace(/\.png$/, `-${name}.png`)
    writeFileSync(file, (await win.webContents.capturePage()).toPNG())
    log('screenshot:', file)
  }
  const js = (code: string) => win.webContents.executeJavaScript(code)
  for (let i = 0; i < 240 && (await js('window.mc.indexStatus()')).lastRun === 0; i++) await sleep(500)

  const projects = (await listProjects()).filter((p) => !p.worktree && p.sessionCount > 0).sort((a, b) => b.sessionCount - a.sessionCount)
  const busiest = projects[0]
  const chats = await listSessions(busiest.keys, busiest.path)
  const usage = await contextUsage(chats.slice(0, 3).map((c) => c.id))
  for (const c of chats.slice(0, 3)) {
    const u = usage[c.id]
    log(`spend: "${c.title}" is ${u ? `${u.tokens} tokens (${u.model}, window ${u.window}), $${u.perTurnUsd.toFixed(3)} per reply` : 'no reply yet'}`)
  }
  const first = await queryIndex<{ tokens: number; model: string }[]>('firstReplies', busiest.keys)
  const report = await startupReport(busiest.path, first)
  log(`spend: ${busiest.name} new chats start at ${report.measured?.medianTokens} tokens (${report.measured?.samples} chats, $${report.measured?.firstTurnUsd.toFixed(2)} to start)`)
  log('spend: files', report.files.map((f) => `${f.label}=${f.tokens}`).join(', '))
  log('spend: servers', report.servers.map((s) => `${s.name}(${s.scope})`).join(', '))
  const midnight = new Date()
  midnight.setHours(0, 0, 0, 0)
  const pricey = await queryIndex<{ title: string; cost: number }[]>('chatsOverCost', midnight.getTime(), 1)
  log('spend: chats over $1 today:', pricey.map((c) => `"${c.title}" $${c.cost.toFixed(2)}`).join(', ') || 'none')

  // Limit the scratch folder to one server and Haiku, then see what Claude actually loads.
  mkdirSync(folder, { recursive: true })
  const keep = report.servers.find((s) => s.name === 'fetch')?.name ?? report.servers[0]?.name
  const before = loadStore().projectMeta[normalizePath(folder)]
  setProjectMeta(folder, { mcpAllow: keep ? [keep] : [], defaultModel: 'haiku' })
  const args = launchArgs(folder, { newChat: true, hasModel: false })
  log('spend: launch args', JSON.stringify(args.map((a) => (a.endsWith('.json') ? basename(a) : a))))
  const configFile = args.find((a) => a.startsWith('--mcp-config='))!.slice('--mcp-config='.length)
  log('spend: config holds', Object.keys(JSON.parse(readFileSync(configFile, 'utf8')).mcpServers).join(', '))
  const { file, prefix } = claudeCommand()
  const init = await new Promise<string>((resolve) => {
    const child = spawn(file, [...prefix, '-p', '--output-format', 'stream-json', '--verbose', ...args, 'Reply with the word ok'], {
      cwd: folder,
      env: agentEnv(),
      windowsHide: true
    })
    let buf = ''
    let settled = false
    const done = (v: string) => {
      if (settled) return
      settled = true
      try {
        execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
      } catch {
        /* already exited */
      }
      resolve(v)
    }
    child.on('exit', (code) => setTimeout(() => done(`exited with code ${code} before its init event`), 500))
    child.stdout.on('data', (d) => {
      buf += String(d)
      const line = buf.split('\n').find((l) => l.includes('"subtype":"init"'))
      if (line) {
        const e = JSON.parse(line)
        done(`model=${e.model} mcp=${(e.mcp_servers ?? []).map((s: { name: string; status: string }) => `${s.name}:${s.status}`).join(',')}`)
      }
    })
    setTimeout(() => done('no init event within 60 s'), 60_000)
  })
  log('spend: claude started with', init)
  updateStore((s) => {
    if (before) s.projectMeta[normalizePath(folder)] = before
    else delete s.projectMeta[normalizePath(folder)]
  })

  // The Spending card on the busiest project, and a size meter on a resumed chat.
  await js(`window.__mcSmoke.selectProject(${JSON.stringify(busiest.path)}); window.__mcSmoke.setView('project')`)
  await sleep(600)
  await js(`[...document.querySelectorAll('.page-tabs button')].find(b => b.textContent.includes('Overview'))?.click()`)
  await sleep(1200)
  await js(`document.querySelector('.spending-card')?.scrollIntoView()`)
  await shot('spend-card')
  // Resume one of the smoke tests' own old chats (never one of yours) to see the meter.
  const testProject = (await listProjects()).find((p) => /scratchpad[\\/]hooktest/i.test(p.path))
  const big = testProject ? (await listSessions(testProject.keys))[0] : undefined
  if (!big) return log('spend: no test chat to resume for the meter')
  await js(`window.__mcSmoke.launch({ cwd: ${JSON.stringify(big.cwd)}, projectName: 'size check', projectPath: ${JSON.stringify(big.cwd)}, title: 'size check', args: ['--resume', ${JSON.stringify(big.id)}] })`)
  await js(`window.__mcSmoke.setView('agents')`)
  await sleep(12_000)
  await shot('spend-agent')
  log('spend: meter shows', await js(`document.querySelector('.ctx-meter')?.textContent ?? 'no meter'`))
  const agentId: string = await js(`window.__mcSmoke.agents().find(a => a.title === 'size check')?.id`)
  if (agentId) killTerminal(agentId)
}

/**
 * MC_SMOKE_NAMES=<project folder name, e.g. WBP>: logs every project's name, icon and chat count, then
 * screenshots that project's chats and its Name and icon dialog. Renames one chat and puts it back. Free.
 */
async function namesTour(win: BrowserWindow, outFile: string, folder: string): Promise<void> {
  const shot = async (name: string) => {
    await sleep(800)
    const file = outFile.replace(/\.png$/, `-${name}.png`)
    writeFileSync(file, (await win.webContents.capturePage()).toPNG())
    log('screenshot:', file)
  }
  const js = (code: string) => win.webContents.executeJavaScript(code)
  // Chats started from C:\ are matched to projects from the index, so wait for it.
  for (let i = 0; i < 240 && (await js('window.mc.indexStatus()')).lastRun === 0; i++) await sleep(500)
  const projects = await listProjects()
  for (const p of projects.filter((x) => !x.worktree)) {
    log(`project: ${p.folderName} -> "${p.name}" [${p.icon}] ${p.sessionCount} chats from ${p.keys.length} folders`)
  }
  log('hidden (temp/scratch):', projects.filter((x) => x.worktree).length)
  for (const m of movedChatList()) log('matched chat:', m.id, '->', m.path)
  const target = projects.find((p) => p.folderName.toLowerCase() === folder.toLowerCase())
  if (!target) return log('names: no project named', folder)
  const sessions = await listSessions(target.keys, target.path)
  log(`names: ${target.name} has ${sessions.length} chats:`, sessions.map((s) => `"${s.title}"${s.worktree ? ` (worktree: ${s.worktree})` : ''}`).join(', '))

  if (sessions[0]) {
    const before = loadStore().chatTitles[sessions[0].id]
    renameSession(sessions[0].id, 'Smoke renamed chat')
    const renamed = (await listSessions(target.keys, target.path)).find((s) => s.id === sessions[0].id)
    log('names: rename shows', JSON.stringify(renamed?.title), 'renamed flag', renamed?.renamed)
    renameSession(sessions[0].id, before ?? '')
    log('names: rename undone', (await listSessions(target.keys, target.path)).find((s) => s.id === sessions[0].id)?.title === sessions[0].title)
  }

  await js(`window.__mcSmoke.setView('home')`)
  await shot('names-home')
  await js(`window.__mcSmoke.selectProject(${JSON.stringify(target.path)}); window.__mcSmoke.setView('project')`)
  await sleep(600)
  await js(`[...document.querySelectorAll('.page-tabs button')].find(b => b.textContent.includes('Chats'))?.click()`)
  await shot('names-chats')
  await js(`document.querySelector('.avatar-button')?.click()`)
  await shot('names-icon-dialog')
  await js(`document.querySelector('.dialog.identity .icon-btn')?.click()`)
}

/**
 * MC_SMOKE_CHAIN=<empty scratch folder>: v0.7 end to end. Turns on git for a folder with a secret and
 * node_modules; runs a 3-step chain whose first step fails its checks (the next step must stay blocked),
 * fixes the check and re-runs it (the chain must continue by itself, each step on the previous branch);
 * merges the last branch; sends a follow-up; and checks the monthly budget guard. Uses Haiku (about $0.10).
 */
async function chainTour(win: BrowserWindow, outFile: string, root: string): Promise<void> {
  const shot = async (name: string) => {
    await sleep(600)
    const file = outFile.replace(/\.png$/, `-${name}.png`)
    writeFileSync(file, (await win.webContents.capturePage()).toPNG())
    log('screenshot:', file)
  }
  const js = (code: string) => win.webContents.executeJavaScript(code)
  const repo = join(root, 'chain-demo')
  const sh = (args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
  const waitFor = async (label: string, test: () => boolean, ms = 180_000) => {
    const start = Date.now()
    while (!test()) {
      if (Date.now() - start > ms) throw new Error(`Timed out waiting for: ${label}`)
      await sleep(300)
    }
  }
  const get = (id: string) => listTasks().find((t) => t.id === id)!
  const settingsBefore = loadStore().settings
  const made: string[] = []

  // 1. Turn on git.
  mkdirSync(join(repo, 'src'), { recursive: true })
  mkdirSync(join(repo, 'node_modules', 'left-pad'), { recursive: true })
  writeFileSync(join(repo, 'README.md'), '# Chain demo\n')
  writeFileSync(join(repo, 'src', 'app.js'), 'console.log("hi")\n')
  writeFileSync(join(repo, '.env'), 'API_KEY=not-a-real-secret\n')
  writeFileSync(join(repo, 'node_modules', 'left-pad', 'index.js'), 'module.exports = 1\n')
  const preview = await previewGitInit(repo)
  log('git preview:', `${preview.fileCount} files`, JSON.stringify(preview.files), '| secrets kept out:', JSON.stringify(preview.secretsExcluded), '| new ignore rules:', preview.gitignoreAdditions.length)
  const init = await initGit(repo)
  log('git init:', `commit ${init.commit}, ${init.files} files; tracked: ${sh(['ls-files']).split('\n').join(', ')}`)
  log('git identity (this repo only):', sh(['config', '--local', 'user.name']) || '(global)')

  const checkFile = (name: string) => `if (Test-Path ${name}) { Write-Output 'found ${name}' } else { Write-Output '${name} is missing'; exit 1 }`
  try {
    // 2. A 3-step chain. Step 1 writes step-one.txt, but the check wrongly looks for step1.txt.
    setProjectMeta(repo, { checkCommand: checkFile('step1.txt') })
    const common = { projectPath: repo, projectName: 'chain-demo', mode: 'headless' as const, permission: 'acceptEdits' as const, useWorktree: true, budgetUsd: 0.3, model: 'haiku' }
    const a = createTask({ ...common, title: 'Step 1: create step-one.txt', prompt: 'Create a file named step-one.txt containing the word "one". Reply with one short sentence.' })
    const b = createTask({ ...common, title: 'Step 2: create step2.txt', prompt: 'Create a file named step2.txt containing the word "two". Reply with one short sentence.', dependsOn: [a.id] })
    const c = createTask({ ...common, title: 'Step 3: list the files', prompt: 'Create a file named step3.txt that lists the names of all .txt files in this folder, one per line. Reply with one short sentence.', dependsOn: [b.id] })
    made.push(a.id, b.id, c.id)
    await js(`window.__mcSmoke.setView('tasks')`)
    await startTask(a.id)
    await waitFor('step 1 to finish', () => get(a.id).column === 'review' && get(a.id).run?.checks?.status !== 'running')
    log('step 1:', `checks ${get(a.id).run?.checks?.status} | commit ${get(a.id).run?.commit} | step 2 is ${get(b.id).column}`)
    await sleep(1500)
    log('after failed checks, step 2 still waits:', get(b.id).column === 'todo' && !get(b.id).run ? 'yes' : `NO (${get(b.id).column})`)
    await shot('chain-blocked')
    await js(`window.__mcSmoke.openTask(${JSON.stringify(b.id)})`)
    await shot('chain-drawer-blocked')
    await js(`window.__mcSmoke.openTask(null)`)

    // Fix the check and re-run it: the chain must continue by itself.
    setProjectMeta(repo, { checkCommand: checkFile('step-one.txt') })
    await rerunChecks(a.id)
    log('step 1 after fixing the check:', get(a.id).run?.checks?.status)
    await waitFor('step 3 to finish', () => get(c.id).column === 'review' && get(c.id).run?.checks?.status !== 'running', 300_000)
    for (const t of [a, b, c].map((x) => get(x.id))) {
      log(`  ${t.title}: ${t.column}, branch ${t.worktree?.branch}, commit ${t.run?.commit ?? '-'}, checks ${t.run?.checks?.status ?? '-'}, cost $${t.run?.costUsd?.toFixed(3)}, error ${t.run?.error ?? 'none'}`)
    }
    const order = [a, b, c].map((x) => get(x.id).run!)
    log('ran in order:', order[0].finishedAt! <= order[1].startedAt && order[1].finishedAt! <= order[2].startedAt ? 'yes' : 'NO')
    const cwt = get(c.id).worktree!
    const files = ['step-one.txt', 'step2.txt', 'step3.txt'].map((f) => `${f}:${existsSync(join(cwt.path, f)) ? 'yes' : 'no'}`)
    log('step 3 worktree has the earlier steps’ work:', files.join(' '))
    log('step 3 branch history:', execFileSync('git', ['log', '--oneline', `${cwt.base}..${cwt.branch}`], { cwd: repo, encoding: 'utf8' }).trim().split('\n').join(' | '))
    await js(`window.__mcSmoke.openTask(${JSON.stringify(c.id)})`)
    await shot('chain-drawer-done')
    await js(`window.__mcSmoke.openTask(null)`)
    await shot('chain-done')

    // 4. Follow-up on step 3, then merge its branch (which carries all three steps).
    followUpTask(c.id, 'Also create a file named followup.txt containing the word "more". Reply with one short sentence.')
    await sleep(500)
    await waitFor('the follow-up to finish', () => get(c.id).column === 'review' && get(c.id).run?.checks?.status !== 'running')
    const fc = get(c.id)
    log('follow-up:', `${fc.run?.followUps} follow-up, followup.txt ${existsSync(join(cwt.path, 'followup.txt')) ? 'written' : 'missing'}, commit ${fc.run?.commit}, total cost $${fc.run?.costUsd?.toFixed(3)}, checks ${fc.run?.checks?.status}`)
    const merged = await mergeWorktree(cwt)
    log('merge into main:', merged.split('\n')[0], '| main now has:', ['step-one.txt', 'step2.txt', 'step3.txt', 'followup.txt'].filter((f) => existsSync(join(repo, f))).join(', '))

    // 5. Budget guard: a tiny budget for this project must hold its queued tasks.
    reindex()
    await sleep(6000)
    invalidateBudgets()
    setProjectMeta(repo, { monthlyBudgetUsd: 0.01 })
    const state = await projectBudget(repo)
    log('budget state:', state ? `spent $${state.spent.toFixed(3)} of $${state.budget}, over: ${state.over}` : 'none')
    updateStore((s) => {
      s.settings = { ...s.settings, queueEnabled: true, queueParallel: 1, queuePauseAtPercent: 0 }
    })
    const q = createTask({ ...common, title: 'Queued while over budget', prompt: 'Say hi.', queued: true })
    made.push(q.id)
    await pumpQueue()
    await sleep(800)
    log('queued task held by the budget:', get(q.id).column === 'todo' && !get(q.id).run ? 'yes' : `NO (${get(q.id).column})`, '| hold reason:', await automationHold(repo))
  } finally {
    updateStore((s) => {
      s.settings = settingsBefore
      delete s.projectMeta[normalizePath(repo)]
    })
    for (const id of made) {
      const wt = listTasks().find((t) => t.id === id)?.worktree
      deleteTask(id)
      if (wt && existsSync(wt.path)) {
        await killTerminalsIn(wt.path)
        await removeWorktree(wt).catch((e) => log('cleanup:', (e as Error).message))
      }
    }
    flushTasks()
    log('chain cleanup: tasks left', listTasks().length, '| settings restored', JSON.stringify(loadStore().settings) === JSON.stringify(settingsBefore))
  }
}

/** MC_SMOKE_UPDATE=1 in a packaged build: checks the releases repo and downloads (not installs) any update. */
async function updateCheck(): Promise<void> {
  const states: string[] = []
  initUpdater((s) => {
    const label = `${s.state}${'version' in s && s.version ? ` ${s.version}` : ''}${'percent' in s && s.percent !== undefined ? ` ${s.percent}%` : ''}${'message' in s && s.message ? `: ${s.message}` : ''}`
    if (states[states.length - 1] !== label && !(s.state === 'downloading' && states[states.length - 1]?.startsWith('downloading'))) states.push(label)
  }, false)
  await checkForUpdates()
  const started = Date.now()
  while (Date.now() - started < 180_000) {
    const s = updateStatus().state
    if (s === 'ready' || s === 'none' || s === 'error' || s === 'disabled') break
    await sleep(500)
  }
  log('update states:', states.join(' -> '), '| final:', JSON.stringify(updateStatus()))
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
    if (process.env.MC_SMOKE_AUTOMATION) await automationTour(win, outFile, process.env.MC_SMOKE_AUTOMATION)
    if (process.env.MC_SMOKE_UPDATE) await updateCheck()
    if (process.env.MC_SMOKE_CHAIN) await chainTour(win, outFile, process.env.MC_SMOKE_CHAIN)
    if (process.env.MC_SMOKE_NAMES) await namesTour(win, outFile, process.env.MC_SMOKE_NAMES)
    if (process.env.MC_SMOKE_SPEND) await spendTour(win, outFile, process.env.MC_SMOKE_SPEND)
    if (process.env.MC_SMOKE_SHOTS) await shotsTour(win, outFile, process.env.MC_SMOKE_SHOTS)
    if (process.env.MC_SMOKE_BRIEF) await briefTour(win, outFile, process.env.MC_SMOKE_BRIEF)
    if (process.env.MC_SMOKE_HUB) {
      listDocsForSmoke = deps.listDocs
      await hubTour(process.env.MC_SMOKE_HUB)
    }

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
