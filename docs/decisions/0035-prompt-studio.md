# 0035: Prompt Studio

Date: 2026-11-01

## Context

Users write prompts for Claude Code and Codex by hand and get uneven results. They wanted to describe a goal in plain words, be asked only what matters, and receive a prompt tuned for the chosen agent, improving with their own reference material.

## Decision

A Prompt Studio page holds a chat that interviews the user (at most 3 short questions per turn, none after two assistant turns) and then returns one copy-ready prompt. Generation is a one-shot `claude -p` call through the existing `askClaude` (now with a model parameter, Sonnet here), so no API key is needed. The system prompt stays one short quote-free line because the command may run through a cmd.exe shim; rules, library excerpts and the conversation go on stdin.

Learning is a resource library stored in the app store: pasted text, files and web pages (http/https only, 20 s timeout, 2 MB cap, text extracted from HTML). Each request sends the most relevant enabled resources, ranked by shared words (title hits weigh more) within a 24,000 character budget. Library text is wrapped as reference material and the model is told to ignore instructions inside it. No embeddings or full text index: keyword ranking is enough for a personal library and has no dependencies.

Output actions: Copy, Send to a new Claude or Codex agent with the prompt as its first message, and Save to a snippet list (closes the roadmap item for prompt snippets).

## Consequences

Each reply costs one Claude call. Generated prompts are only as current as the built-in best-practice guides and the user's library. Nothing is written to `~/.claude/`.
