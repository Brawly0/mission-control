# 0037: Claude and Codex logos in place of their names

Date: 2026-11-07

## Context

The user asked for the words "Claude" and "Codex" to be replaced by their logos everywhere in the app UI. They chose logo only (no word), app UI only (not inside chats, notes or prompts), and the real brand marks. The renderer has about 175 places that mention either name, many inside template strings, props passed to shared components, and generated text such as the fun facts.

## Decision

- The renderer uses a custom JSX runtime (`jsxImportSource: '@mc-brand'` in `electron.vite.config.ts`, files in `src/renderer/src/brand/`). It wraps React's runtime and, for DOM elements and fragments, swaps any text child containing the whole word `Claude` or `Codex` for a `BrandText` element that renders the logo as an inline SVG (`role="img"`, `aria-label` = the name). Nested child arrays are walked too, so `<Button>Send to {name}</Button>` works.
- Only text children change. Attributes (`title`, `aria-label`, `placeholder`) stay text, so tooltips and screen readers still read the names.
- Matching is case-sensitive and whole-word: `claude-hub`, `CLAUDE.md`, `Claude.md`, `@Claude` and paths are left alone.
- Skipped: `textarea`, `input`, `select`/`option`, `code`, `pre`, `kbd`, `samp`, `title`, `style`, `script` and SVG `text`/`tspan`. Any element with `data-no-brand` keeps its own text children, and `<NoBrand>` keeps a whole subtree as text. They're used for user messages, Prompt Studio turns, task prompts and activity, recap quotes, note rendering, vault outline, knowledge and search snippets. Assistant replies and briefings render through react-markdown, which uses React's own runtime, so they are never changed.
- The marks come from simple-icons (CC0 path data): the Claude starburst in `#d97757` and the OpenAI mark in `currentColor`, sized to 1.1em.

## Alternatives

- Editing all ~175 call sites with a `<Brand>` component: large, easy to miss spots, and new strings would need remembering.
- A `MutationObserver` that rewrites text nodes in the DOM: React keeps references to the text nodes it created, so splitting them breaks later updates and can throw on unmount.

## Consequences

- New UI text gets logos automatically. Content that must stay verbatim needs `data-no-brand` or `<NoBrand>`.
- Text copied from the UI drops the names (the logo has no text content).
- Type checking still uses React's runtime types; the custom runtime has the same signatures.
