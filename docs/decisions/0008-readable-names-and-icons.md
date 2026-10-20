# 0008: Readable project names, icons, and worktree chats under their project

**Status:** accepted · 2026-10-21

## Context

Projects were named after their folder (`WBP`, `COURT`, `T019`), which says little. Worse, chats started from Claude Code's own worktrees (`WBP\.claude\worktrees\semester-schedule-planning-2b8af2`) each became a separate, hidden "worktree" project, so WBP and COURT looked empty.

## Decisions

- **Worktree chats belong to their project.** Every `~/.claude/projects` folder whose working directory is inside `<project>\.claude\worktrees\` is folded into that project. `Project.keys` lists all those folders, and listing, search and per-chat cost take the whole list. Each chat shows which worktree it ran in. Usage by project folds the same way.
- **Names come from the README.** The display name is your own name, else the README's first heading (cleaned: no Markdown, no ALL CAPS, the part before a long dash), else the folder name. The first paragraph becomes a one-line description. Only the first 8 KB is read, and it's cached by modification time.
- **Icons are guessed, then yours.** Keyword rules over the folder name first, then the README, pick a lucide icon (game, journal, trading, bot, course, network…). Each project also gets a stable color. Both can be changed in **Name and icon**, and **Use automatic** brings the guesses back.
- **Your names live in Mission Control's store.** A project's name, icon and color are in `projectMeta`, and chat titles you set are in `chatTitles`. Nothing in `~/.claude` is written, and the folder isn't renamed.
- **Chat titles:** your title, else one set with `/rename`, else the automatic name Claude Code gives a chat, else a cleaned first prompt (greetings and pasted tags dropped).
