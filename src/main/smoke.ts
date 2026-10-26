import { app, type BrowserWindow } from 'electron'
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync, spawn } from 'node:child_process'
import { basename, join } from 'node:path'
import { refreshPlanUsage } from './planUsage'
import { vaultNotes } from './vault'
import { coachPrompt } from './eco'
import { hookSettingsFor, removeHookSettings } from './hookServer'
import { automationHold, claudeCommand, getRateLimit, takeDueReminders, createTask, deleteTask, flushTasks, followUpTask, listTasks, pumpQueue, rerunChecks, startTask } from './tasks'
import { invalidateBudgets, projectBudget } from './budget'
import { reindex } from './indexer'
import { deleteTemplate, fillVariables, listTemplates, nextRunAfter, runDueTemplates, saveTemplate } from './templates'
import { checkForUpdates, initUpdater, updateStatus } from './updater'
import type { DocFile, HookEvent, TerminalInfo, TerminalSpec } from '../shared/types'
import { listProjects, listSessions, movedChatList, recentSessions, normalizePath, renameSession, setProjectMeta } from './claudeData'
import { commitAll, createWorktree, getChanges, initGit, mergeWorktree, previewGitInit, removeWorktree } from './git'
import { agentEnv, killTerminal, killTerminalsIn } from './pty'
import { contextUsage, defaultModelFor, launchArgs, startupReport } from './spend'
import { latestBriefing, listBriefings } from './briefings'
import { briefingFileName, briefingMarkdown } from '../shared/projectLook'
import { claudeStatus, createProject, deleteNote, knowledgeDocs, listNotes, quickChatFolder, saveNote, searchKnowledge, userName } from './hub'
import { queryIndex } from './indexer'
import { loadStore, updateStore } from './store'
import { planRate } from './planCost'
import { buildDigest } from './digest'
import { digestText } from '../shared/digest'
import { nameChats, sessionRecap, summarizeChat } from './recap'
import { unclearTitle } from '../shared/projectLook'

interface SmokeDeps {
  launchTerminal: (spec: TerminalSpec) => TerminalInfo
  ptyTaps: Set<{ data?: (id: string, d: string) => void; exit?: (id: string, code: number) => void }>
  hookTaps: Set<(e: HookEvent) => void>
  listDocs: (projectPath: string) => Promise<DocFile[]>
}

/** Logs to stdout, and to MC_SMOKE_LOG if set (a packaged Windows app has no console). */
export const log = (...a: unknown[]) => {
  console.log('[smoke]', ...a)
  if (process.env.MC_SMOKE_LOG) {
    const line = a.map((x) => (typeof x === 'string' ? x : x instanceof Error ? (x.stack ?? x.message) : JSON.stringify(x))).join(' ')
    appendFileSync(process.env.MC_SMOKE_LOG, `[smoke] ${line}\n`)
  }
}
/** Startup times for the speed test (MC_SMOKE_PERF), in ms since the process started. */
const processStart = Date.now() - process.uptime() * 1000
export const perfMarks: Record<string, number> = {}
export const perfMark = (name: string) => {
  perfMarks[name] = Math.round(Date.now() - processStart)
}

/** CPU (% of one core, averaged since the last call) and memory (MB) of the app's processes, by type. */
function appUsage(): string {
  const by: Record<string, { cpu: number; mb: number; n: number }> = {}
  for (const m of app.getAppMetrics()) {
    const k = m.type === 'Utility' ? `Utility(${m.serviceName ?? m.name ?? '?'})` : m.type
    const b = (by[k] ??= { cpu: 0, mb: 0, n: 0 })
    b.cpu += m.cpu.percentCPUUsage
    b.mb += m.memory.workingSetSize / 1024
    b.n++
  }
  const total = Object.values(by).reduce((t, b) => ({ cpu: t.cpu + b.cpu, mb: t.mb + b.mb }), { cpu: 0, mb: 0 })
  return `total ${total.cpu.toFixed(1)}% CPU, ${total.mb.toFixed(0)} MB | ` + Object.entries(by).map(([k, b]) => `${k}${b.n > 1 ? `x${b.n}` : ''} ${b.cpu.toFixed(1)}% ${b.mb.toFixed(0)}MB`).join(', ')
}

