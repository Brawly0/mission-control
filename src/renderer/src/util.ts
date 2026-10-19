export function timeAgo(ms: number): string {
  if (!ms) return 'never'
  const s = Math.round((Date.now() - ms) / 1000)
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(ms).toLocaleDateString()
}

export function elapsed(since: number): string {
  const s = Math.max(0, Math.round((Date.now() - since) / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function basename(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? p
}

/** Shortens C:\Users\me\... to ~\... for display. */
export function shortPath(p: string): string {
  return p.replace(/^[A-Za-z]:\\Users\\[^\\]+/i, '~')
}

const AVATAR_HUES = [14, 32, 152, 192, 212, 262, 292, 336]

/** A stable color for a project, derived from its name. */
export function avatarHue(name: string): number {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return AVATAR_HUES[h % AVATAR_HUES.length]
}

export function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

/** Strips Electron's "Error invoking remote method 'x': Error:" prefix from IPC errors. */
export function errorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
