/**
 * What to type into an agent's terminal to send a prompt. A prompt with line breaks goes in as one
 * bracketed paste, so Claude Code takes it as one message instead of sending at the first line
 * break; Enter (\r) then submits it, unless `submit` is false.
 */
export function promptInput(text: string, submit = true): string {
  const t = text.replace(/\r\n/g, '\n').trim()
  if (!t) return ''
  const body = t.includes('\n') ? `\x1b[200~${t.replace(/\n/g, '\r')}\x1b[201~` : t
  return submit ? `${body}\r` : body
}

/** How long to wait between typing a prompt and pressing Enter (see sendPrompt). */
export const SUBMIT_DELAY_MS = 250

/**
 * Types a prompt into an agent and, unless `submit` is false, presses Enter a moment later as its own
 * keystroke. Claude Code and Codex treat a long burst of input as a paste, and an Enter inside that
 * burst becomes a line break in the input box instead of sending, so the prompt sat there until you
 * pressed Enter yourself. Returns false when there was nothing to send.
 */
export function sendPrompt(write: (data: string) => void, text: string, submit = true, delayMs = SUBMIT_DELAY_MS): boolean {
  const body = promptInput(text, false)
  if (!body) return false
  write(body)
  if (submit) setTimeout(() => write('\r'), delayMs)
  return true
}
