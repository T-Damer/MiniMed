# Assessment UI clone-fidelity review

**Recommendation:** REQUEST_CHANGES

## Scope and evidence inspected

- Design contract: `DESIGN.md`.
- Current render tree: `apps/app/src/features/assessments/AssessmentQuestionnairePage.tsx`, `apps/app/src/features/assessments/AssessmentDefinitionNotice.tsx`, and `apps/app/src/components/OverlayDialog.tsx`.
- Shared primitives and tokens: `apps/app/src/components/Button.tsx`, `apps/app/src/styles/components.css`, `apps/app/src/styles/global.css`, and `apps/app/src/styles/doctor-ux.css`.
- Assessment CSS and current diff: `apps/app/src/styles/assessments.css` and `git diff` for the assessment and overlay changes.
- Captures visually inspected at native dimensions: `assessment-current-desktop.png` (1200x800), `assessment-current-mobile.png` (375x800), and `assessment-current-modal.png` (1200x800).

The interface is a live Solid DOM implementation, not a pasted screenshot or a raster/background-image substitute. `Button` and `OverlayDialog` are live reused primitives; the paper surface is the existing `.paper-card` CSS primitive. No fake-image finding.

## CRITICAL

None.

## HIGH

1. **The supplied visual evidence is stale and cannot support approval.** `assessment-current-desktop.png`, `assessment-current-mobile.png`, and `assessment-current-modal.png` were written at `2026-08-07 11:07:33–11:07:34`; `AssessmentQuestionnairePage.tsx` was modified later at `11:09:05`. The images may therefore omit the current JSX/CSS state. Re-capture the desktop questionnaire, the 375px questionnaire with the next control visible, and the modal after the final source edit.

2. **The sticky next-question control obstructs answer space on mobile.** In `assessment-current-mobile.png`, the fixed circular arrow sits over the first question’s right edge/response area. This is caused by the viewport-fixed rule in `apps/app/src/styles/assessments.css:449-465`, while mobile turns answers into a one-column stack at `:559-573`. It competes with selectable rows rather than occupying reserved UI space. Reposition it outside the questionnaire’s interactive column, reserve matching bottom/right clearance, or use a non-overlapping sticky placement at the mobile breakpoint.

3. **The new visual treatment is not fully token-driven.** The added legend and sticky control introduce one-off shadow colors in `apps/app/src/styles/assessments.css:358` and `:465`; the modal family also has raw colors at `apps/app/src/styles/doctor-ux.css:9,19,23,33-35,52,64,66`. This bypasses the `DESIGN.md` rule that colors/depth be driven by semantic design tokens. Define semantic surface/shadow/overlay tokens in the design system and consume them instead of literals.

## MEDIUM

1. **The methodology modal lacks a compact reading inset on desktop.** `assessment-current-modal.png` shows a 1176px-wide dialog in a 1200px viewport, which reads as an edge-to-edge banner rather than an inset paper card. The assessment-specific class has no sizing override (`apps/app/src/features/assessments/AssessmentDefinitionNotice.tsx:23-27`); it inherits `width: min(73.75rem, 100%)` from `apps/app/src/styles/doctor-ux.css:13-16` and only the backdrop’s 0.75rem horizontal padding at `:7-8`. Give this short methodology dialog a bounded readable width and a larger desktop inset, while retaining the intentional full-screen mobile dialog behavior.

## LOW

None.

## Confirmed strengths

- The question card remains a live `fieldset.paper-card` with a semantic `legend` (`AssessmentQuestionnairePage.tsx:116-148`), and the accent-soft legend correctly establishes the question number and prompt as the card’s primary hierarchy (`assessments.css:344-378`).
- The back/print header actions are a clear vertical action stack at both captured widths (`AssessmentQuestionnairePage.tsx:55-74`; `assessments.css:231-241`).
- The methodology control opens a real accessible dialog through `OverlayDialog`, rather than embedding a static visual treatment (`AssessmentDefinitionNotice.tsx:14-43`; `OverlayDialog.tsx:82-137`).

## Approval blockers

1. Fresh captures produced after the last assessment-source edit.
2. A 375px sticky-next placement that cannot obscure any answer control.
3. Semantic tokens for the new assessment depth/overlay values, with the cited raw values replaced.
