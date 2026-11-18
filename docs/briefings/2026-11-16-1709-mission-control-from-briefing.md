# Session briefing: AI terminal shipped as 0.37.0 (2026-11-16)

## Goal

Make the embedded agent terminals feel like an AI terminal instead of a plain shell. The user said: "it doesn't feel like an AI terminal at all". They asked for all of it, then for a commit, a release and an update.

GitHub profile work is **off the table**. The user said "forget github, focus on the app".

## Done and verified

| Item | State |
| --- | --- |
| **v0.37.0 released** (`e6dd14d`, pushed to `main`) | ✅ https://github.com/Brawly0/mission-control/releases/tag/v0.37.0 (not a draft). All 4 assets are present. Release gates PASS |
| Rendering: 16-colour brand palette, WebGL renderer + fallback, Unicode 11, web links, file-path links → VS Code `code -g` | ✅ The GPU renderer reported "on" in the smoke test. Screenshots checked: dark, light, 960px |
| Activity strip: tool in progress from `PreToolUse`, "Thinking" between tools, timer, "N files changed" chip → Review | ✅ `MC_SMOKE_TERM` |
| Approval bar: Allow / Deny / More (Claude: Enter / Esc; Codex: `y` / Esc; trust: Enter) | ✅ With the fake CLI: Allow sends `\r` and the bar closes |
| Prompt box: Enter sends, multi-line → bracketed paste, ↑ history, Esc clears / interrupts, paste image → PNG path, drop files → `@path`, quick chips, Stop, hide toggle | ✅ `MC_SMOKE_TERM`, except paste-image and drag-drop |
| typecheck, **400 tests** (45 files), build | ✅ |
| `MC_SMOKE_MC` (regression) | ✅ PASS |

**Not verified yet:**
- **With a real Claude session.** Most important: that Allow (Enter) and Deny (Esc) answer Claude's real permission menu correctly.
- Pasting a screenshot and dragging a file into the prompt box. Neither was exercised in the smoke test.
- Clicking a file link in the terminal: only the `filesExist` IPC was tested, not a hover or click.
- The user hasn't updated their installed app to 0.37.0 yet. The last thing they were told: top bar **Update** → **Restart**.

## Decisions and why (ADR 0043)

- **Approvals are keystrokes, not the `PermissionRequest` hook.**
  - The hook would mean holding the HTTP request open past curl's 3-second limit (`hookServer.ts`).
  - Keystrokes leave the CLI's own menu as the source of truth.
  - **More** focuses the terminal, for "allow for the session" and similar options.
- **`PreToolUse` was added to the hook settings** to get "what it's doing now". It doubles the hook calls, but each one is a local curl that gets `{}` back immediately.
  - `activity` is set at PreToolUse and cleared at PostToolUse, UserPromptSubmit, Stop and SessionStart.
  - `edited` is filled from Edit/Write/MultiEdit/NotebookEdit at **PostToolUse**, so only successful writes count.
