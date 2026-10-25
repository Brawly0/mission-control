import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ContextUsage, SavedAgent } from '@shared/types'
import type { Agent, LaunchOptions, View } from '../types'
import { onActivity } from '../terminalBus'
import { statusFromHook } from '../agentStatus'
import type { useToast } from '../toast'
import { errorMessage } from '../util'

function loadNotifyPref(): boolean {
  try {
    return localStorage.getItem('mc.notify') !== 'off'
  } catch {
    return true
  }
}

interface AgentsOptions {
  view: View
  setView: (view: View) => void
  toast: ReturnType<typeof useToast>
  /** Chat size (tokens) that triggers the one-time "getting large" toast. */
  warnAt: number
  /** The Write briefing shortcut's keys, quoted in that toast. */
  writeBriefingKey: string
  /** Called when an agent finishes a turn (files probably changed). */
  onTurnDone: () => void
}

/**
 * The open agents (embedded terminals) and everything that tracks them: launching and closing, hook
 * status and notifications, output timing, chat sizes, restore after restart, maximize and tray counts.
 */
export function useAgents({ view, setView, toast, warnAt, writeBriefingKey, onTurnDone }: AgentsOptions) {
  const [agents, setAgents] = useState<Agent[]>([])
  const [activeAgent, setActiveAgent] = useState<string | null>(null)
  const [lastOutput, setLastOutput] = useState<Record<string, number>>({})
  const [notify, setNotify] = useState(loadNotifyPref)
  /** Agents from the last run that haven't been restored or dismissed yet; null until loaded. */
  const [pendingRestore, setPendingRestore] = useState<SavedAgent[] | null>(null)
  const [, setTick] = useState(0)
  // How big each live chat is (by session id), refreshed every few seconds.
  const [contexts, setContexts] = useState<Record<string, ContextUsage>>({})
  const warnedContext = useRef(new Set<string>())

  // Hook events and timers run outside React's render cycle; refs give them current values.
  const agentsRef = useRef(agents)
  agentsRef.current = agents
  const uiRef = useRef({ view, activeAgent, notify })
  uiRef.current = { view, activeAgent, notify }
  const briefingKeyRef = useRef(writeBriefingKey)
  briefingKeyRef.current = writeBriefingKey
  const onTurnDoneRef = useRef(onTurnDone)
  onTurnDoneRef.current = onTurnDone

  useEffect(() => {
    window.mc.loadSavedAgents().then(setPendingRestore)
  }, [])

  useEffect(() => {
    const tick = async () => {
      const live = agentsRef.current.filter((a) => a.kind === 'claude' && !a.exited && a.sessionId)
      if (!live.length) return setContexts((c) => (Object.keys(c).length ? {} : c))
      const next = await window.mc.contextUsage(live.map((a) => a.sessionId!)).catch(() => null)
      if (!next) return
      setContexts(next)
      for (const a of live) {
        const u = next[a.sessionId!]
        if (!u || u.tokens < warnAt || warnedContext.current.has(a.sessionId!)) continue
        warnedContext.current.add(a.sessionId!)
        toast('info', `${a.title} is getting large`, `${Math.round(u.tokens / 1000)}K tokens: each reply re-reads all of it (about $${u.perTurnUsd.toFixed(2)}). Press Compact on the agent to shrink it, or ${briefingKeyRef.current || 'Write briefing'} for a handoff first.`)
      }
    }
    void tick()
    const timer = setInterval(tick, 8000)
    return () => clearInterval(timer)
  }, [warnAt, toast])

  // Track when each terminal last printed output, for agents without hook status.
  useEffect(() => {
    let pendingUpdate: Record<string, number> = {}
    let scheduled = false
    const off = onActivity((id) => {
      pendingUpdate[id] = Date.now()
      if (scheduled) return
      scheduled = true
      setTimeout(() => {
        const batch = pendingUpdate
        pendingUpdate = {}
        scheduled = false
        setLastOutput((prev) => ({ ...prev, ...batch }))
      }, 250)
    })
    const timer = setInterval(() => setTick((t) => t + 1), 1000)
    return () => {
      off()
      clearInterval(timer)
    }
  }, [])

  const focusAgent = useCallback(
    (id: string) => {
      window.mc.focusWindow()
      setView('agents')
      setActiveAgent(id)
    },
    [setView]
  )

  // Exact status from Claude Code hooks, plus desktop notifications.
  useEffect(() => {
    return window.mc.onHookEvent((event) => {
      const agent = agentsRef.current.find((a) => a.id === event.agentId)
      if (!agent || agent.exited) return
      const change = statusFromHook(event, agent.hookStatus)
      setAgents((list) =>
        list.map((a) =>
          a.id !== event.agentId
            ? a
            : {
                ...a,
                sessionId: event.sessionId ?? a.sessionId,
                hookStatus: change?.status ?? a.hookStatus,
                statusAt: change && change.status !== a.hookStatus ? Date.now() : a.statusAt,
                statusMessage: change ? change.message : a.statusMessage
              }
        )
      )
      // A finished turn usually means files changed.
      if (event.event === 'Stop') onTurnDoneRef.current()
      const ui = uiRef.current
      const lookingAtIt = document.hasFocus() && ui.view === 'agents' && ui.activeAgent === agent.id
      if (change?.notify && ui.notify && !lookingAtIt) {
        const body = change.status === 'done' ? 'Finished. Your turn.' : change.message || 'Claude needs your input.'
        const n = new Notification(agent.title, { body, silent: false })
        n.onclick = () => focusAgent(agent.id)
      }
    })
  }, [focusAgent])

  // Remember open agents so they can be reopened after a restart.
  useEffect(() => {
    if (pendingRestore === null) return
    const open: SavedAgent[] = agents
      .filter((a) => !a.exited)
      .map(({ title, cwd, projectName, projectPath, kind, sessionId, worktree }) => ({ title, cwd, projectName, projectPath, kind, sessionId, worktree }))
    window.mc.saveAgents([...pendingRestore, ...open])
  }, [agents, pendingRestore])

  const launch = useCallback(
    async (opts: LaunchOptions) => {
      const kind = opts.kind ?? 'claude'
      const args = opts.args ?? []
      const resumeAt = args.indexOf('--resume')
      const resumedFrom = resumeAt >= 0 ? args[resumeAt + 1] : undefined
      // A chat that's already open as an agent is shown, not started a second time.
      const open = resumedFrom ? agentsRef.current.find((a) => !a.exited && a.sessionId === resumedFrom) : undefined
      if (open) {
        setActiveAgent(open.id)
        setView('agents')
        return { id: open.id, pid: 0, sessionId: open.sessionId }
      }
      try {
        const info = await window.mc.ptySpawn({ cwd: opts.cwd, args: opts.args ?? [], kind, cols: 120, rows: 30 })
        const agent: Agent = {
          id: info.id,
          title: opts.title,
          cwd: opts.cwd,
          projectName: opts.projectName,
          projectPath: opts.projectPath ?? opts.cwd,
          kind,
          sessionId: info.sessionId,
          worktree: opts.worktree,
          exited: false,
          startedAt: Date.now(),
          resumedFrom
        }
        setAgents((a) => [...a, agent])
        setActiveAgent(info.id)
        setView('agents')
        return info
      } catch (e) {
        toast('error', 'Could not start the agent', errorMessage(e))
        return null
      }
    },
    [toast, setView]
  )

  // Live counts for the tray tooltip.
  useEffect(() => {
    const live = agents.filter((a) => !a.exited)
    window.mc.reportStatus({ agents: live.length, attention: live.filter((a) => a.hookStatus === 'needs-input').length })
  }, [agents])

  const restoreAll = useCallback(async () => {
    const saved = pendingRestore ?? []
    setPendingRestore([])
    for (const s of saved) {
      // A session that never got a prompt has no transcript, so it can't be resumed; start fresh.
      const canResume = s.kind === 'claude' && s.sessionId && (await window.mc.sessionExists(s.sessionId))
      await launch({
        cwd: s.cwd,
        projectName: s.projectName,
        projectPath: s.projectPath,
        title: s.title,
        kind: s.kind,
        worktree: s.worktree,
        args: canResume ? ['--resume', s.sessionId!] : []
      })
    }
  }, [pendingRestore, launch])

  const closeAgent = useCallback((id: string) => {
    window.mc.ptyKill(id)
    setAgents((list) => {
      const next = list.filter((a) => a.id !== id)
      setActiveAgent((cur) => (cur === id ? (next[next.length - 1]?.id ?? null) : cur))
      return next
    })
  }, [])

  const renameAgent = useCallback((id: string, title: string) => {
    setAgents((list) => list.map((a) => (a.id === id ? { ...a, title } : a)))
  }, [])

  const markExited = useCallback((id: string, code: number) => {
    setAgents((list) => list.map((a) => (a.id === id ? { ...a, exited: true, exitCode: code } : a)))
  }, [])

  const toggleNotify = useCallback(() => {
    setNotify((cur) => {
      const next = !cur
      try {
        localStorage.setItem('mc.notify', next ? 'on' : 'off')
      } catch {
        /* preference just won't persist */
      }
      return next
    })
  }, [])

  const openSessions = useMemo(() => new Set(agents.filter((a) => !a.exited && a.sessionId).map((a) => a.sessionId!)), [agents])
  // One agent filling the whole window (Maximize); anything that leaves the Agents page restores the layout.
  const [maximizedAgent, setMaximizedAgent] = useState<string | null>(null)
  useEffect(() => {
    if (view !== 'agents' || (maximizedAgent && !agents.some((a) => a.id === maximizedAgent))) setMaximizedAgent(null)
  }, [view, agents, maximizedAgent])

  return {
    agents,
    agentsRef,
    activeAgent,
    setActiveAgent,
    lastOutput,
    contexts,
    notify,
    toggleNotify,
    pendingRestore,
    setPendingRestore,
    restoreAll,
    launch,
    focusAgent,
    closeAgent,
    renameAgent,
    markExited,
    openSessions,
    maximizedAgent,
    setMaximizedAgent
  }
}
