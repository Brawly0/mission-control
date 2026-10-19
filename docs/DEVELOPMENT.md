# Development

## Setup

```bash
npm install
npm run dev
```

`npm install` runs a `postinstall` step that downloads the Electron binary. If `npm run dev` says Electron failed to install, run:

```bash
node node_modules/electron/install.js
```

## Checks

```bash
npm run typecheck
npm run build
```

### Smoke test

Builds aside, the app has a self-test that scans your projects, runs `claude --version` in a real PTY, screenshots the window and quits:

```powershell
npm run build
$env:MC_SMOKE = "$PWD\smoke.png"; .\node_modules\electron\dist\electron.exe .
```

Expected output: `[smoke] projects: N`, the session count of one project, the Claude Code version from the PTY, and the screenshot path.

## Conventions

- TypeScript strict everywhere. Shared types live in `src/shared/types.ts`.
- Never write to `~/.claude`. App data goes in `store.ts`.
- New IPC: add to `MissionControlApi`, then `preload/index.ts`, then a handler in `main/index.ts`.
- Styles: plain CSS with variables in `renderer/src/styles.css`. No UI framework.
- Record significant choices in `docs/decisions/NNNN-title.md`.

## Troubleshooting

| Problem | Fix |
|---|---|
| Terminal says "claude was not found on PATH" | Install Claude Code, check `where claude`, restart the app |
| A project shows a strange path | The real path is read from session files. Folders with no readable session fall back to decoding the folder name, which is lossy. |
| Agents fail with "OAuth session expired" | Log the CLI in with `claude auth login` in a normal terminal; `claude auth status` should show `"loggedIn": true`. The desktop app's login is separate. |
| Chat list is slow the first time | Large session files are scanned once, then cached by modification time |

### Hook test

`MC_SMOKE_HOOKS=<empty folder>` makes the smoke test also send one tiny real prompt (`claude -p`) from that folder and list the hook events that reached the app. Expected: `SessionStart`, `UserPromptSubmit`, `Stop`, `SessionEnd`, all with the session id the app assigned. This uses a small amount of your Claude usage and needs `claude` to be logged in. Set `MC_SMOKE_MODEL=haiku` to use a cheaper model.
