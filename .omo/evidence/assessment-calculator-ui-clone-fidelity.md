# Assessment / calculator clone-fidelity review

**Recommendation:** REQUEST_CHANGES

## Scope and verification basis

- Target: the repository's existing warm-paper design system, documented in `DESIGN.md`.
- Changed UI: assessment download copy/states and the calculator section/download/use experience.
- Inspected: current worktree diff; `CalculatorsView.tsx`; assessment route components; `calculator-packs.ts`; `global.css`, `compact-release.css`, `assessments.css`, and `calculators.css`.
- Live routes, fresh isolated local session: `#/calculators`, installed calculator and its form; `#/assessments`, installed assessment section, and questionnaire. Captured at 375, 768, and 1280 CSS px.
- No exact external screenshot/Figma target was supplied, so this judges fidelity to the in-repo design contract and existing warm-paper surface—not an unsupported pixel comparison.

## CRITICAL

None. The pages are live Solid DOM: the accessibility snapshots expose real headings, buttons, inputs, radios, selects, and state changes. I found no screenshot/raster or `background-image` substitute for the UI.

## HIGH

1. **The mobile/tablet layer stack obscures primary task controls.** At 375 px, the fixed bottom navigation covers the assessment card's primary `Пройти` action; at 768 px, the sticky `Осталось 24 пунктов / Рассчитать профиль` panel sits on top of Question 2. This materially blocks the download → use flow and violates the system requirement that controls remain reachable.
   - Code: `apps/app/src/styles/compact-release.css:904-918` fixes the navigation above page content; `apps/app/src/styles/assessments.css:366-389` independently fixes the submit panel; `apps/app/src/styles/assessments.css:64-68` gives the route only a generic bottom padding.
   - Evidence: `.playwright-cli/page-2026-08-06T21-27-40-744Z.png`, `.playwright-cli/page-2026-08-06T21-28-37-979Z.png`, `.playwright-cli/page-2026-08-06T21-28-41-885Z.png`.

2. **The new calculator section styling is not token-driven.** The design contract requires semantic tokens, but the feature falls back to undeclared legacy variables and literal colors. The root defines `--theme-*` tokens, not `--accent`, `--surface`, `--text`, `--page-background`, `--muted-text`, or `--button-on-accent`; the fallbacks therefore become the rendered design. It produces a second, undeclared teal/white/gray palette rather than the repository’s warm-paper ramp. The warning treatment additionally introduces two raw oranges not in `DESIGN.md`.
   - Code: `apps/app/src/styles/calculators.css:14-15, 34-35, 51, 147, 171, 181, 189-190, 235-236, 319-320, 340, 377-379`; compare declared tokens in `apps/app/src/styles/global.css:8-29` and the no-literal rule in `DESIGN.md:28-29`.
   - This is a design-system blocker even though the rendered surface is otherwise real DOM.

## MEDIUM

1. **The section/download/use model is inconsistent between feature families.** Calculators consistently demand a section download before opening a tool (`CalculatorsView.tsx:84-103, 812-827`). Assessments tell users to “choose a section” and say a test “входит в скачиваемый раздел,” but every unavailable card still offers `Скачать тест отдельно` (`AssessmentCatalogPage.tsx:57-59, 141, 152-163`; `AssessmentsView.tsx:316-326`). The same state is variously called `подключён`, `скачан`, `на устройстве`, and `в разделе`. The happy path works, but the ownership model is not clear enough to be a reusable system.

2. **Catalog hierarchy is overly airy at the card level.** `min-height: 18rem` for calculator cards (`calculators.css:215-244`) and `20rem` for assessment cards (`assessments.css:123-138`) push the unavailable explanation or action far below its title and metadata. In the first calculator section this creates a large ruled-paper void before the only next-step copy, weakening scanability and separating the reason from the action.

## LOW

1. **Transient success messages are visually heavier than the state change they confirm.** The sticky white toast competes with the title and first section after a download (`assessments.css:74-85`, `calculators.css:67-78`). The state change is already visible in the section counter and action label, so the duplicate high-elevation message briefly muddies hierarchy.

## What is sound

- The component tree is genuine and reusable: section cards, calculator cards/forms/results, and assessment cards/questionnaires are live components rather than a pasted visual.
- The warm-paper material itself carries through: ruled paper cards, hairline borders, serif headings, muted green primary actions, and compact archive metadata are recognizably coherent with the existing system.
- The primary calculator flow was exercised live: section state changed from `Можно скачать` / `После скачивания` to `Раздел скачан` / `На устройстве`, then exposed a working calculator form. Assessment section state and questionnaire routing likewise updated live.

## Approval blockers

- Resolve the fixed/sticky layer collisions so no task action or question content is obscured at 375 and 768 px.
- Replace the calculator feature’s legacy/fallback literals with the declared semantic token ramp (including warning colors) before claiming design-system fidelity.
