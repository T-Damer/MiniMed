# MiniMed assessment final visual QA gate review

- recommendation: REJECT
- blockers:
  - violatedCriterion: SC-4 — Fresh print capture must visibly prove a compact one-page blank form with one title and no description.
    evidencePointer: `/Users/d/Projects/Personal/MiniMed/qa-latest2-assessment-print.png` is a valid 375×10,666 PNG showing the interactive questionnaire chrome, methodology callout, floating controls, and bottom navigation across a tall page; it is not a one-page print-popup capture.
  - violatedCriterion: SC-5 — Fresh print capture must visibly prove the `MiniMed ⋅ current page link ⋅ local QR` footer.
    evidencePointer: The footer is not legibly verifiable in `/Users/d/Projects/Personal/MiniMed/qa-latest2-assessment-print.png`; the supplied h1/URL/QR/scroll metrics conflict with the captured artifact and have no referenced raw QA artifact to reconcile them.

## originalIntent

Hide the assessment description from the main questionnaire and place it in the methodology modal; render the methodology trigger as a paper callout; align the pie-progress Next control below scroll-to-top; and print a compact one-page blank form with one visible title, no description, and a `MiniMed ⋅ current page link ⋅ local QR` footer.

## desiredOutcome

Fresh final captures visibly demonstrate all four current user-facing states: desktop questionnaire top, desktop floating-control geometry, mobile methodology modal, and a genuine one-page print surface containing the requested title/body/footer composition.

## userOutcomeReview

The main-page and methodology outcomes pass visual review. `qa-latest2-assessment-desktop-top.png` omits the description and presents the methodology trigger as a coherent raised-paper callout. `qa-latest2-assessment-mobile-methodology.png` places the description and methodology/legal copy in an inset modal without visible clipping. `qa-latest2-assessment-desktop-progress.png` shows the Next control directly below scroll-to-top at the same right anchor, consistent with the supplied geometry and without horizontal overflow.

The print outcome is not proven by the fresh artifact. The file is 375×10,666 and visibly contains the interactive app questionnaire rather than the print-popup document. This directly conflicts with the supplied claim that the print surface has `scrollHeight=viewportHeight=697`. Source and markup tests support the intended title/description/footer content, but they do not replace a valid final visual capture for this visual gate.

## Success criteria

| ID | Criterion | Result | Evidence |
| --- | --- | --- | --- |
| SC-1 | Main questionnaire omits description; methodology modal contains it | PASS | desktop-top and mobile-methodology captures; `AssessmentQuestionnairePage.tsx`; `AssessmentDefinitionNotice.tsx` |
| SC-2 | Methodology trigger is a coherent paper callout | PASS | desktop-top capture; `assessments.css` |
| SC-3 | Pie-progress Next is below scroll-to-top at the same horizontal anchor | PASS | desktop-progress capture; supplied browser geometry; `assessments.css` |
| SC-4 | Blank print is compact and one page, with one title and no description | REJECT | fresh print capture is 375×10,666 and shows app chrome, not the print popup |
| SC-5 | Footer visibly reads `MiniMed ⋅ page link ⋅ local QR` | REJECT | source generates it, but the fresh print capture does not legibly verify it |
| SC-6 | No horizontal overflow at 375/1280 | PASS for supplied app captures | supplied geometry and direct capture inspection |

## Programming and remove-ai-slops review

Direct inspection found no criterion-breaking type escape hatch, swallowed error, dependency-direction violation, raster substitution, or speculative production abstraction in the scoped TypeScript/CSS. The QR dependency serves the explicit local-QR requirement, and the inline SVG renderer translates its matrix into printable markup.

The focused print test combines several observable markup checks and includes requested-removal assertions (`not.toContain` for description and duplicate title). This is removal-verification coverage and gives limited confidence about pagination; it does not prove physical one-page rendering. It is a maintenance NOTE, not an additional blocker, because no stated criterion mandates a particular test shape. No excessive test suite, tautological expected-value derivation, implementation-mirroring parser, deletion-only production behavior, or unnecessary normalization layer was found.

The prior report `.omo/evidence/latest-assessment-visual-qa-gate-review.md` explicitly covers programming/slop criteria, but it reviewed the older `qa-latest-*` print artifact at 1200×697. It cannot approve the newer `qa-latest2-*` capture set.

## Checked artifact paths

- `/Users/d/Projects/Personal/MiniMed/qa-latest2-assessment-desktop-top.png` — valid 1280×900 RGB PNG
- `/Users/d/Projects/Personal/MiniMed/qa-latest2-assessment-desktop-progress.png` — valid 1280×900 RGB PNG
- `/Users/d/Projects/Personal/MiniMed/qa-latest2-assessment-mobile-methodology.png` — valid 375×800 RGB PNG
- `/Users/d/Projects/Personal/MiniMed/qa-latest2-assessment-print.png` — valid 375×10,666 RGB PNG, wrong visual surface for print proof
- `/Users/d/Projects/Personal/MiniMed/DESIGN.md`
- `/Users/d/Projects/Personal/MiniMed/apps/app/src/features/assessments/AssessmentQuestionnairePage.tsx`
- `/Users/d/Projects/Personal/MiniMed/apps/app/src/features/assessments/AssessmentDefinitionNotice.tsx`
- `/Users/d/Projects/Personal/MiniMed/apps/app/src/features/assessments/assessment-print.ts`
- `/Users/d/Projects/Personal/MiniMed/apps/app/src/features/assessments/assessment-print.test.ts`
- `/Users/d/Projects/Personal/MiniMed/apps/app/src/styles/assessments.css`
- `/Users/d/Projects/Personal/MiniMed/apps/app/src/styles/global.css`
- `/Users/d/Projects/Personal/MiniMed/.omo/evidence/latest-assessment-visual-qa-gate-review.md`
- `/Users/d/Projects/Personal/MiniMed/.omo/evidence/assessment-final5-gate-review.md`
- current scoped working-tree diff

## exactEvidenceGaps

- No ulw-loop plan exists (`ULW_LOOP_PLAN_MISSING`), so this report uses the required `.omo/evidence/<goal>-gate-review.md` fallback.
- No raw browser-QA output artifact is referenced for the supplied `h1Count`, description, font-size, URL, QR, and 697px scroll metrics, so the contradiction with the 375×10,666 PNG cannot be resolved.
- No separate executor report, current code-review report, manual-QA matrix, or notepad path was supplied. Prior reports were inspected but bind to older capture sets.
- Independent dual visual-review subagent tools are unavailable in this session. This is an evidence gap, not a separate criterion blocker; direct inspection already identifies the criterion-linked print failure.

## Required re-gate evidence

Replace `qa-latest2-assessment-print.png` with a fresh capture of the actual print popup/print page at the stated 1200×697 surface (or a rendered one-page PDF), showing the single title, blank form, and legible footer. Preserve the three passing captures.
