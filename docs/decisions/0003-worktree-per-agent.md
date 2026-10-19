# 0003: One git worktree per parallel agent

**Status:** accepted · 2026-10-20

## Context

Several agents in the same folder edit the same files and step on each other. Each one needs its own copy of the code, and you need an easy way to bring the good results back.

## Decision

- "New session in worktree" creates a real `git worktree` on a new branch `mc/agent-xxxx`, based on the main checkout's current branch.
- Worktrees live in `<repo>/.claude/worktrees/`, the same place Claude Code's own worktrees go, so they're easy to find and the app's sidebar already groups them as worktrees.
- The folder is excluded through `.git/info/exclude` (local only) instead of editing `.gitignore`, so nothing gets committed into the user's repository.
- Review is a diff against the merge base. Merging happens in the main checkout with `--no-ff`, so each agent's work stays visible in history as one merge.
- Destructive steps (delete worktree and branch) are confirmed in a native dialog owned by the main process. They are limited to `mc/` branches under `.claude/worktrees/`.

## Alternatives rejected

- **Copying the folder**: slow for big repos, and you lose git's merge tooling.
- **Separate clones**: duplicate `.git` storage, and remotes have to be set up again.
- **Branches in one checkout**: agents still share one working tree, so they'd still conflict.

## Consequences

- Only works in git repositories with at least one commit. The menu item is disabled otherwise.
- Merging needs a clean main checkout on the base branch. The app explains what to fix instead of stashing for you.
- Dependencies such as `node_modules` aren't shared between worktrees, so an agent may need to install them.
