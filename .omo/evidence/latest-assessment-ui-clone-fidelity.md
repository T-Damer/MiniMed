# Latest assessment UI clone-fidelity review

## Decision

`REQUEST_CHANGES`

The rendered hierarchy is materially faithful to the stated target and is real, interactive DOM. Approval is blocked because the changed implementation is not a rigorous token-driven design system: it introduces numerous literal spacing, type, and print color values rather than using declared semantic tokens.

## Goal and acceptance criteria reviewed

- Preserve the warm paper clinical-archive material while improving assessment hierarchy.
- Keep the questionnaire description discoverable only through Methodology and limitations.
- Make the methodology trigger intentional and consistent with the UI pack.
- Put the progress action below scroll-up.
- Produce a compact one-page, real-DOM print document with one questionnaire title, no description, and `MiniMed ⋅ pageLink ⋅ local QR` footer.
- Reject raster/screenshot substitution, ad-hoc one-off styling, and non-reusable component construction.

## Findings

### CRITICAL

None. The assessment page is rendered from live Solid JSX and shared primitives; no screenshot, raster overlay, canvas, or `background-image` substitutes for the assessment UI. The print QR is generated as an inline SVG path, not an image. See [AssessmentQuestionnairePage.tsx](/Users/d/Projects/Personal/MiniMed/apps/app/src/features/assessments/AssessmentQuestionnairePage.tsx:53), [AssessmentDefinitionNotice.tsx](/Users/d/Projects/Personal/MiniMed/apps/app/src/features/assessments/AssessmentDefinitionNotice.tsx:12), and [assessment-print.ts](/Users/d/Projects/Personal/MiniMed/apps/app/src/features/assessments/assessment-print.ts:26).

### HIGH

- The new assessment surface does not meet the token-driven styling criterion. `DESIGN.md` documents the palette and a type scale but does not define consumable spacing, font-size, border-width, radius, or motion tokens. The changed CSS instead embeds per-control values such as `0.7rem`, `3.5rem`, `0.55rem 0.8rem`, `0.75rem`, `1.25rem 0.9rem`, `750`, `1px`, and `2px`. Examples: [assessments.css](/Users/d/Projects/Personal/MiniMed/apps/app/src/styles/assessments.css:280), [assessments.css](/Users/d/Projects/Personal/MiniMed/apps/app/src/styles/assessments.css:375), [assessments.css](/Users/d/Projects/Personal/MiniMed/apps/app/src/styles/assessments.css:446), and [DESIGN.md](/Users/d/Projects/Personal/MiniMed/DESIGN.md:28). This is a visually credible page, but not a rigorous reusable design system.
- The print implementation also hardcodes its presentation (`#111`, `#bbb`, `15pt`, `8.5pt`, `6.5pt`, and individual millimetre spacing) instead of using a print token contract. See [assessment-print.ts](/Users/d/Projects/Personal/MiniMed/apps/app/src/features/assessments/assessment-print.ts:50). Its visible output is correct, but it fails the stated token requirement.

### MEDIUM

- Touched assessment markup still relies on structural/tag selectors rather than semantic BEM elements, contrary to the project rule and weakening primitive reuse. The new/changed control markup uses bare `label`, `legend`, `span`, `small`, and `button` nodes at [AssessmentQuestionnairePage.tsx](/Users/d/Projects/Personal/MiniMed/apps/app/src/features/assessments/AssessmentQuestionnairePage.tsx:82) and [AssessmentQuestionnairePage.tsx](/Users/d/Projects/Personal/MiniMed/apps/app/src/features/assessments/AssessmentQuestionnairePage.tsx:120), while styling couples to nesting in [assessments.css](/Users/d/Projects/Personal/MiniMed/apps/app/src/styles/assessments.css:388) through [assessments.css](/Users/d/Projects/Personal/MiniMed/apps/app/src/styles/assessments.css:463). This makes the questionnaire anatomy less portable than the otherwise well-scoped methodology trigger.

### LOW

None.

## Verified positive evidence

