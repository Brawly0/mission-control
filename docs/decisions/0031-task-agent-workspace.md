# 0031: Agent workspace inside Tasks

Date: 2026-10-28

## Decision

Tasks owns a task-scoped agent workspace, opened with **Watch agents** on a team card or its drawer, or **Task agents** in the Tasks toolbar. A task selector separates teams. Each workspace includes its planner, workers and final integrator, with Tabs and Grid layouts, assignment details, live status, and maximize/restore in Grid. Arrow keys, Home and End navigate the agent tabs. The layout preference is local to Tasks.

The existing typed task list, task-output IPC and interactive PTY remain the source of truth. Team members are individual provider processes managed by the existing coordinator. Presenting them in tabs must not start duplicate agents, kill processes on navigation, change permissions, or bypass team controls. Waiting members have an explicit dependency explanation instead of a fabricated terminal. Completed runs remain selectable after restart; their output follows the existing saved-event reconstruction limits. Only the selected workspace mounts terminal panes; switching layouts keeps its panes mounted.

Managed background runs retain their read-only streamed consoles. Interactive tasks retain editable PTYs and the existing single-input-owner terminal bus. Converting a team worker into a freely interactive CLI is a separate lifecycle change and is not implied by presenting its real output in a tab.

## Verification

`taskWorkspace.test.ts` covers grouping, saved history, project filtering, missing members, dependency failures, paused teams and checks. The native `MC_SMOKE_TEAM=1` tour exercises real fixture processes, waiting and completed agent tabs, keyboard navigation, both layouts and themes at 1440 and 960×600, board/drawer entry points, integration/checks/commit, and an interactive PTY accepting one key exactly once. No paid model calls are needed.
