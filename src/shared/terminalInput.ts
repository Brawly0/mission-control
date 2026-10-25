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
