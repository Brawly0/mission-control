/**
 * Routes PTY output from the main process to the terminal pane that owns it.
 * Output that arrives before a pane has subscribed is buffered so nothing is lost.
 */
type DataHandler = (data: string) => void
type ExitHandler = (code: number) => void

const dataHandlers = new Map<string, DataHandler>()
const exitHandlers = new Map<string, ExitHandler>()
const pending = new Map<string, string[]>()
const activityListeners = new Set<(id: string) => void>()

window.mc.onPtyData((id, data) => {
  activityListeners.forEach((l) => l(id))
  const handler = dataHandlers.get(id)
  if (handler) handler(data)
  else pending.set(id, [...(pending.get(id) ?? []), data])
})

window.mc.onPtyExit((id, code) => exitHandlers.get(id)?.(code))

export function subscribe(id: string, onData: DataHandler, onExit: ExitHandler): () => void {
  dataHandlers.set(id, onData)
  exitHandlers.set(id, onExit)
  const buffered = pending.get(id)
  if (buffered) {
    pending.delete(id)
    buffered.forEach(onData)
  }
  return () => {
    dataHandlers.delete(id)
    exitHandlers.delete(id)
  }
}

/** Called with a terminal id every time that terminal prints something. */
export function onActivity(listener: (id: string) => void): () => void {
  activityListeners.add(listener)
  return () => activityListeners.delete(listener)
}
