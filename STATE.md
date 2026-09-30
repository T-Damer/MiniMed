# Agent sync state

Live coordination file for the agents working in this repository at the same time. It holds only
the current picture — who owns what, what is in progress, what one agent needs from another. History
lives in git and `docs/CURRENT_STATE.md`; product decisions live in `docs/`.

## Protocol

- Read this file (after `git fetch`) before starting a task and before every commit.
- Claim a task by adding a row to **In progress** and committing `STATE.md` on its own right away,
  before touching code. Remove the row when the work is committed; add one line to **Recently done**.
- Only edit paths you own. For a change in someone else's path, add a row to **Requests** and wait.
- Keep entries one line each and dated (YYYY-MM-DD HH:MM, local time). Delete what is no longer true.
- Commit only files you wrote; `git fetch` and rebase onto `origin/main` before pushing.

## Agents

| Agent | Tool | Role |
| --- | --- | --- |
| claude-coordinator | Claude Code (desktop) | coordination, design system, native search core, commits for Claude sessions |
| codex-native | Codex (ChatGPT app) | native screens, navigation, app state, visual preview, icons |
| claude-ui | Claude Code session «Улучшения приложения» | WebView UI (frozen reference; fixes only) |

## Ownership (native)

| Paths | Owner |
| --- | --- |
| `native/shared/src/commonMain/kotlin/dev/localmed/nativespike/shared/designsystem/**`, `ui/Theme.kt`, fonts, `scripts/generate-native-design-tokens.ts`, `docs/NATIVE_DESIGN_SYSTEM.md` | claude-coordinator |
| `native/shared/**/lexical/**`, `native/shared/**/db/NativeSearchDatabase.kt` (after codex-native commits its current edits there) | claude-coordinator |
| `native/shared/**/ui/**` except `Theme.kt`, navigation, app state, `wasmJsMain/**`, icons, visual preview scripts | codex-native |
| `apps/app/**` (WebView reference) | claude-ui (fixes only) |
| `STATE.md` | everyone (own rows only) |

## In progress

| Since | Agent | Task | Paths |
| --- | --- | --- | --- |
| 2026-09-30 15:40 | codex-native | commit the current native work (visual preview, icons, screen edits) | its uncommitted files |
| 2026-09-30 15:40 | claude-coordinator | fonts (Cascadia for digits/stamps) and text styles; `Theme.kt` on generated tokens | `designsystem/**`, `ui/Theme.kt` |

## Next (claimed, not started)

| Agent | Task |
| --- | --- |
| claude-coordinator | design-system components: paper card, buttons, round icon button, query sheet, clinical toggle, source picker, stamps, section rows, paper sheet/dialog |
| claude-coordinator | port the per-document lexical window (TS 26a69921) to Kotlin; refresh search golden fixtures |
| codex-native | migrate screens to design-system components as they land, search screen first (one row: source picker, brain toggle, round send) |

## Requests

| Date | From → To | Request | Status |
| --- | --- | --- | --- |

## Recently done

- 2026-09-30 claude-coordinator: design tokens generated from the WebView theme (`1be9863d`); plan in `docs/NATIVE_DESIGN_SYSTEM.md`.

## Waiting for the user

- None.
