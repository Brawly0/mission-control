# 0009: Spend less: measure chat size, choose models and MCP servers per project

**Status:** accepted · 2026-10-24

## Context

The chat index showed where the money goes. New Opus chats in `bot` start at about 67K tokens before the first message, and long chats reach about 1M tokens, so every reply re-reads close to a million tokens. Ten user-scope MCP servers load in every project.

## Decisions

- **Measure, don't guess.** A live chat's size comes from the usage of Claude's latest reply, read from the end of its transcript (input + cache write + cache read + output). A project's startup size is the median first-reply context of its recent chats. Files are listed with rough token counts (bytes / 4). MCP tool-list sizes aren't known without connecting to each server, so the measured startup size is the number to watch.
- **Warn by absolute size, not by percentage of the window.** Cost per reply grows with tokens, whatever the window. The default warning is 200K. Red is at 2.5x the warning or at 85% of the window, whichever comes first. **Compact** only types `/compact` into the agent, and only while Claude isn't working.
- **MCP servers are limited per project through launch flags, not by editing Claude's config.** When a project has `mcpAllow`, Mission Control writes the chosen servers' config to its own folder and starts claude with `--strict-mcp-config --mcp-config=<file>`. The `=` form matters: `--mcp-config` takes several values and would otherwise swallow a prompt that follows it. Strict mode also leaves out plugin servers and claude.ai connectors, and the UI says so. Chats started outside Mission Control are unchanged.
- **Default models apply to new chats and tasks only.** Resumed and continued chats keep their model. A task without a model gets its project's default, then the app's. The value is stored on the task, so the card shows it.
- **Cost alerts are once per chat per day**, from the index, after each index run.
