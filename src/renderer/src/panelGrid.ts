export const gridOptions = [
  ['auto', 'Auto'], ['1', '1 column'], ['2', '2 columns'], ['3', '3 columns'],
  ['4', '4 columns'], ['8', '8 columns'], ['4x2', '4 top + 4 bottom'],
  ['8x2', '8 top + 8 bottom'], ['4x4', '4 × 4'], ['8x8', '8 × 8']
] as const

export function gridShape(count: number, preset: string) {
  const valid = gridOptions.some(([value]) => value === preset) ? preset : 'auto'
  const [width, height] = valid.split('x').map(Number)
  const cols = height ? width : Math.min(Math.max(1, count), valid === 'auto' ? Math.ceil(Math.sqrt(Math.max(1, count))) : width)
  return { cols, rows: Math.max(height || 1, Math.ceil(count / cols)) }
}

export function arrangePanels(ids: string[], source: string, target: string, mode: 'before' | 'after' | 'swap') {
  const result = [...ids], from = ids.indexOf(source), to = ids.indexOf(target)
  if (from < 0 || to < 0 || from === to) return result
  if (mode === 'swap') [result[from], result[to]] = [result[to], result[from]]
  else { result.splice(from, 1); result.splice(result.indexOf(target) + (mode === 'after' ? 1 : 0), 0, source) }
  return result
}