- **The strip says "Waiting for you" during a permission prompt.** The bar spells out the request; before this change, the same text appeared three times.
- **The prompt box covers Claude and Codex only, not shell or mc.** It takes focus when the agent is shown (`autoFocus` on the terminal is off while it's visible). Its on/off setting and the prompt history live in localStorage (`mc.composer`, `mc.promptHistory`) because they're per-viewer conveniences.
- **Pasted images:** the renderer reads the clipboard blob and converts it to PNG through `OffscreenCanvas`. Main validates the PNG signature and writes it to `%TEMP%\mission-control-paste` (files older than a day are cleared). Electron 44's main-process `clipboard` has no `readImage()` any more; it's the new async API.
- **File links:** `shared/terminalLinks.ts` finds the candidates, and main confirms each file exists (`fs:files-exist`, cached per pane) before it becomes a link, so false matches never link.
- **Release notes were not shown for confirmation first.** The user explicitly said "just commit and release everything" in that turn.

## Open problems

- **`MC_SMOKE_TEAM=1` fails**: "Agent team smoke condition timed out", waiting for the created task to appear. It failed the same way on the unchanged 0.36 code (checked with a stash), so it's not caused by this work. The likely cause is `TASKS_UI = false` (Tasks hidden in 0.36). The smoke needs updating, or a guard so it skips while the flag is off.
- `npm run dev` exits straight away while the installed app is running: the single-instance lock in `src/main/index.ts:51` focuses the installed app. Dev and installed also share userData. The user can't try a dev build without quitting the installed app from the tray.
- Codex and mc have no tool hooks, so their strip shows status only.
- File paths that wrap across terminal lines don't link. Link ranges use string indices, so wide characters earlier on the same line can shift a link by a cell.
- Each visible terminal holds a WebGL context; Chromium allows about 16. Past that, the oldest falls back to the DOM renderer (this is handled).
- Carried over from 0.36: mc tabs show "working" while idle at the `mc ›` prompt.

## Next steps

1. The user updates to 0.37.0 and tries a real Claude session: give it a command that needs permission, click **Allow**, and confirm Claude goes ahead. Check **Deny** too.
2. If Allow or Deny don't work, fix the keys in `approvalFor()` in `AgentAssist.tsx`.
3. Ask for feedback on how it feels: strip wording, prompt box focus behaviour, colours.
4. Possible follow-ups, only if the user asks:
   - Fix or skip `MC_SMOKE_TEAM` while Tasks is hidden.
   - A dev mode that doesn't collide with the installed app (a separate userData and no single-instance lock under `npm run dev`).
   - An "Allow for this session" button (Claude's option 2) once the menu keys are confirmed.
   - A strip status for mc (idle vs. running).

## Gotchas

- **Backslashes get mangled by heredocs and `node -` scripts in Git Bash** (this bit again this session). Use the Edit/Write tools for anything containing `\`, and never use `cat > file` without input: it hangs.
- On ConPTY, a plain Node app only gets bracketed-paste markers if it turns on `\x1b[?2004h`. Without that, the markers and the inner `\r` are stripped. The fake CLI in `aiTerminalSmoke.ts` turns it on, as real Claude does. ConPTY also repaints and re-sends old lines, which is why the fake numbers its echoes (`GOT<n>:`).
- `sendInputEvent` with Shift+Enter doesn't insert a newline in a textarea (no char event). Use `webContents.insertText('a\nb')` instead.
- Smoke tests: `Start-Process -WindowStyle Hidden -Wait` with redirected output, a fresh `MC_SMOKE_PROFILE`, `MC_SMOKE_CLEAN=1`, and absolute `MC_SMOKE` / `MC_SMOKE_LOG` paths. Clear the other `MC_SMOKE_*` variables between runs in the same shell.
- The `v0.36.0` tag isn't fetched locally (`git log v0.36.0..HEAD` fails). Use `gh release view` or fetch tags.
- Don't commit `docs/briefings/*.md`. The repo is public and these name teammates and personal context. Three older briefings and this one are untracked on purpose.
- Commit and release only when the user asks in that turn. Never force-close the installed app: it may have live agent sessions.

## Files that matter

- `src/renderer/src/components/TerminalPane.tsx`: theme (`terminalTheme`, also used by `TaskConsole`), addons, file-link provider, `loadGpuRenderer`, `FOCUS_TERMINAL_EVENT`.
- `src/renderer/src/components/AgentAssist.tsx`: `ActivityStrip`, `approvalFor` / `ApprovalBar`, `PromptComposer`, `pathForPrompt`, the `QUICK` commands.
- `src/renderer/src/components/AgentsView.tsx`: wires these into each agent cell; `composerOn` state.
- `src/renderer/src/terminal.css`: all the new styles (imported in `main.tsx`).
- `src/shared/agentActivity.ts`: `describeTool`, `isPermissionPrompt`. `src/shared/terminalLinks.ts`: `findFileRefs`. Tests sit next to both.
- `src/renderer/src/agentStatus.ts`: `activityFromHook`; `PreToolUse` counts as working (`agentStatus.test.ts`).
- `src/renderer/src/types.ts`: `Agent.activity`, `Agent.edited`. `src/shared/types.ts`: `HookEvent.tool` and the new API (`openFileAt`, `filesExist`, `savePastedImage(png)`, `pathForFile`).
- `src/main/hookServer.ts`: `PreToolUse` added; `tool: describeTool(...)`.
- `src/main/ipc.ts`: `open:file-at`, `fs:files-exist`, `clipboard:save-image`. `src/preload/index.ts`: `webUtils.getPathForFile`.
- `src/main/aiTerminalSmoke.ts` (`MC_SMOKE_TERM=1`), registered in `src/main/smoke.ts`.
- Docs: `docs/decisions/0043-ai-terminal.md`, `docs/ROADMAP.md` (0.37.0 section), `docs/DEVELOPMENT.md` (`MC_SMOKE_TERM`).
- Dependencies added: `@xterm/addon-webgl@0.19.0`, `@xterm/addon-unicode11@0.9.0`, `@xterm/addon-web-links@0.12.0`.
