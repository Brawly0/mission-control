# 0025: Workspace dock and visual identity

2026-10-27

The project and Agents views share a resizable bottom dock with Terminal and Run tabs. Terminal shells are owned by the dock rather than becoming agents. Each PTY has exactly one mounted TerminalPane, preserving its screen and scrollback when collapsed, switched or hidden. Closing a terminal kills its process; closing the application uses the existing global PTY shutdown. Dock height, selected tool and expanded state are local UI preferences. Shells and scrollback last for the current application session.

The dock follows the active agent's actual folder, including app-created worktrees, or the selected project's root. Its folder label follows the selected terminal when a user chooses another existing shell. Run reuses RunPanel and the existing command runner. Command definitions stay on the root project; an optional working folder can target that root or a resolved descendant. Diagnostic agent launches retain the originating worktree. No additional process service or command format is introduced.

Agent tabs are grouped by project while preserving agent identity and keyboard shortcut order. A portal menu reaches tabs outside the visible strip. The agent toolbar and New session context follow the active project, and the branch label prefers the active worktree. Needs-you indicators are static. Project tabs follow the normal flow from overview and conversations to commands, changes and context.

Review presents diff approval, verification and optional agent findings separately. Output and setup details collapse to leave room for the diff. Snapshot-bound approval, stale-check detection and main-process merge guards remain unchanged. Failed saves keep the user's draft.

Colors and logo follow the user's brand sheet: Deep Space Navy #0B1020 background, Midnight Slate #1A2238 surfaces, Electric Cyan #22D3EE as the dark-theme accent (with near-black text on it), Signal Blue #3B82F6 and Soft Violet #8B5CF6 in gradients. Cyan is unreadable on white, so the light theme's accent is a deeper Signal Blue (#2563EB, white text). Claude's labels are violet and Codex's blue. The logo (orbital rings with three dots around a `>_` prompt, cyan to blue to violet, on a navy tile) is `build/icon.svg`, shared by the sidebar and the generated Windows PNG (`npm run icon`); terminals stay dark in both themes.

Validation: typecheck/build, existing unit suite, native PowerShell dock lifecycle and layout walkthrough, worktree command folder and merge-freshness checks. Smoke runs use the isolated self-test profile and no model calls.
