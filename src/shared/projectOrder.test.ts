import { describe, expect, it } from 'vitest'
import { moveProject, orderedProjects } from './projectOrder'
import type { Project } from './types'

describe('project ordering', () => {
  it('moves both ways and retains projects hidden by filters', () => {
    expect(moveProject(['a', 'hidden', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'hidden', 'b'])
    expect(moveProject(['a', 'hidden', 'b', 'c'], 'a', 'b', true)).toEqual(['hidden', 'b', 'a', 'c'])
  })
  it('ignores external and self drops', () => {
    expect(moveProject(['a', 'b'], 'missing', 'b')).toEqual(['a', 'b'])
    expect(moveProject(['a', 'b'], 'a', 'a')).toEqual(['a', 'b'])
  })
  it('keeps saved order ahead of newly discovered projects', () => {
    const projects = [{ path: 'new', lastActivity: 100, meta: {} }, { path: 'b', lastActivity: 10, meta: { sortOrder: 1 } }, { path: 'a', lastActivity: 0, meta: { sortOrder: 0 } }] as Project[]
    expect(orderedProjects(projects).map((p) => p.path)).toEqual(['a', 'b', 'new'])
  })
})
