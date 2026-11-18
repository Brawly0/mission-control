import { randomBytes } from 'node:crypto'
import { basename, relative } from 'node:path'
import { runAgent, stopAll, which, type Access, type AgentEvent, type AgentResult } from './agents'
import { COMMANDS, complete, onOff, parseCommand, suggestions, type Command } from './commands'
import { changedFiles, commitAll, createWorktree, deleteRun, diffFor, findRun, git, listRuns, removeWorktree, repoRoot, saveRun, tryGit, type Run } from './git'
import { NAME, SIDES, firstLine, other, overlaps, parseDuoPlan, parseReport, plannerPrompt, reviewPrompt, soloPlan, workerPrompt, workers, type DuoPlan, type Report, type Side, type Teamwork } from './plan'
import { saveSettings, settings } from './settings'
import { resultLines } from './result'
import { AURAS, type Aura } from './tree'
import { Live, ask, block, c, card, cardColumn, cardInner, duration, heading, md, promptBox, say, sideBySide, startSession, tokens, wrap, type Section } from './ui'

const VERSION = '0.4.0'
type Cost = { side: Side; r: AgentResult }
const sessionRuns: Cost[][] = []
/** /new clears only the planner's earlier-request context. */
const earlier: string[] = []

const HELP = `${c.bold('mc')}: one prompt, two agents. Claude and Codex share the work: mc answers questions directly, gives small
changes to one agent and splits bigger ones so both build at the same time. The other agent reviews the result.

${c.bold('Usage')}
  mc                         interactive: keeps asking what to do next
  mc "<what to build or ask>"
  mc list                    runs in this repository
  mc merge [id]              merge a finished run into your current branch and remove its worktree
  mc clean [id]              delete a run's worktree and branch without merging
  mc help | --version

${c.bold('Options')}
  --mode auto|split|claude|codex
                             auto (default): the planner picks answer, one agent, or both
                             split: always two halves · claude/codex: that agent builds alone, no planning step
  --no-review                skip the review step (faster, cheaper)
  --full                     let both agents run any command (Claude bypassPermissions, Codex no sandbox)
  --planner claude|codex     who reads the repo and plans (default: claude)
  --claude-model <model>     model for Claude (default: your Claude Code default)
  --codex-model <model>      model for Codex (default: your Codex default)

${c.bold('How it works')}
  1. The planner reads the repo once (read-only). A question is answered right there; nothing else runs.
  2. Otherwise a new worktree is made on branch mc/duo-<id> from your last commit. Your folder is never touched.
  3. A small change goes to one agent; a bigger one is split into two halves with separate files, built at the
     same time. The builders get what the planner already found, so they don't explore the repo again.
  4. The other agent reviews the diff and fixes real problems (it continues its own session when it built too).
  5. Everything is committed on the branch, with one combined report. Merge it with: mc merge <id>

  By default Claude can edit files and run read-only git plus test/build commands (npm test, npm run, tsc,
  vitest, pytest, go test, cargo); Codex runs in its workspace-write sandbox. Use --full for anything else.`

interface Options {
  review: boolean
  access: Access
  planner: Side
  teamwork: Teamwork
  models: Partial<Record<Side, string>>
}

const TEAMWORK: Teamwork[] = ['auto', 'split', 'claude', 'codex']

