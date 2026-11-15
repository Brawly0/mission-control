// The My PC advisor's files, kept free of Electron imports so tests can load them.
import type { StoreData } from './store'

export const MY_PC_NAME = 'My PC'
export const MY_PC_LOG = 'PC-LOG.md'
export const MY_PC_PROFILE = 'PC-PROFILE.md'
export const MY_PC_ABOUT = 'ABOUT-ME.md'

export function myPcClaudeMd(home: string, windows: string): string {
  return `# My PC

This folder is my general-purpose workspace for my whole computer, not a code project. You are my **personal PC
advisor**: you know this machine, you know me, and you can reach anything on it.

## Start of every chat

Read these three files in this folder before you answer:

- \`${MY_PC_PROFILE}\`: a snapshot of this PC that Mission Control rewrites (hardware, Windows, drives and free
  space, installed apps, startup apps, network, my projects, the connectors you have). Don't edit it; if it looks
  stale for the question, check the live state instead.
- \`${MY_PC_ABOUT}\`: who I am, what I do and how I like things. **Yours to keep up to date**: when you learn
  something lasting about me (a preference, a goal, my usual tools, things I care about), add it.
- \`${MY_PC_LOG}\`: what you've done and found on this PC before, newest first. Add a dated line after you change
  something or find something worth remembering.

## Your role

- Anything on this PC is in scope: slowness, disk space, apps, settings, files anywhere on any drive, updates,
  drivers, security, networking, backups, what to buy or install, and my projects too.
- Look before you answer: check the real state (PowerShell, \`Get-*\` cmdlets, \`winget\`, file listings) instead of
  guessing. You have access to every drive.
- Explain in plain words what you found and give **one clear recommendation** with its trade-offs. Say how sure you are.
- **Advise first, act second.** Reading and inspecting is fine any time. Before anything that changes the machine
  (deleting, moving or renaming files, installing or uninstalling, settings, registry, services, startup apps,
  drivers), tell me exactly what you'll do and wait for my yes.
- Prefer reversible steps: Recycle Bin over permanent delete, \`winget\` over random installers, disabling a startup
  entry over removing it. Say how to undo what you did.

## Connectors

You have all my MCP connectors (listed in \`${MY_PC_PROFILE}\`; \`/mcp\` shows their status), for example my
Chrome browser, Playwright, web fetch, git, GitHub and memory. Use them whenever they help: look things up,
check a website, read my GitHub, drive the browser. Ask me first before anything that acts in my name outside
this PC: posting, sending messages or email, buying, changing account settings.

## The machine

- Windows ${windows}. Home folder: \`${home}\`. Main shell: PowerShell 5.1; Git Bash is also available.
- Install and update apps with \`winget\` (\`winget upgrade\` lists what's out of date).

## Hard rules

- Don't change anything in \`C:\\Windows\`, \`C:\\Program Files*\` or \`AppData\` unless I ask about something specific there. Reading is fine.
- Never write to \`${home}\\.claude\`.
- Tell me before running anything that needs admin rights; I may have to approve the UAC prompt.
- Never upload my files or personal details anywhere without asking.
`
}

export const LOG_STARTER = `# PC log

What the PC advisor has done or learned on this machine, newest first.

`

export function aboutMeStarter(name: string): string {
  return `# About me

The PC advisor keeps this up to date as it learns about me. I can edit it too.

- Name: ${name || '(ask me)'}
- What I do:
- Main uses of this PC:
- Preferences (how I like answers, apps I prefer, things to avoid):
- Goals:
`
}

/** What the PowerShell survey in myPc.ts returns (all fields optional: a failed probe is just left out). */
export interface PcSurvey {
  computer?: { Manufacturer?: string; Model?: string; Name?: string }
  os?: { Caption?: string; Version?: string; InstallDate?: string; LastBootUpTime?: string; RamGB?: number }
  cpu?: { Name?: string; NumberOfCores?: number; NumberOfLogicalProcessors?: number }[]
  gpu?: { Name?: string; DriverVersion?: string }[]
  drives?: { Name?: string; UsedGB?: number; FreeGB?: number }[]
  apps?: { DisplayName?: string; DisplayVersion?: string; Publisher?: string }[]
  startup?: { Name?: string; Command?: string }[]
  network?: { Name?: string; InterfaceDescription?: string; LinkSpeed?: string }[]
}

const list = <T>(v: T | T[] | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v])

