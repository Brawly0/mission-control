# Session briefing: Project organization tool for Claude Code

Oct 24, 2026, 3:47 PM · Mission Control · the chat reached its limit at about 683K tokens. Saved by Mission Control.

To pick up where it left off, start a new chat and ask Claude to read this file. To reopen the original chat instead: `claude --resume bb3086b1-415f-42fe-b46a-78252a8d5f59` (full transcript: `C:\Users\bsbra\.claude\projects\C--\bb3086b1-415f-42fe-b46a-78252a8d5f59.jsonl`).

---

Summary:
Session briefing (written as a handoff per the project's CLAUDE.md "Summary instructions": goal; done/verified vs not; decisions and why; open problems; exact next steps; gotchas; key files).

1. Primary Request and Intent:
   The user wanted a Windows app to "control all my claude sessions and projects and open clis and multiple agents with a good UI". This became **Mission Control** (folder `C:\Users\bsbra\Desktop\claude-hub`, private GitHub repo `Brawly0/claude-hub`).

   Versions requested in sequence:
   - **v0.1:** project sidebar, session browser, live terminals, docs.
   - **v0.2:** exact status via Claude Code hooks, Windows notifications, rename tabs, restore agents.
   - **Fixes:** confirm the Stop event; a crash on close.
   - **UI overhaul plus v0.3:** worktrees per agent, diff review and merge, git badges, remembering project/layout/window.
   - **Desktop shortcut/installer.**
   - **v0.4:** tags, groups, notes and status, full-text chat search, token and cost stats.
   - **v0.5:** Kanban task board, headless agents with progress, global hotkey and tray.
   - **v0.6:** templates and recurring tasks, an auto-queue, auto-update. The user chose a public releases repo `Brawly0/mission-control-releases` so the code stays private.
   - **v0.7:** the user said "Plan v0.7 … Show me the plan before building". They then chose all extras and failure behavior "Stay blocked (Recommended)", and said "Looks good, build v0.7 with this plan." The scope:
     - task dependencies with branch chaining
     - checks after a task
     - "Turn on git"
     - follow-up box
     - spending guardrails
     - unit tests and CI
     - release via auto-update

   Requests after the first compaction:
   - **v0.8, names and icons:** WBPjournal and the game project had confusing names, so: better project and chat names, plus icons inside the app.
   - **Efficiency ideas:** "what other stuff we can do so this tool can be as effecient as possible". I proposed a "Spend less" v0.9.
   - **v0.8.1, detection:** this project (Mission Control) wasn't in the app and needed better detection. Then: "i want a tab for this project mission control to work on it there and make sure to sort every project".
   - **App and updates:** asked where the app is and whether to reinstall every update. Answered: Desktop/Start menu shortcut; auto-updates install on restart.
   - **v0.9:** "now do the v9 plan", i.e. "Spend less".
   - **v0.10:** "ok now work on the UI make it better and also make shortcuts for everything".
   - **v0.11:** the user gave a mockup image and said "next version will target a UI like this". AskUserQuestion answers: Notebook/Knowledge = "Notes + docs hub (Recommended)"; due dates = "Add due dates + reminders (Recommended)".
   - **v0.12:** "every time the conversation gets to its limit i tell it to document and make a sessison breifing for the next session … how can we make it auto work on it".
   - **Walkthrough:** "wait i dont know how to use it for example this session work me through i do session breifing and open a news session".
   - **Latest:** "how do the breifings get created".

2. Key Technical Concepts:
   - **Stack:** Electron 44 (Node 24, SQLite built in), electron-vite 6, Vite 8, React 19, TypeScript 5.9, xterm.js 6, @lydell/node-pty, lucide-react, react-markdown, electron-builder 26 (NSIS per-user), electron-updater, Vitest.
   - **Claude data:** `~/.claude/projects/<encoded>/*.jsonl` is read-only. Entry types used:
     - `cwd`, which changes on every line
     - `custom-title`, `agent-name`
     - `isCompactSummary:true` (the user message holding the compaction summary)
     - the `system` subtype `compact_boundary` with `compactMetadata{trigger:'auto'|'manual', preTokens}`
   - **Agents:** hooks via `--settings`, plus `--session-id`/`--resume`.
   - **Headless tasks:** `claude -p --output-format stream-json`; the init event lists `mcp_servers`.
   - **Per-project MCP:** `--strict-mcp-config --mcp-config=<file>`. The `=` form is required.
   - **Index:** a worker with SQLite FTS. Schema 6 tables: files, sessions, msgs, fts, folders, briefings. It repairs itself when damaged; smoke tests use `index-smoke.db`.
   - **Project detection:** worktree chats fold into their parent project. Chats started from `C:\`, Desktop or scratch folders are matched to the dominant project root (≥5 hits and ≥60%). `chatProjects` holds manual overrides.
   - **Shortcuts:** a registry in `shortcuts.ts`, matching by `event.code`, terminal-safe rules, and rebinding in `AppSettings.keybindings`. Unhandled ids broadcast an `mc:shortcut` event; buttons fire `mc:run-shortcut`.
   - **Themes:** `:root[data-theme='light']` token overrides; zoom via `webContents.setZoomFactor`.
   - **Session briefings:** see sections 3 and 8.
   - **Release flow:** bump `package.json`, commit and push, run `node scripts/release.mjs "<notes>"` (draft, build, verify 3 assets, publish), then `git tag vX && git push origin vX`. CI runs on windows-latest.

3. Files and Code Sections (repo `C:\Users\bsbra\Desktop\claude-hub`; `package.json` version **0.12.0**):
   - **src/shared/projectLook.ts** (pure, unit-tested):
     - Names and icons: `PROJECT_ICONS`, `PROJECT_HUES`, `guessIcon` (folder name, then README title, then most-mentioned kind; "claude" removed from the AI rule), `readmeInfo`, `folderLabel`, `worktreeParent`, `prettyWorktreeName`, `encodeProjectKey`, `titleFromPrompt`.
     - Detection: `windowsPath`, `projectRootOf`, `isInside`, `pickProject`.
     - Briefings: `cleanBriefing`, `briefingFileName(at,title)` → `YYYY-MM-DD-HHmm-slug.md`, `briefingMarkdown(...)`, `briefingPrompt(path)`, `writeBriefingPrompt(file)`, `COMPACT_INSTRUCTIONS`.
   - **src/main/claudeData.ts:**
     - Listing: `listProjects` (keys, folding worktrees, chat-less folders that are project roots, `describe()`, `matchStrayChats`), `listSessions(keys, projectPath?)`.
     - Chats: `renameSession`, `moveSession`, `movedChatList`, `setFolderSource`.
     - Helpers: a folder cache, and a 1.5 s timeout on index lookups.
   - **src/main/indexWorker.ts:** schema 6 with a `briefings` table. `hit()` collects folders. Queries: search, sessionUsage, sessionFolders, sessionTotals, firstReplies, chatsOverCost, briefings. `openDb`/`resetDb`/`isCorrupt` handle self-repair.
   - **src/main/spend.ts:** projectFor, defaultModelFor, mcpServers, `launchArgs`, contextUsage, contextWindow, startupReport.
   - **src/main/hub.ts:** notes, knowledgeDocs/searchKnowledge, claudeStatus (from `claude auth status`; email never passed on), userName (Settings value, else the first word of the Windows full name, "Mhmd"), quickChatFolder (`os.tmpdir()/mission-control-quick-chats`), createProject.
   - **src/main/briefings.ts:**
     - `listBriefings`, `saveBriefing`.
     - `saveNewBriefings(notify)`: the first run sets `briefingsFrom = now`; later runs write new ones.
     - `latestBriefing`, `hasSummaryInstructions`, `addSummaryInstructions`.
     - Where files go: `<project>/docs/briefings/` for real projects, otherwise `%APPDATA%\Mission Control\briefings\`.
   - **src/main/tasks.ts:** `takeDueReminders`. A due-date change re-arms the reminder. `createTask` applies default models, and runHeadless adds `launchArgs`. `claudeCommand` is exported.
   - **src/main/index.ts:** IPC for everything above. The index status callback runs `checkChatCosts()` and `saveNewBriefings(...)`, which shows the "Session briefing saved" notification. `listDocs` includes `docs/briefings`. Reminders run on a 60 s interval.
   - **src/main/store.ts:**
     - Data keys: chatTitles, chatProjects, costAlerted, notes, briefingsFrom, briefingsSaved.
     - Settings: defaultTaskModel, chatCostAlertUsd 20, contextWarnTokens 200000, keybindings, theme, uiZoom, userName, autoBriefings true.
   - **src/main/smoke.ts:** tours NAMES, SPEND, SHOTS, HUB, BRIEF (plus the older ones).
   - **Renderer:**
     - App and shell: App.tsx, shortcuts.ts, due.ts, projectLook.tsx (LookContext).
     - Components: TopBar, Sidebar (nav, rail, ClaudeStatusCard), HomeView (dashboard), ProjectsView, NotebookView, KnowledgeView (Docs and Session briefings tabs), BriefingsPane (useBriefings, BriefingList, BriefingDetail), DocViewer, DocsPanel, NewProjectDialog, IdentityDialog, ShortcutsDialog, SpendingCard, SettingsDialog (tabs, name, autoBriefings toggle), OverviewPanel (BriefingField "Add to CLAUDE.md"), AgentsView (ContextMeter, Briefing button), ProjectView ("New session from latest briefing").
     - CSS: styles.css, ui2.css, dashboard.css, identity.css, spend.css.
   - **Docs:** README, ROADMAP, ADRs 0008–0012, DEVELOPMENT, ARCHITECTURE.
   - **CLAUDE.md:** a "## Summary instructions" section was appended (commit ce2c840).
   - **docs/briefings/2026-10-24-1449-mission-control-v0-12.md:** a handwritten briefing for this session (committed ce2c840).

4. Errors and fixes:
   - Git Bash heredocs and sed ate backslashes in regexes and paths. Fixed with the Edit tool, or `.cjs` scripts written with the Write tool.
   - listProjects blocked while the index rebuilt. Fixed with a 1.5 s timeout and a cache.
   - The installed app and a dev run shared index.db, which got corrupted. Fixed with self-repair and `index-smoke.db`.
   - `--mcp-config` swallowed the prompt that followed it. Fixed by using the `=` form.
   - Smoke screenshots were stale and key presses never arrived. Fixed with focus and `setBackgroundThrottling(false)`, and by closing dialogs through overlay mousedown.
   - Ctrl+digit was blocked inside terminals. Now allowed.
   - The quick-actions margin overrode centering; fixed.
   - Week labels showed "Sat" twice because of daylight saving. Fixed with `setDate`.
   - Icon misdetection: Mission Control showed a game controller. Fixed with title-first, then count-based guessing.
   - "Usage & Insights" and "Chats" labels broke the test expectations; the tests were updated.
   - The cleanBriefing preamble variant ("authored-by-others"); fixed.
   - Prop name clash `tasks` in ProjectCard; renamed to `openTasks`.
   - JSX unclosed div in Sidebar; fixed.

5. Problem Solving:
   - Verified:
     - in-app smoke tours: shortcuts, hub features, and briefings (10 found; written to a scratch folder; latest found)
     - Claude starts with only the chosen MCP server
     - 74 unit tests
     - CI green for v0.12
   - Not verified:
     - a real automatic briefing save after a new compaction
     - by hand: the Briefing button, changing a shortcut, zoom, a reminder popup, the New project dialog, Compact on a real chat

6. All user messages:
   - "ok i have a question i use claude code alot for different stuff can we do a program for windows that will help me sort my projects and claude code chats and documentation and through it i can open claude code cli and work what recommendations do you have"
   - "like i want an app to control all my claude sessions and projects and open clis and multiple agents with a good UI do you know what i mean do you have recommendations"
   - "can you start building it assign a folder for it a github repo documentation structure and start working on it if you have anything ask me with the stack you see the best works"
   - (AskUserQuestion answers: folder Desktop\claude-hub, Private repo, name "Mission Control")
   - "Start v0.2: exact waiting/done status via Claude Code hooks, Windows notifications, renaming agent tabs, and restoring agents after a restart."
   - "I logged in to claude again. Rerun the hook smoke test and confirm the Stop event and done status."
   - "I ran claude auth login in a normal terminal and auth status shows loggedIn true. Rerun the real hook test to confirm the Stop event."
   - (Image of the error dialog) "this error keeps popping up"
   - "ok are you done ?"
   - "where is the app and how can i open it"
   - "ok UI is still basic it needs alot of work so continue working on it and the next v3"
   - "Make Mission Control open from a desktop shortcut or installer so I don't need a terminal."
   - "Start v0.4: tags and groups for projects, per-project notes and status, full-text search across all chats, and token/cost stats."
   - "Start v0.5: a Kanban task board where Start launches an agent on a card, headless agents with progress in the card, and a global hotkey plus tray icon."
   - "Start v0.6: task templates and recurring tasks, an auto-queue that starts the next To do task when one finishes, and auto-update for the installed app." (AskUserQuestion answer: "Public releases repo (Recommended)")
   - "Plan v0.7: task dependencies (run B after A succeeds), and anything else you'd recommend next for Mission Control. Show me the plan before building." (AskUserQuestion answers: all four extras; "Stay blocked (Recommended)")
   - "Looks good, build v0.7 with this plan."
   - "ok now i have a problem with the names and there is WBPjournal project and game project so i want you to work on the names of the chats and the projects for me to know what is what and icons inside the app"
   - "what other stuff we can do so this tool can be as effecient as possible"
   - "ok btw this project is not on the app i need it to have better app detection"
   - "i want a tab for this project mission control to work on it there and make sure to sort every project"
   - "ok where is the app and do i need to install everytime you update"
   - "now do the v9 plan"
   - "ok now work on the UI make it better and also make shortcuts for everything"
   - (mockup image) "next version will target a UI like this"
   - (AskUserQuestion answers: "Notes + docs hub (Recommended)"; "Add due dates + reminders (Recommended)")
   - "ok i want it to do something i dont want everytime the conversation gets to its limit i tell it to document and make a sessison breifing for the next session can you work on that like this convo for example how can we make it auto work on it"
   - "wait i dont know how to use it for example this session work me through i do session breifing and open a news session"
   - "how do the breifings get created"

   Security-relevant constraints:
   - Never send the user's email (mhmdhmidan05@gmail.com) to services, or show it in the UI. The status card uses only loggedIn, authMethod and plan. Use the GitHub noreply address for commits.
   - Never embed tokens in the app; use `gh auth token` only for the publish command.
   - Don't modify the global git config.
   - `~/.claude` data stays read-only.
   - Destructive or outward actions need confirmation.

7. Pending Tasks:
   - Answer the latest question: "how do the briefings get created".
   - Otherwise nothing is pending beyond the hand checks listed in section 5.

8. Current Work:
   - **Walkthrough just finished.** I wrote and committed (ce2c840) the handwritten briefing `docs/briefings/2026-10-24-1449-mission-control-v0-12.md` and added "## Summary instructions" to CLAUDE.md. I told the user to update the app (Quit from tray, reopen), open Mission Control in the sidebar, choose New session ▾ → "New session from latest briefing" (or Ctrl+Alt+B), and let Claude read the briefing.
   - **The user then asked "how do the briefings get created".** The answer:
     1. **Claude Code writes the summary.** When a chat fills up (auto) or the user runs /compact (manual), Claude Code writes a summary into the chat's .jsonl. It's a user message with `isCompactSummary:true`, preceded by a `compact_boundary` entry recording the trigger and preTokens. The CLAUDE.md "Summary instructions" steer that summary to be a handoff.
     2. **The index records it.** Mission Control's index worker reads new lines about every minute and stores each summary in its `briefings` table.
     3. **briefings.ts saves it.** After each index run, `saveNewBriefings` writes summaries newer than `briefingsFrom` (set on first run) to `<project>/docs/briefings/YYYY-MM-DD-HHmm-<chat>.md`, or to `%APPDATA%\Mission Control\briefings\` for C:\ or temp chats. The file gets a header (date, project, auto/manual, size, `claude --resume <id>`) and the cleaned summary, and a notification appears. It's free, with no extra Claude call.
     4. **Other ways to get one:**
        - The Briefing button / Ctrl+Shift+B types a prompt asking the agent to write one now into docs/briefings/.
        - Knowledge → Session briefings lets older summaries be saved by hand.
        - I wrote today's by hand.

9. Optional Next Step:
   Answer the user's question "how do the breifings get created" in plain text, using the explanation in section 8. Don't start new work unless they ask.
