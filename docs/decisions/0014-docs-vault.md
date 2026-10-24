# 0014: Docs vault per project, written by Claude

**Status:** accepted · 2026-10-24

## Context

The user wants every project to have its documentation in one place, the way Obsidian keeps a vault: written by the AI, linked together and easy to browse, so that Claude understands the project at the start of every chat. Before this, the Docs tab only listed a few root files (CLAUDE.md, README.md…) and the top level of docs/.

## Decisions

- **The vault is the project's `docs/` folder**, plus the root docs (CLAUDE.md, README.md, AGENTS.md, BRIEFING.md, CONTRIBUTING.md, CHANGELOG.md). It's plain Markdown in the repo, so it's versioned with the code, Claude can read it with no extra tools, and it opens as-is in Obsidian. Session briefings (`docs/briefings/`, ADR 0012) and ADRs (`docs/decisions/`) are part of it.
- **Obsidian conventions:** `[[wikilinks]]` (with `|alias` and `#heading`), relative `.md` links, YAML frontmatter (`title`, `tags`, `updated`, `generated: claude`). Parsing and link resolution are pure (`src/shared/vault.ts`) and unit-tested. Names resolve case-insensitively by the end of the path; with several matches the note nearest the linking one wins, then the shortest path.
- **Claude writes it through an ordinary headless task** (`Docs vault: build` / `Docs vault: update`, `acceptEdits`, no worktree), so it shows on the Tasks board with its activity and cost, obeys the queue and budgets, and needs no new runner. The prompts (`buildVaultPrompt`, `updateVaultPrompt`) set the note list (INDEX hub, overview, architecture, setup, conventions, status, glossary, decisions) and the rules: facts only, mark guesses "(unverified)", never delete notes or rewrite ones without `generated: claude`, never touch source code or briefings.
- **Claude finds it through CLAUDE.md.** The build adds a "## Project docs" section pointing at docs/INDEX.md. That's the user's file, but only on a build the user starts, and only that section. The vault header shows whether CLAUDE.md links it.
- **Sonnet by default** for building and updating: docs don't need Opus, and the user is often near plan limits. The build dialog shows the current session usage.
- **Automatic updates are opt-in per project** ("Keep up to date", `ProjectMeta.autoDocs`). They run after each compaction, the natural checkpoint where a briefing is saved, and only when the vault exists and automation isn't on hold (plan usage or budget). Building vaults for every project automatically was rejected because it would spend the user's plan without asking.
- **UI:** the Docs tab becomes a vault browser with a folder tree (filter, new note), the note (properties, clickable links, missing links dimmed, back/forward, edit), the outline, links and backlinks, and a graph view. The graph is a small force layout in SVG with no extra library. Changes on disk show up live through `fs.watch` on docs/ while the tab is open. `remark-gfm` was added for tables and task lists.

## Risks

- A build reads a lot of the project and can use a noticeable share of a Pro session. It's always started by the user (or by their auto-update opt-in) and shows its cost.
- Claude might write something wrong. Notes are marked `generated: claude`, guesses are flagged, and the notes live in git, where changes can be reviewed and reverted.
