# Assessment final2 clone / design-system fidelity review

## Recommendation

REQUEST_CHANGES

## Scope and evidence inspected

- Design contract: `DESIGN.md` (especially §§2, 3, 5, and 7).
- Current render tree: `apps/app/src/features/assessments/AssessmentQuestionnairePage.tsx`, `apps/app/src/features/assessments/AssessmentDefinitionNotice.tsx`, `apps/app/src/components/OverlayDialog.tsx`, `apps/app/src/components/Card.tsx`, and `apps/app/src/components/Button.tsx`.
- Current style/token paths: `apps/app/src/styles/global.css`, `apps/app/src/styles/assessments.css`, `apps/app/src/styles/doctor-ux.css`, and `apps/app/src/styles/components.css`.
- Supplied current captures, directly opened at original size:
  - `assessment-final2-desktop.png` (1200 × 800; 11:19:46)
  - `assessment-final2-mobile.png` (375 × 800; 11:19:46)
  - `assessment-final2-modal.png` (1200 × 800; 11:19:47)
- Scoped current diff for the assessment/dialog implementation. `git diff --check` passed for the scoped files.

The captures are valid PNGs and postdate the latest examined assessment stylesheet edit (`assessments.css`, 11:19:13). Prior reports and success claims were treated as untrusted and were not used as verdict evidence.

## Findings

### CRITICAL

None. The UI is not a pasted screenshot, canvas, or raster `background-image`: the questionnaire is a live `form` of `fieldset.paper-card` items with `legend`, radio `input`, and `label` elements (`AssessmentQuestionnairePage.tsx:107-170`); the notice invokes the shared live `OverlayDialog` (`AssessmentDefinitionNotice.tsx:14-43`); and the dialog renders a portal-backed semantic `section[role="dialog"]` (`OverlayDialog.tsx:82-136`).

### HIGH

1. **Semantic depth tokens are not consistently used for visible assessment elevation.** The root defines reusable elevation tokens (`global.css:31-33,50-51`), and the paper primitive consumes `--shadow-paper` (`global.css:483-503`). However, assessment controls introduce independent raw shadow values: launch control (`assessments.css:16`), overlay close (`:50`), sticky message (`:84`), submit panel (`:442`), next-question control (`:473`), and result actions (`:543`). The shared dialog’s visible elevation also uses `var(--shadow-folder)` rather than a semantic modal/elevation token (`doctor-ux.css:13-24`). This violates the contract’s token-driven depth strategy and produces equivalent raised objects through unrelated recipes. Centralize these values as documented semantic elevation/overlay tokens and apply them to the assessment and dialog surfaces.

### MEDIUM

1. **The assessment title’s design-system rule remains DOM-nesting dependent.** The Georgia token is correctly declared (`global.css:52`) and applied to the questionnaire heading (`assessments.css:253-255`), which is visibly correct in desktop and mobile captures. But the selector is `.assessment-subpage-header h1` rather than an explicit semantic BEM element class. This conflicts with the project’s touched-UI selector rule and makes the display type rule less reusable. Give the heading its own BEM class and style that class directly.

### LOW

None.

## Verified, do not regress

- **Georgia heading token:** `--font-serif` resolves to Georgia first (`global.css:52`); the assessment heading consumes it (`assessments.css:253-255`). Both questionnaire captures visibly show the serif display hierarchy.
- **Paper-card hierarchy:** the shared `Card` primitive emits `article.paper-card.ui-card` (`Card.tsx:3-9`), while the questionnaire uses live `fieldset.paper-card` cards (`AssessmentQuestionnairePage.tsx:114-149`). The desktop/mobile captures show distinct raised paper response cards with a separately tinted legend layer; this is real DOM rather than image substitution.
- **Header action stack:** back and print controls are grouped in a live `.assessment-subpage-header-actions` stack (`AssessmentQuestionnairePage.tsx:55-74`) with a grid gap (`assessments.css:238-241`). The desktop capture shows the intended left-hand two-action stack.
- **Mobile sticky clearance:** the fixed next control reserves right-side response space at mobile (`assessments.css:457-473,558-585`). In the 375px capture, it clears both the response row and bottom navigation rather than covering content.
- **Inset, padded modal:** the shared backdrop centers and insets its dialog (`doctor-ux.css:1-24`), and the dialog body has explicit padding (`doctor-ux.css:78-84`). The modal capture confirms a centered inset panel, dark header, and readable padded body.

## Blockers

- Replace the independent assessment/dialog shadow recipes with documented semantic depth/elevation tokens. Until then, the result is not a rigorous token-driven design system.
