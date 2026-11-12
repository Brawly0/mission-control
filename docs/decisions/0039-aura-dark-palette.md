# 0039: Aura dark palette

Date: 2026-11-12. Status: accepted.

## Context
The dark theme used a navy base with an electric-cyan accent. The new reference look ("Aura") is a near-black,
neutral base with a periwinkle-blue accent and blue-to-violet gradients.

## Decision
Replace the dark-theme tokens with the Aura palette. The light theme is unchanged.

| Role | Token(s) | Value |
| --- | --- | --- |
| background | `--bg` (`--bg-sidebar` one step up) | `#050507` |
| surface | `--surface`, `--hd-panel` | `#0D0E13` |
| elevated | `--surface-2` | `#151720` |
| border | `--border`, `--hd-line` | `#262936` |
| accent | `--accent` (gradient partner `#8F7DFF`) | `#668BFF` |
| text | `--text` | `#F4F4F8` |
| muted | `--muted` | `#858594` |
| success | `--green` | `#5ED5B0` |
| warning | `--orange` | `#E8B36C` |
| danger | `--red` | `#E47D8E` |

Hard-coded status tints (`rgba(...)` of the old green/orange/red/blue/yellow/cyan) in dark rules were re-pointed to
the new hues, and the xterm theme, scrollbars and Home hero overlay follow the new base.

## Consequences
The generated art (`art/bg-texture.webp`, `art/hero-banner.webp`, ADR 0038) was painted for the navy base and may
read slightly blue against the near-black; regenerate if it clashes.
