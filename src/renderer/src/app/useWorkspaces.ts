import { useEffect, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import type { Workspace } from '@shared/types'
import type { Agent, AgentLayout, LaunchOptions } from '../types'
import type { useToast } from '../toast'
import { resumeArgs } from '../agentStatus'

interface WorkspacesOptions {
  agents: Agent[]
  agentsRef: MutableRefObject<Agent[]>
  layout: AgentLayout
  setLayout: Dispatch<SetStateAction<AgentLayout>>
  launch: (opts: LaunchOptions) => Promise<unknown>
  toast: ReturnType<typeof useToast>
}

/** Saved sets of agents with their layout, plus the agent grid's column setting (which a workspace restores). */
export function useWorkspaces({ agents, agentsRef, layout, setLayout, launch, toast }: WorkspacesOptions) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [workspacesOpen, setWorkspacesOpen] = useState(false)
  const [agentCols, setAgentColsState] = useState<string>(() => {
    try {
      return JSON.parse(localStorage.getItem('mc.agentCols') ?? '"auto"')
    } catch {
      return 'auto'
    }
  })
  const setAgentCols = (cols: string) => {
    setAgentColsState(cols)
    try {
      localStorage.setItem('mc.agentCols', JSON.stringify(cols))
    } catch {
      /* just won't be remembered */
    }
  }
  useEffect(() => {
    window.mc.listWorkspaces().then(setWorkspaces).catch(() => undefined)
  }, [])

  /** Saves the open agents and the layout under a name (replacing the workspace with `replaceId`). */
  const saveWorkspace = async (name: string, replaceId?: string) => {
    const open = agents
      .filter((a) => !a.exited)
      .map(({ title, cwd, projectName, projectPath, kind, sessionId, worktree }) => ({ title, cwd, projectName, projectPath, kind, sessionId, worktree }))
    setWorkspaces(await window.mc.saveWorkspace({ id: replaceId, name, layout, cols: agentCols, agents: open }))
    toast('success', `Workspace "${name}" saved`, `${open.length} ${open.length === 1 ? 'agent' : 'agents'}. Open it from Agents → Workspaces or the command palette.`)
  }
  /** Reopens a workspace's agents (resuming their chats) in its layout; agents already open are shown, not doubled. */
  const openWorkspace = async (ws: Workspace) => {
    setWorkspacesOpen(false)
    setLayout(ws.layout)
    setAgentCols(ws.cols || 'auto')
    for (const a of ws.agents) {
      // A shell that's still open isn't opened twice (chats are matched by their session in launch).
      if (a.kind === 'shell' && agentsRef.current.some((x) => !x.exited && x.kind === 'shell' && x.title === a.title && x.cwd === a.cwd)) continue
      const canResume = a.kind !== 'shell' && !!a.sessionId && (await window.mc.sessionExists(a.sessionId))
      await launch({ cwd: a.cwd, projectName: a.projectName, projectPath: a.projectPath, title: a.title, kind: a.kind, worktree: a.worktree, args: canResume && a.kind !== 'shell' ? resumeArgs(a.kind, a.sessionId!) : [] })
    }
    toast('success', `Opened "${ws.name}"`, `${ws.agents.length} ${ws.agents.length === 1 ? 'agent' : 'agents'}`)
  }
  const deleteWorkspace = async (id: string) => setWorkspaces(await window.mc.deleteWorkspace(id))

  return { workspaces, workspacesOpen, setWorkspacesOpen, agentCols, setAgentCols, saveWorkspace, openWorkspace, deleteWorkspace }
}
