import { describe, expect, it } from 'vitest'
import { arrangePanels, gridShape } from './panelGrid'

describe('panel layouts', () => {
  it('provides two-row presets and expands rather than losing extra panels', () => {
    expect(gridShape(8, '4x2')).toEqual({ cols: 4, rows: 2 })
    expect(gridShape(16, '8x2')).toEqual({ cols: 8, rows: 2 })
    expect(gridShape(9, '4x2')).toEqual({ cols: 4, rows: 3 })
    expect(gridShape(2, '4x4')).toEqual({ cols: 4, rows: 4 })
    expect(gridShape(64, '8x8')).toEqual({ cols: 8, rows: 8 })
    expect(gridShape(0, 'bad')).toEqual({ cols: 1, rows: 1 })
  })
  it('swaps or inserts in either direction without losing a running panel', () => {
    const ids = ['a', 'b', 'c', 'd']
    expect(arrangePanels(ids, 'a', 'd', 'swap')).toEqual(['d', 'b', 'c', 'a'])
    expect(arrangePanels(ids, 'a', 'c', 'after')).toEqual(['b', 'c', 'a', 'd'])
    expect(arrangePanels(ids, 'd', 'b', 'before')).toEqual(['a', 'd', 'b', 'c'])
    expect(arrangePanels(ids, 'missing', 'b', 'swap')).toEqual(ids)
    expect(ids).toEqual(['a', 'b', 'c', 'd'])
  })
})
