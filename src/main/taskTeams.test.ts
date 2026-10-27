import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NewTask, Task, TaskRun, TeamAssignment, TeamPlan } from '../shared/types'

const mock = vi.hoisted(() => ({
  spawn: vi.fn(),
  exists: vi.fn(),
  createWorktree: vi.fn(),
  commit: vi.fn(),
  cleanup: vi.fn(),
  budget: vi.fn(),
  usage: vi.fn(),
  store: { tasks: [] as Task[], projectMeta: {} as Record<string, { checkCommand?: string }>, settings: { queueEnabled: false, queueParallel: 3, queuePauseAtPercent: 95, defaultTaskBudgetUsd: 0 } }
}))

vi.mock('node:child_process', () => ({ spawn: mock.spawn }))
vi.mock('node:fs', () => ({ existsSync: mock.exists }))
vi.mock('./processCleanup', () => ({ terminateProcessTreesSync: mock.cleanup }))
vi.mock('./projectBriefing', () => ({ briefingContext: (_path: string, prompt: string) => prompt }))
vi.mock('./codexData', () => ({ codexUsage: mock.usage }))
vi.mock('./budget', () => ({ projectBudget: mock.budget, invalidateBudgets: vi.fn() }))
vi.mock('./claudeData', () => ({ normalizePath: (path: string) => path.replace(/\//g, '\\').toLowerCase() }))
vi.mock('./git', () => ({ createWorktree: mock.createWorktree, commitIfDirty: mock.commit, gitInfo: vi.fn().mockResolvedValue({ isRepo: true, mainRoot: 'C:\\project' }) }))
vi.mock('./pty', () => ({ agentEnv: () => ({}), whichSync: (tool: string) => `${tool}.exe` }))
vi.mock('./store', () => ({ loadStore: () => mock.store, updateStore: (fn: (store: typeof mock.store) => void) => { fn(mock.store); return mock.store } }))
vi.mock('./spend', () => ({ defaultModelFor: () => undefined, launchArgs: () => [] }))
vi.mock('./planCost', () => ({ markEcoSession: vi.fn() }))

class FakeChild extends EventEmitter {
  stdin = new PassThrough()
  stdout = new PassThrough()
  stderr = new PassThrough()
  pid: number
  closed = false
  constructor(pid: number) { super(); this.pid = pid }
  kill = vi.fn(() => { this.close(1); return true })
  close(code = 0) {
    if (this.closed) return
    this.closed = true
    this.emit('close', code)
  }
}

interface SpawnRecord {
  file: string
  args: string[]
  options: { cwd: string }
  child: FakeChild
  taskId?: string
  run?: TaskRun
  stagedMembers: number
}

let api: typeof import('./tasks')
let spawned: SpawnRecord[]
let hooks: Parameters<typeof import('./tasks').initTasks>[0]
const worktree = { path: 'C:\\project\\.claude\\worktrees\\team', branch: 'mc/team', base: 'main', repoRoot: 'C:\\project' }
const assignment = (id: string, files = [`src/${id}.ts`], dependsOn: string[] = []): TeamAssignment => ({ id, title: `Implement ${id}`, prompt: `Implement and test ${id}.`, files, dependsOn })
const plan = (agents = [assignment('backend'), assignment('frontend')]): TeamPlan => ({ size: agents.length === 1 ? 'small' : 'medium', summary: 'Scoped implementation assignments.', agents })
const rootInput = (patch: Partial<NewTask> = {}): NewTask => ({ title: 'Build the feature', prompt: 'Implement the feature and verify frontend and backend.', projectPath: 'C:\\project', projectName: 'Project', tool: 'claude', mode: 'headless', permission: 'auto', useWorktree: false, ...patch })
const settle = async () => { for (let n = 0; n < 40; n++) await Promise.resolve() }
const members = (root: Task) => root.team!.memberIds.map(id => api.listTasks().find(t => t.id === id)!)
const runningWorkers = (root: Task) => members(root).filter(t => t.teamRole === 'worker' && t.column === 'running')
const recordFor = (task: Task) => [...spawned].reverse().find(record => record.taskId === task.id && !record.child.closed && record.file !== 'powershell.exe')!

async function finish(task: Task, result = 'Done', code = 0) {
  const record = recordFor(task)
  expect(record, `Missing running process for ${task.title}`).toBeDefined()
  if (code) record.child.stderr.write('Assignment failed\n')
  if (task.tool === 'codex') {
    record.child.stdout.write(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: result } }) + '\n')
    record.child.stdout.write(JSON.stringify({ type: 'turn.completed' }) + '\n')
  } else {
    record.child.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result, total_cost_usd: 0.05, num_turns: 1 }) + '\n')
  }
  record.child.close(code)
  await settle()
}

