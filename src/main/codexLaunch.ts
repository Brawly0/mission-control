import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, sep } from 'node:path'

/** Quick chats use low reasoning without changing the user's Codex configuration. */
export function codexLaunchArgs(cwd: string, args: string[]): string[] {
  const child = relative(join(tmpdir(), 'mission-control-quick-chats'), cwd)
  if (!child || child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) return args
  return ['-c', 'model_reasoning_effort="low"', ...args]
}
