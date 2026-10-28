# 0032: Useful empty states and responsive view controls

Date: 2026-10-28

Status: Accepted

## Context

Tasks hid the workflow entirely when empty, toolbar controls had different heights, and the project filter competed with actions. Search offered little help before a query. Project cards varied visually with descriptions and tags and repeated launch actions throughout the grid. Settings reserved a large fixed area even for short tabs and mixed unrelated General preferences.

## Decision

Keep the existing React controls, callbacks and CSS variables. Tasks uses a bounded project filter beside its title and 38px toolbar groups with responsive wrapping. The existing four column definitions and hints render for empty boards. A short message distinguishes an empty board from an empty project selection, which offers Show all projects. New task remains in the toolbar and To do header. At narrower widths the board uses two columns with scrolling instead of forcing wide columns offscreen.

Search offers plain-word example queries as suggestions, explicitly without promising matches. Buttons set the existing query state and focus the input; debounce, cancellation, errors, role/project filters and result actions retain their existing path. Do not add persisted search history or imply advanced query syntax.

Project grid rows stretch cards to equal heights and align action areas at their bottoms. New session appears on hover or focus within a card; it remains focusable and is visible by default on devices without a fine hover pointer. The project-opening button, session button and actions menu remain siblings, avoiding nested interactive controls. The current preferred-provider callback remains the only launch interface. Descriptions that repeat the project or folder name use live-session context, last activity or a first-session hint; meaningful descriptions remain intact. Grid/list filtering, ordering and project menus keep their existing wiring.

General settings groups all existing controls under Profile, Notifications and Window. Short tabs use their content height with a usable minimum; the dialog keeps its width and maximum viewport height, and longer content scrolls within the pane. The Windows first-name fallback contract, persistence, validation, hotkey recording, theme/zoom and close behavior remain unchanged.

Tasks and Search rules live in tasks.css and organize.css. Projects and Settings overrides in ui2.css use component scoping to survive later dashboard.css declarations. No backend task behavior, IPC surface or UI framework is added.

## Verification

The isolated UI polish tour creates local projects with mixed description/tag lengths, display-only tasks and local waiting Claude/Codex CLI fixtures. It checks empty and filtered boards, control heights and wrapping, clickable Search suggestions, equal project row/action geometry, keyboard visibility of session actions, preferred-provider routing, grouped Settings and content sizing. It captures dark/light at 1440 and 960 pixels and Settings at 125% zoom, with viewport bounds checks. Existing shell checks remain behavioral to permit independent meter and connection markup changes. Fixtures run without model calls and restore the isolated profile's settings and project metadata.

## Consequences

The empty views teach the same workflow users see once populated. Narrow boards may scroll vertically. Session actions occupy space even while visually hidden, preventing layout jumps; keyboard focus reveals them before activation. Settings height can change across tabs while navigation and dialog width remain stable.