async function planned(value = plan(), patch: Partial<NewTask> = {}) {
  const root = api.createTask(rootInput(patch))
  await api.planTaskTeam(root.id)
  await finish(api.listTasks().find(t => t.id === root.team!.plannerId)!, JSON.stringify(value))
  expect(root.team?.phase).toBe('ready')
  return root
}

beforeEach(async () => {
  vi.resetModules()
  vi.useFakeTimers()
  vi.clearAllMocks()
  spawned = []
  mock.store.tasks = []
  mock.store.projectMeta = {}
  mock.store.settings.queueEnabled = false
  mock.store.settings.defaultTaskBudgetUsd = 0
  mock.exists.mockReturnValue(true)
  mock.createWorktree.mockResolvedValue({ ...worktree })
  mock.commit.mockResolvedValue('abc123')
  mock.budget.mockResolvedValue(null)
  mock.usage.mockResolvedValue({ limits: { windows: [] } })
  mock.spawn.mockImplementation((file: string, args: string[], options: { cwd: string }) => {
    const child = new FakeChild(1000 + spawned.length)
    const isCheck = file === 'powershell.exe'
    const task = api.listTasks().find(t => !t.team && t.column === 'running' && t.run && (isCheck ? t.run.checks?.status === 'running' : !spawned.some(record => record.run === t.run)))
    const root = task?.teamParentId ? api.listTasks().find(t => t.id === task.teamParentId) : undefined
    spawned.push({ file, args, options, child, taskId: task?.id, run: task?.run, stagedMembers: root?.team?.memberIds.length ?? 0 })
    if (file === 'taskkill') {
      const pid = Number(args[args.findIndex(arg => arg.toLowerCase() === '/pid') + 1])
      spawned.find(record => record.child.pid === pid)?.child.close(1)
      child.close()
    }
    return child
  })
  api = await import('./tasks')
  hooks = {
    onChange: vi.fn<(tasks: Task[]) => void>(),
    onRateLimit: vi.fn<Parameters<typeof import('./tasks').initTasks>[0]['onRateLimit']>(),
    onFinished: vi.fn<(task: Task) => void>(),
    onQueueStatus: vi.fn<Parameters<typeof import('./tasks').initTasks>[0]['onQueueStatus']>(),
    onReady: vi.fn<(task: Task) => void>()
  }
  api.initTasks(hooks)
})

