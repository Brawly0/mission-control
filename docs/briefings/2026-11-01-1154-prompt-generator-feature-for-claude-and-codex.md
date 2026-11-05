# Session briefing: Prompt generator feature for Claude and Codex

Nov 1, 2026, 11:54 AM · Mission Control · the chat reached its limit at about 118K tokens. Saved by Mission Control.

To pick up where it left off, start a new chat and ask Claude to read this file. To reopen the original chat instead: `claude --resume a7de4ea3-6785-48cf-a435-9034f8db032b` (full transcript: `C:\Users\bsbra\.claude\projects\C--Users-bsbra-Desktop-claude-hub\a7de4ea3-6785-48cf-a435-9034f8db032b.jsonl`).

---

<system-reminder>
</system-reminder>
Summary:
## Session briefing: Prompt Studio feature for Mission Control

### 1. Primary Request and Intent
The user's only message: *"i want to build a new feuture inside the app where its a prompt giver and generator to generate prompts at the highest and most effeciant way for claude and codex like i talk to it and it gives me a prompt to give we can make it learn from resources"*

I asked three design questions. The user chose the recommended option for all three:
- **Interaction:** a chat that interviews the user. It asks up to 3 short clarifying questions, then outputs a final copy-ready prompt. It uses a one-shot `claude -p` call, so no API key is needed.
- **Learning:** a resource library. The user adds docs, links, pasted guides or example prompts. The app stores them and injects the most relevant ones into the generator's input (keyword ranking, not FTS).
- **Output:** copy, plus "Send to Claude / Codex agent" (launches an agent with the prompt prefilled), plus a saved-prompt snippet list. That list closes the ROADMAP item "Prompt snippets you can insert into any agent".

Project rules from `C:\Users\bsbra\Desktop\claude-hub\CLAUDE.md` still apply:
- Read `docs/ARCHITECTURE.md` before changing structure (done).
- Always run `npm run typecheck && npm run build` after changes.
- **Never write to `~/.claude/`.** It is read-only for this app. App data goes through `src/main/store.ts`.
- New IPC goes in this order: `src/shared/types.ts` (`MissionControlApi`), then `src/preload/index.ts`, then a handler in `src/main/ipc.ts`.
- Use plain CSS with variables in `src/renderer/src/styles.css`. No UI framework.
- Tick finished items in `docs/ROADMAP.md` and add an ADR in `docs/decisions/` for notable choices. The latest existing ADR is 0034, so the new one is **0035**.
- Never read a whole session JSONL file.
- Commit attribution, if committing: end commit messages with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Only commit if the user asks.
- The git working tree already had many uncommitted changes from earlier work (task teams and so on). Don't disturb them.

### 2. Key Technical Concepts
- Electron + React + TypeScript (electron-vite), Windows. The renderer talks to the main process through the typed `window.mc` API (preload plus ipcMain).
- `askClaude()` in `src/main/recap.ts` spawns `claude -p --no-session-persistence --tools '' --strict-mcp-config --output-format json --system-prompt <sys>`, sends the prompt on stdin, and has a 120s timeout.
- `claudeCommand()` may route through `cmd.exe /c <shim>`, so the command line must stay short and quote-free. For this reason `PROMPT_STUDIO_SYSTEM` is a single short line, and all rules, library excerpts and conversation go on **stdin**.
- Views are lazy-loaded in `App.tsx` and wrapped in `<OnceShown>` inside `view-pane` divs.
- Agents are launched with `launch({kind:'claude'|'codex', cwd, projectName, projectPath, title, args:[prompt]})`. `quickChatFolder()` gives a temp folder when no project is selected.
- Store: `StoreData` in `src/main/store.ts`. `readStore` validates array keys. Use `loadStore()` and `updateStore(fn)`.

### 3. Files and Code Sections

