import { app } from 'electron'
import { existsSync, mkdirSync, promises as fs, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { ContextUsage, McpServerInfo, ProjectMeta, StartupReport } from '../shared/types'
import { encodeProjectKey, worktreeParent } from '../shared/projectLook'
import { claudeProjectsDir, normalizePath } from './claudeData'
import { priceFor } from './pricing'
import { loadStore } from './store'

/**
 * "Spend less": how big live chats are, what a new chat carries before you type, and the
 * per-project launch options (default model, which MCP servers load) that cut both.
 * Claude Code's own files and config are only read.
 */

// ---------------------------------------------------------------- project settings for a folder

/** The project a folder belongs to, with its settings: the folder itself, a worktree's project, or the nearest parent with settings. */
export function projectFor(cwd: string): { path: string; meta?: ProjectMeta } {
  const all = loadStore().projectMeta
  const start = worktreeParent(cwd)?.parent ?? cwd
  const own = all[normalizePath(start)] as ProjectMeta | undefined
  if (own) return { path: start, meta: own }
  // A subfolder uses its project's settings, but folders that hold projects (the drive, home,
  // Desktop) never pass theirs down: "C: drive" settings must not apply to everything on C:.
  const home = normalizePath(homedir())
  for (let dir = dirname(start); dirname(dir) !== dir; dir = dirname(dir)) {
    const norm = normalizePath(dir)
    if (norm === home || /\\(desktop|documents|downloads|projects)$/i.test(norm)) break
    const meta = all[norm] as ProjectMeta | undefined
    if (meta) return { path: dir, meta }
  }
  return { path: start }
}

/** Model a new chat or task should use when it doesn't pick one: the project's, then (for tasks) the app's. */
export function defaultModelFor(cwd: string, forTask: boolean): string | undefined {
  return projectFor(cwd).meta?.defaultModel || (forTask ? loadStore().settings.defaultTaskModel : '') || undefined
}

// ---------------------------------------------------------------- MCP servers

interface RawServer {
  name: string
  scope: McpServerInfo['scope']
  config: Record<string, unknown>
}

function readJson(file: string): any {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
}

/** Every MCP server Claude Code would load in this folder from config files (plugins and claude.ai connectors aren't listed). */
function rawServers(projectPath: string): RawServer[] {
  const user = readJson(join(homedir(), '.claude.json')) ?? {}
  const out = new Map<string, RawServer>()
  const add = (servers: unknown, scope: RawServer['scope']) => {
    if (!servers || typeof servers !== 'object') return
    for (const [name, config] of Object.entries(servers as Record<string, Record<string, unknown>>)) out.set(name, { name, scope, config })
  }
  add(user.mcpServers, 'user')
  // ~/.claude.json keys projects by path with forward slashes ("C:/Users/me/app").
  const want = normalizePath(projectPath).replace(/\\/g, '/')
  for (const [p, v] of Object.entries((user.projects ?? {}) as Record<string, any>)) {
    if (normalizePath(p).replace(/\\/g, '/') === want) add(v?.mcpServers, 'local')
  }
  add(readJson(join(projectPath, '.mcp.json'))?.mcpServers, 'project')
  return [...out.values()]
}

export function mcpServers(projectPath: string): McpServerInfo[] {
  const allow = projectFor(projectPath).meta?.mcpAllow
  return rawServers(projectPath).map((s) => {
    const c = s.config as { type?: string; command?: string; args?: string[]; url?: string }
    const kind = c.type ?? (c.url ? 'http' : 'stdio')
    const detail = c.url ?? [c.command, ...(c.args ?? [])].filter(Boolean).join(' ')
    return { name: s.name, scope: s.scope, kind, detail: detail.slice(0, 160), enabled: !allow || allow.includes(s.name) }
  })
}

/**
 * Extra arguments for a claude process started in \`cwd\`: the project's default model for new chats,
 * and, when the project loads only some MCP servers, a config with just those plus --strict-mcp-config.
 */
export function launchArgs(cwd: string, opts: { newChat: boolean; hasModel: boolean; forTask?: boolean }): string[] {
  const args: string[] = []
  if (opts.newChat && !opts.hasModel) {
    const model = defaultModelFor(cwd, !!opts.forTask)
    if (model) args.push('--model', model)
  }
  const { path, meta } = projectFor(cwd)
  if (meta?.mcpAllow) {
    const chosen = Object.fromEntries(rawServers(path).filter((s) => meta.mcpAllow!.includes(s.name)).map((s) => [s.name, s.config]))
    // Kept in the app's own folder (only your Windows account can read it); rewritten on every launch.
    const file = join(app.getPath('userData'), 'mcp', `${encodeProjectKey(path)}.json`)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify({ mcpServers: chosen }, null, 2), 'utf8')
    // "=" form: --mcp-config takes several values, so a prompt after it would be read as another config.
    args.push('--strict-mcp-config', `--mcp-config=${file}`)
  }
  return args
}

