import { randomBytes } from 'node:crypto'
import { basename } from 'node:path'
import { runAgent, stopAll, which, type Access, type AgentEvent, type AgentResult } from './agents'
import { COMMANDS, complete, onOff, parseCommand, type Command } from './commands'
import { changedFiles, commitAll, createWorktree, deleteRun, diffFor, findRun, git, listRuns, removeWorktree, repoRoot, saveRun, tryGit, type Run } from './git'
import { NAME, SIDES, firstLine, other, overlaps, parseDuoPlan, plannerPrompt, reviewPrompt, workerPrompt, type DuoPlan, type Side } from './plan'
import { Live, ask, block, c, card, cardColumn, cardInner, duration, heading, promptBox, say, sideBySide, startSession, wrap, type Section } from './ui'

const VERSION = '0.2.0'

const HELP = `${c.bold('mc')}: one prompt, two agents. Claude and Codex split the work and build it at the same time.

${c.bold('Usage')}
  mc "<what to build>"       plan, build both halves in parallel, cross-review, commit to a new branch
  mc list                    runs in this repository
  mc merge [id]              merge a finished run into your current branch and remove its worktree
  mc clean [id]              delete a run's worktree and branch without merging
  mc help | --version

${c.bold('Options')}
  -y, --yes                  start without confirming the plan
  --no-review                skip the cross-review step (faster, cheaper)
  --full                     let both agents run any command (Claude bypassPermissions, Codex no sandbox)
  --planner claude|codex     who splits the work (default: claude)
  --claude-model <model>     model for Claude (default: your Claude Code default)
  --codex-model <model>      model for Codex (default: your Codex default)

${c.bold('How it works')}
  1. The planner reads the repo (read-only) and splits the request into two halves with separate files.
  2. A new worktree is made on branch mc/duo-<id> from your last commit. Your folder is never touched.
  3. Claude and Codex each build their half at the same time, in that worktree.
  4. Each one reviews and fixes the other's half (unless --no-review).
  5. Everything is committed on the branch. Merge it with: mc merge <id>

  By default Claude can edit files and run read-only git plus test/build commands (npm test, npm run, tsc,
  vitest, pytest, go test, cargo); Codex runs in its workspace-write sandbox. Use --full for anything else.`

interface Options {
  yes: boolean
  review: boolean
  access: Access
  planner: Side
  models: Partial<Record<Side, string>>
}

function parse(argv: string[]): { command: string; rest: string[]; opts: Options } {
  const opts: Options = { yes: false, review: true, access: 'edit', planner: 'claude', models: {} }
  const rest: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const value = () => {
      const v = argv[++i]
      if (!v) throw new Error(`${a} needs a value.`)
      return v
    }
    if (a === '-y' || a === '--yes') opts.yes = true
    else if (a === '--no-review') opts.review = false
    else if (a === '--full') opts.access = 'full'
    else if (a === '--planner') {
      const v = value()
      if (v !== 'claude' && v !== 'codex') throw new Error('--planner must be claude or codex.')
      opts.planner = v
    } else if (a === '--claude-model') opts.models.claude = value()
    else if (a === '--codex-model') opts.models.codex = value()
    else if (a === '-h' || a === '--help') rest.unshift('help')
    else if (a === '-v' || a === '--version') rest.unshift('version')
    else if (a.startsWith('-') && a.length > 1) throw new Error(`Unknown option ${a}. Run mc help.`)
    else rest.push(a)
  }
  const first = rest[0]
  if (first && ['help', 'version', 'list', 'merge', 'clean'].includes(first) && (first !== 'help' || rest.length === 1)) {
    return { command: first, rest: rest.slice(1), opts }
  }
  return { command: 'run', rest, opts }
}

function requireRepo(): string {
  const root = repoRoot(process.cwd())
  if (!root) throw new Error('Run mc inside a git repository (the agents work on a new branch).')
  return root
}

function yes(answer: string): boolean {
  return !answer.trim() || /^y(es)?$/i.test(answer.trim())
}

/** The two agents side by side when the terminal is wide enough, otherwise one under the other. */
function bySide(lines: (side: Side, width: number) => string[]): Section[] {
  if (sideBySide()) return [{ left: lines('claude', cardColumn()), right: lines('codex', cardColumn()) }]
  return SIDES.map(side => lines(side, cardInner()))
}

