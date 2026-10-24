# 0010: One shortcut registry, terminal-safe rules, rebinding in the app

**Status:** accepted · 2026-10-24

## Decisions

- **One registry.** Every shortcut is defined once in `src/renderer/src/shortcuts.ts`, with an id, label, group and default keys. The cheat sheet, rebinding, tooltips (`withKey`) and the command palette's hints all read from it, so they can't drift apart. A unit test checks that no default combination is used twice.
- **App handles global actions; views handle their own.** `App` maps ids to actions (go to a view, new session, switch agents…). Any id it doesn't handle is broadcast as an `mc:shortcut` window event, and the visible view that owns it reacts through `useShortcutEvent` (ProjectView for tabs and the chat list, AgentsView for Review and rename).
- **Keys are named by physical position** (`event.code`), so `Ctrl+Shift+1` is "1" and not "!", and layouts with different symbols still match.
- **Terminals keep their keys.** In a terminal, plain `Ctrl+letter` belongs to Claude Code and the shell (`Ctrl+C`, `Ctrl+R`, `Ctrl+B`…). Only Alt, Ctrl+Shift, F-key, `Ctrl+Tab`, `Ctrl+digit` and `Ctrl+=`/`Ctrl+-` shortcuts fire there, since terminals can't send those last ones anyway. In text fields, editing keys (`Ctrl+A/C/V/X/Z`, `Ctrl+Enter`, `F2`) stay with the field. While a dialog is open, only the palette shortcut fires.
- **Rebinding lives in the cheat sheet.** Your bindings are stored as `AppSettings.keybindings`. A missing id means the default, and `''` turns a shortcut off. Taking a combination from another shortcut moves that shortcut to its next combination, or turns it off.
- **Light theme by tokens.** All colors are CSS variables. `:root[data-theme='light']` overrides them, plus the few hardcoded diff and scrollbar colors. Terminals stay dark so Claude's colors read the same.