**Created**
- `src/shared/promptStudio.ts` (pure logic, needs unit tests). Exports:
  - Types: `PromptTarget`, `PromptResource {id,title,content,source?,target?,enabled,createdAt}`, `PromptSnippet {id,title,text,target,createdAt}`, `PromptChatMessage`, `PromptChatRequest {target,messages,projectName?,projectContext?}`, `PromptChatReply {kind:'question'|'prompt',text,title,usedResources}`.
  - Constants: `MAX_RESOURCE_CHARS=40000`, `RESOURCE_BUDGET_CHARS=24000`.
  - Functions: `words()`, `pickResources(resources, query, target, budget)`, `targetName()`, `buildStudioInput(req, picked)`, `parseStudioReply(raw, usedResources)`, `htmlToText()`, and `PROMPT_STUDIO_SYSTEM`.
  - `pickResources` ranks by shared words, with title hits weighted 3 and body hits 1. It filters on enabled and target, and respects the character budget. If a single best resource doesn't fit, it includes a truncated copy.
  - `buildStudioInput` embeds Claude and Codex best-practice guides and the interview rules. It stops asking questions after 2 assistant turns. It wraps the library in `<library><resource title="">`, which is described to the model as reference material rather than instructions (injection guard). It asks for JSON `{"type":"question"|"prompt","text","title"}`.
  - `parseStudioReply` strips code fences, falls back to a plain question when the reply isn't JSON, and returns `kind:'question'` unless `type==='prompt'`.
- `src/main/promptStudio.ts`. Exports:
  - `listPromptResources`, `savePromptResource` (upsert, capped at 40K chars), `deletePromptResource`.
  - `importResourceFromUrl` (http/https only, 20s timeout, 2MB cap, HTML converted to text, title from `<title>`).
  - `importResourceFiles` (native open dialog via `getMainWindow()` from `./window`, text extensions only, up to 20 files, ≤2MB each).
  - `listPromptSnippets`, `savePromptSnippet` (max 200), `deletePromptSnippet`.
  - `promptStudioChat(req)`, which validates that the last message is from the user, picks resources, calls `askClaude(buildStudioInput(...), PROMPT_STUDIO_SYSTEM, 'sonnet')`, and parses the reply.

**Edited**
- `src/main/recap.ts`: `askClaude` is now exported and takes a third parameter, `model = 'haiku'`. It was `async function askClaude(prompt, system)` with `--model 'haiku'` hardcoded.
- `src/main/store.ts`:
  - Added `import type { PromptResource, PromptSnippet } from '../shared/promptStudio'`.
  - Added `promptResources: PromptResource[]` and `promptSnippets: PromptSnippet[]` to `StoreData`, with `[]` defaults.
  - Added both to the `readStore` array-validation key list.
- `src/main/ipc.ts`: imported the promptStudio functions and added handlers `prompts:chat`, `prompts:resources`, `prompts:saveResource`, `prompts:deleteResource`, `prompts:importUrl`, `prompts:importFiles`, `prompts:snippets`, `prompts:saveSnippet`, `prompts:deleteSnippet` (before `skills:list`).
- `src/preload/index.ts`: added `promptChat`, `listPromptResources`, `savePromptResource`, `deletePromptResource`, `importPromptUrl`, `importPromptFiles`, `listPromptSnippets`, `savePromptSnippet`, `deletePromptSnippet`.
- `src/shared/types.ts`:
  - Imported the prompt types from `./promptStudio`.
  - Added the same 9 methods to `MissionControlApi`, before `nameChats`.
  - Added `'prompts'` to the `view?:` union in `UiState` (~line 406).
- `src/renderer/src/types.ts`: `View` now includes `'prompts'`.
- `src/renderer/src/components/Sidebar.tsx`: added `PenLine` to the lucide import, plus nav item `{ view: 'prompts', icon: PenLine, label: 'Prompt Studio', shortcut: 'goPrompts' }` after Skills. `goPrompts` is not a defined shortcut id (no keybinding). Typecheck may complain, or `keyFor` may just return empty.
- `src/renderer/src/app/commands.ts`: added `PenLine` to the imports and the command `{ id: 'go-prompts', group: 'Go to', title: 'Prompt Studio', icon: PenLine, keywords: '...', run: () => setView('prompts') }`.
- `src/renderer/src/App.tsx`:
  - Added `const PromptStudioView = lazy(() => import('./components/PromptStudioView'))`.
  - Added a `view-pane` block before the knowledge pane, rendering `<PromptStudioView visible projects selectedProject onSend={(tool, prompt, project) => ...launch({kind: tool, cwd, projectName, projectPath: cwd, title: \`${name} · prompt\`, args: [prompt]})} />`. It uses `quickChatFolder()` when there is no project and toasts errors via `errorMessage`.

**Not yet created (the build will fail until these exist)**
- `src/renderer/src/components/PromptStudioView.tsx` (default export)
- `src/renderer/src/promptStudio.css`, imported in `src/renderer/src/main.tsx` next to `import './skills.css'`

