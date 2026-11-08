# Typed errors

Rule (owner, 2026-11-08): every error state is checked, and an unhandled error kind must not
compile, in code and in the interface. Exceptions are for bugs; expected failures are values.

## Pattern (`packages/contracts/src/result.ts`, `typed-errors.ts`)

- An error is a union of objects with a `kind`: `{ kind: 'offline' } | { kind: 'http'; status?: number }`.
- `Result<T, E>`, `ok()`, `err()` already existed; `TypedResult<T, E extends KindedError>` narrows them.
- `matchError(error, handlers)`: `handlers` has one function per `kind` (mapped type), so a missing or
  extra kind is a compile error. `switch (e.kind) { … default: return assertNever(e); }` is equivalent.
- `ErrorStates<E>`: a table `{ [kind]: { title, text?, action? } }`. Every kind has its own state;
  `action` is one of `retry | download | settings | open-external | dismiss`
  (`ERROR_ACTION_LABELS` holds the labels).
- A thrown error crosses into the typed world once, in an `attempt…` function (the only `catch`),
  which maps known classes to a kind and files anything else as `unexpected` after `console.warn`.

## Rendering

`apps/app/src/components/calm-error-props.ts` turns a state into `CalmError` props. A button is drawn
only if the screen passes a handler for the state's `action`; the others get text only. Small spots
(a list row, a toast) use the same state through `failureLine(state)`: «title. text».

## Adding an error kind

1. Add the member to the union (`FeedFailure` in `news-types.ts`).
2. `bun run typecheck`: the compiler lists the state table and every `matchError` that lacks it.
3. Write the state (plain fact, one line on what happens next), map the producer in `feedFailureOf`.
4. Add the kind to the test list in `news-failure.test.ts`.

## What enforces it

- tsc: `ErrorHandlers` / `ErrorStates` mapped types; `// @ts-expect-error` cases in
  `packages/contracts/src/typed-errors.test.ts` fail if a missing kind ever compiles.
- Biome override in `biome.json` for `features/news`, `components/calm-error-props.ts` and
  `typed-errors.ts`: `nursery/useExhaustiveSwitchCases`, `suspicious/noEmptyBlockStatements` (no silent
  `catch {}`), `complexity/noUselessCatch`. Widen `includes` as other areas migrate.
- `bun run check:errors`: `nursery/noFloatingPromises` on the same paths. It is type-aware and cannot
  be scoped by an override (only root-level config activates it; a whole-repo run took over 15 min), so it
  is a separate script; add paths to it as areas migrate.
- Unit tests: every kind has a distinct state and a mapping (`news-failure.test.ts`).

## Example area: news feed (`apps/app/src/features/news/`)

`news-failure.ts` holds `FEED_FAILURE_STATES` (offline, cors, network, timeout, http, too-large,
not-a-feed, malformed, rejected, empty, unexpected) and `SUBSCRIBE_FAILURE_STATES` (adds limit,
invalid-input). Used by the source sheet (`CalmError` with retry / add-as-site), the feed banner,
the sources list, the article and page fallbacks of the viewer, the PubMed search and all toasts.