function parse(argv: string[]): { command: string; rest: string[]; opts: Options } {
  const opts: Options = { review: true, access: 'edit', planner: 'claude', teamwork: 'auto', models: {} }
  const rest: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const value = () => {
      const v = argv[++i]
      if (!v) throw new Error(`${a} needs a value.`)
      return v
    }
    if (a === '-y' || a === '--yes') continue // accepted for old scripts; mc no longer asks before building
    else if (a === '--no-review') opts.review = false
    else if (a === '--full') opts.access = 'full'
    else if (a === '--mode') {
      const v = value() as Teamwork
      if (!TEAMWORK.includes(v)) throw new Error('--mode must be auto, split, claude or codex.')
      opts.teamwork = v
    } else if (a === '--planner') {
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

/** The agents side by side when the terminal is wide enough, otherwise one under the other. */
function bySide(sides: Side[], lines: (side: Side, width: number) => string[]): Section[] {
  if (sides.length === 2 && sideBySide()) return [{ left: lines(sides[0], cardColumn()), right: lines(sides[1], cardColumn()) }]
  return sides.map(side => lines(side, cardInner()))
}

function showPlan(plan: DuoPlan, opts: Options): void {
  const inner = cardInner()
  const sides = workers(plan)
  const sections: Section[] = [wrap(plan.summary, inner)]
  if (plan.contract) sections.push([c.bold('Shared contract'), ...wrap(plan.contract, inner - 2).map(l => '  ' + l)])
  sections.push(...bySide(sides, (side, w) => [
    c[side](c.bold(NAME[side])) + c.dim(sides.length === 1 ? '  builds it alone' : ''),
    ...wrap(plan.halves[side]!.title, w).map(c.bold),
    ...wrap(plan.halves[side]!.files.join(', '), w).map(c.dim)
  ]))
  if (sides.length === 1) sections.push([c.dim(opts.review ? `${NAME[other(sides[0])]} reviews the diff afterwards.` : 'No review (/review on to add one).')])
  console.log()
  card(sides.length === 2 ? 'Plan · split in two' : 'Plan · one agent', sections)
}

/** Runs agents at the same time under the live status rows. */
let live: Live | undefined
async function together(phase: string, hint: string, jobs: Array<{ side: Side; go: (onEvent: (e: AgentEvent) => void) => Promise<AgentResult> }>): Promise<AgentResult[]> {
  const panel = live = new Live(hint)
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

/** What the run cost, from what each CLI reports: Claude in dollars, Codex in tokens. */
function spend(costs: Array<{ side: Side; r: AgentResult }>): string {
  const mine = (side: Side) => costs.filter(x => x.side === side).map(x => x.r)
  const parts: string[] = []
  const claude = mine('claude'), codex = mine('codex')
  if (claude.length) {
    const usd = claude.reduce((n, r) => n + (r.costUsd ?? 0), 0)
    parts.push(`${c.claude('Claude')} ${claude.some(r => r.costUsd !== undefined) ? `$${usd.toFixed(2)}` : 'plan usage'}`)
  }
  if (codex.length) {
    const total = codex.reduce((n, r) => n + (r.tokens ?? 0), 0)
    const cached = codex.reduce((n, r) => n + (r.cached ?? 0), 0)
    parts.push(`${c.codex('Codex')} ${codex.some(r => r.tokens !== undefined) ? `${tokens(total)} tokens (${total ? Math.round((cached / total) * 100) : 0}% cached)` : 'plan usage'}`)
  }
  return parts.join(c.dim(' · '))
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
  console.log(c.dim(`      Ask a question or describe a change. mc answers it, gives it to one agent, or splits it between both;`))
  console.log(c.dim(`      the other agent reviews. Work happens on a new branch, so your folder is never touched.`))
  if (root) {
    const room = Math.max(20, (process.stdout.columns || 100) - 8)
    console.log(c.dim(`      ${root.length > room ? '…' + root.slice(root.length - room + 1) : root}`))
  }
}

const PROMPT_HINT = '/ for commands · Tab/↑↓ pick · Enter runs · ↑ earlier prompts · paste keeps lines together · Enter on an empty line quits'

function statusLine(root: string, opts: Options): string {
  const branch = tryGit(root, ['symbolic-ref', '--short', 'HEAD']) ?? 'detached'
  const team = opts.teamwork === 'auto' ? 'auto' : opts.teamwork === 'split' ? 'always split' : `${opts.teamwork} only`
  return [
    basename(root), branch, team,
    `review ${opts.review ? 'on' : 'off'}`,
    ...(opts.access === 'full' ? ['full access'] : []),
    ...(opts.planner !== 'claude' ? [`planner ${opts.planner}`] : []),
    ...SIDES.filter(side => opts.models[side]).map(side => `${side} ${opts.models[side]}`)
  ].join(' · ')
}

function showCommands(): void {
  const w = Math.max(...COMMANDS.map(cmd => cmd.usage.length)) + 2
  const inner = cardInner()
  console.log()
  card('Commands', [
    COMMANDS.flatMap(cmd => wrap(cmd.help, Math.max(20, inner - w)).map((l, i) => `${i ? ' '.repeat(w) : c.mc(cmd.usage.padEnd(w))}${c.dim(l)}`)),
    wrap('Anything else you type is a request. Questions get an answer straight away; changes are built on a new branch.', inner).map(c.dim)
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
      case 'mode': {
        const v = cmd.args.toLowerCase() as Teamwork
        if (!TEAMWORK.includes(v)) { say(c.yellow('Use /mode auto, /mode split, /mode claude or /mode codex.')); break }
        opts.teamwork = v
        say(v === 'auto' ? 'mc decides each time: answer, one agent, or both.' : v === 'split' ? 'Every change is split between Claude and Codex.' : `${NAME[v]} builds every change alone, without a planning step${opts.review ? `; ${NAME[other(v)]} reviews` : ''}.`)
        break
      }
      case 'review': opts.review = onOff(cmd.args, opts.review); say(`Review is ${c.bold(opts.review ? 'on' : 'off')}.`); break
      case 'full':
        opts.access = onOff(cmd.args, opts.access === 'full') ? 'full' : 'edit'
        say(opts.access === 'full' ? `${c.yellow('Full access')}: both agents may run any command.` : 'Edit access: file edits plus read-only git and test/build commands.')
        break
      case 'planner':
        if (cmd.args === 'claude' || cmd.args === 'codex') { opts.planner = cmd.args; say(`${NAME[cmd.args]} reads the repo and plans.`) }
        else say(c.yellow('Use /planner claude or /planner codex.'))
        break
      case 'usage': {
        const costs = sessionRuns.flat()
        say(`${sessionRuns.length} runs · ${costs.length} agent calls`)
        say(costs.length ? spend(costs) : 'Claude $0.00 · Codex 0 tokens (0% cached)')
        const last = sessionRuns.at(-1)
        say('Last run: ' + (last ? spend(last) || 'no reported usage' : 'none yet'))
        break
      }
      case 'new': earlier.length = 0; say('Earlier request context cleared. Your next prompt starts fresh.'); break
      case 'version': say('mc ' + VERSION); break
      case 'report': showReport(); break
      case 'model': {
        if (!cmd.args) {
          say(SIDES.map(side => NAME[side] + ': ' + (opts.models[side] ?? 'default')).join(' · '))
          break
        }
        const [side, name] = cmd.args.split(/\s+/)
        if ((side !== 'claude' && side !== 'codex') || !name) { say(c.yellow('Use /model claude <name> or /model codex <name> (or "default").')); break }
        if (name === 'default') delete opts.models[side]
        else opts.models[side] = name
        say(`${NAME[side]} uses ${c.bold(opts.models[side] ?? 'its default model')}.`)
        break
      }
      case 'aura': {
        const v = cmd.args.toLowerCase() as Aura
        if (!AURAS.includes(v)) { say(c.yellow(`Use /aura ${AURAS.join(', ')}. Now: ${settings.aura}.`)); break }
        settings.aura = v
        saveSettings(settings)
        say(v === 'mood' ? 'Aura follows the work: reading blue, editing gold, commands green, web ice blue, errors red. Saved.' : `Aura is ${c.bold(v)}. Saved.`)
        break
      }
      case 'view': {
        if (cmd.args !== 'tree' && cmd.args !== 'lines') { say(c.yellow(`Use /view tree or /view lines. Now: ${settings.view}.`)); break }
        settings.view = cmd.args
        saveSettings(settings)
        say(cmd.args === 'tree' ? 'Agents show as a live tree of boxes while they work. Saved.' : 'Agents show as one status line each. Saved.')
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

/** `mc` with no prompt (and how Mission Control opens it): keep asking for the next thing to do. */
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
    const request = (await promptBox(statusLine(root, opts), PROMPT_HINT, suggestions)).trim()
    if (!request) return 0
    const cmd = parseCommand(request)
    if (cmd) {
      if (await slash(cmd, root, opts)) return 0
      continue
    }
    try {
      await run([request], opts, true, earlier)
    } catch (err) {
      live?.stop()
      stopAll()
      say(c.red((err as Error).message))
    }
    if (earlier.length > 6) earlier.shift()
    current = undefined
  }
}

async function run(requestParts: string[], opts: Options, interactive = false, earlier: string[] = []): Promise<number> {
  const request = requestParts.join(' ').trim()
  if (!request) { console.log(HELP); return 1 }
  const root = requireRepo()
  for (const side of SIDES) if (!which(side)) throw new Error(`${side} was not found on PATH. Install it first.`)
  if (!tryGit(root, ['rev-parse', '--verify', 'HEAD'])) throw new Error('This repository has no commits yet. Make a first commit, then run mc.')
  // Counted for /usage only once the run can actually start.
  const costs: Cost[] = []
  sessionRuns.push(costs)
  const callAgent: typeof runAgent = async options => {
    const r = await runAgent(options)
    costs.push({ side: options.side, r })
    return r
  }
  const remember = (outcome: string) => earlier.push(`${JSON.stringify(firstLine(request, 100))} → ${outcome}`)

  const started = Date.now()
  current = undefined

  // 1. Plan: the planner reads the repo once and decides how much teamwork this needs.
  let plan: DuoPlan
  const solo = opts.teamwork === 'claude' || opts.teamwork === 'codex' ? opts.teamwork : undefined
  if (solo) plan = soloPlan(request, solo)
  else {
    heading('Plan', `${NAME[opts.planner]} reads the repo and decides who does what`)
    const [planned] = await together('plan', 'reading only, nothing is changed', [{
      side: opts.planner,
      go: onEvent => callAgent({ side: opts.planner, cwd: root, prompt: plannerPrompt(request, opts.teamwork, earlier), access: 'plan', model: opts.models[opts.planner], onEvent })
    }])
    if (!planned.ok) throw new Error(`Planning failed: ${planned.error}`)
    try {
      plan = parseDuoPlan(planned.text, opts.teamwork)
    } catch (err) {
      // Don't dead-end on a plan mc can't read: prose is the answer; a broken plan goes to one agent as typed.
      if (!/^\s*(```|\{)/.test(planned.text) && planned.text.trim()) {
        showAnswer(planned.text, `${NAME[opts.planner]} · ${duration(Date.now() - started)} · ${spend(costs)}`)
        remember('answered')
        return 0
      }
      const owner: Side = opts.teamwork === 'split' || opts.teamwork === 'auto' ? 'codex' : opts.teamwork
      say(c.yellow(`${(err as Error).message} ${NAME[owner]} builds it from your request instead.`))
      plan = soloPlan(request, owner)
    }
    if (plan.mode === 'answer') {
      showAnswer(plan.answer, `${NAME[opts.planner]} · ${duration(Date.now() - started)} · ${spend(costs)}`)
      remember(`answered: ${firstLine(plan.summary, 120)}`)
      return 0
    }
    showPlan(plan, opts)
  }

  const dirty = (tryGit(root, ['status', '--porcelain']) ?? '').split(/\r?\n/).filter(l => l && !/\.claude\/worktrees\//.test(l))
  if (dirty.length) say(c.yellow(`Heads-up: ${dirty.length} uncommitted change${dirty.length === 1 ? '' : 's'} in your folder. The agents start from your last commit, so these aren't included.`))
  // No confirmation: building starts right after the plan (Ctrl+C stops it).

  // 2. Worktree
  let id = randomBytes(2).toString('hex')
  while (tryGit(root, ['rev-parse', '--verify', '--quiet', `refs/heads/mc/duo-${id}`])) id = randomBytes(2).toString('hex')
  const wt = createWorktree(root, id)
  current = { id, request, branch: wt.branch, base: wt.base, baseCommit: wt.baseCommit, worktree: wt.path, root, createdAt: started, status: 'working', sessions: {} }
  saveRun(current)
  const where = `on ${wt.branch} · ${relative(root, wt.path).replace(/\\/g, '/')}`

  // 3. Build: one agent, or both halves at the same time.
  const builders = workers(plan)
  heading('Build', builders.length === 2 ? 'Claude and Codex build their halves at the same time' : `${NAME[builders[0]]} builds it`)
  const built = await together('build', where, builders.map(side => ({
    side,
    go: onEvent => callAgent({ side, cwd: wt.path, prompt: workerPrompt(request, plan, side), access: opts.access, model: opts.models[side], onEvent })
  })))
  const work: Partial<Record<Side, AgentResult>> = {}
  builders.forEach((side, i) => { work[side] = built[i]; current!.sessions![side] = built[i].sessionId })
  const failed = builders.filter(side => !work[side]!.ok)
  for (const side of failed) say(c.red(`${NAME[side]} failed: ${work[side]!.error}`))
  if (failed.length) {
    current.status = 'failed'
    current.error = failed.map(side => `${NAME[side]}: ${work[side]!.error}`).join('; ')
    saveRun(current)
    say(`Nothing was committed. The worktree is kept at ${wt.path}.`)
    for (const side of builders) if (work[side]!.sessionId) say(c.dim(`Continue ${NAME[side]}: cd "${wt.path}" && ${resumeHint(side, work[side]!.sessionId)}`))
    say(`Remove it with: mc clean ${id}`)
    remember('failed')
    return 1
  }

  // 4. Review: each author's diff goes to the other agent. A reviewer that also built continues its own session.
  const reviews: Partial<Record<Side, Report>> = {}
  const reviewTexts: string[] = []
  const paths = (side: Side) => (plan.halves[side]!.files.length ? plan.halves[side]!.files : ['.'])
  const toReview = opts.review ? builders.map(author => ({ author, reviewer: other(author), diff: diffFor(wt.path, wt.baseCommit, paths(author)) })).filter(x => x.diff.trim()) : []
  if (toReview.length) {
    current.status = 'reviewing'
    saveRun(current)
    heading('Review', toReview.map(x => `${NAME[x.reviewer]} checks ${NAME[x.author]}'s diff`).join(' · '))
    const results = await together('review', where, toReview.map(({ author, reviewer, diff }) => ({
      side: reviewer,
      go: async (onEvent: (e: AgentEvent) => void) => {
        const session = work[reviewer]?.sessionId
        const fresh = () => callAgent({ side: reviewer, cwd: wt.path, access: opts.access, model: opts.models[reviewer], prompt: reviewPrompt(request, plan, reviewer, work[author]!.text, diff), onEvent })
        if (!session) return fresh()
        const r = await callAgent({ side: reviewer, cwd: wt.path, access: opts.access, model: opts.models[reviewer], resume: session, prompt: reviewPrompt(request, plan, reviewer, work[author]!.text, diff, true), onEvent })
        // If the session can't be continued, review from scratch rather than skip it.
        return r.ok || r.text ? r : fresh()
      }
    })))
    toReview.forEach(({ reviewer }, i) => {
      reviewTexts[i] = results[i].text
      reviews[reviewer] = results[i].ok ? parseReport(results[i].text) : { changed: [], checked: [], notes: [`Review failed: ${results[i].error}`], fixes: [], rest: '' }
    })
  }

  // 5. Commit
  const changed = changedFiles(wt.path, wt.baseCommit)
  const owned = builders.flatMap(side => plan.halves[side]!.files)
  const outside = plan.mode === 'split' ? changed.filter(file => !overlaps([file], owned).length) : []
  const reports: Partial<Record<Side, Report>> = {}
  for (const side of builders) reports[side] = parseReport(work[side]!.text)
  const verdictLine = (reviewer: Side) => {
    const r = reviews[reviewer]
    return r ? `${NAME[reviewer]} reviewed ${NAME[other(reviewer)]}'s work: ${r.verdict ?? 'done'}${r.fixes.length ? ` (${r.fixes.length} fix${r.fixes.length === 1 ? '' : 'es'})` : ''}` : ''
  }
  const body = [
    plan.summary,
    '',
    ...builders.map(side => `${NAME[side]}: ${plan.halves[side]!.title}`),
    ...(toReview.length ? ['', ...toReview.map(x => verdictLine(x.reviewer))] : [])
  ].join('\n')
  const commit = commitAll(wt.path, `mc: ${firstLine(request, 66)}\n\n${body}\n`)
  current.status = 'done'
  current.commit = commit
  saveRun(current)

  // 6. One clear result for the whole run.
  const took = duration(Date.now() - started)
  if (!commit) {
    removeWorktree(root, current, true)
    deleteRun(root, id)
    // A request that turned out to be a question: the builder's reply is the answer.
    const reply = builders.map(side => work[side]!.text.trim()).filter(Boolean).join('\n\n')
    if (reply) {
      showAnswer(reply, `${builders.map(s => NAME[s]).join(' + ')} · ${took} · ${spend(costs)} · nothing was changed`)
      remember('answered, no changes')
      return 0
    }
    console.log()
    card(`Nothing to commit · ${took}`, [[c.yellow('The agents made no changes, so nothing was committed.'), spend(costs)]], c.yellow)
    remember('no changes')
    return 1
  }
  // No question afterwards: the card ends with how to merge, throw away or read everything, then the prompt is back.
  const cmd = interactive ? '/' : 'mc '
  const next = `${cmd}merge ${id} · ${cmd}clean ${id}${interactive ? ' · /report for everything they said' : ` · git diff ${wt.base}...${wt.branch}`}`
  const rel = relative(process.cwd(), wt.path) || '.'
  lastRun = {
    branch: wt.branch, worktree: wt.path,
    replies: [
      ...builders.map(side => ({ side, title: `${NAME[side]} · ${plan.halves[side]!.title}`, text: work[side]!.text })),
      ...toReview.map(({ reviewer, author }, i) => ({ side: reviewer, title: `${NAME[reviewer]} reviewed ${NAME[author]}'s work`, text: reviewTexts[i] ?? '' }))
    ],
    resume: builders.filter(side => work[side]!.sessionId).map(side => `Continue ${NAME[side]}: cd "${rel}" && ${resumeHint(side, work[side]!.sessionId)}`)
  }
  showResult({ plan, builders, reports, reviews, outside, commit, branch: wt.branch, stat: tryGit(wt.path, ['diff', '--shortstat', `${wt.baseCommit}..HEAD`])?.trim() ?? '', took, spend: spend(costs), next })
  remember(`committed on ${wt.branch} (${firstLine(plan.summary, 100)})`)
  return 0
}

/** "3 files changed, 120 insertions(+), 8 deletions(-)" → "3 files +120 −8" */
function shortStat(stat: string): string {
  const n = (re: RegExp) => Number(re.exec(stat)?.[1] ?? 0)
  const files = n(/(\d+) files? changed/)
  return `${files} file${files === 1 ? '' : 's'} ${c.green('+' + n(/(\d+) insertion/))} ${c.red('−' + n(/(\d+) deletion/))}`
}

function showAnswer(text: string, meta: string): void {
  console.log()
  console.log(`${c.mc('●')} ${c.bold('Answer')}  ${c.dim(meta)}`)
  for (const line of md(text, cardInner())) console.log('  ' + line)
}

/** The run's one result, short: the summary, what each agent delivered, checks, review, at most two notes, cost. */
function showResult(o: { plan: DuoPlan; builders: Side[]; reports: Partial<Record<Side, Report>>; reviews: Partial<Record<Side, Report>>; outside: string[]; commit: string; branch: string; stat: string; took: string; spend: string; next: string }): void {
  const inner = cardInner()
  const titles: Partial<Record<Side, string>> = {}
  for (const side of o.builders) titles[side] = o.plan.halves[side]!.title
  const sections: Section[] = [[
    ...wrap(o.plan.summary, inner - 2).map((l, i) => (i ? '  ' : c.green('✓ ')) + l),
    c.dim(`  ${o.branch} · commit ${o.commit}${o.stat ? ' · ' + shortStat(o.stat) : ''}`)
  ], [
    ...resultLines({ builders: o.builders, reports: o.reports, reviews: o.reviews, titles }, inner),
    ...(o.outside.length ? [c.yellow(`Changed outside both halves: ${o.outside.slice(0, 4).join(', ')}${o.outside.length > 4 ? ', …' : ''}`)] : [])
  ], [
    `${o.spend}${c.dim(' · ' + o.took)}`,
    c.dim(o.next)
  ]]
  console.log()
  card(`Done · ${o.took}`, sections, c.green)
}

/** Everything the last run's agents said, for /report: the Done card only shows the short version. */
interface LastRun { branch: string; worktree: string; replies: Array<{ title: string; side: Side; text: string }>; resume: string[] }
let lastRun: LastRun | undefined

function showReport(): void {
  if (!lastRun) { say('No finished run in this session yet.'); return }
  for (const r of lastRun.replies) {
    console.log()
    console.log(`${c[r.side]('●')} ${c.bold(r.title)}`)
    for (const line of md(r.text || '(no reply)', cardInner())) console.log('  ' + line)
  }
  console.log()
  say(c.dim(`Branch ${lastRun.branch} · worktree ${lastRun.worktree}`))
  for (const hint of lastRun.resume) say(c.dim(hint))
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
  console.error(`  ${c.mc(c.bold('mc'))}      ${c.red((err as Error).message)}`)
  process.exit(1)
})
