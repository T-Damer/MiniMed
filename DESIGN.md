# MiniMed Design System

## 1. Atmosphere & Identity

MiniMed is a quiet clinical archive: warm paper, a muted desk, and compact controls that keep the
source material in focus. The signature is the paper-sheet surface floating above a softly textured
desk. The existing archive look is preserved; consistency comes from shared tokens and predictable
states, not from adding more decoration.

## 2. Color

| Role | Token | Value | Usage |
| --- | --- | --- | --- |
| Desk | `--theme-background` | `#777266` | App background |
| Paper | `--theme-surface` | `#f3ecd9` | Cards and sheets |
| Raised paper | `--theme-surface-raised` | `#fbf7ea` | Interactive surfaces |
| Muted paper | `--theme-surface-muted` | `#e6dcc4` | Secondary blocks |
| Border | `--theme-border` | `#cbc0a7` | Hairlines and dividers |
| Text | `--theme-text` | `#292720` | Primary copy |
| Muted text | `--theme-text-muted` | `#585349` | Supporting copy |
| Accent | `--theme-accent` | `#405b4e` | Primary action and focus |
| Danger | `--theme-danger` | `#87453c` | Errors and failed tasks |
| Warning | `--theme-warning` | `#75560f` | Retry and caution states |

Use the warm neutral palette for surfaces and one muted green accent for interaction. New colors are
added as semantic tokens before use.

## 3. Typography

| Level | Size | Weight | Usage |
| --- | --- | --- | --- |
| Display | `clamp(1.6875rem, 3.2vw, 2.625rem)` | 500 | Page titles |
| Section | `clamp(1.5625rem, 3vw, 2.5rem)` | 500 | Search and feature headings |
| Body | `1rem` | 400 | Main copy |
| Small | `0.75rem` | 400 | Supporting copy |
| Label | `0.4375rem–0.6875rem` | 500–600 | Archive metadata and status |

Body uses Arial/Helvetica; headings use Georgia; metadata uses the system monospace stack. Text
measure stays compact for clinical reading, while catalog grids may expand inside the same shell.

Reusable type tokens are `--theme-type-label` (0.6875rem), `--theme-type-field-label` (0.78rem),
`--theme-type-caption` (0.75rem), `--theme-type-response`, and `--theme-weight-label`,
`--theme-weight-emphasis`, and `--theme-weight-strong`.

## 4. Spacing & Layout

Spacing is rem-based with a 0.25rem base step. The app uses a centered content shell, compact paper
cards, and a fixed bottom navigation bubble. The bottom safe-area inset is always included in shell
padding. At mobile widths the primary content becomes one column with no horizontal overflow.

Reusable layout tokens are `--theme-space-1` through `--theme-space-5`, `--theme-space-control`,
`--theme-space-body-gap`, `--theme-space-floating-inline`, `--theme-radius-control`,
`--theme-radius-panel`, `--theme-border-hairline`, `--theme-outline-width`,
`--theme-outline-offset`, and `--theme-outline-tight-offset`. Motion uses
`--theme-motion-control` and `--theme-motion-standard`; assessment controls use
`--theme-assessment-floating-size`, `--theme-assessment-floating-offset`,
`--theme-assessment-scroll-top-offset`, `--theme-assessment-response-safe-space`,
`--theme-bottom-nav-clearance`, `--theme-bottom-nav-secondary-clearance`,
`--theme-control-height-large`, `--theme-control-icon-size`, `--theme-icon-size-small`,
`--theme-icon-size-methodology`,
`--theme-assessment-response-height`, `--theme-assessment-legend-overlap`,
`--theme-assessment-legend-padding`, and `--theme-text-underline-offset`.
Assessment surfaces may scope `--assessment-content-width`, `--assessment-radius-pill`,
`--assessment-message-width`, `--assessment-message-close-size`, and
`--assessment-help-label-size` locally when a component needs feature-specific geometry or type;
these values stay local to the assessment surface rather than becoming global theme tokens.

Print documents use a local token contract: `--print-page-margin`, `--print-title-size`,
`--print-body-size`, `--print-footer-size`, `--print-leading`, `--print-footer-gap`, and
`--print-qr-size`, and `--print-border-width`. Print ink and rules use browser system colors so
saved PDFs remain legible in light and dark browser themes.

## 5. Components

### Paper surface

- **Structure**: `section` or `article` with `paper-card` or `paper-sheet`.
- **States**: rest, hover, focus-visible, loading, empty, and error.
- **Accessibility**: semantic headings, readable contrast, keyboard-visible focus.
- **Motion**: color/shadow hover feedback only.

### Root navigation

- **Structure**: fixed `nav.app-bottom-nav` containing icon-only labelled buttons.
- **States**: active, rest, hover, focus-visible, and disabled.
- **Accessibility**: Russian accessible labels and current-page styling.
- **Motion**: direction-aware transform/opacity entry; reduced motion disables it.

### Download status

- **Structure**: floating compact pill that expands into a task panel.
- **States**: queued, downloading, verifying, installing, retrying, failed, and offline.
- **Accessibility**: live region, explicit action labels, and progress text alongside the bar.
- **Motion**: width/opacity changes are short and non-blocking; transfer progress is not animated by
  layout.

