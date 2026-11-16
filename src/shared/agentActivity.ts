/**
 * Turns a Claude Code tool call (from the PreToolUse / PostToolUse hooks) into a short line for the
 * activity strip above an agent's terminal, e.g. "Editing App.tsx" or "Running npm test".
 */

export interface ToolActivity {
  /** What the agent is doing: "Editing", "Running", "Searching"... */
  verb: string
  /** What it's doing it to, already shortened for display. May be empty. */
  target: string
  /** The file a tool writes to, when it writes one (full path as Claude gave it). */
  file?: string
}

const MAX_TARGET = 90

function short(text: string, max = MAX_TARGET): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

/** The last part of a path, for either slash. */
export function baseName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? path
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/** Tools that change a file, and the input field holding its path. */
const WRITERS: Record<string, string> = { Edit: 'file_path', MultiEdit: 'file_path', Write: 'file_path', NotebookEdit: 'notebook_path' }

export function describeTool(tool: string, input: unknown): ToolActivity {
  const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  if (WRITERS[tool]) {
    const file = str(i[WRITERS[tool]])
    return { verb: tool === 'Write' ? 'Writing' : 'Editing', target: file ? baseName(file) : '', file: file || undefined }
  }
  switch (tool) {
    case 'Read':
      return { verb: 'Reading', target: baseName(str(i.file_path)) }
    case 'Bash':
    case 'PowerShell':
      return { verb: 'Running', target: short(str(i.command) || str(i.description)) }
    case 'Grep':
      return { verb: 'Searching for', target: short(str(i.pattern), 60) }
    case 'Glob':
      return { verb: 'Finding files', target: short(str(i.pattern), 60) }
    case 'WebFetch':
      return { verb: 'Reading', target: short(str(i.url).replace(/^https?:\/\//, ''), 60) }
    case 'WebSearch':
      return { verb: 'Searching the web for', target: short(str(i.query), 60) }
    case 'Task':
    case 'Agent':
      return { verb: 'Delegating', target: short(str(i.description) || str(i.subagent_type) || 'to a subagent', 60) }
    case 'TodoWrite':
      return { verb: 'Updating the plan', target: '' }
    case 'Skill':
      return { verb: 'Using skill', target: short(str(i.skill) || str(i.command), 40) }
  }
  const mcp = /^mcp__(.+?)__(.+)$/.exec(tool)
  if (mcp) return { verb: `Using ${mcp[1].replace(/[_-]+/g, ' ')}`, target: mcp[2].replace(/_/g, ' ') }
  return { verb: 'Using', target: tool }
}

/** True when a Notification hook is a permission prompt (and not the "waiting for input" reminder). */
export function isPermissionPrompt(message: string | undefined, notificationType?: string): boolean {
  return notificationType === 'permission_prompt' || /permission|approv/i.test(message ?? '')
}
