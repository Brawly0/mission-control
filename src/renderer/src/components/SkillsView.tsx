import { useEffect, useMemo, useState } from 'react'
import { Box, Copy, FolderOpen, Leaf, Play, Puzzle, RefreshCw, Search, Settings2, Sparkles, User, Wand2, X } from 'lucide-react'
import type { EcoSettings, Project, SkillInfo, SkillUse } from '@shared/types'
import { errorMessage, timeAgo } from '../util'
import { useToast } from '../toast'
import NoteMarkdown from './NoteMarkdown'
import { Button, IconButton, MenuButton, Segmented } from './ui'

interface Props {
  visible: boolean
  eco?: EcoSettings
  projects: Project[]
  /** Where "Use in new chat" starts: the open project, or a quick chat. */
  projectName?: string
  onUse: (skillId: string) => void
  onToggleEco: () => void
  onEcoSettings: () => void
}

type Filter = 'all' | 'used' | 'unused' | 'personal' | 'plugin' | 'project'
type Sort = 'uses' | 'name' | 'cost'
const PERIODS = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '0', label: 'All time' }
] as const

const SOURCE: Record<SkillInfo['source'], { label: string; icon: typeof User }> = {
  personal: { label: 'Personal', icon: User },
  plugin: { label: 'Plugin', icon: Puzzle },
  project: { label: 'Project', icon: Box },
  'mission-control': { label: 'Mission Control', icon: Leaf },
  other: { label: 'Built-in or removed', icon: Sparkles }
}

interface Row {
  skill: SkillInfo
  use?: SkillUse
}

function fmtTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n)
}

