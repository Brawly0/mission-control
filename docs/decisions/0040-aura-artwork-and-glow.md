# 0040: Aura artwork and glow finish

Date: 2026-11-12. Status: accepted. Follows ADR 0039 (Aura palette); supersedes the look, not the mechanics, of ADR 0038.

## Context
After the Aura palette shipped (0.32.0), the generated art from ADR 0038 was still navy and cyan, and the UI lacked
the glowing accent edges of the reference design.

## Decision
- **Artwork regenerated with Codex CLI** (`codex exec --image=<reference screenshot>`, built-in image generation), same
  12 files, names and sizes as ADR 0038: near-black base, periwinkle `#668BFF` to violet `#8F7DFF`, glassy objects,
  no cyan, no text. The app icon is a glowing four-point sparkle on a dark glass squircle; its corners were masked to
  transparent (rounded-rect alpha with a 22px glow fade) so it doesn't sit in a black square on the taskbar.
- **`aura.css`** (imported last, dark theme only) adds the finish: primary buttons as dark glass with a glowing accent
  edge, a quieter outlined active nav row, a glowing focused agent cell, blue-violet gradient meters (warn/high keep
  status colors), `--chart-bar` in the accent, and soft focus rings. The focus rule uses `:where()` so fields that set
  `outline: none` keep opting out; wrapped search fields glow on the wrapper instead.

## Consequences
The light theme only changes through the shared art (empty states, icon), which reads fine on light. The Codex prompt
is in `docs/art/aura-codex-prompt.md`; re-running it gives different images each time.
