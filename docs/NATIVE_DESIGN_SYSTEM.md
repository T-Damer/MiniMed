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
| `bun run native:design preview` | builds the Wasm preview and serves it on `http://127.0.0.1:4175` — `?scene=design` is the interactive design gallery (`&theme=dark`, `&loading=1`, `&q=пневмония` opens sample results; submitting a query there does too), `?scene=design-reader` the reader over a Markdown sample (`&find=…`), `?scene=design-settings` and `?scene=design-files` the WebView settings and files pages rebuilt from parts, `?scene=search` the real screens |

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
| `NativeFeatureCarousel(features)` | `.carousel.useful-features`: equal heights, arrows, dots, 7 s autoplay until the user takes over |
| `NativeCarouselDots` | `.carousel__dots` |
| `NativeFlexRow` | `display: flex` with `flex: 1 1 auto` children |
| `NativeChoiceChip(accent)`, `NativeMeanings` | `.choice-chip` (`--accent` is the download chip), `.search-meanings__phrase` |
| `NativeSecondaryButton`, `NativeIdentityCard` | `.ui-button--secondary`, `.core-identity-matches__card` |
| `nativeDocumentItems(document, actions)`, `NativeDocumentBlock` | reader paper, `.document-overlay-section__title`, paragraphs, `.safe-markdown` blocks (docs/NATIVE_READER.md) |
| `NativeReaderTopBar`, `NativeReaderTool`, `NativeFindBar`, `NativeOutlinePanel`, `NativeReadingMenu`, `NativeScrollTopButton` | `.document-page__chrome`, `.document-find`, `.document-overlay-outline`, reading settings, `.scroll-top-button` |
| `NativePageHeader`, `NativeGroupTitle`, `NativePaperSheet` (+ `nativePaperRules`), `NativeSectionHeading` | `.page__header`, `.settings-page__group-title`, `.paper-sheet` (ruled paper), `.settings-section__heading` |
| `NativeSettingSwitch`, `NativeSwitch`, `NativeRangeSetting`, `NativeChoiceGroup`, `NativeDisclosure`, `NativeTextLink` | `.settings-row` + `.ui-switch`, `.range-input`, `.ui-choice-group`, `.ui-disclosure`, `.settings-page__link` |
| `NativeFeatureTile`, `NativePrimaryButton` | `.ui-feature-card` (optional capability), `.ui-button--primary` |
| `NativeSearchField`, `NativeBreadcrumbs`, `NativeIconToggle`, `NativeFolderCard` | `.archive-search`, `.user-library-breadcrumbs`, `.user-library-view-toggle`, `.user-library-folder-card`; round `back-button` / `sort-button` / `add-button` styles for `NativeIconButton` |
| `NativeResultGroup(snippets, action, tags)` | `.result-group`: header with faint index, kind badge, serif title, tags, note; accent action; fragments with category stamp, path and highlights; «Ещё N» disclosure |

Icons are slots (`icon: @Composable (tint) -> Unit`), so the design system does not depend on the
screens' glyph set. Screens must wrap their content in `ProvideNativeDesignTokens(dark)`.

## App frame and press feedback

- `NativeAppFrame` (applied by `NativeSpikeTheme`): below 760 dp the app fills the window; above it
  the page is `min(width − 32 dp, 1152 dp)`, centred, with the desk on both sides, as the web root
  page width. Nested frames do nothing.
- Press feedback (user decision 2026-09-30): no Material ripple anywhere (`LocalRippleConfiguration`
  is null). Raised controls use `Modifier.nativePressBox(style)`: while held they sink 1.6 dp and
  their outer shadows give way to a pressed-in shadow, as the web `:active` rule; rows, cards and
  other plain clickables get `NativePressShade`, a faint shade while pressed.

## Where native deliberately differs from the web

- **Core status in the field.** The web shows a separate `.search-core-status` card. Native
  `NativeQueryFooter(progress)` replaces the source picker and toggle with the status and the send
  button with a round progress; the field stays editable, and a query submitted before the core is
  ready runs as soon as it is (the screen shows «Ищем…» meanwhile).
- **Bottom navigation.** The bubble, its overshoot/stretch motion and the drag-to-switch gesture
  follow the web `use-bottom-nav.ts`; native adds a haptic tick per destination during the drag.
- **Card actions** follow web `flex: 1 1 auto` and never wrap; a label that still does not fit
  shrinks to 11 sp.
- **Dark theme bubble** is plain light paper (the theme text colour) with no highlight or accent rim,
  and the selected icon on it is dark.
- **Suggestion cards** in the carousel all take the tallest card's height, actions at the bottom.
- **Result fragments** start collapsed to the first one; the rest expand in place with a short
  height/fade animation and the chevron turns.

Text follows CSS line boxes: `NativeTextSpec.textStyle()` gives every line the full `line-height`
with the half-leading split evenly (`LineHeightStyle.Trim.None`), so text blocks measure as on the
web. A line shorter than its font (the 68 px result index in a 51 px line) is laid out in a box one
line tall, as the web lets it overflow.

## Parity checks

Compare components, not whole screens. A component carries the web BEM block name as its Compose
`testTag`; the check renders it with the same data in both worlds and compares numbers — size,
padding, corner radius, font size and weight, colours — from `getComputedStyle`/bounding boxes on
the web and the Compose semantics/layout tree natively, with small tolerances. A mismatch reads as
«`paper-card`: padding 16 vs 12», not as a pixel diff. `NativeComponentParityTest` (desktopTest) does
this for the home/search and result components within 1 dp; it caught touch targets that excluded padding and
the CSS border-box difference.

Coordination between agents (ownership, claims, requests) lives in `STATE.md` at the repository root.