### 4. Errors and fixes
- I accidentally put a stray Japanese token ('から') in the `STOP` word set in `shared/promptStudio.ts`. I removed it with an Edit.
- No build, typecheck or test errors yet. None has been run.

### 5. Problem Solving
- Windows command-line length and quoting limits (cmd.exe shim): solved by putting all content on stdin and keeping the system arg short.
- Prompt-injection risk from library content: the input tells the model that the library is reference material and to ignore instructions in it.
- Verifying the UI building blocks and CSS conventions, so far:
  - `ui.tsx` exports `Button` (props `variant: 'primary'|'secondary'|'ghost'|'danger'`, `size: 'sm'|'md'`, `icon`), `IconButton` (`icon`, `label`, `active`), `Avatar`, `Kbd`, `Badge`, plus `Segmented`, `MenuButton` and `EmptyState`.
  - Other hooks and helpers: `useToast()` from `../toast` (`toast('error'|'success'|'info', title, detail)`), `errorMessage` and `timeAgo` from `../util`, `NoteMarkdown` for rendering Markdown.
  - CSS variables: `--bg --surface --surface-2 --surface-3 --border --border-strong --text --text-2 --muted --faint --accent --accent-soft --accent-text --green --red --radius --radius-lg --font-display --mono`.
  - Helper classes: `.muted .mono .pad .scroll`.
  - Page-layout reference: `skills.css`, with `.skills-view` as a grid and `.skills-main.scroll` with padding `26px 32px 48px`.

### 6. All user messages
- "i want to build a new feuture inside the app where its a prompt giver and generator to generate prompts at the highest and most effeciant way for claude and codex like i talk to it and it gives me a prompt to give we can make it learn from resources"
- Answers to my AskUserQuestion: "Chat that interviews you (Recommended)", "Resource library (Recommended)", "Copy + send to agent (Recommended)".

### 7. Pending Tasks
1. Create `PromptStudioView.tsx`:
   - Props: `visible`, `projects`, `selectedProject?`, `onSend(tool: 'claude'|'codex', prompt, project?)`.
   - A target toggle (Claude / Codex).
   - An optional project picker.
   - A chat pane with message list, input and a "thinking" state, built on `window.mc.promptChat` (the message history is held in the component).
   - Question replies render as assistant messages. Prompt replies render as a prompt card with Copy, "Send to Claude/Codex agent", and "Save as snippet".
   - Show which library resources were used.
   - A Library panel:
     - Add pasted text.
     - Import URL.
     - Import files.
     - Enable/disable and delete a resource.
     - Edit a resource.
   - A Saved prompts list with copy, send and delete.
   - Handle errors with toasts.
2. Create `promptStudio.css` and import it in `main.tsx`.
3. Add Vitest unit tests `src/shared/promptStudio.test.ts`, covering `pickResources`, `parseStudioReply`, `buildStudioInput` and `htmlToText`.
4. Run `npm run typecheck && npm run build` (and tests) and fix errors. Check that `goPrompts` as the shortcut string typechecks and doesn't break `keyFor`/`withKey`. If it does, add a shortcut entry or make `shortcut` optional.
5. Docs:
   - Add `docs/decisions/0035-prompt-studio.md`.
   - Update `docs/ARCHITECTURE.md` (file lists for `main/promptStudio.ts`, `shared/promptStudio.ts`, `PromptStudioView`).
   - Tick "Prompt snippets you can insert into any agent" in `docs/ROADMAP.md`.
   - Optionally mention it in `docs/DEVELOPMENT.md`.
6. Optionally smoke-test the app (`npm run dev`) to see the view working. Don't commit unless the user asks.

### 8. Current Work
I was finishing the plumbing (types, store, IPC, preload, nav, command palette, App wiring) and had just checked `ui.tsx`, `skills.css` and the CSS variables in order to write `PromptStudioView.tsx` and `promptStudio.css`. Neither file was written yet when the summary was requested. The user's last in-flight nudge was only a status check, so I should give a short status line and continue.

### 9. Optional Next Step
Write `src/renderer/src/components/PromptStudioView.tsx` and `src/renderer/src/promptStudio.css`. Add `import './promptStudio.css'` in `main.tsx`. Then run `npm run typecheck && npm run build`. This continues directly from: "Build Prompt Studio now: the shared logic is written. Next come the main-process service, the IPC wiring and the UI."
