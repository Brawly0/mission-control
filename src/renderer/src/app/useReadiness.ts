import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { DEFAULT_GUIDED_SETUP, type GuidedSetupState, type ReadinessResult } from '@shared/readiness'
import type { DiagnosticSnapshot } from '../problems'

type Snapshot = { requestId: string; busy: boolean; result?: ReadinessResult }
export function useReadiness(projectPath: string | null, onError: () => void) {
  const [setup, setSetup] = useState<GuidedSetupState>()
  const [connections, setConnections] = useState<Snapshot>({ requestId: '', busy: false })
  const [projects, setProjects] = useState<Record<string, Snapshot>>({})
  const mounted = useRef(true)
  const slots = useRef<Record<string, string>>({})
  const providers = setup?.providers ?? DEFAULT_GUIDED_SETUP.providers
  const cancel = useCallback((slot?: string) => {
    for (const key of Object.keys(slots.current)) {
      if (slot && key !== slot) continue
      const id = slots.current[key]; delete slots.current[key]
      void window.mc.cancelReadiness(id).catch(() => undefined)
      if (mounted.current) {
        if (key === 'connections') setConnections(s => ({ ...s, busy: false }))
        else setProjects(s => s[key] ? { ...s, [key]: { ...s[key], busy: false } } : s)
      }
    }
  }, [])
  const check = useCallback(async (path?: string) => {
    const slot = path ?? 'connections'
    cancel(slot)
    const requestId = crypto.randomUUID()
    slots.current[slot] = requestId
    const put = (value: Snapshot) => path ? setProjects(s => ({ ...s, [path]: value })) : setConnections(value)
    put({ requestId, busy: true })
    try {
      const result = path ? await window.mc.checkProjectReadiness({ requestId, projectPath: path, requireHistory: true }) : await window.mc.checkConnections({ requestId, providers, force: true })
      if (mounted.current && slots.current[slot] === requestId && result.requestId === requestId) put({ requestId, busy: false, result })
    } catch {
      if (mounted.current && slots.current[slot] === requestId) {
        const now = Date.now()
        put({ requestId, busy: false, result: { requestId, startedAt: now, completedAt: now, outcome: 'unavailable', suggestions: [], checks: [{ id: 'diagnostic', outcome: 'unavailable', reason: 'probe_failed', explanation: 'The check could not finish. Recheck when the tool or folder is available.', action: 'recheck', checkedAt: now }] } })
        onError()
      }
    }
  }, [cancel, providers.join(','), onError])
  const saveQueue = useRef(Promise.resolve())
  const updateSetup = useCallback((patch: Partial<Pick<GuidedSetupState, 'providers' | 'status' | 'step'>>) => {
    saveQueue.current = saveQueue.current.then(async () => {
      try { const next = await window.mc.updateGuidedSetup(patch); if (mounted.current) setSetup(next) } catch { if (mounted.current) onError() }
    })
    return saveQueue.current
  }, [onError])
  useEffect(() => {
    mounted.current = true
    window.mc.getGuidedSetup().then(s => { if (mounted.current) setSetup(s) }).catch(() => { if (mounted.current) onError() })
    return () => { mounted.current = false; cancel() }
  }, [])
  useEffect(() => {
    if (!setup) return
    void check()
    return () => cancel('connections')
  }, [!!setup, providers.join(',')])
  useEffect(() => {
    if (projectPath) void check(projectPath)
    return () => { if (projectPath) cancel(projectPath) }
  }, [projectPath])
  const diagnostics: DiagnosticSnapshot[] = [
    { scope: { kind: 'connections' }, latestRequestId: connections.requestId, result: connections.result },
    ...Object.entries(projects).map(([path, s]) => ({ scope: { kind: 'project' as const, projectPath: path }, latestRequestId: s.requestId, result: s.result }))
  ]
  return { setup, providers, connections, projects, check, cancel, updateSetup, diagnostics }
}
export type ReadinessState = ReturnType<typeof useReadiness>
export const ReadinessContext = createContext<ReadinessState | null>(null)
export function useSharedReadiness() {
  const value = useContext(ReadinessContext)
  if (!value) throw new Error('Readiness provider missing')
  return value
}
