import type { Project } from './types'

export function orderedProjects(projects: Project[]): Project[] {
  return [...projects].sort((a, b) => (a.meta.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.meta.sortOrder ?? Number.MAX_SAFE_INTEGER) || Number(!!b.pinned) - Number(!!a.pinned) || Number(a.meta.status === 'done') - Number(b.meta.status === 'done') || b.lastActivity - a.lastActivity)
}

/** Move within the complete list, so filtering never drops hidden projects. */
export function moveProject(paths: string[], source: string, target: string, after = false): string[] {
  if (source === target || !paths.includes(source) || !paths.includes(target)) return paths
  const next = paths.filter((p) => p !== source)
  next.splice(next.indexOf(target) + Number(after), 0, source)
  return next
}
