# 0017: Agent layout controls, "what we worked on" recaps and clearer chat names

**Status:** accepted · 2026-10-24

## Context

The user runs several agents at once and wanted more control over them: minimize, maximize and resize. They wanted to open all of a project's chats as agents in one go. When opening or resuming a chat, they wanted to see what that session worked on. They also found chat names unclear. In their "bot" project, 20 of 24 chats had names Claude Code wrote itself, several of them identical ("Next task briefing" twice) or handoff names ("Session Briefing 2026-10-11").

## Decisions

### Agents: minimize, maximize, resize
- **Minimize** (header button, `Ctrl+Shift+Down`): the agent leaves the grid or the tab stage and goes to a **dock** under the agents, with its status dot. Its tab stays, dimmed. Clicking either brings it back; "Restore all" brings back every agent. The terminal stays mounted and keeps running.
- **Maximize** (header button, double-click the header, `Ctrl+Shift+Up`): the agent fills the **whole window**. The sidebar, top bar, status bar and agent tabs are hidden until you restore it. Leaving the Agents page always restores the layout, so you can't get stuck.
- **Resize** in the grid: the grid's tracks include 6px divider tracks. Dragging a divider moves the line between two columns or rows (each keeps at least 20% of an even share); double-clicking evens them out. Sizes are remembered per grid shape ("3x2") in local storage, a per-viewer convenience.
- **Columns:** Auto (√n) or 1–4. The last agent stretches across its row's empty columns.
- Hidden and minimized cells are taken out of the grid with absolute positioning rather than unmounted, because unmounting an xterm loses its scrollback.

### Open a project's chats as agents
- Chats tab → **Open as agents**: the 2, 4 or 8 latest chats, or all of them. More than 8 asks first, since each is its own Claude process and resuming a long chat re-reads it. Chats already open are skipped. Several chats switch the Agents page to the grid.
- **Resuming a chat that's already open shows that agent** instead of starting a second copy of the same session.
- Chats open as agents have a green dot in the list.

### "What we worked on"
- A **free recap from the transcript** (`src/shared/recap.ts`, pure and tested; streamed in `src/main/recap.ts`, cached by size and modification time). It holds:
  - when, and active time (breaks over 15 minutes don't count);
  - the number of prompts, with the first and latest three;
  - files edited or created (relative to the chat's folder);
  - shell commands and commit messages (from `-m` or a heredoc);
  - compactions, and Claude's last reply, which is usually the wrap-up.
- **Where it shows:**
  - at the top of the chat viewer (collapsible, remembered);
  - as a one-line **"Last time: …"** banner above every agent resumed from a chat, expandable and dismissable.
- **Summarize with Claude** (optional, per chat): one Haiku call with the recap as input (not the transcript), returning `{title, bullets, next}`. It's kept in the store (`chatRecaps`) and shown instead of the raw recap. It also gives the chat a title.

### Clearer chat names
- **Title order:**
  1. your Mission Control name;
  2. a name Claude gave the chat in Mission Control;
  3. Claude Code's names (`custom-title`, the newer `ai-title`, `agent-name`);
  4. the first prompt.
  Claude Code writes its automatic names in the same form as a `/rename`, so they can't be told apart and count as Claude Code's.
- **Better names from the first prompt:**
  - leading filler is dropped ("ok i want you to", "can you", "i have a question");
  - paths become their file name;
  - a chat that starts by reading a briefing is named after the briefing ("From briefing: Mission control v0 12").
- **Name chats** (one Haiku call, up to 40 chats) for chats whose name says little:
  - a title made from the first prompt;
  - a handoff name (`unclearTitle`);
  - a name shared with another chat in the project.
  Claude gets each chat's first and latest prompt, its top files and the start of the last reply. Names you give in Mission Control are never changed. Names by Claude carry a ✨.
- Chats that still share a title show their date.
- The one-shot calls use `claude -p --model haiku --no-session-persistence --tools "" --strict-mcp-config` with a short system prompt. That's about 1k tokens and $0.0003 for a small call, and no chat file or stray project is created. They run in the app's data folder.
- The index (schema 8) reads `ai-title` too, so search, Usage and the digest show the same names.

## Risks

- Claude Code names of chats you really did rename with `/rename` are treated like its automatic ones. If Name chats picks one as unclear, the name by Claude is shown instead. Renaming in Mission Control always wins.
- Opening many chats at once starts many Claude processes; the count asks first above 8.
- The recap reads the whole transcript once per change (streamed, not loaded), which takes about 10 ms for a small chat and longer for 30 MB ones. It runs only when a chat is opened or resumed.