function showPlan(plan: DuoPlan): void {
  const inner = cardInner()
  const sections: Section[] = [wrap(plan.summary, inner)]
  if (plan.contract) sections.push([c.bold('Shared contract'), ...wrap(plan.contract, inner - 2).map(l => '  ' + l)])
  sections.push(...bySide((side, w) => [
    c[side](c.bold(NAME[side])),
    ...wrap(plan[side].title, w).map(c.bold),
    ...wrap(plan[side].files.join(', '), w).map(c.dim)
  ]))
  console.log()
  card('Plan', sections)
}

/** Runs agents at the same time under the live status rows. */
let live: Live | undefined
async function together(phase: string, jobs: Array<{ side: Side; go: (onEvent: (e: AgentEvent) => void) => Promise<AgentResult> }>): Promise<AgentResult[]> {
  const panel = live = new Live()
  for (const job of jobs) panel.start(job.side, phase)
  try {
    return await Promise.all(jobs.map(async job => {
      const r = await job.go(e => panel.event(job.side, e))
      panel.finish(job.side, r.ok, r.ms)
      return r
    }))
  } finally {
    panel.stop()
    live = undefined
  }
}

function resumeHint(side: Side, sessionId?: string): string {
  if (!sessionId) return ''
  return side === 'claude' ? `claude --resume ${sessionId}` : `codex resume ${sessionId}`
}

/** The run in progress, so Ctrl+C can mark it stopped and point at its worktree. */
let current: Run | undefined

function onInterrupt(): void {
  live?.stop()
  stopAll()
  console.log()
  say(c.yellow('Stopped.'))
  if (current && current.status !== 'done') {
    current.status = 'stopped'
    saveRun(current)
    say(`The worktree is kept at ${current.worktree}. Remove it with: mc clean ${current.id}`)
  }
  process.exit(130)
}

function banner(root: string | undefined): void {
  console.log()
  console.log(`  ${c.claude('◖')}${c.codex('◗')}  ${c.mc(c.bold('mc'))} ${c.dim(VERSION)}  ${c.bold('Claude')} + ${c.bold('Codex')} on one prompt`)
  console.log(c.dim(`      Each prompt is split in two, built by both at the same time on a new branch, then cross-reviewed.`))
  if (root) console.log(c.dim(`      Repository: ${root}`))
  console.log(c.dim(`      Type what to build · / for commands (Tab completes) · ↑ earlier prompts · Enter on an empty line quits · Ctrl+C stops a run`))
}

function statusLine(root: string, opts: Options): string {
  const branch = tryGit(root, ['symbolic-ref', '--short', 'HEAD']) ?? 'detached'
  return [
    basename(root), branch,
    `review ${opts.review ? 'on' : 'off'}`,
    opts.access === 'full' ? 'full access' : 'edit access',
    ...(opts.planner !== 'claude' ? [`planner ${opts.planner}`] : []),
    ...(opts.yes ? ['auto-start'] : []),
    ...SIDES.filter(side => opts.models[side]).map(side => `${side} ${opts.models[side]}`)
  ].join(' · ')
}

function showCommands(): void {
  const w = Math.max(...COMMANDS.map(cmd => cmd.usage.length)) + 2
  console.log()
  card('Commands', [
    COMMANDS.map(cmd => `${c.mc(cmd.usage.padEnd(w))}${c.dim(cmd.help)}`),
    [c.dim('Anything else you type is a request: Claude and Codex split it and build it together.')]
  ])
}

/** A slash command at the prompt. Returns true to quit. */
async function slash(cmd: Command | { name: 'unknown'; args: string }, root: string, opts: Options): Promise<boolean> {
  try {
    switch (cmd.name) {
      case 'unknown': say(c.yellow(`There's no /${cmd.args}. Type /help for the list.`)); break
      case 'help': showCommands(); break
      case 'list': list(); break
      case 'merge': merge(cmd.args || undefined); break
      case 'clean': clean(cmd.args || undefined); break
      case 'review': opts.review = onOff(cmd.args, opts.review); say(`Cross-review is ${c.bold(opts.review ? 'on' : 'off')}.`); break
      case 'full':
        opts.access = onOff(cmd.args, opts.access === 'full') ? 'full' : 'edit'
        say(opts.access === 'full' ? `${c.yellow('Full access')}: both agents may run any command.` : 'Edit access: file edits plus read-only git and test/build commands.')
        break
      case 'yes': opts.yes = onOff(cmd.args, opts.yes); say(opts.yes ? 'Building starts right after the plan, without asking.' : 'mc asks before building.'); break
      case 'planner':
        if (cmd.args === 'claude' || cmd.args === 'codex') { opts.planner = cmd.args; say(`${NAME[cmd.args]} splits the work.`) }
        else say(c.yellow('Use /planner claude or /planner codex.'))
        break
      case 'model': {
        const [side, name] = cmd.args.split(/\s+/)
        if ((side !== 'claude' && side !== 'codex') || !name) { say(c.yellow('Use /model claude <name> or /model codex <name> (or "default").')); break }
        if (name === 'default') delete opts.models[side]
        else opts.models[side] = name
        say(`${NAME[side]} uses ${c.bold(opts.models[side] ?? 'its default model')}.`)
        break
      }
      case 'status': say(statusLine(root, opts)); break
      case 'clear': process.stdout.write('\x1b[2J\x1b[3J\x1b[H'); banner(root); break
      case 'exit': return true
    }
  } catch (err) {
    say(c.red((err as Error).message))
  }
  return false
}