/** Every skill Claude Code can load: what each does, how often you use it, what it costs in context; plus Eco mode. */
export default function SkillsView({ visible, eco, projects, projectName, onUse, onToggleEco, onEcoSettings }: Props) {
  const toast = useToast()
  const [skills, setSkills] = useState<SkillInfo[] | null>(null)
  const [uses, setUses] = useState<SkillUse[]>([])
  const [period, setPeriod] = useState<string>('30')
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<Sort>('uses')
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)

  const load = () => {
    window.mc.listSkills().then(setSkills).catch(() => setSkills([]))
  }
  useEffect(() => {
    if (visible && skills === null) load()
  }, [visible]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!visible) return
    const since = Number(period) ? Date.now() - Number(period) * 86_400_000 : 0
    window.mc.skillUsage(since).then(setUses).catch(() => setUses([]))
  }, [visible, period])

  // Join skills with their uses; skills used in chats but not on disk show as "not installed here".
  const rows = useMemo<Row[]>(() => {
    const list = skills ?? []
    const byId = new Map(list.map((s) => [s.id.toLowerCase(), s]))
    const out: Row[] = list.map((skill) => ({ skill }))
    const index = new Map(out.map((r) => [r.skill.id.toLowerCase(), r]))
    for (const u of uses) {
      const key = u.skill.toLowerCase()
      const hit = index.get(key) ?? (byId.has(key) ? undefined : out.find((r) => r.skill.source !== 'plugin' && r.skill.name.toLowerCase() === key))
      if (hit) {
        hit.use = hit.use ? { ...hit.use, uses: hit.use.uses + u.uses, byClaude: hit.use.byClaude + u.byClaude, byYou: hit.use.byYou + u.byYou, lastUsed: Math.max(hit.use.lastUsed, u.lastUsed) } : u
      } else {
        out.push({
          skill: { id: u.skill, name: u.skill, description: '', source: 'other', path: '', dir: '', listingTokens: 0, bodyTokens: 0, files: 0, modelInvocable: true },
          use: u
        })
      }
    }
    return out
  }, [skills, uses])

  const q = query.trim().toLowerCase()
  const shown = useMemo(() => {
    const list = rows.filter((r) => {
      if (q && !`${r.skill.id} ${r.skill.description}`.toLowerCase().includes(q)) return false
      if (filter === 'used') return !!r.use
      if (filter === 'unused') return !r.use && r.skill.source !== 'other'
      if (filter === 'personal' || filter === 'plugin' || filter === 'project') return r.skill.source === filter
      return true
    })
    return list.sort((a, b) =>
      sort === 'name'
        ? a.skill.id.localeCompare(b.skill.id)
        : sort === 'cost'
          ? b.skill.listingTokens - a.skill.listingTokens
          : (b.use?.uses ?? 0) - (a.use?.uses ?? 0) || (a.skill.source === 'mission-control' ? -1 : 0) || a.skill.id.localeCompare(b.skill.id)
    )
  }, [rows, q, filter, sort])

  const installed = rows.filter((r) => r.skill.source !== 'other')
  const listing = installed.reduce((s, r) => s + r.skill.listingTokens, 0)
  const totalUses = rows.reduce((s, r) => s + (r.use?.uses ?? 0), 0)
  const unused = installed.filter((r) => !r.use && r.skill.source !== 'mission-control')
  const unusedTokens = unused.reduce((s, r) => s + r.skill.listingTokens, 0)
  const periodLabel = PERIODS.find((p) => p.value === period)!.label.toLowerCase()
  const open = rows.find((r) => r.skill.id === openId) ?? null
  const ecoReady = !!eco?.enabled && !!eco.skill

  const addToProject = async (p: Project) => {
    try {
      const file = await window.mc.addEcoSkillToProject(p.path)
      toast('success', `eco-coach added to ${p.name}`, file)
      load()
    } catch (e) {
      toast('error', 'Could not add the skill', errorMessage(e))
    }
  }

  return (
    <div className="skills-view">
      <div className="skills-main scroll">
        <header className="skills-head">
          <div>
            <h1>
              <Wand2 size={20} /> Skills
            </h1>
            <p className="muted small">
              {skills === null
                ? 'Looking for skills…'
                : `${installed.length} skills · about ${fmtTokens(listing)} tokens in every chat's skill list · ${totalUses} uses in the ${PERIODS.find((p) => p.value === period)!.value === '0' ? 'whole history' : `last ${periodLabel}`}`}
            </p>
          </div>
          <span className="skills-head-actions">
            <Segmented value={period} onChange={setPeriod} options={PERIODS.map((p) => ({ ...p }))} />
            <IconButton icon={RefreshCw} label="Reload" size={14} onClick={load} />
          </span>
        </header>

        <section className={`eco-card ${eco?.enabled ? 'on' : ''}`}>
          <div className="eco-card-icon">
            <Leaf size={22} />
          </div>
          <div className="eco-card-body">
            <h2>
              Eco mode <span className={`eco-pill ${eco?.enabled ? 'on' : ''}`}>{eco?.enabled ? 'On' : 'Off'}</span>
            </h2>
            <p className="muted small">
              Almost all of a long chat's usage is Claude re-reading the chat on every reply. Eco mode makes the chats and tasks Mission Control starts compact sooner, default to a cheaper model, and come with the <code>eco:coach</code> skill. When a chat grows long, Claude is
              told once to suggest compacting or a fresh chat at a good moment.
            </p>
            {eco && (
              <div className="eco-chips">
                <span>{eco.model ? `${eco.model[0].toUpperCase()}${eco.model.slice(1)} by default` : "Claude's default model"}</span>
                <span>{eco.autocompactTokens ? `compact at ${Math.round(eco.autocompactTokens / 1000)}k` : 'default compaction'}</span>
                {eco.effort && <span>{eco.effort} effort</span>}
                <span>{eco.coach ? 'coach on' : 'coach off'}</span>
                <span>{eco.skill ? 'eco:coach skill' : 'no skill'}</span>
              </div>
            )}
          </div>
          <div className="eco-card-actions">
            <Button variant={eco?.enabled ? 'secondary' : 'primary'} icon={Leaf} onClick={onToggleEco}>
              {eco?.enabled ? 'Turn off' : 'Turn on'}
            </Button>
            <Button variant="ghost" icon={Settings2} onClick={onEcoSettings}>
              Settings
            </Button>
            <Button
              variant="ghost"
              icon={Play}
              disabled={!ecoReady}
              title={ecoReady ? `Starts a chat in ${projectName ?? 'a quick chat'} with /eco:coach` : 'Turn on Eco mode (with the skill) first'}
              onClick={() => onUse('eco:coach')}
            >
              Try /eco:coach
            </Button>
            <MenuButton
              align="right"
              trigger={(toggle) => (
                <Button variant="ghost" icon={Box} onClick={toggle} title="Copies the skill into a project's .claude/skills, so chats started outside Mission Control have it too">
                  Add to a project…
                </Button>
              )}
              items={projects
                .filter((p) => !p.worktree)
                .slice(0, 30)
                .map((p) => ({ label: p.name, icon: Box, onSelect: () => void addToProject(p) }))}
            />
          </div>
        </section>

        {unused.length > 0 && (
          <div className="skills-tip">
            <Sparkles size={14} />
            <span>
              <span className="strong">{unused.length} skills</span> weren't used in the {period === '0' ? 'whole history' : `last ${periodLabel}`}. Together they add about {fmtTokens(unusedTokens)} tokens to every chat. Remove the ones you don't need from <code>~/.claude/skills</code> or with{' '}
              <code>/plugin</code>; Mission Control only reads them.
            </span>
            <button className="link-btn" onClick={() => setFilter('unused')}>
              Show them
            </button>
          </div>
        )}

        <div className="skills-toolbar">
          <div className="vault-search skills-search">
            <Search size={13} />
            <input placeholder="Find a skill" value={query} onChange={(e) => setQuery(e.target.value)} />
            {query && <IconButton icon={X} label="Clear" size={12} onClick={() => setQuery('')} />}
          </div>
          <Segmented
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: 'All' },
              { value: 'used', label: 'Used' },
              { value: 'unused', label: 'Unused' },
              { value: 'personal', label: 'Personal' },
              { value: 'plugin', label: 'Plugins' },
              { value: 'project', label: 'Projects' }
            ]}
          />
          <select className="select" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="uses">Most used</option>
            <option value="cost">Context cost</option>
            <option value="name">Name</option>
          </select>
        </div>

        <div className="skills-list">
          {shown.map(({ skill, use }) => {
            const src = SOURCE[skill.source]
            return (
              <button key={`${skill.source}:${skill.id}:${skill.projectPath ?? ''}`} className={`skill-row ${openId === skill.id ? 'selected' : ''}`} onClick={() => setOpenId(skill.id === openId ? null : skill.id)}>
                <span className={`skill-icon src-${skill.source}`}>
                  <src.icon size={15} />
                </span>
                <span className="skill-text">
                  <span className="skill-name">
                    <span className="mono">/{skill.id}</span>
                    <span className="skill-badge">{skill.source === 'project' && skill.projectPath ? projects.find((p) => p.path === skill.projectPath)?.name ?? 'Project' : src.label}</span>
                    {!skill.modelInvocable && <span className="skill-badge">only you start it</span>}
                  </span>
                  <span className="skill-desc muted">{skill.description || (skill.source === 'other' ? 'Used in your chats but not in your skill folders: built into Claude Code, or removed since.' : 'No description.')}</span>
                </span>
                <span className="skill-stats">
                  {use ? (
                    <>
                      <span className="strong">{use.uses} use{use.uses === 1 ? '' : 's'}</span>
                      <span className="muted tiny">
                        {use.byClaude > 0 && `Claude ${use.byClaude}`}
                        {use.byClaude > 0 && use.byYou > 0 && ' · '}
                        {use.byYou > 0 && `you ${use.byYou}`} · {timeAgo(use.lastUsed)}
                      </span>
                    </>
                  ) : (
                    <span className="muted small">{skill.source === 'other' ? '' : 'Not used'}</span>
                  )}
                  {skill.listingTokens > 0 && <span className="muted tiny">~{fmtTokens(skill.listingTokens)} tokens per chat</span>}
                </span>
              </button>
            )
          })}
          {skills !== null && !shown.length && <div className="muted pad">No skills match.</div>}
        </div>
      </div>

      {open && <SkillDetail row={open} projectName={projectName} onUse={onUse} onClose={() => setOpenId(null)} />}
    </div>
  )
}