afterEach(() => {
  api.stopAllTasks()
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('agent team planning', () => {
  it.each(['claude', 'codex'] as const)('uses the selected %s provider read-only and skips commits and project checks', async tool => {
    mock.store.projectMeta['c:\\project'] = { checkCommand: 'npm test' }
    const root = await planned(plan([assignment('implementation')]), { tool, model: 'chosen-model' })
    const planner = api.listTasks().find(t => t.id === root.team!.plannerId)!
    const record = spawned[0]
    expect(planner).toMatchObject({ tool, permission: 'plan', teamRole: 'planner', model: 'chosen-model' })
    expect(record.file).toBe(`${tool}.exe`)
    expect(record.options.cwd).toBe(root.projectPath)
    expect(record.args).toContain('chosen-model')
    if (tool === 'codex') expect(record.args).toContain('sandbox_mode="read-only"')
    else expect(record.args.slice(record.args.indexOf('--permission-mode'), record.args.indexOf('--permission-mode') + 2)).toEqual(['--permission-mode', 'plan'])
    expect(root.team?.plan?.agents).toHaveLength(1)
    expect(mock.createWorktree).not.toHaveBeenCalled()
    expect(mock.commit).not.toHaveBeenCalled()
    expect(spawned).toHaveLength(1)
  })

  it('rejects invalid planner output without creating or launching workers', async () => {
    const root = api.createTask(rootInput())
    await api.planTaskTeam(root.id)
    await finish(api.listTasks().find(t => t.id === root.team!.plannerId)!, '{"agents":[]}')
    expect(root.team).toMatchObject({ phase: 'error', memberIds: [] })
    expect(root.team?.error).toContain('Could not create the team plan')
    expect(api.listTasks()).toHaveLength(2)
    expect(mock.createWorktree).not.toHaveBeenCalled()
  })

  it('stops planning and ignores a late planner result', async () => {
    const root = api.createTask(rootInput())
    await api.planTaskTeam(root.id)
    const planner = api.listTasks().find(t => t.id === root.team!.plannerId)!
    api.stopTaskTeam(root.id)
    await settle()
    expect(root.team?.phase).toBe('error')
    expect(root.team?.plan).toBeUndefined()
    expect(planner.run?.error).toBe('Stopped by you.')
    expect(mock.commit).not.toHaveBeenCalled()
    expect(root.team?.memberIds).toEqual([])
  })
})

describe('coordinated team execution', () => {
  it('stages every assignment before spawning, shares one worktree and caps disjoint workers at three', async () => {
    const root = await planned(plan(['one', 'two', 'three', 'four'].map(id => assignment(id))))
    await api.startTaskTeam(root.id)
    expect(members(root)).toHaveLength(5)
    expect(runningWorkers(root)).toHaveLength(3)
    expect(mock.createWorktree).toHaveBeenCalledTimes(1)
    const workerRecords = spawned.filter(record => record.taskId && members(root).some(t => t.id === record.taskId))
    expect(workerRecords).toHaveLength(3)
    expect(workerRecords.every(record => record.stagedMembers === 5 && record.options.cwd === worktree.path)).toBe(true)
    await finish(runningWorkers(root)[0])
    expect(runningWorkers(root)).toHaveLength(3)
    expect(members(root).find(t => t.teamRole === 'integrator')?.column).toBe('todo')
    expect(mock.commit).not.toHaveBeenCalled()
  })

  it('serializes overlapping ownership while allowing an independent worker to run', async () => {
    const root = await planned(plan([assignment('one', ['src/main/']), assignment('two', ['src/main/ipc.ts']), assignment('three', ['src/renderer/'])]))
    await api.startTaskTeam(root.id)
    expect(runningWorkers(root).map(t => t.teamStepId)).toEqual(['one', 'three'])
    await finish(runningWorkers(root).find(t => t.teamStepId === 'one')!)
    expect(runningWorkers(root).map(t => t.teamStepId)).toEqual(['two', 'three'])
  })

  it('waits for explicit dependencies and all workers before integration, then checks before committing', async () => {
    mock.store.projectMeta['c:\\project'] = { checkCommand: 'npm test' }
    const root = await planned(plan([assignment('backend'), assignment('frontend', ['src/frontend.ts'], ['backend'])]))
    await api.startTaskTeam(root.id)
    expect(runningWorkers(root).map(t => t.teamStepId)).toEqual(['backend'])
    await finish(runningWorkers(root)[0], 'Backend complete')
    expect(mock.commit).not.toHaveBeenCalled()
    expect(runningWorkers(root).map(t => t.teamStepId)).toEqual(['frontend'])
    await finish(runningWorkers(root)[0], 'Frontend complete')
    const integrator = members(root).find(t => t.teamRole === 'integrator')!
    expect(integrator.column).toBe('running')
    expect(spawned.filter(record => record.file === 'powershell.exe')).toHaveLength(0)
    await finish(integrator, 'Integrated and verified')
    const checks = [...spawned].reverse().find(record => record.file === 'powershell.exe')!
    expect(checks.args).toContain('npm test')
    expect(checks.options.cwd).toBe(worktree.path)
    expect(root.team?.phase).toBe('running')
    expect(mock.commit).not.toHaveBeenCalled()
    checks.child.close()
    await settle()
    expect(mock.commit).toHaveBeenCalledTimes(1)
    expect(mock.commit.mock.calls[0][0]).toBe(worktree.path)
    expect(root).toMatchObject({ column: 'review', team: { phase: 'review' }, run: { result: 'Integrated and verified', commit: 'abc123', checks: { status: 'passed' } } })
    expect(hooks.onFinished).toHaveBeenCalledWith(root)
  })

  it('pauses after a failed worker and resumes without rerunning successful assignments', async () => {
    const root = await planned()
    await api.startTaskTeam(root.id)
    const [success, failure] = runningWorkers(root)
    await finish(success, 'Completed backend')
    const successfulRun = success.run
    await finish(failure, 'Failed frontend', 1)
    expect(root.team?.phase).toBe('paused')
    expect(members(root).find(t => t.teamRole === 'integrator')?.column).toBe('todo')
    await api.startTaskTeam(root.id)
    expect(success.run).toBe(successfulRun)
    expect(runningWorkers(root).map(t => t.id)).toEqual([failure.id])
    expect(root.worktree).toEqual(worktree)
    expect(mock.createWorktree).toHaveBeenCalledTimes(1)
  })

  it('leaves failed final checks uncommitted and pauses the team', async () => {
    mock.store.projectMeta['c:\\project'] = { checkCommand: 'npm test' }
    const root = await planned(plan([assignment('implementation')]))
    await api.startTaskTeam(root.id)
    await finish(runningWorkers(root)[0])
    await finish(members(root).find(t => t.teamRole === 'integrator')!)
    const checks = [...spawned].reverse().find(record => record.file === 'powershell.exe')!
    checks.child.close(1)
    await settle()
    expect(root.team?.phase).toBe('paused')
    expect(mock.commit).not.toHaveBeenCalled()
  })

  it('blocks resume and deletion during a pending final commit and can finish after being paused', async () => {
    let finishCommit!: (hash: string) => void
    mock.commit.mockImplementationOnce(() => new Promise<string>(resolve => { finishCommit = resolve }))
    const root = await planned(plan([assignment('implementation')]))
    await api.startTaskTeam(root.id)
    await finish(runningWorkers(root)[0])
    const integrator = members(root).find(t => t.teamRole === 'integrator')!
    await finish(integrator)
    expect(mock.commit).toHaveBeenCalledTimes(1)
    expect(integrator.run?.finishedAt).toBeUndefined()
    api.stopTaskTeam(root.id)
    await expect(api.startTaskTeam(root.id)).rejects.toThrow('finish starting or stopping')
    expect(() => api.deleteTask(root.id)).toThrow('wait for its agents to stop')
    finishCommit('abc123')
    await settle()
    expect(root.team?.phase).toBe('paused')
    await api.startTaskTeam(root.id)
    await settle()
    expect(root.team?.phase).toBe('review')
    expect(root.column).toBe('review')
    expect(mock.commit).toHaveBeenCalledTimes(1)
  })

  it('blocks manual starts, edits, deletion and follow-ups for managed assignments', async () => {
    const root = await planned()
    await api.startTaskTeam(root.id)
    const member = members(root)[0]
    await expect(api.startTask(member.id)).rejects.toThrow('team controls')
    expect(() => api.updateTask(member.id, { prompt: 'Bypass ownership' })).toThrow('original task')
    expect(() => api.deleteTask(member.id)).toThrow('original task')
    expect(() => api.followUpTask(member.id, 'Continue')).toThrow('original task')
    await expect(api.rerunChecks(member.id)).rejects.toThrow('team')
    expect(() => api.updateTask(root.id, { column: 'done' })).toThrow('team controls')
  })

  it('prevents planning, team starts and late scheduling after shutdown', async () => {
    const root = await planned()
    await api.startTaskTeam(root.id)
    const processes = runningWorkers(root).map(recordFor)
    const agentCount = spawned.filter(record => record.file === 'claude.exe').length
    api.stopAllTasks()
    await expect(api.planTaskTeam(api.createTask(rootInput()).id)).rejects.toThrow('closing')
    await expect(api.startTaskTeam(root.id)).rejects.toThrow('closing')
    processes.forEach(record => record.child.close())
    await settle()
    expect(spawned.filter(record => record.file === 'claude.exe')).toHaveLength(agentCount)
    expect(mock.cleanup).toHaveBeenCalled()
    expect(mock.commit).not.toHaveBeenCalled()
  })

  it('allocates one total USD cap across planning, parallel workers, integration and failed attempts', async () => {
    const root = await planned(plan(), { budgetUsd: 1 })
    expect(root.team?.budgetUsd).toBe(1)
    expect(spawned[0].args).toContain('--max-budget-usd')
    expect(spawned[0].args[spawned[0].args.indexOf('--max-budget-usd') + 1]).toBe('1')
    await api.startTaskTeam(root.id)
    const [success, retry] = runningWorkers(root)
    const firstCaps = runningWorkers(root).reduce((sum, worker) => sum + (worker.budgetUsd ?? 0), 0)
    expect(firstCaps).toBeLessThanOrEqual(0.95)
    expect(success.budgetUsd).toBeGreaterThan(0)
    expect(retry.budgetUsd).toBeGreaterThan(0)
    await finish(success)
    await finish(retry, 'Needs another attempt', 1)
    await api.startTaskTeam(root.id)
    expect(retry.teamSpentUsd).toBeCloseTo(0.05)
    expect(root.run?.costUsd).toBeCloseTo(0.15)
    expect(retry.budgetUsd).toBeCloseTo(0.425)
    await finish(retry)
    const integrator = members(root).find(member => member.teamRole === 'integrator')!
    expect(integrator.column).toBe('running')
    expect(integrator.budgetUsd).toBeCloseTo(0.8)
    await finish(integrator)
    expect(root.run?.costUsd).toBeCloseTo(0.25)
    expect(root.team?.phase).toBe('review')
  })

  it('allows paused cap edits above spend, then clears the cap without inheriting the global default', async () => {
    mock.store.settings.defaultTaskBudgetUsd = 3
    const root = await planned(plan([assignment('implementation')]))
    expect(root.team?.budgetUsd).toBe(3)
    await api.startTaskTeam(root.id)
    expect(() => api.updateTask(root.id, { budgetUsd: 4 })).toThrow('team controls')
    const worker = runningWorkers(root)[0]
    await finish(worker, 'Retry required', 1)
    expect(root.team?.phase).toBe('paused')
    expect(() => api.updateTask(root.id, { budgetUsd: 0.05 })).toThrow('greater than its reported spend')
    expect(() => api.updateTask(root.id, { budgetUsd: NaN })).toThrow()
    api.updateTask(root.id, { budgetUsd: 5 })
    expect(root.team?.budgetUsd).toBe(5)
    api.updateTask(root.id, { budgetUsd: undefined })
    expect(root.team?.budgetUsd).toBeUndefined()
    await api.startTaskTeam(root.id)
    expect(recordFor(worker).args).not.toContain('--max-budget-usd')
  })

  it('keeps an explicitly cleared planning cap on retries even with a global default', async () => {
    mock.store.settings.defaultTaskBudgetUsd = 3
    const root = api.createTask(rootInput())
    await api.planTaskTeam(root.id)
    await finish(api.listTasks().find(task => task.id === root.team!.plannerId)!, 'Invalid plan')
    expect(root.team?.phase).toBe('error')
    api.updateTask(root.id, { budgetUsd: undefined })
    await api.planTaskTeam(root.id)
    const planner = api.listTasks().find(task => task.id === root.team!.plannerId)!
    expect(recordFor(planner).args).not.toContain('--max-budget-usd')
    expect(root.team?.budgetUsd).toBeUndefined()
  })

  it('keeps an entire plan-only team read-only, including its final integration', async () => {
    mock.store.projectMeta['c:\\project'] = { checkCommand: 'npm test' }
    const root = await planned(plan([assignment('investigation')]), { permission: 'plan' })
    await api.startTaskTeam(root.id)
    expect(runningWorkers(root)[0].permission).toBe('plan')
    await finish(runningWorkers(root)[0])
    const integrator = members(root).find(member => member.teamRole === 'integrator')!
    expect(integrator.permission).toBe('plan')
    await finish(integrator, 'Investigation finished')
    expect(root.team?.phase).toBe('review')
    expect(spawned.some(record => record.file === 'powershell.exe')).toBe(false)
    expect(mock.commit).not.toHaveBeenCalled()
  })

  it.each(['planning', 'running'] as const)('recovers a %s team on restart without automatically relaunching agents', async phase => {
    const root = api.createTask(rootInput())
    await api.planTaskTeam(root.id)
    if (phase === 'running') {
      await finish(api.listTasks().find(task => task.id === root.team!.plannerId)!, JSON.stringify(plan()))
      await api.startTaskTeam(root.id)
    }
    api.flushTasks()
    api.stopAllTasks()
    const savedTasks = structuredClone(api.listTasks())
    vi.clearAllTimers()
    vi.resetModules()
    mock.store.tasks = savedTasks
    spawned = []
    api = await import('./tasks')
    api.initTasks(hooks)
    await vi.advanceTimersByTimeAsync(31_000)
    const restored = api.listTasks().find(task => task.id === root.id)!
    expect(restored.team?.phase).toBe(phase === 'planning' ? 'error' : 'paused')
    expect(restored.team?.error).toContain('Mission Control closed')
    expect(api.listTasks().some(task => task.column === 'running')).toBe(false)
    expect(spawned).toHaveLength(0)
  })

  it('injects predecessor handoffs into dependent workers and every worker handoff into integration', async () => {
    const root = await planned(plan([assignment('backend'), assignment('frontend', ['src/frontend.ts'], ['backend'])]))
    await api.startTaskTeam(root.id)
    await finish(runningWorkers(root)[0], 'Backend handoff: use GET /widgets; API contract verified.')
    const frontend = runningWorkers(root)[0]
    const frontendPrompt = recordFor(frontend).child.stdin.read()?.toString()
    expect(frontendPrompt).toContain('Completed assignment handoffs')
    expect(frontendPrompt).toContain('Backend handoff: use GET /widgets; API contract verified.')
    await finish(frontend, 'Frontend handoff: widget list is connected and tested.')
    const integrator = members(root).find(member => member.teamRole === 'integrator')!
    const integrationPrompt = recordFor(integrator).child.stdin.read()?.toString()
    expect(integrationPrompt).toContain('Backend handoff: use GET /widgets; API contract verified.')
    expect(integrationPrompt).toContain('Frontend handoff: widget list is connected and tested.')
  })

  it('protects the shared team worktree and subfolders until the team finishes review preparation', async () => {
    const root = await planned(plan([assignment('implementation')]))
    await api.startTaskTeam(root.id)
    expect(() => api.assertTeamWorktreeIdle(worktree.path)).toThrow('Finish the agent team')
    expect(() => api.assertTeamWorktreeIdle(worktree.path + '\\src')).toThrow('Finish the agent team')
    expect(() => api.assertTeamWorktreeIdle('C:\\unrelated')).not.toThrow()
    api.stopTaskTeam(root.id)
    await settle()
    expect(root.team?.phase).toBe('paused')
    expect(() => api.assertTeamWorktreeIdle(worktree.path + '\\src')).toThrow('Finish the agent team')
    await api.startTaskTeam(root.id)
    await finish(runningWorkers(root)[0])
    await finish(members(root).find(member => member.teamRole === 'integrator')!)
    expect(root.team?.phase).toBe('review')
    expect(() => api.assertTeamWorktreeIdle(worktree.path)).not.toThrow()
    expect(() => api.assertTeamWorktreeIdle(worktree.path + '\\src')).not.toThrow()
  })
})