/** MC_SMOKE_PERF=1: startup times, a full index build into an empty index, and idle CPU and memory with 0 and 4 agents. */
async function perfTour(win: BrowserWindow): Promise<void> {
  const js = (code: string) => win.webContents.executeJavaScript(code)
  perfMark('did-finish-load')
  // The first project in the sidebar: the moment the app is usable.
  const shown: number = await js(`new Promise((resolve) => {
    const check = () => document.querySelector('.project-name') ? resolve(Math.round(performance.timeOrigin + performance.now())) : setTimeout(check, 10)
    check()
  })`)
  perfMarks['first project shown'] = Math.round(shown - processStart)
  const heap = await js('performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1')
  log('startup (ms since process start):', JSON.stringify(perfMarks), `| renderer JS heap ${heap} MB`)
  const t0 = Date.now()
  for (let i = 0; i < 1200 && (await js('window.mc.indexStatus()')).lastRun === 0; i++) await sleep(250)
  const idx = await js('window.mc.indexStatus()')
  log(`index ${process.env.MC_SMOKE_PERF === 'fresh' ? 'build from empty' : 'first run'}: ${Date.now() - t0}ms after load (${idx.sessions} chats, ${idx.messages} messages)`)
  const timed = async (label: string, code: string) => {
    const ms = await js(`(async () => { const t = performance.now(); await ${code}; return Math.round(performance.now() - t) })()`)
    return `${label} ${ms}ms`
  }
  log('calls:', [
    await timed('listProjects', 'window.mc.listProjects()'),
    await timed('listProjects again', 'window.mc.listProjects()'),
    await timed('gitInfoMany', 'window.mc.listProjects().then(l => window.mc.gitInfoMany(l.map(p => p.path)))')
  ].join(', '))
  // MC_SMOKE_PERF=startup stops here (MC_SMOKE_PERF=fresh deletes the speed test's index first, to time a full build).
  if (process.env.MC_SMOKE_PERF !== '1') return
  const idle = async (label: string) => {
    await sleep(10_000)
    appUsage() // starts the CPU averaging window
    await sleep(30_000)
    // Endless animations keep the GPU busy while nothing happens; list what's running.
    const anims = await js(`[...new Set(document.getAnimations().map(a => (a.animationName || 'anim') + ' on ' + (a.effect && a.effect.target ? a.effect.target.className.toString().slice(0, 40) : '?')))].join('; ')`)
    log(`idle, ${label}:`, appUsage(), `| animations: ${anims || 'none'}`)
  }
  await idle('no agents, Home')
  for (let i = 0; i < 4; i++) await js(`window.__mcSmoke.launch({ cwd: ${JSON.stringify(process.cwd())}, projectName: 'perf', title: 'perf ${i + 1}', kind: 'shell' })`)
  await js(`window.__mcSmoke.setView('agents')`)
  await idle('4 shell agents, Agents view')
  await js(`window.__mcSmoke.setView('home')`)
  await idle('4 shell agents, Home')
  for (const a of await js('window.__mcSmoke.agents().map(a => a.id)')) await js(`window.__mcSmoke.closeAgent(${JSON.stringify(a)})`)
}

/** Opens a page and waits until it has rendered: some pages load on first visit. */
async function openView(win: BrowserWindow, view: string): Promise<void> {
  await win.webContents.executeJavaScript(`window.__mcSmoke.setView(${JSON.stringify(view)})`)
  for (let i = 0; i < 50; i++) {
    if (await win.webContents.executeJavaScript(`(document.querySelector('.view-pane:not(.hidden)')?.childElementCount ?? 1) > 0`)) return
    await sleep(100)
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
  await openView(win, 'usage')
  await sleep(800)
  await shot('usage')
  await openView(win, 'search')
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
  await openView(win, 'knowledge')
  await sleep(800)
  await js(`[...document.querySelectorAll('.kn-list .segmented button')].find(b => b.textContent.includes('Session briefings'))?.click()`)
  await sleep(1500)
  const shotFile = outFile.replace(/\.png$/, '-briefings.png')
  writeFileSync(shotFile, (await win.webContents.capturePage()).toPNG())
  log('screenshot:', shotFile)
}

/**
 * MC_SMOKE_VAULT=<empty scratch folder>: writes a small sample vault there (INDEX, notes with
 * [[links]], a decision, frontmatter, a table), shows the folder as a project for the tour,
 * checks links, backlinks and the live watcher, and screenshots the note, a linked note, the
 * graph, the empty "build" screen and its dialog as <MC_SMOKE>-vault-*.png. Free: nothing is sent to Claude.
 */
async function vaultTour(win: BrowserWindow, outFile: string, dir: string): Promise<void> {
  const js = (code: string) => win.webContents.executeJavaScript(code)
  const shot = async (name: string, wait = 900) => {
    await sleep(wait)
    const file = outFile.replace(/\.png$/, `-vault-${name}.png`)
    writeFileSync(file, (await win.webContents.capturePage()).toPNG())
    log('screenshot:', file)
  }
  const click = (selector: string, text: string) =>
    js(`[...document.querySelectorAll(${JSON.stringify(selector)})].find(e => e.textContent.includes(${JSON.stringify(text)}))?.click()`)
  win.show()
  win.focus()
  win.webContents.setBackgroundThrottling(false)
  const fm = (title: string, tags: string) => `---\ntitle: ${title}\ntags: [${tags}]\nupdated: 2026-10-24\ngenerated: claude\n---\n`
  const fence = '```'
  const files: Record<string, string> = {
    'CLAUDE.md': '# Demo app\n\n## Project docs\n\nStart with docs/INDEX.md: it links to the overview, architecture, setup, conventions and current status.\n',
    'README.md': '# Demo app\n\nA tiny app for the vault tour.\n',
    'docs/INDEX.md': `${fm('Demo app: index', 'hub')}# Demo app\n\nA small web app that turns notes into flashcards.\n\n## Map\n\n- [[overview]]: what it is and who it is for\n- [[architecture]]: how the pieces fit\n- [[setup]]: run, build, test\n- [[conventions]]: rules to follow\n- [[status]]: where things stand\n- [[decisions/0001-sqlite|Why SQLite]]\n- [[glossary]] (not written yet)\n`,
    'docs/overview.md': `${fm('Overview', 'product')}# Overview\n\nTurns Markdown notes into spaced-repetition cards. Built with **React** and **SQLite**. See [[architecture]].\n\nBack to [[INDEX]]\n`,
    'docs/architecture.md': `${fm('Architecture', 'code, design')}# Architecture\n\n## Modules\n\n| Module | Does |\n|---|---|\n| src/parser.ts | Markdown to cards |\n| src/store.ts | SQLite storage, see [[decisions/0001-sqlite]] |\n| src/ui/ | React screens |\n\n## Data flow\n\n1. Parse notes\n2. Store cards\n3. Schedule reviews\n\nSet up first: [[setup]]. Rules: [[conventions]].\n\nBack to [[INDEX]]\n`,
    'docs/setup.md': `${fm('Setup', 'dev')}# Setup\n\n${fence}\nnpm install\nnpm run dev\n${fence}\n\n- [x] Node 22\n- [ ] Docker (optional)\n\nBack to [[INDEX]]\n`,
    'docs/conventions.md': `${fm('Conventions', 'code')}# Conventions\n\n- Plain CSS, no framework\n- Never write to the user home folder (see [[architecture]])\n\nBack to [[INDEX]]\n`,
    'docs/status.md': `${fm('Status', 'status')}# Status\n\n## Done\n\n- Parser and store\n\n## Next\n\n- Review screen ([[architecture#data-flow|data flow]])\n\nBack to [[INDEX]]\n`,
    'docs/decisions/0001-sqlite.md': `${fm('0001: SQLite for storage', 'adr')}# 0001: SQLite for storage\n\nOne file, no server. Used by [[architecture]].\n`,
    'docs/briefings/2026-10-24-1200-first-chat.md': '# Session briefing\n\nParser done; next is the review screen. See [[status]].\n'
  }
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true })
    writeFileSync(join(dir, rel), text)
  }
  updateStore((s) => {
    s.manualProjects.push(dir)
  })
  try {
    const info = await vaultNotes(dir)
    const arch = info.notes.find((n) => n.rel === 'docs/architecture.md')
    log('vault notes:', info.notes.length, 'hasIndex:', info.hasIndex, 'claudeMdLinked:', info.claudeMdLinked, 'updatedAt>0:', info.updatedAt > 0)
    log('architecture links:', JSON.stringify(arch?.links), 'index unresolved:', JSON.stringify(info.notes.find((n) => n.name === 'INDEX')?.unresolved))
    log('backlinks to architecture:', info.notes.filter((n) => n.links.includes('docs/architecture.md')).map((n) => n.rel).join(', '))

    await js('window.__mcSmoke.refresh()')
    await sleep(800)
    await js(`window.__mcSmoke.selectProject(${JSON.stringify(dir)}); window.__mcSmoke.setView('project')`)
    await sleep(600)
    await click('.page-tabs button', 'Docs')
    await shot('index', 1500)
    log('open note:', await js(`document.querySelector('.vault .doc-title .strong')?.textContent`))
    log('tree notes:', await js(`document.querySelectorAll('.vault-note').length`), 'missing links shown:', await js(`document.querySelectorAll('a.note-link.missing').length`))
    await click('a.note-link', 'architecture')
    await shot('architecture')
    log('after link click:', await js(`document.querySelector('.vault .doc-title .strong')?.textContent`), '| side:', await js(`[...document.querySelectorAll('.vault-side h4')].map(h => h.textContent).join(' | ')`))

    // Live: a note written on disk shows up without reloading.
    writeFileSync(join(dir, 'docs', 'glossary.md'), `${fm('Glossary', 'terms')}# Glossary\n\n- **Card**: one question and answer\n\nBack to [[INDEX]]\n`)
    await sleep(1500)
    log('tree after new file:', await js(`document.querySelectorAll('.vault-note').length`))

    await click('.vault-head .segmented button', 'Graph')
    await shot('graph', 1200)
    log('graph nodes:', await js(`document.querySelectorAll('.vg-node').length`), 'edges:', await js(`document.querySelectorAll('.vg-edge').length`))

    // Without docs/INDEX.md: the build screen and its dialog (cancelled; nothing runs).
    rmSync(join(dir, 'docs', 'INDEX.md'))
    await click('.page-tabs button', 'Overview')
    await sleep(500)
    await click('.page-tabs button', 'Docs')
    await shot('empty', 1500)
    log('hero shown:', await js(`!!document.querySelector('.vault-hero')`))
    await click('.vault-hero button', 'Build vault')
    await shot('build-dialog', 900)
    log('build dialog:', await js(`document.querySelector('.vault-dialog h2')?.textContent`))
    await js(`document.querySelector('.overlay')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`)
  } finally {
    updateStore((s) => {
      s.manualProjects = s.manualProjects.filter((p) => p !== dir)
    })
  }
}

