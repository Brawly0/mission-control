import { existsSync, promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import type { SkillInfo } from '../shared/types'
import { parseFrontmatter } from '../shared/vault'
import { roughTokens } from '../shared/skills'
import { ECO_SKILL } from './ecoPlugin'

/**
 * The Skills page (ADR 0015): every skill Claude Code can load, read from disk. Personal skills
 * in ~/.claude/skills, plugin skills from installed_plugins.json, project skills in each
 * project's .claude/skills, and Mission Control's own eco:coach. Everything is only read.
 */

/** Claude Code lists a skill with its name and (shortened) description in every chat. */
const LISTING_CHARS = 1024

async function readSkill(dir: string, id: string, source: SkillInfo['source'], extra: Partial<SkillInfo> = {}): Promise<SkillInfo | null> {
  const path = join(dir, 'SKILL.md')
  let text: string
  try {
    text = await fs.readFile(path, 'utf8')
  } catch {
    return null
  }
  const { props, body } = parseFrontmatter(text)
  const str = (v: unknown) => (typeof v === 'string' ? v : Array.isArray(v) ? v.join(' ') : '')
  const description = str(props.description) || body.replace(/^#.*$/m, '').trim().split(/\n\s*\n/)[0]?.slice(0, 300) || ''
  const modelInvocable = str(props['disable-model-invocation']).toLowerCase() !== 'true'
  let files = 0
  try {
    files = (await fs.readdir(dir, { recursive: true, withFileTypes: true })).filter((e) => e.isFile()).length
  } catch {
    /* unreadable folder */
  }
  return {
    id,
    name: str(props.name) || basename(dir),
    description,
    source,
    path,
    dir,
    listingTokens: modelInvocable ? roughTokens(`${id}: ${description}`.slice(0, LISTING_CHARS)) : 0,
    bodyTokens: roughTokens(text),
    files,
    modelInvocable,
    ...extra
  }
}

async function skillsIn(root: string, idOf: (folder: string) => string, source: SkillInfo['source'], extra: Partial<SkillInfo> = {}): Promise<SkillInfo[]> {
  let entries
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  // Skills are often links to a folder elsewhere (a cloned repo); follow them.
  const isDir = async (e: (typeof entries)[number]) => e.isDirectory() || (e.isSymbolicLink() && (await fs.stat(join(root, e.name)).then((s) => s.isDirectory(), () => false)))
  const dirs = (await Promise.all(entries.map(async (e) => ((await isDir(e)) ? e.name : null)))).filter((n): n is string => n !== null)
  const found = await Promise.all(dirs.map((name) => readSkill(join(root, name), idOf(name), source, extra)))
  return found.filter((s): s is SkillInfo => s !== null)
}

async function pluginSkills(): Promise<SkillInfo[]> {
  let registry: any
  try {
    registry = JSON.parse(await fs.readFile(join(homedir(), '.claude', 'plugins', 'installed_plugins.json'), 'utf8'))
  } catch {
    return []
  }
  const out: SkillInfo[] = []
  for (const [key, installs] of Object.entries<any>(registry?.plugins ?? {})) {
    const install = Array.isArray(installs) ? installs[0] : installs
    const root = install?.installPath
    if (typeof root !== 'string') continue
    let name = key.split('@')[0]
    try {
      name = JSON.parse(await fs.readFile(join(root, '.claude-plugin', 'plugin.json'), 'utf8')).name || name
    } catch {
      /* no manifest: the registry key names it */
    }
    out.push(...(await skillsIn(join(root, 'skills'), (f) => `${name}:${f}`, 'plugin', { plugin: name })))
  }
  return out
}

export async function listSkills(projectPaths: string[], ecoPluginDir: string): Promise<SkillInfo[]> {
  const personal = skillsIn(join(homedir(), '.claude', 'skills'), (f) => f, 'personal')
  const projects = Promise.all(
    [...new Set(projectPaths)].filter((p) => existsSync(join(p, '.claude', 'skills'))).map((p) => skillsIn(join(p, '.claude', 'skills'), (f) => f, 'project', { projectPath: p }))
  )
  const eco = readSkill(join(ecoPluginDir, 'skills', 'coach'), 'eco:coach', 'mission-control', { plugin: 'eco' })
  const all = [...(await personal), ...(await pluginSkills()), ...(await projects).flat()]
  const own = await eco
  return own ? [own, ...all] : all
}

/** Copies eco:coach into a project as .claude/skills/eco-coach, so chats started outside Mission Control have it too. */
export async function addEcoSkillToProject(projectPath: string): Promise<string> {
  const dir = join(projectPath, '.claude', 'skills', 'eco-coach')
  await fs.mkdir(dir, { recursive: true })
  const file = join(dir, 'SKILL.md')
  await fs.writeFile(file, ECO_SKILL.replace(/^name: coach$/m, 'name: eco-coach').replace(/eco:coach/g, 'eco-coach'), 'utf8')
  return file
}
