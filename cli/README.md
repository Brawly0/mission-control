<p align="center"><img src="logo.svg" alt="mc logo: two linked rings, orange for Claude and blue for Codex" width="96"></p>

# mc

One prompt, two agents. `mc` splits your request between Claude Code and Codex, has them build their halves at the
same time in a fresh git worktree, lets each review the other's half, and commits the result to a new branch.

```
mc                 # interactive: keeps asking what to build next
mc "add CSV export to the reports page"
mc list
mc merge <id>      # merge into your current branch, remove the worktree
mc clean <id>      # throw the run away
mc help
```

mc spends tokens only where they help. The planner reads the repo once and picks a mode:

- **answer**: a question gets answered right away; nothing else runs.
- **solo**: a small change goes to one agent; the other reviews the diff.
- **split**: a bigger change is split into two halves with separate files, built at the same time, each reviewed by the other agent.

Builders get what the planner already found, so they don't explore the repo again. A reviewer that built the other half
continues its own session. Every agent ends with the same short report, and mc merges both into one result card.

In the interactive prompt, type `/help` for slash commands (`/mode`, `/merge`, `/clean`, `/review on|off`, `/aura`, `/view`, `/full`, `/planner`, `/model`, ...). Tab completes them and ↑ brings back earlier prompts; a multi-line paste is one request. While the agents work, the transcript shows every step (tool calls, command results, reasoning) and a live tree of boxes at the bottom shows what each agent is touching. `/aura mood|violet|ocean|sunset|matrix|gold|ice|fire|rainbow` colours it, `/view lines` swaps it for one status line per agent; both are saved. After a run, `m` merges, `d` lists the files changed and `c` throws the run away.

Options: `--mode auto|split|claude|codex`, `-y` (skip the plan confirmation), `--no-review`, `--full` (both agents may run any command),
`--planner claude|codex`, `--claude-model <m>`, `--codex-model <m>`.

Needs Node 22+, git, and the `claude` and `codex` CLIs signed in. Run it inside a git repository with at least one
commit.

## In Mission Control

Start it like a Claude or Codex chat: the **Duo with mc** card on Home, the **mc** button on a project page, **New → mc session**, the palette, or **Ctrl+Alt+D**. The app ships `mc` with the installer and runs it with Node from PATH in the project folder.

## Build and install

```
npm run cli:build          # from the repo root: bundles cli/dist/mc.mjs
cd cli && npm link         # puts `mc` on PATH
```

Design notes: `docs/decisions/0042-tasks-archived-and-mc-duo-cli.md`, `0044-mc-ai-terminal.md`, `0046-mc-teamwork-and-work-tree.md`.
