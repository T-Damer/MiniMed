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

## Commands

| Command | What it does |
| --- | --- |
| `bun run native:design sync [--build]` | capture the web reference, regenerate tokens and component styles |
| `bun run native:design check` | token/style drift checks plus `NativeComponentParityTest` |
| `bun run native:design compare [--build]` | web vs native home screenshots side by side, light and dark, in `playwright/design-compare/` |

`--build` rebuilds the WebView first; otherwise the existing `apps/app/dist` is used. Captures are
repeatable: reduced motion stops the carousel and transitions, and database downloads are held so
the core status stays at its first message (`scripts/lib/built-app-preview.ts`).

## Web reference

`bun run build:app && bun scripts/extract-web-component-reference.ts` serves the built WebView,
opens it at 375 × 812 in light and dark, and writes the computed styles and boxes of the key BEM
blocks to `native/shared/src/commonTest/resources/web-component-reference.json`
(`--list` prints the blocks visible on each screen). Components are written against these numbers
— many values, such as the query sheet's 12 px radius and its own shadow, live in component CSS,
not in the shared tokens — and the parity check compares against the same file.

## Component styles

`bun scripts/generate-native-component-styles.ts` turns the web reference into
`designsystem/NativeComponentStyles.kt`: per BEM block and theme, padding, corner, border,
background, shadow layers, gaps and text (`NativeDesign.components.<block>`). Icon buttons and
dots keep their fixed web size; buttons and rows keep the web `min-height`. Components add only
layout, behaviour and semantics. Painting goes through `Modifier.nativeBoxFrame(style)` →
interaction (`clickable`/`toggleable`) → `nativePadding(style)`, so the whole box is the touch target
and the ripple is clipped while shadows are not; `nativePadding` adds the border width because a CSS
border takes layout space. `native:source:check` fails when either generated file drifts.

Ready components (package `dev.localmed.nativespike.shared.designsystem`), each tagged with its
reference key:

| Component | Web block |
| --- | --- |
| `NativeIconButton(style = components.routeIconButton / historyFab / helpIconLink / carouselArrow / queryClear / searchButton)` | round icon controls |
| `NativeClinicalToggle` | `.search-clinical-toggle` (off/on) |
| `NativeActionButton(primary)` | `.home-feature__action` / `--secondary` |
| `NativeSourcePicker`, `NativeChip` (dashed border) | `.search-source-picker`, `.search-quick-access__all` |
| `NativeQuerySheet`, `NativeQueryInput`, `NativeQueryFooter(progress)` | `.query-sheet`, search input, `.query-actions` |
| `NativeFeatureCard(primary, secondary)`, `NativeStatusCard` | `.home-feature`, `.search-core-status` |
| `NativeSectionList`, `NativeSectionRow` | `.search-sections__list`, `__row` |
| `NativeBottomNav(items, selected, onSelect)` | `.app-bottom-nav` with `__bubble` |
| `NativeCarouselDots` | `.carousel__dots` |
| `NativeFlexRow` | `display: flex` with `flex: 1 1 auto` children |

Icons are slots (`icon: @Composable (tint) -> Unit`), so the design system does not depend on the
screens' glyph set. Screens must wrap their content in `ProvideNativeDesignTokens(dark)`.

## Where native deliberately differs from the web

- **Core status in the field.** The web shows a separate `.search-core-status` card. Native
  `NativeQueryFooter(progress)` replaces the source picker and toggle with the status and the send
  button with a round progress; the field stays editable, and a query submitted before the core is
  ready runs as soon as it is (the screen shows «Ищем…» meanwhile).
- **Bottom navigation.** The bubble, its overshoot/stretch motion and the drag-to-switch gesture
  follow the web `use-bottom-nav.ts`; native adds a haptic tick per destination during the drag.
- **Card actions** follow web `flex: 1 1 auto` and never wrap; a label that still does not fit
  shrinks to 11 sp.

## Parity checks

Compare components, not whole screens. A component carries the web BEM block name as its Compose
`testTag`; the check renders it with the same data in both worlds and compares numbers — size,
padding, corner radius, font size and weight, colours — from `getComputedStyle`/bounding boxes on
the web and the Compose semantics/layout tree natively, with small tolerances. A mismatch reads as
«`paper-card`: padding 16 vs 12», not as a pixel diff. `NativeComponentParityTest` (desktopTest) does
this for the home/search components within 1 dp; it caught touch targets that excluded padding and
the CSS border-box difference.

Coordination between agents (ownership, claims, requests) lives in `STATE.md` at the repository root.