/**
 * MC_SMOKE_SKILLS=1: the Skills page and Eco mode, against your real skills and chats, for free.
 * Lists skills and their uses from the index, turns Eco mode on for the tour (restored after),
 * checks the launch flags, asks the coach about your largest recent chat directly and through
 * the hook server (a real UserPromptSubmit round trip), and screenshots the Skills page, a
 * skill's detail, the top bar and Settings → Spending as <MC_SMOKE>-skills-*.png.
 */
async function skillsTour(win: BrowserWindow, outFile: string): Promise<void> {
  const js = (code: string) => win.webContents.executeJavaScript(code)
  const shot = async (name: string, wait = 900) => {
    await sleep(wait)
    const file = outFile.replace(/\.png$/, `-skills-${name}.png`)
    writeFileSync(file, (await win.webContents.capturePage()).toPNG())
    log('screenshot:', file)
  }
  win.show()
  win.focus()
  win.webContents.setBackgroundThrottling(false)
  for (let i = 0; i < 240 && (await js('window.mc.indexStatus()')).lastRun === 0; i++) await sleep(500)

  const skills = await js('window.mc.listSkills()')
  const bySource: Record<string, number> = {}
  for (const s of skills) bySource[s.source] = (bySource[s.source] ?? 0) + 1
  log('skills:', skills.length, JSON.stringify(bySource), 'eco:coach found:', skills.some((s: any) => s.id === 'eco:coach'))
  log('listing tokens total:', skills.reduce((n: number, s: any) => n + s.listingTokens, 0))
  const usage = await js('window.mc.skillUsage(0)')
  log('skill uses (all time):', usage.slice(0, 8).map((u: any) => `${u.skill}=${u.uses} (claude ${u.byClaude}, you ${u.byYou})`).join(', '))

  const before = loadStore().settings.eco
  updateStore((s) => {
    s.settings.eco = { ...before, enabled: true, coach: true, skill: true, autocompactTokens: 150_000, model: 'sonnet' }
  })
  try {
    log('eco launch args:', JSON.stringify(launchArgs(process.cwd(), { newChat: true, hasModel: false })))
    log('eco task model:', defaultModelFor(process.cwd(), true))

    // The coach, on your largest recent chat.
    const recent = await recentSessions(12)
    const sizes = await contextUsage(recent.map((r) => r.id))
    const big = Object.values(sizes).sort((a, b) => b.tokens - a.tokens)[0]
    if (big) {
      log('largest recent chat:', Math.round(big.tokens / 1000) + 'k tokens', 'window', Math.round(big.window / 1000) + 'k')
      // Through the hook server, as Claude Code asks on every prompt; then directly, when it was already said once.
      const settingsFile = hookSettingsFor('smoke-coach')
      const url = /"(http:\/\/127\.0\.0\.1:[^"]+)"/.exec(readFileSync(settingsFile, 'utf8').replace(/\\"/g, '"'))?.[1]
      const res = await fetch(url!, { method: 'POST', body: JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: big.sessionId, prompt: 'hi' }) })
      log('coach (hook reply):', (await res.text()).slice(0, 400))
      log('coach (asked again, same level):', JSON.stringify(await coachPrompt(big.sessionId)))
      removeHookSettings('smoke-coach')
    }

    // The UI reads settings when the Settings dialog closes: open and close it to pick up eco mode.
    await js(`window.__mcSmoke.openSettings()`)
    await sleep(400)
    await js(`document.querySelector('.overlay')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`)
    await sleep(400)
    await openView(win, 'skills')
    await js(`window.__mcSmoke.runShortcut('refresh')`)
    await shot('page', 2500)
    log('rows:', await js(`document.querySelectorAll('.skill-row').length`), 'eco card on:', await js(`!!document.querySelector('.eco-card.on')`), 'top bar eco on:', await js(`!!document.querySelector('.eco-toggle.on')`))
    await js(`[...document.querySelectorAll('.skill-row')].find(r => r.textContent.includes('/eco:coach'))?.click()`)
    await shot('detail', 1200)
    log('detail:', await js(`document.querySelector('.skill-detail-head')?.textContent`))
    await js(`window.__mcSmoke.openSettings()`)
    await sleep(500)
    await js(`[...document.querySelectorAll('.dialog button')].find(b => b.textContent.includes('Spending'))?.click()`)
    await shot('settings', 900)
    await js(`document.querySelector('.overlay')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`)
  } finally {
    updateStore((s) => {
      s.settings.eco = before
    })
  }
}