### Tool section

- **Structure**: a paper section groups related tests or calculators before individual tool cards.
- **States**: available to download, downloaded to device, partially downloaded, planned, and locked
  detail route.
- **Accessibility**: the section heading, device count, primary download action, and locked-route
  explanation remain visible together.
- **Interaction**: download the section first, then open tools inside it; direct tool links explain
  the missing section instead of showing an unusable form.

### Button

- **Structure**: use `Button` from `apps/app/src/components/Button.tsx` with `primary`, `secondary`,
  `quiet`, `danger`, or `icon` variants.
- **Icon rule**: every button has a leading icon; icon-only controls use a Russian `aria-label` and a
  tooltip/title when the action is not obvious.
- **Copy**: labels describe the user outcome (`Скачать`, `Удалить`, `Распечатать`), not implementation
  details. A tooltip or dialog carries secondary explanation.
- **Destructive actions**: delete, remove, disable, and rollback actions require a confirmation dialog
  before the mutation. Use `ConfirmationDialog`, not an unlabelled browser prompt.

### Card

- **Structure**: use `Card` from `apps/app/src/components/Card.tsx` for repeated paper surfaces; keep
  one clear heading and one compact metadata row.
- **Click target**: a card that opens a detail route or reader is clickable as a whole and has keyboard
  activation. Do not add a second `Открыть`, `Что входит`, or `Выжимка` button inside it. Buttons that
  perform another action (download/delete) stop propagation and retain their own accessible name.

### Count badge

- **Structure**: `CountBadge` renders a short numeric label beside a collection heading.
- **Variants**: compact capsule with a one- or multi-character count.
- **States**: rest; focus only when the count becomes interactive.
- **Accessibility**: visible text remains the count; the badge is not a standalone control.
- **Motion**: none.

## 6. Motion & Interaction

| Type | Duration | Easing | Usage |
| --- | --- | --- | --- |
| Micro | 120–140ms | ease-out | Button and control feedback |
| Standard | 200ms | ease-in-out | Panels and active states |
| Root navigation | 240ms | `cubic-bezier(0.22, 0.61, 0.36, 1)` | Direction-aware view entry |

Only `transform` and `opacity` are used for route motion. Root navigation commits synchronously so
rapid taps do not wait on a View Transition snapshot. `prefers-reduced-motion: reduce` removes the
route animation. The navigation interaction follows the beui.dev tabs principle: the active state
moves immediately and the indicator is the only animated context cue.

Dialogs that represent a user-visible state are reflected in navigator history, so Back closes the
current dialog before leaving its underlying route. The URL carries the dialog key for shareable
navigator state; closing several nested dialogs cuts history back to the underlying page in one step,
and opening a new document or modal creates one new history entry.

Primary pages prefer cards, tooltips, and dialogs over long informational accordions. Accordions remain
for genuinely optional technical detail inside a reader or result.

Any horizontally overflowing strip translates vertical mouse-wheel delta into horizontal scrolling;
touch and trackpad horizontal input remain native. At the strip edge the page may continue scrolling.

## 7. Depth & Surface

Depth uses a mixed strategy: tonal shifts for the desk/paper relationship and warm tinted shadows for
floating cards and navigation. Borders remain hairlines and are never the only error signal.

### Primary Obsidian extraction

MiniMed borrows the Primary Obsidian theme's functional principles, not its brand assets: lower
contrast for secondary surfaces, deliberate borders, and layered inset/external shadows for controls
and raised blocks. The source extraction and mapping matrix live in
[`docs/PRIMARY-OBSIDIAN-THEME.md`](docs/PRIMARY-OBSIDIAN-THEME.md).

- The implemented mapping applies to the shared paper surfaces, `Button` controls, search/index
  blocks, and the fixed root navigation.
  - Medication headings, count badges, and assessment controls now use the same warm surface, accent,
    deliberate-border, and translucent-state rules; calculator and document-specific rules remain
    feature-owned until those screens are edited deliberately.
  - Dark-mode `--theme-text-faint` is kept above the AA contrast target for compact metadata on the
    warm surface ramp; feature-specific colors remain owned by their screens.
  - Root navigation uses accessible icon-only buttons. The assessment and calculator entries use the
    Phosphor Bold `list-checks` and `calculator` paths in `AppGlyph`, normalized to the component's
    existing SVG contract and exposed with semantic BEM state classes plus `aria-current`.

## 8. Accessibility Constraints & Accepted Debt

### Constraints

- Target WCAG 2.2 AA contrast for body text and controls.
- Every interactive element has a visible focus state and a Russian accessible name.
- Reduced motion is respected for route and control animation.
- Download failures remain actionable and never replace the offline core search path.

### Accepted Debt

| Item | Location | Why accepted | Exit |
| --- | --- | --- | --- |
| A few feature styles still contain legacy literal colors | `apps/app/src/styles/*.css` | Existing archive screens are broad and already share the root token ramp | Consolidate when a feature is otherwise edited |
| The shell remains intentionally compact on wide screens | `apps/app/src/styles/global.css` | Clinical source reading benefits from a narrow measure | Revisit after a user-tested layout study |
