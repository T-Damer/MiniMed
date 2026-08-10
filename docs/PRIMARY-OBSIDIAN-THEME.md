# Primary Obsidian theme extraction

Research source: the [official Primary Obsidian repository](https://github.com/primary-theme/obsidian),
using its README and source Sass files on the `main` branch. This is a design translation for MiniMed,
not a claim of screenshot or pixel parity with Primary.

## Source principles

The README describes Primary as a warm, playful productivity theme and names these relevant rules:

- **Functional contrast:** lift the focused file/note panes while dimming secondary areas; reserve
  higher contrast/chroma for urgency and lower contrast for supporting material.
- **Layered space:** establish hierarchy with tonal surfaces, blur, and shadows rather than relying on
  borders everywhere; use borders deliberately to separate or lift.
- **Deliberate states:** design every component state, including hover, active, focus, and disabled,
  with small visual differences that carry meaning.
- **Warm limited palette:** the classic palette uses warm grays with restrained primary-color accents
  (red, yellow, blue, and green) instead of one saturated accent everywhere.

The implementation details are visible in the repository's [button component](https://github.com/primary-theme/obsidian/blob/main/src/scss/30_components/_button.scss),
[icon component](https://github.com/primary-theme/obsidian/blob/main/src/scss/10_foundations/_icon.scss),
and [classic palette](https://github.com/primary-theme/obsidian/blob/main/src/scss/10_foundations/palettes/_classic-original.scss):

- Buttons use compact padding, a small radius, and an inset highlight plus external elevation shadow.
  Hover, active, and focus states each change the shadow recipe; focus also gets a visible ring.
- Raised blocks use a tonal background pair and layered shadows. Borders are hairlines with a stronger
  hover/focus border color.
- Dark mode keeps warm brown-gray surfaces, lighter warm text, dimmer secondary text/icons, and a
  brighter accent state. Dark shadows are deeper than light shadows, but remain layered rather than
  becoming one opaque outline.

## MiniMed mapping

### Applies now

| Surface | Mapping | Evidence in code |
| --- | --- | --- |
| Shared paper cards and sheets | Warm tonal surface ramp, hairline border, layered paper shadow | `global.css` root tokens and `theme-dark.css` dark overrides |
| Shared `Button` controls | Compact radius, inset highlight, external hover/active shadow, visible focus ring | `components.css` `.ui-button*` rules |
| Search/index blocks | Secondary muted surface, deliberate dividers, accent only for selected/urgent states | `theme-dark.css` `.query-index`, `.index-row`, `.fact-tag`, `.branch-ticket` |
| Fixed root navigation | Raised bubble with a deliberate active surface; icon-only buttons keep Russian labels/tooltips | `App.tsx`, `.app-bottom-nav` rules, and `AppGlyph.tsx` |
| Medication and assessment surfaces | Warm muted paper for route bars, accent capsule counts, translucent answered legends, and actions separated from content by deliberate borders | `medications.css`, `modules.css`, `assessments.css`, and `components.css` |

### Deferred, intentionally unverified

Calculator and document-specific styling remains outside this extraction's implementation scope.
Their current rules are feature-owned and should be restyled only when that feature is edited.
Original Primary screenshots are not available in this repository, so screenshot-specific geometry,
exact spacing, and exact color matching remain unverified debt.

## Icon contract

The assessment and calculator root-nav entries use the real [Phosphor Core Bold assets](https://github.com/phosphor-icons/core/tree/main/assets/bold):
`list-checks-bold.svg` and `calculator-bold.svg`. Their 256×256 paths are normalized into MiniMed's
existing 24×24 `AppGlyph` SVG contract, remain `aria-hidden`, and are exposed through the parent
button's Russian `aria-label`, `title`, and `aria-current` state. Root-nav state and badge classes use
semantic BEM modifiers (`app-nav-button--active`, `app-nav-badge--*`) so theme overrides do not depend
on generic state names.
