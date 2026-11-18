# 0048: Keep mc transient frames out of scrollback

Date: 2026-11-18. Status: accepted. Builds on 0046.

## Context

Relative cursor-up clearing cannot recover a live tree or prompt that a resize
has pushed into scrollback. Counting wrapped rows is insufficient after a height
shrink. Readline and the prompt also had competing resize painters, and the
prompt stopped painting borders when input wrapped.

## Decision

- Render live frames and waiting prompts in the alternate terminal buffer using
  absolute positions and synchronized writes. Cap live rows, including the hint,
  at screen height minus one. Repaint immediately on stdout resize.
- Commit permanent events to the normal buffer immediately. Keep a bounded tail
  of 500 transcript lines to show above the transient frame; the terminal retains
  its own full scrollback. Route CLI transcript output through the same writer.
- Readline continues to own editing, completion, history and raw mode. Its output
  is muted while a framed prompt owns the screen. One painter renders the input,
  edges and menu, with a caret-following window for input taller than the pane.
- Stop the timer and remove the resize listener before restoring the normal
  buffer, writing summaries and showing the cursor in one write. Restore input
  listeners afterward. Stop is idempotent; process exit restores the buffer too.
- Page Up exposes native scrollback. Page Down (or another editing key) returns
  to the live frame without losing prompt text. This is necessary because native
  scrolling is unavailable while the alternate buffer is displayed.
- In the app, xterm turns the wheel into ↑↓ on the alternate buffer (which would
  walk prompt history). For mc tabs TerminalPane swallows the wheel there and
  sends Page Up on wheel-up, so scrolling up opens the real scrollback.

## Verification and limits

Screen-emulator regression tests cover tree/line layouts, narrowing, widening,
height changes, wrapped input, slash menus, submission, paste, completion teardown,
EOF, Ctrl+C, cursor restoration, listener cleanup and scrollback browsing. A real
Windows PTY fixture exercises resize, finish, the Done card, menu, wrapped editing
and Ctrl+C without invoking models or changing a repository.

The recent transcript preview clips long historical lines to the current width;
full text remains in normal scrollback. Panes too small for borders show input
only. Rendering remains terminal-dependent where synchronized output is not
implemented. The development server builds, but Electron cannot create its profile
lock in this sandbox and native computer-use connectivity is unavailable, so
physical window/grid dragging was not visually verified.
