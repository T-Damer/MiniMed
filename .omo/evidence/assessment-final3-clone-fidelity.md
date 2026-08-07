# Clone fidelity review — assessment final3 exact state

## Recommendation

REQUEST_CHANGES

## Scope

Read-only review of the final assessment UI against `DESIGN.md`, current source, and the supplied
desktop, mobile, methodology-dialog, and delete-dialog captures. The success criteria were semantic
elevation, semantic Georgia titles, paper hierarchy, stacked header actions, mobile sticky spacing,
and inset padded dialogs.

## Evidence inspected

- `DESIGN.md`
- `assessment-final3-desktop.png` — 1200×800 PNG, modified 2026-08-07 11:24:46
- `assessment-final3-mobile.png` — 375×800 PNG, modified 2026-08-07 11:24:46
- `assessment-final3-modal.png` — 1200×800 PNG, modified 2026-08-07 11:24:47
- `assessment-final3-delete.png` — 1200×800 PNG, modified 2026-08-07 11:29:57
- `apps/app/src/features/assessments/AssessmentQuestionnairePage.tsx`
- `apps/app/src/features/assessments/AssessmentDefinitionNotice.tsx`
- `apps/app/src/features/assessments/AssessmentResultPage.tsx`
- `apps/app/src/features/assessments/AssessmentsView.tsx`
- `apps/app/src/components/OverlayDialog.tsx`
- `apps/app/src/components/ConfirmationDialog.tsx`
- `apps/app/src/styles/assessments.css`
- `apps/app/src/styles/doctor-ux.css`
- `apps/app/src/styles/compact-release.css`
- `apps/app/src/styles/global.css`

The four captures have valid PNG signatures, expected dimensions, and complete rendered frames. Each
postdates the assessment/dialog source and stylesheet that renders its corresponding state. No separate
notepad path or external target/reference packet was supplied.

## Findings

### CRITICAL

None. The assessment surface is a live Solid component tree: the questionnaire uses semantic
fieldsets and radio inputs, the shared `Button` primitive, `paper-card` surfaces, and portal-backed
`OverlayDialog` / `ConfirmationDialog` components. No raster, canvas, pasted screenshot, or
background-image substitute is used for the assessment UI.

### HIGH

1. **Mobile `OverlayDialog` is full-screen rather than inset.**
   `apps/app/src/styles/doctor-ux.css:785-796` sets the shared backdrop padding to `0`, makes the
   dialog `width: 100%`, `min-height: 100dvh`, and removes both its border and radius at 760px and
   below. The assessment methodology state uses this component at
   `apps/app/src/features/assessments/AssessmentDefinitionNotice.tsx:23-43`, so that dialog cannot
   preserve the required inset paper-panel treatment on mobile. The desktop modal capture is inset
   and padded, but it does not validate this responsive state.

### MEDIUM

None.

### LOW

None.

## Verified constraints

- Elevation in scoped assessment states is tokenized: `--theme-card-hover-shadow` and
  `--theme-control-hover-shadow` in `apps/app/src/styles/assessments.css`, and the declared root
  elevation token `--shadow-folder` for shared overlay and confirmation panels in
  `apps/app/src/styles/doctor-ux.css:23` and `apps/app/src/styles/compact-release.css:2766`.
- The assessment title has its own semantic class, `assessment-subpage-title`, at
  `apps/app/src/features/assessments/AssessmentQuestionnairePage.tsx:77`; its rule uses
  `var(--font-serif)` at `apps/app/src/styles/assessments.css:252-254`, whose first face is Georgia
  at `apps/app/src/styles/global.css:52`.
- Paper hierarchy is shared, live, and tokenized: assessment surfaces use `paper-card`, whose paper
  shadow is the root token `--shadow-paper` at `apps/app/src/styles/global.css:483-503`.
- The back and print controls are a live stacked action group at
  `apps/app/src/features/assessments/AssessmentQuestionnairePage.tsx:55-74`, styled by
  `apps/app/src/styles/assessments.css:238-241`.
- The mobile capture matches the fixed next-control spacing implementation: its bottom position
  accounts for `--safe-bottom` and its response gutter is reserved at
  `apps/app/src/styles/assessments.css:456-492,570-572`.
- At desktop width, the methodology and delete dialogs are visibly inset and padded. Their panel
  rules provide 1rem dialog-body padding (`apps/app/src/styles/doctor-ux.css:78-84`) and a bounded
  confirmation panel (`apps/app/src/styles/compact-release.css:2753-2767`).

## Blockers

- Restore an inset, padded mobile variant for the assessment methodology dialog, or explicitly scope
  the design criterion to desktop dialogs and provide a matching mobile-dialog reference.
