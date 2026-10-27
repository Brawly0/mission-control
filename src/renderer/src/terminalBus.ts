/**
 * Routes PTY output from the main process to the terminal panes that show it.
 * A terminal can be shown in more than one place (the Agents grid and the Tasks tab), so output
 * is kept as a capped history that a pane opened later replays. Only one pane per terminal sends
 * input (the one shown last): xterm answers terminal queries itself, and two panes answering
 * would type the reply twice.
 */
type DataHandler = (data: string) => void
type ExitHandler = (code: number) => void

interface Subscriber {
  onData: DataHandler
  onExit: ExitHandler
}

const HISTORY_CHARS = 300_000
const subscribers = new Map<string, Set<Subscriber>>()
const history = new Map<string, string>()
const exits = new Map<string, number>()
const inputOwner = new Map<string, Subscriber>()
const activityListeners = new Set<(id: string) => void>()

window.mc.onPtyData((id, data) => {
  activityListeners.forEach((l) => l(id))
  const next = (history.get(id) ?? '') + data
  // Trim from a line start so the replay doesn't begin inside an escape sequence.
  const cut = next.length > HISTORY_CHARS ? next.indexOf('\n', next.length - HISTORY_CHARS) + 1 : 0
  history.set(id, cut > 0 ? next.slice(cut) : next)
  subscribers.get(id)?.forEach((s) => s.onData(data))
})

window.mc.onPtyExit((id, code) => {
  exits.set(id, code)
  subscribers.get(id)?.forEach((s) => s.onExit(code))
})

/** Shows a terminal: replays what it printed so far, then streams. Returns the pane's handle. */
export function subscribe(id: string, onData: DataHandler, onExit: ExitHandler): { unsubscribe: () => void; claimInput: () => void; ownsInput: () => boolean } {
  const sub: Subscriber = { onData, onExit }
  const set = subscribers.get(id) ?? new Set<Subscriber>()
  subscribers.set(id, set)
  set.add(sub)
  if (!inputOwner.has(id)) inputOwner.set(id, sub)
  const past = history.get(id)
  if (past) onData(past)
  const exited = exits.get(id)
  if (exited !== undefined) onExit(exited)
  return {
    unsubscribe: () => {
      set.delete(sub)
      if (inputOwner.get(id) === sub) {
        const next = set.values().next().value
        if (next) inputOwner.set(id, next)
        else inputOwner.delete(id)
      }
      // A closed agent's terminal is never shown again.
      if (!set.size && exits.has(id)) {
        subscribers.delete(id)
        history.delete(id)
        exits.delete(id)
      }
    },
    claimInput: () => inputOwner.set(id, sub),
    ownsInput: () => inputOwner.get(id) === sub
  }
}

/** Called with a terminal id every time that terminal prints something. */
export function onActivity(listener: (id: string) => void): () => void {
  activityListeners.add(listener)
  return () => activityListeners.delete(listener)
}