/**
 * MC_SMOKE_WS=<empty scratch folder>: v0.18. Opens two PowerShell agents and one real Claude agent
 * (Haiku) there, saves them as a workspace through the dialog, sends "pong" to the Claude agent
 * with Send to… and checks its reply in the chat file, closes everything, reopens the workspace
 * (the Claude chat must be resumed, in the grid) and deletes it. About $0.001 of Haiku.
 * Screenshots <MC_SMOKE>-ws-*.png.
 */
async function workspacesTour(win: BrowserWindow, outFile: string, dir: string): Promise<void> {
  const js = (code: string) => win.webContents.executeJavaScript(code)
  const shot = async (name: string, wait = 900) => {
    await sleep(wait)
    const file = outFile.replace(/\.png$/, `-ws-${name}.png`)
    writeFileSync(file, (await win.webContents.capturePage()).toPNG())
    log('screenshot:', file)
  }
  /** Types into a React-controlled field. */
  const type = (selector: string, text: string, proto = 'HTMLInputElement') =>
    js(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; Object.getOwnPropertyDescriptor(${proto}.prototype, 'value').set.call(el, ${JSON.stringify(text)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
  const click = (selector: string, text: string) => js(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(selector)})].find(x => x.textContent.includes(${JSON.stringify(text)})); b?.click(); return !!b })()`)
  win.show()
  win.focus()
  win.webContents.setBackgroundThrottling(false)
  mkdirSync(dir, { recursive: true })
  const base = `{ cwd: ${JSON.stringify(dir)}, projectName: 'ws-smoke', projectPath: ${JSON.stringify(dir)} }`
  const before = await js(`window.__mcSmoke.agents().length`)
  await js(`window.__mcSmoke.launch({ ...${base}, title: 'ws shell 1', kind: 'shell' })`)
  await js(`window.__mcSmoke.launch({ ...${base}, title: 'ws shell 2', kind: 'shell' })`)
  await js(`window.__mcSmoke.launch({ ...${base}, title: 'ws claude', args: ['--model', 'haiku'] })`)
  await js(`window.__mcSmoke.setView('agents')`)
  if (!(await js(`!!document.querySelector('.agent-stage.grid')`))) await js(`window.__mcSmoke.runShortcut('toggleGrid')`)
  const claudeId: string = await js(`window.__mcSmoke.agents().find(a => a.title === 'ws claude')?.id`)
  // Wait for Claude to be ready for input (SessionStart hook).
  for (let i = 0; i < 60 && !(await js(`window.__mcSmoke.agents().find(a => a.id === ${JSON.stringify(claudeId)})?.hookStatus`)); i++) await sleep(500)
  await sleep(2500)
  log('claude agent status:', await js(`window.__mcSmoke.agents().find(a => a.id === ${JSON.stringify(claudeId)})?.hookStatus ?? 'none'`))

  // Save as a workspace through the dialog.
  await click('.agent-bar-end button', 'Workspaces')
  await sleep(300)
  await click('.menu-item', 'Save or manage workspaces')
  await sleep(400)
  await type('.workspace-save input', 'Smoke workspace')
  await shot('save-dialog', 500)
  await click('.workspace-save button', 'Save')
  await sleep(600)
  const saved = (await js(`window.mc.listWorkspaces()`)) as { id: string; name: string; layout: string; agents: { title: string; sessionId?: string }[] }[]
  const ws = saved.find((w) => w.name === 'Smoke workspace')
  log('saved workspace:', ws ? `${ws.agents.length} agents, ${ws.layout}: ${ws.agents.map((a) => a.title).join(', ')}` : 'missing')
  await js(`document.querySelector('.overlay')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`)

  // Send to…: only the Claude agent is listed (shells aren't Claude).
  await js(`window.__mcSmoke.runShortcut('broadcast')`)
  await sleep(500)
  log('send-to lists:', await js(`[...document.querySelectorAll('.broadcast-agents li')].map(l => l.textContent).join(' | ')`))
  await type('.broadcast-text', 'Reply with exactly the word: pong', 'HTMLTextAreaElement')
  await shot('broadcast', 400)
  await click('.dialog.broadcast .dialog-foot button', 'Send to')
  const seen: string[] = []
  for (let i = 0; i < 120; i++) {
    const st = await js(`window.__mcSmoke.agents().find(a => a.id === ${JSON.stringify(claudeId)})?.hookStatus ?? 'none'`)
    if (seen[seen.length - 1] !== st) seen.push(st)
    if (st === 'done' && seen.includes('working')) break
    await sleep(500)
  }
  log('claude status after send:', seen.join(' -> '))
  const sessionId: string | undefined = await js(`window.__mcSmoke.agents().find(a => a.id === ${JSON.stringify(claudeId)})?.sessionId`)
  if (sessionId) {
    await sleep(800)
    const r = await sessionRecap(sessionId).catch((e) => ({ lastReply: `error: ${(e as Error).message}`, prompts: 0 }))
    log('claude reply in chat file:', JSON.stringify(r.lastReply.slice(0, 60)), '| prompts:', r.prompts)
  }

  // Close the three, reopen the workspace.
  for (const id of await js(`window.__mcSmoke.agents().filter(a => a.projectName === 'ws-smoke').map(a => a.id)`)) await js(`window.__mcSmoke.closeAgent(${JSON.stringify(id)})`)
  await sleep(1500)
  log('after closing:', await js(`window.__mcSmoke.agents().length`), 'agents (had', before, 'before)')
  await click('.agent-bar-end button', 'Workspaces')
  await sleep(300)
  if (!(await click('.menu-item', 'Smoke workspace'))) {
    // With no agents open the bar is gone; the empty page offers workspaces.
    await click('.empty-workspaces button', 'Smoke workspace')
  }
  for (let i = 0; i < 40 && (await js(`window.__mcSmoke.agents().filter(a => a.projectName === 'ws-smoke').length`)) < 3; i++) await sleep(500)
  await sleep(2500)
  const reopened = await js(`window.__mcSmoke.agents().filter(a => a.projectName === 'ws-smoke').map(a => a.title + (a.resumedFrom ? ' (resumed)' : ''))`)
  log('reopened:', JSON.stringify(reopened), '| grid:', await js(`!!document.querySelector('.agent-stage.grid')`))
  await shot('reopened', 1500)

  // Delete it.
  await click('.agent-bar-end button', 'Workspaces')
  await sleep(300)
  await click('.menu-item', 'Save or manage workspaces')
  await sleep(400)
  await js(`[...document.querySelectorAll('.workspace-list li')].find(l => l.textContent.includes('Smoke workspace'))?.querySelector('button[aria-label="Delete"], button[title="Delete"]')?.click()`)
  await sleep(500)
  log('after delete:', JSON.stringify(((await js(`window.mc.listWorkspaces()`)) as { name: string }[]).map((w) => w.name)))
  await js(`document.querySelector('.overlay')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`)
  for (const id of await js(`window.__mcSmoke.agents().filter(a => a.projectName === 'ws-smoke').map(a => a.id)`)) await js(`window.__mcSmoke.closeAgent(${JSON.stringify(id)})`)
  await sleep(1000)
}

/**
 * MC_SMOKE_AGENTS=<project folder name, e.g. bot>: v0.17. Logs that project's chat names (and where
 * each comes from) and the recap of its newest chat. Opens four agents "resumed" from its newest
 * chats (as PowerShell tabs, so no Claude runs and no chat is touched), shows them in the grid,
 * drags a divider with the real mouse, minimizes one, maximizes one, opens a "last time" banner,
 * and checks that resuming an open chat again doesn't start a second agent. Screenshots
 * <MC_SMOKE>-agents-*.png. Free. With MC_SMOKE_AGENTS_AI=1 it also asks Claude (Haiku, about
 * $0.002) to summarize the newest chat and name the unnamed ones, logs the answers, and puts the
 * store back as it was.
 */
async function agentsTour(win: BrowserWindow, outFile: string, folder: string): Promise<void> {
  const js = (code: string) => win.webContents.executeJavaScript(code)
  const shot = async (name: string, wait = 1200) => {
    await sleep(wait)
    const file = outFile.replace(/\.png$/, `-agents-${name}.png`)
    writeFileSync(file, (await win.webContents.capturePage()).toPNG())
    log('screenshot:', file)
  }
  win.show()
  win.focus()
  win.webContents.setBackgroundThrottling(false)
  for (let i = 0; i < 240 && (await js('window.mc.indexStatus()')).lastRun === 0; i++) await sleep(500)

  const project = (await listProjects()).find((p) => p.folderName.toLowerCase() === folder.toLowerCase())
  if (!project) return log('agents tour: no project folder named', folder)
  const sessions = await listSessions(project.keys, project.path)
  const bySource: Record<string, number> = {}
  for (const s of sessions) bySource[s.titleSource ?? '?'] = (bySource[s.titleSource ?? '?'] ?? 0) + 1
  log('chats:', sessions.length, 'title sources:', JSON.stringify(bySource))
  for (const s of sessions.slice(0, 12)) log(`  [${s.titleSource}] ${s.title}${s.lastPrompt ? `  | latest: ${s.lastPrompt.slice(0, 70)}` : ''}`)
  const newest = sessions[0]
  if (!newest) return
  const t0 = Date.now()
  const recap = await sessionRecap(newest.id)
  log('recap of newest:', `${Date.now() - t0}ms`, JSON.stringify({ prompts: recap.prompts, active: recap.activeMinutes, files: recap.filesTotal, commits: recap.commits, compactions: recap.compactions, first: recap.firstPrompts[0]?.text.slice(0, 80), lastReply: recap.lastReply.slice(0, 120) }))

  if (process.env.MC_SMOKE_AGENTS_AI) {
    const before = { names: { ...loadStore().chatAiNames }, recaps: { ...loadStore().chatRecaps } }
    try {
      log('summarize (Haiku):', JSON.stringify(await summarizeChat(newest.id)))
      const dup = (t: string) => sessions.filter((x) => x.title === t).length > 1
      const unnamed = sessions.filter((s) => s.firstPrompt && (s.titleSource === 'prompt' || dup(s.title) || unclearTitle(s.title))).map((s) => s.id)
      log('name chats (Haiku):', await nameChats(unnamed), 'named of', unnamed.length)
      const names = loadStore().chatAiNames
      for (const s of sessions.filter((x) => names[x.id] && unnamed.includes(x.id))) log(`  "${s.title}" -> "${names[s.id]}"`)
    } catch (e) {
      log('AI naming failed:', (e as Error).message)
    } finally {
      updateStore((s) => {
        s.chatAiNames = before.names
        s.chatRecaps = before.recaps
      })
    }
  }

  // The chats tab with the recap card.
  await js(`window.__mcSmoke.selectProject(${JSON.stringify(project.path)}); window.__mcSmoke.setView('project')`)
  await sleep(800)
  await js(`[...document.querySelectorAll('.page-tabs button')].find(b => b.textContent.includes('Chats'))?.click()`)
  await shot('chats', 2500)
  log('recap card:', await js(`document.querySelector('.recap')?.textContent?.slice(0, 300) ?? 'missing'`))
  log('session tools:', await js(`[...document.querySelectorAll('.session-tools button')].map(b => b.textContent).join(' | ')`))

  // Four agents "resumed" from the newest chats (PowerShell, so nothing runs in Claude).
  for (const s of sessions.slice(0, 4)) {
    await js(`window.__mcSmoke.launch({ cwd: ${JSON.stringify(project.path)}, projectName: ${JSON.stringify(project.name)}, projectPath: ${JSON.stringify(project.path)}, title: ${JSON.stringify(s.title.slice(0, 48))}, kind: 'shell', args: ['--resume', ${JSON.stringify(s.id)}] })`)
  }
  const count = await js(`window.__mcSmoke.agents().length`)
  // Resuming one that's open shows it instead of starting another (shell agents have no session id, so this checks claude chats only by design).
  log('agents open:', count)
  await js(`window.__mcSmoke.setView('agents')`)
  if (!(await js(`!!document.querySelector('.agent-stage.grid')`))) await js(`window.__mcSmoke.runShortcut('toggleGrid')`)
  await shot('grid', 1500)
  log('grid:', await js(`(() => { const s = document.querySelector('.agent-stage.grid'); return s ? getComputedStyle(s).gridTemplateColumns + ' / ' + getComputedStyle(s).gridTemplateRows : 'missing' })()`))
  log('banners:', await js(`document.querySelectorAll('.recap-compact').length`), '| first:', await js(`document.querySelector('.recap-banner-text')?.textContent?.slice(0, 120) ?? 'none'`))

  // Drag the column divider 160px to the right with the real mouse.
  // A quarter of the way down: the middle is where the row divider crosses it.
  const g = await js(`(() => { const r = document.querySelector('.grid-gutter.col')?.getBoundingClientRect(); return r ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 4) } : null })()`)
  if (g) {
    const z = win.webContents.getZoomFactor()
    const at = (x: number) => ({ x: Math.round(x * z), y: Math.round(g.y * z) })
    win.webContents.sendInputEvent({ type: 'mouseDown', ...at(g.x), button: 'left', clickCount: 1 })
    for (let dx = 20; dx <= 160; dx += 20) {
      win.webContents.sendInputEvent({ type: 'mouseMove', ...at(g.x + dx), button: 'left', modifiers: ['leftbuttondown'] })
      await sleep(30)
    }
    win.webContents.sendInputEvent({ type: 'mouseUp', ...at(g.x + 160), button: 'left', clickCount: 1 })
    await sleep(400)
    log('after drag:', await js(`getComputedStyle(document.querySelector('.agent-stage.grid')).gridTemplateColumns`))
  }
  // Open the first banner.
  await js(`document.querySelector('.recap-banner button[aria-label], .recap-banner .icon-btn')?.click()`)
  await shot('resized-banner', 1200)

  // Minimize the second agent, then maximize the first.
  await js(`document.querySelectorAll('.agent-cell:not(.stacked-hidden) .cell-controls button')[3]?.click()`)
  await sleep(500)
  log('after minimize: dock items', await js(`document.querySelectorAll('.dock-item').length`), '| grid cells', await js(`document.querySelectorAll('.agent-stage.grid .agent-cell:not(.stacked-hidden)').length`))
  await shot('minimized', 1000)
  await js(`document.querySelectorAll('.agent-cell:not(.stacked-hidden) .cell-controls button')[1]?.click()`)
  await sleep(600)
  log('maximized:', await js(`document.querySelector('.app')?.className`), '| sidebar shown:', await js(`getComputedStyle(document.querySelector('.sidebar')).display !== 'none'`))
  await shot('maximized', 1000)
  await js(`document.querySelector('.agent-cell.focused .cell-controls button:nth-child(2)')?.click()`)
  await sleep(500)
  log('restored:', await js(`!document.querySelector('.app.agent-maximized')`))
  await js(`[...document.querySelectorAll('.agent-dock button')].find(b => b.textContent.includes('Restore all'))?.click()`)
  // Close the four test shells, so quitting has no more terminals to stop than before.
  await js(`window.__mcSmoke.agents().filter(a => a.resumedFrom).forEach(a => window.__mcSmoke.closeAgent(a.id))`)
  await sleep(500)
  // The installed app shares this storage: leave no test sizes behind.
  await js(`['mc.agentSizes', 'mc.agentCols', 'mc.recapBanner', 'mc.recapOpen'].forEach((k) => localStorage.removeItem(k))`)
}

/**
 * MC_SMOKE_INBOX=1: v0.16, free. Plan cost: writes sample plan readings for the last three days into
 * the self-test's own index, made from your real chat costs at a known rate (1% of the week per $2.50),
 * and checks the calibration finds that rate back. Inbox: adds a finished task, a failed one and an
 * overdue one, checks the items and the digest, and screenshots the Inbox, Usage, Tasks and
 * Settings → General as <MC_SMOKE>-inbox-*.png. Everything it adds is removed afterwards.
 */
async function inboxTour(win: BrowserWindow, outFile: string): Promise<void> {
  const js = (code: string) => win.webContents.executeJavaScript(code)
  const shot = async (name: string, wait = 1200) => {
    await sleep(wait)
    const file = outFile.replace(/\.png$/, `-inbox-${name}.png`)
    writeFileSync(file, (await win.webContents.capturePage()).toPNG())
    log('screenshot:', file)
  }
  win.show()
  win.focus()
  win.webContents.setBackgroundThrottling(false)
  for (let i = 0; i < 240 && (await js('window.mc.indexStatus()')).lastRun === 0; i++) await sleep(500)

  const H = 3_600_000
  const PER_USD = 0.004
  const now = Date.now()
  const start = now - 72 * H
  const resetsAt = now + 4 * 24 * H
  const made: string[] = []
  try {
    // Sample readings every 3 hours: the week moves exactly by cost × rate.
    let util = 0.05
    await queryIndex('addPlanReading', start, [{ name: 'seven_day', utilization: util, resetsAt }])
    for (let t = start + 3 * H; t <= now - 10 * 60_000; t += 3 * H) {
      const slot = await queryIndex<{ costUsd: number }>('dayDigest', t - 3 * H, t)
      util += slot.costUsd * PER_USD
      await queryIndex('addPlanReading', t, [{ name: 'seven_day', utilization: util, resetsAt }])
    }
    const rate = await planRate(true)
    const w = rate.windows.seven_day
    log('calibration: expected perUsd', PER_USD, 'got', w ? w.perUsd.toFixed(5) : 'none', w ? `(usd ${w.usd.toFixed(2)}, share ${w.share.toFixed(3)}, outside ${w.outside})` : '')
    log('models:', rate.models.slice(0, 3).map((m) => `${m.model} ${m.usdPerMTok.toFixed(2)}/MTok`).join(', '), 'eco:', JSON.stringify(rate.eco ?? null))
    // The UI asks for the rate when the index or plan numbers change; nudge it now.
    win.webContents.send('index:status', { ...(await js('window.mc.indexStatus()')), lastRun: Date.now() })

    // Inbox scenarios.
    const project = (await listProjects()).find((p) => !p.worktree)
    const base = { projectPath: project?.path ?? process.cwd(), projectName: project?.name ?? 'smoke', mode: 'headless' as const, permission: 'plan' as const, useWorktree: false, prompt: 'smoke' }
    const ok = await createTask({ ...base, title: 'Smoke: finished task' })
    const bad = await createTask({ ...base, title: 'Smoke: failed task' })
    const late = await createTask({ ...base, title: 'Smoke: overdue task', dueAt: now - 2 * H, dueHasTime: true })
    made.push(ok.id, bad.id, late.id)
    for (const t of listTasks()) {
      if (t.id === late.id) t.remindedAt = now
      if (t.id !== ok.id && t.id !== bad.id) continue
      t.column = 'review'
      t.run = {
        startedAt: now - H,
        finishedAt: now - (t.id === ok.id ? 5 : 15) * 60_000,
        toolCalls: 4,
        events: [],
        costUsd: t.id === ok.id ? 1.8 : 0.4,
        error: t.id === bad.id ? 'Reached the budget of $0.40' : undefined
      }
    }
    flushTasks()
    // Push the board to the UI through the normal path.
    await js(`window.mc.updateTask(${JSON.stringify(late.id)}, { order: ${now} })`)
    await js(`window.__mcSmoke.setView('inbox')`)
    await shot('page', 2500)
    log('inbox items:', await js(`[...document.querySelectorAll('.inbox-item')].map(e => e.querySelector('.inbox-title')?.textContent).join(' | ')`))
    log('sidebar badge:', await js(`[...document.querySelectorAll('.nav-item')].find(b => b.textContent.includes('Inbox'))?.querySelector('.count')?.textContent ?? 'none'`))
    log('digest card:', await js(`document.querySelector('.digest-stats')?.textContent ?? 'missing'`))
    for (const which of ['yesterday', 'today'] as const) {
      const d = await buildDigest(which)
      log(`digest ${which}:`, JSON.stringify({ chats: d.chats, replies: d.replies, cost: d.costUsd.toFixed(2), weekShare: d.weekShare, review: d.review, overdue: d.overdue, top: d.topProjects[0]?.projectPath }))
      log(`digest ${which} text:`, digestText(d).body)
    }
    // Dismiss the finished task; it should go, and "Show dismissed (1)" appear.
    const before = await js(`document.querySelectorAll('.inbox-item').length`)
    await js(`[...document.querySelectorAll('.inbox-item')].find(e => e.textContent.includes('Smoke: finished'))?.querySelector('.inbox-actions button[aria-label]')?.click()`)
    await sleep(500)
    log('dismiss:', before, '->', await js(`document.querySelectorAll('.inbox-item').length`), '| header buttons:', await js(`[...document.querySelectorAll('.inbox-head-actions button')].map(b => b.textContent).join(', ')`))

    await openView(win, 'usage')
    await shot('usage', 2500)
    log('plan cost card:', await js(`document.querySelector('.plan-cost')?.textContent?.slice(0, 500) ?? 'missing'`))
    log('usage shares shown:', await js(`document.querySelectorAll('.plan-share').length`))
    await js(`window.__mcSmoke.setView('tasks')`)
    await shot('tasks', 1500)
    log('task card share:', await js(`[...document.querySelectorAll('.task-card')].find(c => c.textContent.includes('Smoke: finished'))?.querySelector('.plan-share')?.textContent ?? 'none'`))
    await js(`window.__mcSmoke.openSettings()`)
    await shot('settings', 900)
    await js(`document.querySelector('.overlay')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`)
  } finally {
    for (const id of made) await deleteTask(id)
    await queryIndex('dropPlanReadings', 'seven_day', start, now)
    await planRate(true).catch(() => undefined)
  }
}

/**
 * MC_SMOKE_PLAN=1: asks your Claude account for the plan limits (one small request, no model use),
 * logs them and screenshots Home's top bar and the Usage page as <MC_SMOKE>-plan-*.png. Free.
 */
async function planTour(win: BrowserWindow, outFile: string): Promise<void> {
  const js = (code: string) => win.webContents.executeJavaScript(code)
  win.show()
  win.focus()
  win.webContents.setBackgroundThrottling(false)
  const info = await refreshPlanUsage(true).then(() => getRateLimit())
  log('plan limits:', info?.error ? `error: ${info.error}` : '', JSON.stringify(info?.windows), 'plan:', info?.plan)
  for (const name of ['home', 'usage']) {
    win.webContents.send('navigate', { view: name })
    await sleep(1200)
    const file = outFile.replace(/.png$/, `-plan-${name}.png`)
    writeFileSync(file, (await win.webContents.capturePage()).toPNG())
    log('screenshot:', file)
  }
  log('top bar meter:', await js(`document.querySelector('.plan-meter')?.textContent ?? 'missing'`))
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
    // MC_SMOKE_CHAT=<session id>: also shoot that chat in the viewer (e.g. one with a Markdown table).
    const chat = process.env.MC_SMOKE_CHAT
    if (chat) {
      await js(`window.__mcSmoke.openSession(${JSON.stringify(project.path)}, ${JSON.stringify(chat)})`)
      await sleep(2500)
      log('chat tables:', await js(`(() => { const t = document.querySelectorAll('.message-text table'); t[0]?.scrollIntoView({ block: 'center' }); return t.length })()`))
      await shot('chat')
    }
  }
  for (const view of ['projects', 'notebook', 'knowledge', 'tasks', 'agents', 'usage']) {
    await openView(win, view)
    await shot(view, 1200)
  }
  await openView(win, 'search')
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
  await openView(win, 'knowledge')
  await shot('light-knowledge', 1200)
  if (project) {
    await js(`window.__mcSmoke.selectProject(${JSON.stringify(project.path)}); window.__mcSmoke.setView('project')`)
    key('C', ['alt'])
    await shot('light-chats', 1200)
    key('O', ['alt'])
    await shot('light-overview', 1200)
  }
  await openView(win, 'usage')
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
    // MC_SMOKE_QUIT=<n>: only the quit test, with n terminals printing as fast as they can (0: none).
    const quitTest = Number(process.env.MC_SMOKE_QUIT || -1)
    if (quitTest >= 0) {
      const { writeTerminal } = await import('./pty')
      for (let i = 0; i < quitTest; i++) {
        const t = deps.launchTerminal({ cwd: process.cwd(), args: [], kind: 'shell', cols: 100, rows: 20 })
        writeTerminal(t.id, 'while ($true) { "flood $(Get-Date -Format o)" }\r')
      }
      await sleep(2500)
      log(`quit test: closing the window with ${quitTest} terminals printing`)
      win.close()
      return
    }
    if (process.env.MC_SMOKE_PERF) {
      await perfTour(win)
      win.close()
      return
    }
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
    if (process.env.MC_SMOKE_PLAN) await planTour(win, outFile)
    if (process.env.MC_SMOKE_SKILLS) await skillsTour(win, outFile)
    if (process.env.MC_SMOKE_INBOX) await inboxTour(win, outFile)
    if (process.env.MC_SMOKE_AGENTS) await agentsTour(win, outFile, process.env.MC_SMOKE_AGENTS)
    if (process.env.MC_SMOKE_WS) await workspacesTour(win, outFile, process.env.MC_SMOKE_WS)
    if (process.env.MC_SMOKE_VAULT) await vaultTour(win, outFile, process.env.MC_SMOKE_VAULT)
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
