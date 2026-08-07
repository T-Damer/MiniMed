# Clone / design-system fidelity review: boot fix

**Recommendation: REQUEST_CHANGES**

## Scope and evidence

- Target supplied: the MiniMed boot/loading and settled-calculators states (no separate reference design or Figma was provided, so this is an intent/system review rather than a pixel diff against an external target).
- Fresh visual evidence, captured after the relevant source modifications:
  - `output/playwright/boot-fix-loading-375.png` (360 × 890, 00:51:43)
  - `output/playwright/boot-fix-loading-768.png` (753 × 1102, 00:51:48)
  - `output/playwright/boot-fix-loading-1280.png` (1265 × 978, 00:51:53)
  - `output/playwright/boot-fix-settled-calculators-375.png` (360 × 3344, 00:51:47)
  - `output/playwright/boot-fix-settled-calculators-1280.png` (1265 × 2702, 00:51:56)
- Code/design evidence: `DESIGN.md`; `apps/app/src/app/App.tsx`; `apps/app/src/features/calculators/CalculatorsView.tsx`; `apps/app/src/styles/global.css`; `apps/app/src/styles/calculators.css`; `apps/app/src/styles/compact-release.css`; `apps/app/src/styles/mobile-shell.css`; `apps/app/src/styles/tool-routes.css`; scoped current diff for the boot/navigation and calculators changes.

## Findings

### CRITICAL

None. The loading surface is live DOM: `App` renders a `section`, `div`, spinner, text, and conditional retry button rather than a raster substitute (`apps/app/src/app/App.tsx:347-369`). The only data-URL assets found in the relevant shell are decorative SVG noise and a vector nav-tab shape, not UI screenshots (`apps/app/src/styles/global.css:86`, `apps/app/src/styles/mobile-shell.css:15`). The calculator list is also live/reused component output (`apps/app/src/features/calculators/CalculatorsView.tsx:116-175`, `765-783`).

### HIGH

1. **Fixed bottom navigation obscures live calculator content at both settled breakpoints.** In `boot-fix-settled-calculators-375.png`, the floating pill covers the Anthropometry section copy; in `boot-fix-settled-calculators-1280.png`, it overlays the Mosteller card copy. The shell fixes the nav to the viewport (`apps/app/src/styles/compact-release.css:904-918`) while only adding padding at the document end (`apps/app/src/styles/compact-release.css:895-902`), so content can scroll behind it. This breaks the responsive-shell composition and makes the central reading surface partially unavailable.

2. **The rendered navigation is not fully token-driven.** The shared design contract requires semantic tokens for the color ramp, but the visible nav hardcodes multiple colors and alpha values (`apps/app/src/styles/compact-release.css:914-916`, `932`, `941-943`, `955-962`, `975-976`). The broader mobile shell repeats the pattern (`apps/app/src/styles/mobile-shell.css:6-15`, `62`, `110`, `171`, `184-186`, `244-245`). This is not a tokenized reusable primitive and fails the stated design-system criterion despite the calculator-specific additions correctly using `--theme-*` tokens (`apps/app/src/styles/calculators.css:144-191`, `229-239`).

### MEDIUM

1. **The supplied files do not actually capture the named viewport widths.** The `-375`, `-768`, and `-1280` PNGs are 360, 753, and 1265 pixels wide respectively. The consistent 15px difference likely excludes a scrollbar, but it prevents literal verification at the requested widths and leaves breakpoint-edge behavior unproven.

2. **Boot coherence is not universal across routes.** The centered boot takeover is skipped for `/assessments` and `/calculators` while `ready()` is false (`apps/app/src/app/App.tsx:330-350`); at the same time, root navigation remains hidden until ready (`apps/app/src/app/App.tsx:449-495`). Thus deep links can expose a normal tool page in a booting shell with no navigation, unlike the intentional full-screen boot state shown in the supplied loading images.

### LOW

1. **The boot card has isolated legacy literal colors.** Its paper-sheet backing uses `#c3b79d` and `#e9dfc7` outside the semantic token ramp (`apps/app/src/styles/global.css:511-521`). The visual result remains coherent, but the values should be represented by the existing surface/border token family when the token debt is addressed.

## What passes

- Loading composition is visually coherent at the supplied 360/753/1265-pixel captures: a centered paper sheet, restrained spinner, title, and offline reassurance form a deliberate blocked state. Hiding the nav in that full-screen state is appropriate and is implemented directly with `<Show when={ready()}>`.
- The loading card scales cleanly from the narrow portrait layout to the wide centered layout (`apps/app/src/styles/global.css:476-546`); no horizontal clipping or malformed Russian wrapping is visible.
- The calculator catalog is a real hierarchy of reusable section/card primitives, not a screenshot imitation. Its headings, card grouping, action state, and responsive column collapse map to live component and CSS structure.

## Blocking resolution required before approval

1. Ensure the persistent nav never covers readable card content at any supported viewport/scroll position.
2. Move the nav/shell color ramp into semantic design tokens and consume those tokens instead of literal hex/RGB values.
3. Re-capture the requested 375, 768, and 1280 CSS-pixel viewports, including the settled first viewport where fixed UI competes with content.

No source files were changed during this review; this evidence report is the only generated artifact.