/** `mc` with no prompt (and how Mission Control opens it): keep asking for the next thing to build. */
async function interactive(opts: Options): Promise<number> {
  const root = repoRoot(process.cwd())
  banner(root)
  if (!root) {
    console.log()
    say(c.yellow('This folder is not a git repository. mc builds on a new branch, so it needs git.'))
    say(c.dim('Turn on git first (in Mission Control: Changes tab → Turn on git, or run git init and make a first commit).'))
    if (process.env.MC_FROM_APP) await ask(c.dim('   Press Enter to close. '))
    return 1
  }
  startSession(complete)
  for (;;) {
    console.log()
    const request = (await promptBox(statusLine(root, opts))).trim()
    if (!request) return 0
    const cmd = parseCommand(request)
    if (cmd) {
      if (await slash(cmd, root, opts)) return 0
      continue
    }
    try {
      await run([request], opts, true)
    } catch (err) {
      live?.stop()
      stopAll()
      say(c.red((err as Error).message))
    }
    current = undefined
  }
}

async function run(requestParts: string[], opts: Options, interactive = false): Promise<number> {
  const request = requestParts.join(' ').trim()
  if (!request) { console.log(HELP); return 1 }
  const root = requireRepo()
  for (const side of SIDES) if (!which(side)) throw new Error(`${side} was not found on PATH. Install it first.`)
  if (!tryGit(root, ['rev-parse', '--verify', 'HEAD'])) throw new Error('This repository has no commits yet. Make a first commit, then run mc.')

  const dirty = (tryGit(root, ['status', '--porcelain']) ?? '').split(/\r?\n/).filter(l => l && !/\.claude\/worktrees\//.test(l))
  if (dirty.length && !opts.yes) {
    say(c.yellow(`You have ${dirty.length} uncommitted change${dirty.length === 1 ? '' : 's'}. The agents start from your last commit, so these are not included.`))
    if (!yes(await ask('   Continue anyway? [Y/n] '))) return 1
  }

  const started = Date.now()
  let id = randomBytes(2).toString('hex')
  while (tryGit(root, ['rev-parse', '--verify', '--quiet', `refs/heads/mc/duo-${id}`])) id = randomBytes(2).toString('hex')
  const costs: AgentResult[] = []
  current = undefined

  // 1. Plan
  heading(`Planning with ${NAME[opts.planner]}`)
  const [planned] = await together('plan', [{
    side: opts.planner,
    go: onEvent => runAgent({ side: opts.planner, cwd: root, prompt: plannerPrompt(request), access: 'plan', model: opts.models[opts.planner], onEvent })
  }])
  costs.push(planned)
  if (!planned.ok) throw new Error(`Planning failed: ${planned.error}`)
  let plan: DuoPlan
  try {
    plan = parseDuoPlan(planned.text)
  } catch (err) {
    say(c.red((err as Error).message))
    block(c.dim(planned.text.slice(0, 1500)))
    return 1
  }
  showPlan(plan)
  if (!opts.yes && !yes(await ask(`${c.mc(c.bold('mc'))}     Start building? [Y/n] `))) { say('Cancelled. Nothing was changed.'); return 1 }

  // 2. Worktree
  const wt = createWorktree(root, id)
  current = { id, request, branch: wt.branch, base: wt.base, baseCommit: wt.baseCommit, worktree: wt.path, root, createdAt: started, status: 'working', sessions: {} }
  saveRun(current)
  say(`Worktree ${c.dim(wt.path)} on branch ${c.bold(wt.branch)}`)

  // 3. Build both halves at the same time
  heading('Building')
  const built = await together('build', SIDES.map(side => ({
    side,
    go: onEvent => runAgent({ side, cwd: wt.path, prompt: workerPrompt(request, plan, side), access: opts.access, model: opts.models[side], onEvent })
  })))
  const work: Record<Side, AgentResult> = { claude: built[0], codex: built[1] }
  costs.push(...built)
  for (const side of SIDES) {
    current.sessions![side] = work[side].sessionId
    if (!work[side].ok) say(c.red(`${NAME[side]} failed: ${work[side].error}`))
    else if (!process.stdout.isTTY) say(`${c[side](NAME[side])} finished its half in ${duration(work[side].ms)}.`)
  }
  if (SIDES.some(side => !work[side].ok)) {
    current.status = 'failed'
    current.error = SIDES.filter(side => !work[side].ok).map(side => `${NAME[side]}: ${work[side].error}`).join('; ')
    saveRun(current)
    say(`Nothing was committed. The worktree is kept at ${wt.path}.`)
    for (const side of SIDES) if (work[side].sessionId) say(c.dim(`Continue ${NAME[side]}: cd "${wt.path}" && ${resumeHint(side, work[side].sessionId)}`))
    say(`Remove it with: mc clean ${id}`)
    return 1
  }

  // 4. Cross-review
  const verdicts: Partial<Record<Side, string>> = {}
  if (opts.review) {
    current.status = 'reviewing'
    saveRun(current)
    heading('Cross-review')
    const reviews = await together('review', SIDES.map(reviewer => {
      const author = other(reviewer)
      return {
        side: reviewer,
        go: (onEvent: (e: AgentEvent) => void) => runAgent({
          side: reviewer, cwd: wt.path, access: opts.access, model: opts.models[reviewer],
          prompt: reviewPrompt(request, plan, reviewer, work[author].text, diffFor(wt.path, wt.baseCommit, plan[author].files)),
          onEvent
        })
      }
    }))
    costs.push(...reviews)
    SIDES.forEach((reviewer, i) => {
      const r = reviews[i]
      const verdict = /verdict:\s*(ok|fixed)/i.exec(r.text)?.[0] ?? (r.ok ? 'Verdict: done' : `failed: ${r.error}`)
      verdicts[reviewer] = verdict
      say(`${c[reviewer](NAME[reviewer])} reviewed ${NAME[other(reviewer)]}'s half: ${r.ok ? verdict : c.red(verdict)}`)
    })
  }

  // 5. Commit
  const changed = changedFiles(wt.path, wt.baseCommit)
  const outside = changed.filter(file => !overlaps([file], [...plan.claude.files, ...plan.codex.files]).length)
  const subject = `mc: ${firstLine(request, 66)}`
  const body = [
    plan.summary,
    '',
    `Claude: ${plan.claude.title}`,
    `Codex: ${plan.codex.title}`,
    ...(opts.review ? ['', `Review of Codex's half by Claude: ${verdicts.claude}`, `Review of Claude's half by Codex: ${verdicts.codex}`] : [])
  ].join('\n')
  const commit = commitAll(wt.path, `${subject}\n\n${body}\n`)
  current.status = 'done'
  current.commit = commit
  saveRun(current)

  // 6. Summary
  const claudeCost = costs.reduce((n, r) => n + (r.costUsd ?? 0), 0)
  const codexTokens = costs.reduce((n, r) => n + (r.tokens ?? 0), 0)
  const spend = `Claude ${claudeCost ? `$${claudeCost.toFixed(2)}` : 'plan usage'} · Codex ${codexTokens ? `${Math.round(codexTokens / 1000)}k tokens` : 'plan usage'}`
  const took = duration(Date.now() - started)
  if (!commit) {
    console.log()
    card(`Nothing to commit · ${took}`, [[c.yellow('The agents made no changes, so nothing was committed.'), c.dim(spend)]], c.yellow)
    removeWorktree(root, current, true)
    deleteRun(root, id)
    return 1
  }
  const inner = cardInner()
  const sections: Section[] = [[
    `${c.green('✓')} Commit ${c.bold(commit)} on ${c.bold(wt.branch)}`,
    ...wrap(tryGit(wt.path, ['diff', '--shortstat', `${wt.baseCommit}..HEAD`])?.trim() ?? '', inner).map(c.dim),
    c.dim(spend)
  ]]
  sections.push(...bySide((side, w) => [
    c[side](c.bold(NAME[side])) + (verdicts[side] ? c.dim(`  ${verdicts[side]}`) : ''),
    ...wrap(firstLine(work[side].text, 400) || plan[side].title, w).slice(0, 4)
  ]))
  if (outside.length) sections.push(wrap(`Changed outside both halves: ${outside.slice(0, 6).join(', ')}${outside.length > 6 ? ', …' : ''}`, inner).map(c.yellow))
  console.log()
  card(`Done · ${took}`, sections, c.green)
  for (const side of SIDES) if (work[side].sessionId) console.log(c.dim(`   Continue ${NAME[side]}: cd "${wt.path}" && ${resumeHint(side, work[side].sessionId)}`))
  if (interactive) return afterRun(root, current)
  say(`See the changes:  git diff ${wt.base}...${wt.branch}`)
  say(`Merge into ${wt.base}:  ${c.bold(`mc merge ${id}`)}   ·   Throw away:  mc clean ${id}`)
  return 0
}

/** In the interactive prompt, a finished run is merged, inspected or thrown away with one key. */
async function afterRun(root: string, r: Run): Promise<number> {
  for (;;) {
    console.log()
    const key = (await ask(`   ${c.bold('m')} merge into ${r.base}  ·  ${c.bold('d')} files changed  ·  ${c.bold('c')} throw away  ·  ${c.dim('Enter keeps it for later')}  `)).trim().toLowerCase()
    try {
      if (key === 'm' || key === 'merge') { merge(r.id); return 0 }
      if (key === 'c' || key === 'clean') { clean(r.id); return 0 }
      if (key === 'd' || key === 'diff') { block(tryGit(root, ['diff', '--stat', `${r.baseCommit}...${r.branch}`]) ?? 'No diff.'); continue }
    } catch (err) {
      say(c.red((err as Error).message))
      return 1
    }
    say(c.dim(`Kept on ${r.branch}. Later: /merge ${r.id} or /clean ${r.id}`))
    return 0
  }
}

function list(): number {
  const root = requireRepo()
  const runs = listRuns(root)
  if (!runs.length) { say('No runs in this repository yet. Start one with: mc "<what to build>"'); return 0 }
  for (const r of runs) {
    const when = new Date(r.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    const status = r.status === 'done' ? c.green(r.status) : r.status === 'failed' || r.status === 'stopped' ? c.red(r.status) : c.yellow(r.status)
    console.log(`  ${c.bold(r.id)}  ${status.padEnd(18)} ${c.dim(when.padEnd(16))} ${firstLine(r.request, 70)}`)
  }
  return 0
}

function merge(id: string | undefined): number {
  const root = requireRepo()
  const r = findRun(root, id ?? '')
  if (!r) throw new Error(id ? `No run ${id}. See mc list.` : 'No runs yet.')
  if (r.status !== 'done') throw new Error(`Run ${r.id} is ${r.status}; only finished runs can be merged. Use mc clean ${r.id} to remove it.`)
  const branch = tryGit(root, ['symbolic-ref', '--short', 'HEAD'])
  say(`Merging ${c.bold(r.branch)} into ${c.bold(branch ?? 'HEAD')}…`)
  try {
    git(root, ['merge', '--no-edit', r.branch])
  } catch (err) {
    say(c.red('The merge stopped. Resolve it with git (git status, then git merge --continue or --abort).'))
    block(c.dim(String((err as { stdout?: string }).stdout ?? (err as Error).message).trim()))
    return 1
  }
  removeWorktree(root, r, false)
  tryGit(root, ['branch', '-d', r.branch])
  r.status = 'merged'
  saveRun(r)
  say(c.green(`Merged. The worktree and branch ${r.branch} are removed.`))
  return 0
}

function clean(id: string | undefined): number {
  const root = requireRepo()
  const r = findRun(root, id ?? '')
  if (!r) throw new Error(id ? `No run ${id}. See mc list.` : 'No runs yet.')
  removeWorktree(root, r, true)
  deleteRun(root, r.id)
  say(`Removed run ${r.id} (worktree and branch ${r.branch}).`)
  return 0
}

async function main(): Promise<number> {
  process.on('SIGINT', onInterrupt)
  const { command, rest, opts } = parse(process.argv.slice(2))
  if (command === 'help') { console.log(HELP); return 0 }
  if (command === 'version') { console.log(`mc ${VERSION}`); return 0 }
  if (command === 'list') return list()
  if (command === 'merge') return merge(rest[0])
  if (command === 'clean') return clean(rest[0])
  if (!rest.length && process.stdin.isTTY) return interactive(opts)
  return run(rest, opts)
}

main().then(code => process.exit(code), err => {
  live?.stop()
  stopAll()
  console.error(`${c.mc(c.bold('mc'))}     ${c.red((err as Error).message)}`)
  process.exit(1)
})
