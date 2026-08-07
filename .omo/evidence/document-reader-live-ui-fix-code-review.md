# Code review: document-reader-live-ui-fix

## Outcome

- `codeQualityStatus`: BLOCK
- `recommendation`: REQUEST_CHANGES
- Skill-perspective check: ran. I consulted `omo:programming` (including its TypeScript rules) and `omo:remove-ai-slops`. The diff violates both perspectives through an unneeded global history abstraction, an unnecessary metadata accessor, and untested behavior that changes navigation.

## Evidence inspected

- Requested diff and current sources: `AGENTS.md`, `apps/app/src/components/OverlayDialog.tsx`, `apps/app/src/features/library/DocumentReaderDialog.tsx`, `apps/app/src/styles/doctor-ux.css`, and `apps/app/src/styles/theme-dark.css`.
- Parent close paths in `apps/app/src/features/library/DocumentOverlayHost.tsx` and Android Back handling in `apps/app/src/app/App.tsx`.
- `bun run typecheck` in `apps/app`: passed.
- `bunx biome check` on the four changed app files: passed.
- `git diff --check` on the requested diff: passed.
- No focused dialog/history regression test was present or supplied.

## CRITICAL

None.

## HIGH

- `apps/app/src/components/OverlayDialog.tsx:23-54` — History management is applied to every overlay, although only the document reader needs Back support. Every modal now adds `?dialog=<title>` and a `popstate` listener. This changes existing navigation semantics for errors, forms, module dialogs, calculator dialogs, and loading dialogs. It also does not remove the synthetic entry when a parent closes the dialog directly (for example `DocumentOverlayHost.tsx:258-260` or its loading/error close handlers): the reader disappears but `?dialog=` remains in the current entry, so the next Back navigates the app history rather than merely dismissing the already-closed dialog. This fails the requirement to preserve existing navigation behavior. No test exercises Back, close, or programmatic-close history sequences.

## MEDIUM

- `apps/app/src/styles/doctor-ux.css:99-105`; `apps/app/src/features/library/DocumentReaderDialog.tsx:211` — The new state class is `outline-hidden`, rather than a semantic BEM modifier, and its new selector depends on DOM nesting (`.document-overlay-layout.outline-hidden .document-overlay-outline`). This directly violates the newly added `AGENTS.md` BEM rule. Use block modifiers/classes on the affected elements rather than a descendant selector.

- `apps/app/src/styles/theme-dark.css:74-242` — The reader fix adds 170 lines to this theme file, including assessment and module styling unrelated to the requested reader behavior. Many of those newly added selectors are descendant/element selectors (for example `:85-86`, `:120-127`) prohibited by the new BEM policy. This is scope drift and makes the reader change harder to validate.

- `apps/app/src/features/library/DocumentReaderDialog.tsx:48-50,370` — `documentSourceSpans()` adds a one-use `Reflect.get` metadata extraction unrelated to Back/sticky-title/BEM work. It neither improves the established contract nor removes a boundary concern; it is needless production complexity under the slop review criteria.

## LOW

None.

## Confirmed portions

- The reader’s visible Back control invokes the dialog close path (`DocumentReaderDialog.tsx:188-206` and `OverlayDialog.tsx:84-93`).
- Sticky section titles use opaque `var(--theme-surface-raised)` (`doctor-ux.css:227-246`), which resolves to opaque `#fbf7ea` in light mode and `#30312c` in dark mode (`global.css:10`; `theme-dark.css:8`).
- The new menu toggle exposes `aria-expanded` and has an accessible label (`DocumentReaderDialog.tsx:198-206`).

## Blockers

1. Scope history behavior to the document reader and ensure every close path removes or reconciles its synthetic history entry without changing underlying app navigation.
2. Add focused behavior coverage for browser/native Back, close controls, and parent/programmatic reader closure.
3. Bring newly introduced CSS classes and selectors into compliance with the repository BEM rule; remove unrelated theme changes from this fix.