- Description placement is correct: it is absent from the questionnaire header at [AssessmentQuestionnairePage.tsx](/Users/d/Projects/Personal/MiniMed/apps/app/src/features/assessments/AssessmentQuestionnairePage.tsx:75) and appears only inside the `OverlayDialog` controlled by the methodology trigger at [AssessmentDefinitionNotice.tsx](/Users/d/Projects/Personal/MiniMed/apps/app/src/features/assessments/AssessmentDefinitionNotice.tsx:14).
- The Methodology and limitations control is a live button with a shared `AppGlyph` and shared `OverlayDialog`, with a coherent warm-paper/accent treatment. Its mobile dialog is visibly complete and legible in the mobile capture.
- The progress action is a shared `Button` with a real `scrollIntoView` handler. The CSS lifts scroll-up to `7.625rem` while the progress action remains at `4.375rem`, so the action is below scroll-up as required. See [AssessmentQuestionnairePage.tsx](/Users/d/Projects/Personal/MiniMed/apps/app/src/features/assessments/AssessmentQuestionnairePage.tsx:170) and [assessments.css](/Users/d/Projects/Personal/MiniMed/apps/app/src/styles/assessments.css:493).
- The print document is generated HTML, contains exactly one visible `h1`, strips the blank-form description before rendering, and supplies the local current page URL plus inline SVG QR footer. See [assessment-print.ts](/Users/d/Projects/Personal/MiniMed/apps/app/src/features/assessments/assessment-print.ts:62) and [assessment-print.ts](/Users/d/Projects/Personal/MiniMed/apps/app/src/features/assessments/assessment-print.ts:89). The supplied capture shows the full content on one page and the required `MiniMed ⋅ link ⋅ QR` footer.
- The UI capture shows the requested archive material: paper sheet, muted desk, serif title, hairlines, and compact control language. No visible raster fakery was found.

## Artifacts inspected

### Fresh capture set, opened directly

- `/Users/d/Projects/Personal/MiniMed/qa-latest-assessment-desktop-top.png` (1280×900 PNG; 2026-08-07 12:00:09 +0300)
- `/Users/d/Projects/Personal/MiniMed/qa-latest-assessment-desktop-progress.png` (1280×900 PNG; 2026-08-07 12:00:29 +0300)
- `/Users/d/Projects/Personal/MiniMed/qa-latest-assessment-mobile-methodology.png` (375×800 PNG; 2026-08-07 12:00:51 +0300)
- `/Users/d/Projects/Personal/MiniMed/qa-latest-assessment-print.png` (1200×697 PNG; 2026-08-07 11:57:59 +0300)

All captures have valid PNG signatures and are newer than the reviewed source changes (latest source mtime: 11:51:56 +0300).

### Source/design/diff evidence

- `/Users/d/Projects/Personal/MiniMed/DESIGN.md`
- `/Users/d/Projects/Personal/MiniMed/apps/app/src/features/assessments/AssessmentQuestionnairePage.tsx`
- `/Users/d/Projects/Personal/MiniMed/apps/app/src/features/assessments/AssessmentDefinitionNotice.tsx`
- `/Users/d/Projects/Personal/MiniMed/apps/app/src/features/assessments/assessment-print.ts`
- `/Users/d/Projects/Personal/MiniMed/apps/app/src/styles/assessments.css`
- Full uncommitted diff for the five files above; `git diff --check` passed.
- Related live primitives inspected: `Button.tsx`, `OverlayDialog.tsx`, `AppGlyph.tsx`, `global.css`, and `assessment-engine.ts`.
- No notepad path was supplied.

### Verification commands

- `bun run --filter @localmed/app typecheck` — passed.
- `bun run test:unit -- apps/app/src/features/assessments/assessment-print.test.ts` — passed (1 test).

## Approval blockers

1. Define and document reusable spacing, typography, border/radius, and print tokens, then replace the new literal values in `assessments.css` and `assessment-print.ts` with those tokens.
2. Give the touched questionnaire elements semantic BEM classes and replace the structural/tag-dependent selectors with class selectors so the visual language is reusable outside this exact DOM nesting.
