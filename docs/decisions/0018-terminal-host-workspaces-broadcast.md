# 0018: Terminals in their own process, workspaces, and sending to several agents

**Status:** accepted · 2026-10-25

## Context

A self-test run froze for good while quitting with seven busy terminals. Investigation showed this:
- The stuck process sat at 0% CPU with no sockets open. Its last child was a `conhost.exe --headless --width 100 --height 20`, the pseudo console of one of the test's flooding terminals.
- node-pty's Windows `kill()` stops reading the terminal's output, then calls `ClosePseudoConsole` synchronously on the calling thread. ConPTY's close waits for the console host to finish writing output. While the program is still printing, nobody reads that output any more, so it waits forever. The same can happen when closing one agent while Claude streams a reply: the whole app would freeze.
- A stress test (8 flooding terminals, close the window) hung the old code on the first run.

Things that didn't work:
- **Stopping the programs first, inside the main process.** node-pty only closes the console in `kill()` or in its native clean-up at exit, which hit the same wait. Processes then lingered for a minute after their own exit event.
- **node-pty's bundled newer ConPTY (`useConptyDll`).** Terminals didn't start at all in this build.

## Decisions

### A terminal host process
- Every pseudo console now lives in **`src/main/ptyHost.ts`**, run as an Electron `utilityProcess` (as VS Code does). The main process talks to it with messages (spawn, write, resize, kill → spawned, data, exit). `pty.ts` keeps the same functions, so nothing else changed.
- **Closing one terminal** (in the host):
  1. Stop the program and everything it started (`taskkill /T /F`).
  2. node-pty drains the remaining output and reports the exit.
  3. Only then close the console.
  If ConPTY still blocks, only the host waits; the window keeps working.
- **Quitting:** stop all terminal programs, then terminate the host. Termination skips the clean-up that waits. Measured with 8 flooding terminals: the app's exit completes in under 100 ms and no shell is left running.
- If the host dies, its terminals end with exit code -1, and the next terminal starts a new host.
- The program's pid now arrives from the host a moment after spawning; `TerminalInfo.pid` is 0 (nothing used it).

### Self-tests run in their own profile
- Chromium can't share a profile between two running copies. Every smoke run used the same app data folder as the installed app, so a test started while the installed app was open never loaded its page. That made several earlier runs look frozen at startup.
- Smoke runs now use `%APPDATA%\Mission Control (self-test)`, starting from a copy of `store.json`. Tests run while the installed app is open and never change its data.
- `MC_SMOKE_QUIT=<n>` runs only the quit test with n flooding terminals and logs the time of each quit stage.

### Workspaces
- **Agents → Workspaces** saves the open agents (folder, title, chat session, worktree), the layout and the grid columns under a name (store `workspaces`). Saving under an existing name replaces it.
- **Opening one** resumes each chat that has a transcript; a chat with no prompt yet starts fresh in the same folder. A chat or shell that's already open isn't opened twice. Workspaces are also in the command palette and on the empty Agents page.
- Grid columns moved from the Agents view to App, so a workspace can save and restore them.

### Send to several agents
- **Send to…** (`Ctrl+Shift+A`) types one prompt into the Claude agents you pick. Ready-made prompts:
  - **Write a briefing:** each agent gets its own `docs/briefings/` file name;
  - **Where are you?**
  - **Wrap up**
  - **/compact**
- A prompt with line breaks goes in as one bracketed paste (`shared/terminalInput.ts`), so it arrives as one message. "Send it" off only types it in, for checking per agent first. Agents that are working take the message when they finish.

## Risks

- One more process. If the host crashes, all terminals end at once; they can be resumed, since their chats are on disk.
- The final teardown of a dev Electron process on this machine can take a minute even with no terminals at all; it's below the app. The window closes at once and a new copy starts normally.
