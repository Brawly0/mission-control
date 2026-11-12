# 0006: Auto-update from a separate public releases repo

**Status:** accepted · 2026-10-20

## Context

electron-updater needs to download `latest.yml` and the installer from somewhere. The source repo (`Brawly0/claude-hub`) is private, and reading private GitHub releases would mean shipping a GitHub token inside the app, where anyone with the installer could extract it.

## Decision

Publish installers to a separate **public** repo, `Brawly0/mission-control-releases`, which contains only release assets. `package.json → build.publish` points there, so electron-builder writes `app-update.yml` into the app and electron-updater checks it. Publishing uses the developer's `gh auth token` for that one command only. It's never stored in the app or the repo.

## Alternatives rejected

- **A token in the app:** a leaked token would give access to the private source.
- **Making the source public:** the user chose to keep it private.
- **A local-folder updater:** only works on the build machine.

## Consequences

- Release assets are public; the source isn't.
- The installer isn't code-signed, so SmartScreen may warn on first install. Updates install silently once the app is installed.
- Only packaged builds check for updates; `npm run dev` never does.

## Update (2026-11-12)

The source moved into the public repo, renamed from `mission-control-releases` to `Brawly0/mission-control`, and `claude-hub` was deleted. Releases and source now live in one repo. GitHub redirects the old name, so installed copies built against `mission-control-releases` keep updating. Never create a new repo named `mission-control-releases`, because that would break the redirect.
