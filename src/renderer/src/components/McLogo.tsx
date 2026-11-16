import type { LucideIcon } from 'lucide-react'

/**
 * The mc logo: two linked rings, Claude's warm orange and Codex's blue, with the shared part lit violet
 * where their work meets (ADR 0042). Same props as a lucide icon, so it fits buttons and menus.
 */
export function McLogo({ size = 16, className = '' }: { size?: number | string; strokeWidth?: number; className?: string }) {
  return (
    <svg className={`mc-logo ${className}`} width={size} height={size} viewBox="0 0 24 24" role="img" aria-label="mc" focusable="false">
      <path className="mc-logo-meet" d="M12 6.94A6.1 6.1 0 0 1 12 17.06A6.1 6.1 0 0 1 12 6.94Z" />
      <circle className="mc-logo-claude" cx="8.6" cy="12" r="6.1" />
      <circle className="mc-logo-codex" cx="15.4" cy="12" r="6.1" />
    </svg>
  )
}

/** For components that take a lucide icon (Button, MenuButton items). */
export const McIcon = McLogo as unknown as LucideIcon

/** Badge shown on mc terminals, next to the Claude and Codex badges. */
export function McBadge() {
  return (
    <span className="tool-badge tool-mc" title="mc: Claude and Codex on one prompt">
      <McLogo size={11} />mc
    </span>
  )
}
