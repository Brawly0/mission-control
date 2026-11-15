# 0041: My PC advisor workspace

Date: 2026-11-15. Status: accepted.

## Context
General computer help (disk space, slowness, installing apps, settings) has no project to live in. The user had
been opening the "C: drive" entry for it. That's a poor fit: Claude Code keys chat history and memory by folder, so
everything general piles into `C:\`; a `CLAUDE.md` at the drive root needs admin rights; and an agent rooted at
`C:\` has no notes about the machine or the user. Quick chat (a throwaway temp folder) forgets everything.

The user wants one place where Claude acts as a personal advisor that knows the whole PC, knows them and can use
every connector, with the old C: drive project folded in.

## Decision
- **One permanent folder, `~/My PC`** (`src/main/myPc.ts`), set up at app start (`prepareMyPc`, sync and cheap)
  and on every My PC chat (`ensureMyPc`). Files that exist are never overwritten, so the user can edit them all.
  - `CLAUDE.md`: Claude is a **personal PC advisor**. It reads the three files below first, checks the real
    machine before answering, gives one recommendation, and **asks before changing anything** (files, installs,
    settings, registry, services, startup) or acting in the user's name online. Reading is always fine; writes stay
    out of `C:\Windows`, Program Files, AppData and `~/.claude`.
  - `PC-PROFILE.md`: written by the app from a read-only PowerShell survey (computer, Windows, CPU, RAM, GPU,
    drives and free space, installed apps from the uninstall registry keys, startup commands, connected network
    adapters) plus the app's project list and the MCP servers available in that folder. About 8 s; refreshed when
    older than a day (checked 20 s after start, every 6 h, and when a chat opens; the first chat waits for it).
  - `ABOUT-ME.md`: seeded with the user's name; the advisor keeps it up to date as it learns about them.
  - `PC-LOG.md`: the advisor's dated log of what it did and found.
- **Reach**: chats start with `--add-dir C:\ D:\ …` (every drive root). `--add-dir` is variadic, so the prompt
  goes before it (`myPcArgs`). No `mcpAllow` is set, so every MCP connector loads.
- **C: drive folded in** (`applyMyPcSetup`, store `myPcVersion` 2): `mergedProjects['c:'] = My PC`. Chats
  started in `C:\` show under My PC unless they worked in a real project (your own move, then the automatic
  match, then the merge), `C:\` leaves the project list, and its notes, tags and filed chats move over. Nothing
  in `~/.claude` changes; resuming such a chat still runs in `C:\`, where Claude Code keeps it.
- On first setup My PC is pinned with the Cpu icon; later runs keep the user's own choices.
- Ways in: the **Ask my PC** box on Home (Enter sends the question; empty opens the chat) with four starter
  questions, the command palette ("Ask my PC"), and **Ctrl+Alt+P**. Claude only.
- Self-tests (`MC_SMOKE`) skip the startup setup so they never create the real folder.

## Consequences
The app writes outside its own data folder, into `~/My PC` (never `~/.claude`), and runs a short PowerShell
survey daily. The profile lists installed apps and project paths; it stays on this PC like the rest of the
folder. The advisor is only as cautious as its `CLAUDE.md` plus Claude Code's permission prompts.
