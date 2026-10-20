export interface FileDiff {
  path: string
  lines: string[]
  added: number
  removed: number
}

/** Splits a unified diff into per-file chunks, counting added and removed lines. */
export function parseDiff(diff: string): FileDiff[] {
  const files: FileDiff[] = []
  let current: FileDiff | null = null
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const m = line.match(/ b\/(.+)$/)
      current = { path: m ? m[1] : line, lines: [], added: 0, removed: 0 }
      files.push(current)
      continue
    }
    if (!current) continue
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('index ')) continue
    if (/^(new|deleted) file mode|^similarity index|^rename (from|to)|^new file$/.test(line)) continue
    if (line.startsWith('+')) current.added++
    else if (line.startsWith('-')) current.removed++
    current.lines.push(line)
  }
  return files
}
