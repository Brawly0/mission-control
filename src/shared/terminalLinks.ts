/** A file path spotted in a line of terminal output, e.g. `src/App.tsx:42:7`. */
export interface FileRef {
  /** Index of the first character in the line. */
  start: number
  /** Index just past the last character. */
  end: number
  path: string
  line?: number
  col?: number
}

// An optional drive, ./, ../ or root, then folders, then a name with a letter-led extension, then :line(:col).
const FILE_RE = /(?:[A-Za-z]:[\\/]|\.{1,2}[\\/]|[\\/])?(?:[\w.@()+-]+[\\/])*[\w@()+-][\w.@()+-]*\.[A-Za-z][A-Za-z0-9]{0,7}(?::(\d+)(?::(\d+))?|\((\d+)(?:,(\d+))?\))?/g

/**
 * File references in one line of output. URLs and bare version-like words are skipped; whether the file
 * really exists is checked separately (the caller asks the main process), so false matches never link.
 */
export function findFileRefs(text: string): FileRef[] {
  const refs: FileRef[] = []
  for (const m of text.matchAll(FILE_RE)) {
    const start = m.index ?? 0
    const before = text[start - 1] ?? ''
    // Part of a URL (https://x/y.md), an email (a@b.com), or a longer word.
    if (/[\w/:@\\.-]/.test(before)) continue
    const raw = m[0]
    const path = raw.replace(/(?::\d+(?::\d+)?|\(\d+(?:,\d+)?\))$/, '')
    if (/^[a-z]+:\/\//i.test(path) || path.length < 3) continue
    if (path.includes('@') && !/[\\/]/.test(path)) continue
    const line = Number(m[1] ?? m[3]) || undefined
    const col = Number(m[2] ?? m[4]) || undefined
    refs.push({ start, end: start + raw.length, path, line, col })
  }
  return refs
}