// ---------------------------------------------------------------- live chat size

const sessionFileCache = new Map<string, string>()

async function findSessionFile(sessionId: string): Promise<string | null> {
  const hit = sessionFileCache.get(sessionId)
  if (hit && existsSync(hit)) return hit
  if (!/^[\w-]+$/.test(sessionId)) return null
  try {
    for (const key of await fs.readdir(claudeProjectsDir)) {
      const file = join(claudeProjectsDir, key, `${sessionId}.jsonl`)
      if (existsSync(file)) {
        sessionFileCache.set(sessionId, file)
        return file
      }
    }
  } catch {
    /* no Claude data */
  }
  return null
}

/** Context window by model: Haiku and older 4.x models have 200K, current Opus and Sonnet 1M. */
export function contextWindow(model: string): number {
  return /haiku|sonnet-4|opus-4|sonnet-3|opus-3/.test(model) ? 200_000 : 1_000_000
}

/** Context size from Claude's latest reply, read from the end of the chat file. */
async function usageOf(sessionId: string): Promise<ContextUsage | null> {
  const file = await findSessionFile(sessionId)
  if (!file) return null
  const handle = await fs.open(file, 'r')
  try {
    const { size } = await handle.stat()
    const len = Math.min(size, 512 * 1024)
    const buf = Buffer.alloc(len)
    await handle.read(buf, 0, len, size - len)
    const lines = buf.toString('utf8').split('\n')
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].includes('"usage"')) continue
      let e: any
      try {
        e = JSON.parse(lines[i])
      } catch {
        continue
      }
      const u = e?.message?.usage
      if (e.type !== 'assistant' || e.isSidechain || !u || e.message.model === '<synthetic>') continue
      const model = String(e.message.model ?? '')
      const tokens =
        Number(u.input_tokens ?? 0) + Number(u.cache_creation_input_tokens ?? 0) + Number(u.cache_read_input_tokens ?? 0) + Number(u.output_tokens ?? 0)
      const p = priceFor(model)
      const perTurnUsd = (tokens * (p.cacheRead ?? p.input * 0.1)) / 1_000_000
      return { sessionId, tokens, model, window: contextWindow(model), perTurnUsd }
    }
    return null
  } finally {
    await handle.close()
  }
}

export async function contextUsage(sessionIds: string[]): Promise<Record<string, ContextUsage>> {
  const results = await Promise.all(sessionIds.slice(0, 40).map((id) => usageOf(id).catch(() => null)))
  return Object.fromEntries(results.filter((r): r is ContextUsage => !!r).map((r) => [r.sessionId, r]))
}

// ---------------------------------------------------------------- startup cost

/** Rough token count of a text file (about 4 characters per token). */
async function fileTokens(file: string): Promise<number | null> {
  try {
    const st = await fs.stat(file)
    return st.isFile() ? Math.round(st.size / 4) : null
  } catch {
    return null
  }
}

export async function startupReport(
  projectPath: string,
  firstReplies: { tokens: number; model: string }[]
): Promise<StartupReport> {
  const files: StartupReport['files'] = []
  const addFile = async (label: string, path: string) => {
    const tokens = await fileTokens(path)
    if (tokens !== null) files.push({ label, path, tokens })
  }
  await addFile('Your CLAUDE.md (every project)', join(homedir(), '.claude', 'CLAUDE.md'))
  // Claude Code also loads CLAUDE.md from every parent folder.
  const parents: string[] = []
  for (let dir = dirname(projectPath); dirname(dir) !== dir; dir = dirname(dir)) parents.unshift(dir)
  for (const dir of parents) await addFile(`CLAUDE.md in ${dir}`, join(dir, 'CLAUDE.md'))
  await addFile('Project CLAUDE.md', join(projectPath, 'CLAUDE.md'))
  await addFile('Project .claude/CLAUDE.md', join(projectPath, '.claude', 'CLAUDE.md'))
  await addFile('Your private CLAUDE.local.md', join(projectPath, 'CLAUDE.local.md'))
  await addFile('Auto memory (MEMORY.md)', join(claudeProjectsDir, encodeProjectKey(projectPath), 'memory', 'MEMORY.md'))

  let measured: StartupReport['measured']
  if (firstReplies.length) {
    const sorted = [...firstReplies].sort((a, b) => a.tokens - b.tokens)
    const mid = sorted[Math.floor(sorted.length / 2)]
    const p = priceFor(mid.model)
    // The first reply writes the whole context to the cache (1.25x input price).
    measured = { medianTokens: mid.tokens, samples: sorted.length, model: mid.model, firstTurnUsd: (mid.tokens * p.input * 1.25) / 1_000_000 }
  }
  return { measured, files, servers: mcpServers(projectPath), restricted: !!projectFor(projectPath).meta?.mcpAllow }
}
