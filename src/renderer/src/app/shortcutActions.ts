import type { Dispatch, SetStateAction } from 'react'
import type { AppSettings, Project } from '@shared/types'
import { briefingFileName, writeBriefingPrompt } from '@shared/projectLook'
import type { Agent, AgentLayout, LaunchOptions, View } from '../types'
import type { useToast } from '../toast'
import { errorMessage } from '../util'
import { sidebarOrder } from '../components/Sidebar'

/** Everything a shortcut can read or do; App passes its current state and actions. */
export interface ShortcutActionContext {
  agents: Agent[]
  activeAgent: string | null
  setActiveAgent: (id: string | null) => void
  selected: Project | null
  selectedPath: string | null
  projects: Project[]
  view: View
  setView: (view: View) => void
  showWorktrees: boolean
  setShowWorktrees: Dispatch<SetStateAction<boolean>>
  setSidebarCollapsed: Dispatch<SetStateAction<boolean>>
  setLayout: Dispatch<SetStateAction<AgentLayout>>
  appSettings: AppSettings | null
  saveSettings: (patch: Partial<AppSettings>) => Promise<void>
  theme: string
  notify: boolean
  toggleNotify: () => void
  toast: ReturnType<typeof useToast>
  openProject: (path: string) => void
  focusAgent: (id: string) => void
  closeAgent: (id: string) => void
  launch: (opts: LaunchOptions) => unknown
  newInSelected: () => void
  launchWorktree: (project: Project) => void
  refreshProjects: () => Promise<void>
  addProject: () => Promise<void>
  toggleEco: () => Promise<void>
  startFromBriefing: () => Promise<void>
  openPalette: () => void
  openShortcuts: () => void
  openSettings: () => void
  openBroadcast: () => void
  openNewProject: () => void
  requestNewNote: () => void
  openComposer: () => void
  openTemplates: () => void
}