/** PC-PROFILE.md from a survey plus what the app knows (projects, connectors). */
export function pcProfileMarkdown(
  s: PcSurvey,
  extra: { at: Date; home: string; projects: { name: string; path: string; description?: string }[]; connectors: { name: string; kind: string; enabled: boolean }[] }
): string {
  const out: string[] = [
    '# PC profile',
    '',
    `Written by Mission Control on ${extra.at.toISOString().slice(0, 16).replace('T', ' ')} (UTC); refreshed daily. Don't edit: it gets rewritten.`,
    ''
  ]
  const os = s.os ?? {}
  const pc = s.computer ?? {}
  out.push('## Machine', '')
  if (pc.Manufacturer || pc.Model) out.push(`- Computer: ${[pc.Manufacturer, pc.Model].filter(Boolean).join(' ')}${pc.Name ? ` (name: ${pc.Name})` : ''}`)
  if (os.Caption) out.push(`- Windows: ${os.Caption} ${os.Version ?? ''}`.trimEnd())
  if (os.InstallDate) out.push(`- Installed: ${os.InstallDate}`)
  if (os.LastBootUpTime) out.push(`- Last restart: ${os.LastBootUpTime}`)
  for (const c of list(s.cpu)) out.push(`- CPU: ${c.Name?.trim()} (${c.NumberOfCores ?? '?'} cores, ${c.NumberOfLogicalProcessors ?? '?'} threads)`)
  if (os.RamGB) out.push(`- RAM: ${os.RamGB} GB`)
  for (const g of list(s.gpu)) out.push(`- GPU: ${g.Name}${g.DriverVersion ? ` (driver ${g.DriverVersion})` : ''}`)
  out.push(`- Home folder: ${extra.home}`, '')

  const drives = list(s.drives).filter((d) => d.Name)
  if (drives.length) {
    out.push('## Drives', '', '| Drive | Used | Free |', '| --- | --- | --- |')
    for (const d of drives) out.push(`| ${d.Name}: | ${d.UsedGB ?? '?'} GB | ${d.FreeGB ?? '?'} GB |`)
    out.push('')
  }
  const net = list(s.network)
  if (net.length) {
    out.push('## Network (connected adapters)', '')
    for (const n of net) out.push(`- ${n.Name}: ${n.InterfaceDescription ?? ''}${n.LinkSpeed ? `, ${n.LinkSpeed}` : ''}`)
    out.push('')
  }
  const startup = list(s.startup).filter((x) => x.Name)
  if (startup.length) {
    out.push('## Starts with Windows', '')
    for (const x of startup) out.push(`- ${x.Name}${x.Command ? `: \`${x.Command.slice(0, 140)}\`` : ''}`)
    out.push('')
  }
  out.push('## My projects (from Mission Control)', '')
  if (!extra.projects.length) out.push('- (none yet)')
  for (const p of extra.projects) out.push(`- **${p.name}**: \`${p.path}\`${p.description ? `. ${p.description}` : ''}`)
  out.push('')
  out.push('## Connectors (MCP servers)', '')
  if (!extra.connectors.length) out.push('- (none configured)')
  for (const c of extra.connectors) out.push(`- ${c.name} (${c.kind})${c.enabled ? '' : ' (turned off for this folder)'}`)
  out.push('')
  const seen = new Set<string>()
  const apps = list(s.apps)
    .filter((a) => a.DisplayName && !seen.has(a.DisplayName) && seen.add(a.DisplayName))
    .sort((a, b) => a.DisplayName!.localeCompare(b.DisplayName!))
  if (apps.length) {
    out.push(`## Installed apps (${apps.length})`, '')
    for (const a of apps) out.push(`- ${a.DisplayName}${a.DisplayVersion ? ` ${a.DisplayVersion}` : ''}${a.Publisher ? ` (${a.Publisher})` : ''}`)
    out.push('')
  }
  return out.join('\n')
}

/** Store setup steps; bump when adding one so existing installs run it once. */
export const MY_PC_SETUP_VERSION = 2

const norm = (p: string): string => p.replace(/[\\/]+$/, '').toLowerCase()

/**
 * The store side of setting up My PC (`dir`); returns whether anything changed.
 * Every time: My PC is in the project list. Once (by myPcVersion): pin it with the Cpu icon (v1),
 * and fold C:\ into it (v2): chats started in C:\ show under My PC unless they belong to a real
 * project, C:\ leaves the list, and its notes, tags and filed chats move over.
 */
export function applyMyPcSetup(s: Pick<StoreData, 'manualProjects' | 'pinned' | 'projectMeta' | 'chatProjects' | 'mergedProjects' | 'myPcVersion'>, dir: string): boolean {
  const me = norm(dir)
  let changed = false
  if (!s.manualProjects.some((p) => norm(p) === me)) {
    s.manualProjects.push(dir)
    changed = true
  }
  const version = s.myPcVersion ?? 0
  if (version >= MY_PC_SETUP_VERSION) return changed
  if (version < 1) {
    if (!s.pinned.some((p) => norm(p) === me)) s.pinned.unshift(dir)
    const cur = s.projectMeta[me]
    s.projectMeta[me] = { ...cur, icon: cur?.icon ?? 'Cpu', tags: cur?.tags ?? [], notes: cur?.notes ?? '' }
  }
  const drive = norm('C:\\')
  s.mergedProjects = { ...s.mergedProjects, [drive]: dir }
  const from = s.projectMeta[drive]
  if (from) {
    const to = s.projectMeta[me] ?? { tags: [], notes: '' }
    to.tags = [...new Set([...(to.tags ?? []), ...(from.tags ?? [])])]
    if (from.notes?.trim()) to.notes = [to.notes, `From the C: drive project:\n\n${from.notes}`].filter((x) => x?.trim()).join('\n\n')
    s.projectMeta[me] = to
    delete s.projectMeta[drive]
  }
  for (const [id, p] of Object.entries(s.chatProjects)) if (norm(p) === drive) s.chatProjects[id] = dir
  s.manualProjects = s.manualProjects.filter((p) => norm(p) !== drive)
  s.pinned = s.pinned.filter((p) => norm(p) !== drive)
  s.myPcVersion = MY_PC_SETUP_VERSION
  return true
}
