# Native design system

Decision (2026-09-30): the Kotlin Multiplatform + Compose app is the product; the WebView app is
frozen as the reference for design and search behaviour. Native screens must look like the
WebView because they are built from the same tokens and the same components, not because each
screen was matched by eye.

## Layers

1. **Tokens** — `native/shared/src/commonMain/kotlin/dev/localmed/nativespike/shared/designsystem/DesignTokens.kt`
   is generated from `apps/app/src/styles/theme.css` and `theme-dark.css` by
   `bun run native:tokens` (`scripts/generate-native-design-tokens.ts`). The dark theme follows the
   CSS cascade: it overrides the light `:root` and every `var()` resolves again inside it;
   `color-mix(in srgb, …)` is computed; 1 rem = 16 dp, 1 CSS px = 1 dp. Never edit the file by hand;
   `bun run native:source:check` fails when it drifts from the CSS. Font stacks, grain images and
   the desk gradient are listed as not generated and are implemented in code.
2. **Typography** — as on the Android WebView: headings `--font-serif` (Georgia → platform serif),
   body Arial (→ platform sans), digits and uppercase stamps `--font-mono` (Cascadia Code, bundled
   in the web app under `public/fonts`). Numerals are tabular everywhere.
3. **Components** — one Compose component per web BEM block (paper card, buttons, round icon
   button, query sheet, source picker, clinical toggle, stamps and kickers, section rows, paper
   sheets and dialogs, bottom navigation). Components read only tokens. Material 3 primitives are
   allowed inside the design-system package, not in screens.
4. **Screens** — rebuilt from components, search first, then tools, readers, sources and
   collections.

## Parity checks

Compare components, not whole screens. A component carries the web BEM block name as its Compose
`testTag`; the check renders it with the same data in both worlds and compares numbers — size,
padding, corner radius, font size and weight, colours — from `getComputedStyle`/bounding boxes on
the web and the Compose semantics/layout tree natively, with small tolerances. A mismatch reads as
«`paper-card`: padding 16 vs 12», not as a pixel diff.

Coordination between agents (ownership, claims, requests) lives in `STATE.md` at the repository root.
