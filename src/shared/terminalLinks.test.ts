import { describe, expect, it } from 'vitest'
import { findFileRefs } from './terminalLinks'

describe('findFileRefs', () => {
  it('finds relative paths with a line and column', () => {
    const line = '  Edited src/renderer/App.tsx:42:7 ok'
    const [ref] = findFileRefs(line)
    expect(ref).toEqual({ start: 9, end: 34, path: 'src/renderer/App.tsx', line: 42, col: 7 })
    expect(line.slice(ref.start, ref.end)).toBe('src/renderer/App.tsx:42:7')
  })

  it('finds Windows paths, ./ paths and bare file names', () => {
    const refs = findFileRefs('see C:\\repo\\src\\x.ts and ./docs/README.md, package.json')
    expect(refs.map((r) => r.path)).toEqual(['C:\\repo\\src\\x.ts', './docs/README.md', 'package.json'])
    expect(findFileRefs('error in main.ts(12,3)')).toEqual([{ start: 9, end: 22, path: 'main.ts', line: 12, col: 3 }])
  })

  it('skips URLs, emails and version numbers', () => {
    expect(findFileRefs('https://github.com/x/y.md')).toEqual([])
    expect(findFileRefs('mail me@site.com')).toEqual([])
    expect(findFileRefs('v0.36.0 released')).toEqual([])
  })
})
