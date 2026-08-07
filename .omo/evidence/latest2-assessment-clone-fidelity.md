# Clone / design-system fidelity review — latest2 assessment UI

**Recommendation: REQUEST_CHANGES**

## Scope and evidence

- Intent reviewed: warm MiniMed paper/desk material; questionnaire description only in Methodology and limitations; next-question control below scroll-up; real compact one-page print with one title, no description, and `MiniMed ⋅ pageLink ⋅ local QR` footer.
- Fresh captures opened directly:
  - `/Users/d/Projects/Personal/MiniMed/qa-latest2-assessment-desktop-top.png` — valid RGB PNG, 1280×900, modified 2026-08-07 12:11:25.
  - `/Users/d/Projects/Personal/MiniMed/qa-latest2-assessment-desktop-progress.png` — valid RGB PNG, 1280×900, modified 2026-08-07 12:11:44.
  - `/Users/d/Projects/Personal/MiniMed/qa-latest2-assessment-mobile-methodology.png` — valid RGB PNG, 375×800, modified 2026-08-07 12:12:04.
  - `/Users/d/Projects/Personal/MiniMed/qa-latest2-assessment-print.png` — valid RGB PNG, 375×10,666, modified 2026-08-07 12:12:33.
- Source inspected: `DESIGN.md`; `AssessmentQuestionnairePage.tsx`; `AssessmentDefinitionNotice.tsx`; `assessment-print.ts`; `assessments.css`; `global.css`; `Button.tsx`; the print formatter and its focused test.
- Diff inspected: current unstaged diff for all supplied implementation files plus `DESIGN.md`; `git diff --check` was clean.
- No notepad path was supplied. Prior `.omo/evidence` reports were treated as untrusted and were not used as approval evidence.
- Validation: `bun run typecheck` in `apps/app` passed. `bun run test:unit -- apps/app/src/features/assessments/assessment-print.test.ts` passed (1 test).

## What is verified

- The questionnaire is live Solid DOM: `<form>`, `<fieldset>`, labelled radios, native `<progress>`, buttons, and reusable `Button`, `OverlayDialog`, `AppGlyph`, and `paper-card` primitives render it. There is no image/canvas/screenshot substitute in the assessment components or stylesheet. The global data-URI is only a procedural page-noise overlay, not assessment UI. See `AssessmentQuestionnairePage.tsx:53`, `AssessmentDefinitionNotice.tsx:12`, and `global.css:108`.
- The desktop captures preserve the intended paper-on-desk material; the methodology trigger and the next-question control visibly use the warm accent treatment. The desktop-progress capture shows the next-question action below the scroll-up control, as implemented by `assessments.css:495` and `assessments.css:530`.
- The page no longer renders `definition.description`; its only questionnaire-page rendering is inside the Methodology dialog. This is confirmed in `AssessmentDefinitionNotice.tsx:36` and the mobile methodology capture.
- The print generator is actual self-contained HTML. It has one `h1`, strips the blank-form title and description from the body, emits a direct current-page link, and renders a local inline-SVG QR (no external image/service). See `assessment-print.ts:26`, `assessment-print.ts:77`, and `assessment-print.ts:104`. The focused test verifies those markup properties.

## Findings

### CRITICAL

None found. The implementation does not fake the assessment UI with a screenshot, raster image, canvas, or CSS background image.

### HIGH

1. **[evidence] The supplied “print” capture is not a compact print document, so the required print result is not visually verified.** `qa-latest2-assessment-print.png` is a 375×10,666 mobile capture of the interactive assessment: it contains the app header, Methodology trigger, radio controls, fixed navigation, and 24 question cards. It does not show the generated HTML print document, its `MiniMed ⋅ pageLink ⋅ QR` footer, or a single A4 page. This directly contradicts its filename/claimed state. The source and unit test establish markup intent, but not printed pagination or rendered footer. A real print-preview/PDF capture at A4 is required before approval.

2. **[product] The changed assessment styling is not rigorously token-driven.** New global tokens exist (`global.css:55`), but the relevant stylesheet continues to hardcode one-off layout, spacing, radius, and typography values instead of consuming the token contract: for example `assessments.css:281` (`2.1rem`, despite `--theme-control-icon-size`), `309` (`0.55rem`), `327` (`800`), `356-358` (progress dimensions/gap), `439` (`5.5rem`), `468` (literal `clamp()` type scale), `479` (`0.8rem`), and `502` (`4.375rem`, despite `--theme-assessment-floating-offset`). The raw-value scan finds 87 literals in this file. This fails the stated design-system success criterion rather than constituting a tokenized implementation.

### MEDIUM

1. **[product] New/touched assessment rules do not consistently meet the semantic BEM/class-based-state requirement.** `AssessmentQuestionnairePage.tsx:75` leaves the styled header content `<div>` classless, while `assessments.css:242` styles it through `.assessment-subpage-header > div`. State/layout also depends on cross-tree and structural selectors: `.assessment-response-options__option:has(.assessment-response-options__input:checked)` at `assessments.css:448` and `body:has(.assessment-next-button) .scroll-top-button` at `530`. These are DOM-shape-dependent rather than semantic BEM elements/modifiers, contrary to the repository’s selector policy.

2. **[evidence] CJK line-break fidelity is unproven.** Every supplied capture is Russian. The relevant compact labels and prompts use `overflow-wrap: anywhere` (`assessments.css:421-424`, `465-471`), which may break Korean strings at arbitrary syllables under narrow constraints. No fresh CJK capture exists to validate the required natural CJK wrapping; this must be evidenced at the mobile width before a final fidelity pass.

3. **[product] The desktop progress capture shows the fixed bottom navigation overlapping the lower response row.** In `qa-latest2-assessment-desktop-progress.png`, the central navigation pill obscures parts of question 6’s response options at the lower viewport edge. The `assessment-next-button` is positioned separately at `assessments.css:495-515`; no desktop response safe space is applied (the only safe-space rule is mobile-only at `623-625`). This weakens the live layered layout even though the requested vertical ordering of scroll-up and next-question controls is correct.

### LOW

None.

## Required blockers before approval

1. Replace the mislabeled print evidence with a capture of the generated print popup/print preview or PDF that proves one A4 page, one visible title, no description, and the visible `MiniMed ⋅ pageLink ⋅ local QR` footer.
2. Replace the assessment stylesheet’s changed literal spacing, radius, size, and type values with documented semantic tokens; use the already-declared floating offset token.
3. Provide a narrow CJK capture that proves natural wrapping, and eliminate the demonstrated desktop fixed-control overlap.
4. Give newly styled DOM nodes semantic BEM classes and represent interactive state with modifiers rather than structural/descendant selector chains.

## Final decision

`REQUEST_CHANGES`: no raster fakery was found and several core intent requirements are implemented, but a HIGH token-system breach and a HIGH print-evidence failure remain. Under the review contract, either one prevents approval.