/** One skill: where it lives, how it's used, and its SKILL.md. */
function SkillDetail({ row, projectName, onUse, onClose }: { row: Row; projectName?: string; onUse: (id: string) => void; onClose: () => void }) {
  const toast = useToast()
  const { skill, use } = row
  const [text, setText] = useState('')
  useEffect(() => {
    setText('')
    if (skill.path) window.mc.readDoc(skill.path).then(setText).catch(() => setText('*Could not read SKILL.md.*'))
  }, [skill.path])

  return (
    <aside className="skill-detail">
      <div className="skill-detail-head">
        <span className="mono strong ellipsis">/{skill.id}</span>
        <IconButton icon={X} label="Close" size={14} onClick={onClose} />
      </div>
      <div className="skill-detail-actions">
        <Button size="sm" variant="primary" icon={Play} onClick={() => onUse(skill.id)} title={`Starts a new chat in ${projectName ?? 'a quick chat'} with /${skill.id}`}>
          Use in new chat
        </Button>
        <IconButton
          icon={Copy}
          label="Copy /name"
          size={14}
          onClick={() => {
            void navigator.clipboard.writeText(`/${skill.id}`)
            toast('success', 'Copied', `/${skill.id}`)
          }}
        />
        {skill.dir && <IconButton icon={FolderOpen} label="Open folder" size={14} onClick={() => window.mc.openInExplorer(skill.dir)} />}
      </div>
      <dl className="skill-facts">
        <dt>Source</dt>
        <dd>{SOURCE[skill.source].label}{skill.plugin ? ` · ${skill.plugin}` : ''}</dd>
        {skill.dir && (
          <>
            <dt>Folder</dt>
            <dd className="mono tiny ellipsis" title={skill.dir}>
              {skill.dir}
            </dd>
          </>
        )}
        <dt>Used</dt>
        <dd>{use ? `${use.uses}× in ${use.chats} chat${use.chats === 1 ? '' : 's'} (Claude ${use.byClaude}, you ${use.byYou}), last ${timeAgo(use.lastUsed)}` : 'Not in this period'}</dd>
        {skill.path && (
          <>
            <dt>Context</dt>
            <dd>
              {skill.modelInvocable ? `~${fmtTokens(skill.listingTokens)} tokens in every chat's skill list` : "Not listed: only you can start it, so it costs nothing until you do"}; ~{fmtTokens(skill.bodyTokens)} when used · {skill.files} file{skill.files === 1 ? '' : 's'}
            </dd>
          </>
        )}
      </dl>
      {skill.path ? (
        <div className="markdown skill-md scroll">
          <NoteMarkdown text={text} />
        </div>
      ) : (
        <p className="muted small pad">This skill isn't on this computer's disk. It's built into Claude Code, or it came from a plugin or folder that's since been removed.</p>
      )}
    </aside>
  )
}
