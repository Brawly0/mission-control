# 0027: Reliability and public distribution gates

2026-10-27

Keep the current feature set and make the Windows application ready for wider distribution.

Settings writes remain atomic. Before replacing the primary file, retain the previous valid file as `store.json.bak`. Invalid primary input is preserved as a timestamped `.corrupt-*` file rather than destroying the valid backup. Reads fall back to the backup, validate top-level collection shapes and merge older nested Eco settings with current defaults. The format stays compatible with existing installations.

Task starts are guarded while their folder/worktree is being prepared. Check reruns cannot replace a live check process, and active checks count as running work for close-to-tray. Shutdown disables queue pumping and new starts, clears the queue timers and synchronously terminates owned process trees within a bounded timeout. Project-command Stop failures return to a retryable state. PowerShell terminals use the Windows executable's full path, including on fresh accounts with a minimal PATH.

Automatic update checks respect the preference on focus as well as on timers. Turning them off cancels the delayed initial check. Concurrent checks share one promise, a ready download is preserved, and failed Update now requests do not leave a pending automatic restart. Self-tests never install a downloaded update on quit.

First-run connection details link to the official CLI installation guides. New session without a project opens project setup, and the connection card can open a setup shell without a project. Missing Desktop/Documents known-folder entries fall back to paths under the user's home. No credentials or CLI configuration are written by this guidance.

The public GitHub repository remains a download/release repository; the private source is not made public. Its README includes installation, requirements, screenshots, data handling and troubleshooting. A public issue form requests reproducible reports without private data.

`scripts/check-release.mjs` gates the exact packaged application with isolated profiles and no model calls: first run without CLIs/history, setup terminal, native process cleanup, duplicate-start/check protection, installer SHA-512 consistency, and an actual updater download from a temporary loopback feed. The feed reports a newer test version but serves the actual installer; self-test auto-install is disabled and its cache is isolated. Release publication also requires the installer, blockmap, latest.yml and SHA256SUMS.txt assets.

Install/upgrade/uninstall is exercised separately using the same NSIS configuration with a distinct app ID/name and launch-after-install disabled, so the installed daily-use application is untouched. The test checks executable replacement, saved data preservation and shortcut cleanup. This is a native Windows test, not a clean Windows VM or a claim of Windows 10 validation. Code signing remains a separate prerequisite requiring an owner-provided signing identity.

Independent review follow-up: checks re-check the shutdown flag after an awaited commit, and record an interrupted check rather than spawning it. Shared bounded process cleanup inspects tree-kill results, retries surviving roots and falls back to direct root termination, with failures logged. Regression proof includes a delayed real git pre-commit hook and taskkill failure/timeout tests.