/** What each shortcut does. Anything not listed here is handled by the visible view (see useShortcutEvent). */
export function runShortcutAction(id: string, c: ShortcutActionContext): void {
  const { agents, selected, launch, toast, appSettings, saveSettings, setView } = c
  const active = agents.find((a) => a.id === c.activeAgent) ?? agents[agents.length - 1]
  const broadcast = (shortcut: string) => window.dispatchEvent(new CustomEvent('mc:shortcut', { detail: shortcut }))
  const inProject = (shortcut: string) => {
    if (!selected) return
    if (c.view !== 'project') {
      setView('project')
      setTimeout(() => broadcast(shortcut), 50)
    } else broadcast(shortcut)
  }
  const cycleProject = (step: number) => {
    const order = sidebarOrder(c.projects, c.showWorktrees)
    if (!order.length) return
    const i = order.findIndex((p) => p.path === c.selectedPath)
    c.openProject(order[(i + step + order.length) % order.length].path)
  }
  const cycleAgent = (step: number) => {
    if (!agents.length) return
    const i = agents.findIndex((a) => a.id === active?.id)
    c.focusAgent(agents[(i + step + agents.length) % agents.length].id)
  }
  const zoom = (factor: number) => void saveSettings({ uiZoom: Math.round(Math.min(1.6, Math.max(0.7, factor)) * 10) / 10 })
  const handlers: Record<string, () => void> = {
    palette: c.openPalette,
    shortcuts: c.openShortcuts,
    settings: c.openSettings,
    refresh: () => void c.refreshProjects(),
    addProject: () => void c.addProject(),
    notifications: () => {
      c.toggleNotify()
      toast('info', c.notify ? 'Notifications off' : 'Notifications on')
    },
    goHome: () => setView('home'),
    broadcast: () => agents.some((a) => a.kind !== 'shell' && !a.exited) && c.openBroadcast(),
    goInbox: () => setView('inbox'),
    goAgents: () => setView('agents'),
    goTasks: () => setView('tasks'),
    goSearch: () => setView('search'),
    goUsage: () => setView('usage'),
    goProject: () => selected && setView('project'),
    goProjects: () => setView('projects'),
    goNotebook: () => setView('notebook'),
    goKnowledge: () => setView('knowledge'),
    newProject: c.openNewProject,
    newNote: () => {
      setView('notebook')
      c.requestNewNote()
    },
    goSkills: () => setView('skills'),
    toggleEco: () => void c.toggleEco(),
    quickChat: () =>
      void window.mc
        .quickChatFolder()
        .then((folder) => launch({ cwd: folder, projectName: 'Quick chat', projectPath: folder, title: 'Quick chat' }))
        .catch((e) => toast('error', 'Could not start a quick chat', errorMessage(e))),
    prevProject: () => cycleProject(-1),
    nextProject: () => cycleProject(1),
    newSession: () => c.newInSelected(),
    newWorktreeSession: () => selected && c.launchWorktree(selected),
    continueLast: () =>
      selected && launch({ cwd: selected.path, projectName: selected.name, projectPath: selected.path, title: `${selected.name} · continued`, args: ['--continue'] }),
    powershell: () => selected && launch({ cwd: selected.path, projectName: selected.name, projectPath: selected.path, title: `${selected.name} · shell`, kind: 'shell' }),
    pinProject: () => {
      if (!selected) return
      void window.mc.togglePin(selected.path).then(c.refreshProjects)
      toast('info', selected.pinned ? `Unpinned ${selected.name}` : `Pinned ${selected.name}`)
    },
    openExplorer: () => selected && window.mc.openInExplorer(selected.path),
    openVSCode: () => selected && window.mc.openInVSCode(selected.path),
    openTerminal: () => selected && window.mc.openExternalTerminal(selected.path, []),
    nextAgent: () => cycleAgent(1),
    prevAgent: () => cycleAgent(-1),
    closeAgent: () => active && c.closeAgent(active.id),
    toggleGrid: () => c.setLayout((l) => (l === 'tabs' ? 'grid' : 'tabs')),
    compactAgent: () => {
      if (!active || active.kind !== 'claude' || active.exited) return
      window.mc.ptyWrite(active.id, '/compact\r')
      toast('info', `Compacting ${active.title}`, 'Claude summarizes the chat so far and continues from the summary. Mission Control saves that summary as a session briefing.')
    },
    writeBriefing: () => {
      if (!active || active.kind !== 'claude' || active.exited) return
      window.mc.ptyWrite(active.id, writeBriefingPrompt(`docs/briefings/${briefingFileName(Date.now(), active.title).replace(/\.md$/, '')}.md`) + '\r')
      setView('agents')
      c.setActiveAgent(active.id)
      toast('info', `Asked ${active.title} for a briefing`, 'It writes it to docs/briefings/ in its folder.')
    },
    briefingSession: () => void c.startFromBriefing(),
    toggleReview: () => {
      setView('agents')
      setTimeout(() => broadcast('toggleReview'), 50)
    },
    renameAgent: () => {
      setView('agents')
      setTimeout(() => broadcast('renameAgent'), 50)
    },
    newTask: c.openComposer,
    templates: c.openTemplates,
    toggleQueue: () => {
      const on = !appSettings?.queueEnabled
      void saveSettings({ queueEnabled: on })
      toast('info', on ? 'Auto-run queue on' : 'Auto-run queue off')
    },
    toggleSidebar: () => c.setSidebarCollapsed((v) => !v),
    toggleTheme: () => void saveSettings({ theme: c.theme === 'dark' ? 'light' : 'dark' }),
    zoomIn: () => zoom((appSettings?.uiZoom ?? 1) + 0.1),
    zoomOut: () => zoom((appSettings?.uiZoom ?? 1) - 0.1),
    zoomReset: () => zoom(1),
    toggleWorktrees: () => c.setShowWorktrees((v) => !v)
  }
  for (let n = 1; n <= 9; n++) handlers[`agent${n}`] = () => agents[n - 1] && c.focusAgent(agents[n - 1].id)
  for (const t of ['tabOverview', 'tabChats', 'tabChanges', 'tabDocs', 'nameIcon', 'chatFilter', 'chatNext', 'chatPrev', 'chatResume', 'chatRename']) handlers[t] = () => inProject(t)
  ;(handlers[id] ?? (() => broadcast(id)))()
}
