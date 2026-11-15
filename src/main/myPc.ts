import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, promises as fs, statSync, writeFileSync } from 'node:fs'
import { homedir, release } from 'node:os'
import { join } from 'node:path'
import { listProjects, normalizePath } from './claudeData'
import { invalidateKnowledge, userName } from './hub'
import { mcpServers } from './spend'
import { updateStore } from './store'
import {
  aboutMeStarter,
  applyMyPcSetup,
  LOG_STARTER,
  MY_PC_ABOUT,
  MY_PC_LOG,
  MY_PC_NAME,
  MY_PC_PROFILE,
  myPcClaudeMd,
  pcProfileMarkdown,
  type PcSurvey
} from './myPcTemplate'

/**
 * "My PC": one permanent workspace for general computer help that isn't about any project.
 * Claude acts as a personal advisor there: it knows the machine (PC-PROFILE.md, refreshed daily),
 * knows you (ABOUT-ME.md, which it keeps up to date), reaches every drive and all MCP connectors,
 * and only changes things after you say yes. The old "C: drive" project is folded into it.
 * See docs/decisions/0041-my-pc-advisor.md.
 */
export function myPcPath(): string {
  return join(homedir(), MY_PC_NAME)
}

const PROFILE_MAX_AGE_MS = 24 * 60 * 60_000

/**
 * Creates the folder and its CLAUDE.md and log if missing, and applies the one-time store setup:
 * add to the sidebar, pin with the Cpu icon, and fold the C:\ project (its chats, notes and tags)
 * into My PC. Files that exist are never overwritten. Synchronous and cheap: safe at startup.
 */
export function prepareMyPc(): string {
  const dir = myPcPath()
  mkdirSync(dir, { recursive: true })
  const claudeMd = join(dir, 'CLAUDE.md')
  if (!existsSync(claudeMd)) writeFileSync(claudeMd, myPcClaudeMd(homedir(), release()), 'utf8')
  const log = join(dir, MY_PC_LOG)
  if (!existsSync(log)) writeFileSync(log, LOG_STARTER, 'utf8')
  let changed = false
  updateStore((s) => {
    changed = applyMyPcSetup(s, dir)
  })
  if (changed) invalidateKnowledge()
  return dir
}

/** Root folders of the drives on this PC (C:\, D:\ …), for --add-dir. */
export function driveRoots(): string[] {
  const roots: string[] = []
  for (let c = 67; c <= 90; c++) {
    const root = `${String.fromCharCode(c)}:\\`
    try {
      if (statSync(root).isDirectory()) roots.push(root)
    } catch {
      /* no such drive */
    }
  }
  return roots.length ? roots : [homedir()]
}

/** Everything a My PC chat needs: the folder (set up, with fresh-enough files) and the folders it may reach. */
export async function ensureMyPc(): Promise<{ path: string; dirs: string[] }> {
  const dir = prepareMyPc()
  const about = join(dir, MY_PC_ABOUT)
  if (!existsSync(about)) writeFileSync(about, aboutMeStarter(await userName().catch(() => '')), 'utf8')
  const profile = join(dir, MY_PC_PROFILE)
  // A first chat waits for the profile; after that a stale one refreshes in the background.
  if (!existsSync(profile)) await refreshPcProfile().catch(() => undefined)
  else void refreshPcProfileIfStale()
  return { path: dir, dirs: driveRoots() }
}

export async function refreshPcProfileIfStale(): Promise<void> {
  try {
    const st = await fs.stat(join(myPcPath(), MY_PC_PROFILE))
    if (Date.now() - st.mtimeMs < PROFILE_MAX_AGE_MS) return
  } catch {
    /* missing: write it */
  }
  await refreshPcProfile()
}

// Read-only probes. Each is wrapped so one failing (no permission, missing cmdlet) leaves only its field out.
const SURVEY = String.raw`
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$ErrorActionPreference = 'SilentlyContinue'
$r = @{}
$cs = Get-CimInstance Win32_ComputerSystem
$r.computer = @{ Manufacturer = $cs.Manufacturer; Model = $cs.Model; Name = $cs.Name }
$os = Get-CimInstance Win32_OperatingSystem
if ($os) { $r.os = @{ Caption = $os.Caption; Version = $os.Version; InstallDate = $os.InstallDate.ToString('yyyy-MM-dd'); LastBootUpTime = $os.LastBootUpTime.ToString('yyyy-MM-dd HH:mm'); RamGB = [math]::Round($os.TotalVisibleMemorySize / 1MB, 1) } }
$r.cpu = @(Get-CimInstance Win32_Processor | Select-Object Name, NumberOfCores, NumberOfLogicalProcessors)
$r.gpu = @(Get-CimInstance Win32_VideoController | Select-Object Name, DriverVersion)
$r.drives = @(Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Used -ne $null } | ForEach-Object { @{ Name = $_.Name; UsedGB = [math]::Round($_.Used / 1GB); FreeGB = [math]::Round($_.Free / 1GB) } })
$keys = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'
$r.apps = @(Get-ItemProperty $keys | Where-Object { $_.DisplayName -and -not $_.SystemComponent -and -not $_.ParentKeyName } | Select-Object DisplayName, DisplayVersion, Publisher)
$r.startup = @(Get-CimInstance Win32_StartupCommand | Select-Object Name, Command)
$r.network = @(Get-NetAdapter -Physical | Where-Object Status -eq 'Up' | Select-Object Name, InterfaceDescription, LinkSpeed)
$r | ConvertTo-Json -Depth 4 -Compress
`

function survey(): Promise<PcSurvey> {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SURVEY],
      { timeout: 90_000, maxBuffer: 32 * 1024 * 1024, windowsHide: true, encoding: 'utf8' },
      (_err, stdout) => {
        try {
          resolve(JSON.parse(stdout.trim().replace(/^\uFEFF/, '')) as PcSurvey)
        } catch {
          resolve({})
        }
      }
    )
  })
}

let refreshing: Promise<void> | null = null

/** Rewrites PC-PROFILE.md from a fresh survey and the app's projects and connectors. */
export function refreshPcProfile(): Promise<void> {
  refreshing ??= (async () => {
    const dir = myPcPath()
    const [s, projects] = await Promise.all([survey(), listProjects().catch(() => [])])
    const md = pcProfileMarkdown(s, {
      at: new Date(),
      home: homedir(),
      projects: projects
        .filter((p) => !p.worktree && normalizePath(p.path) !== normalizePath(dir))
        .map((p) => ({ name: p.name, path: p.path, description: p.description })),
      connectors: mcpServers(dir).map((c) => ({ name: c.name, kind: c.kind, enabled: c.enabled }))
    })
    await fs.writeFile(join(dir, MY_PC_PROFILE), md, 'utf8')
  })().finally(() => {
    refreshing = null
  })
  return refreshing
}
