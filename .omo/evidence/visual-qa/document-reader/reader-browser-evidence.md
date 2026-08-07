# MiniMed reader visual QA evidence

Fresh run: 2026-08-07 against `http://127.0.0.1:5173`.

## S1 — desktop reader header

- Surface/invocation: browser UI; navigate to `#/modules/documents/collection/core`, click `Показать документы ядра`, then click the first core document button (`01 Официальный реестр лекарств ...`).
- Viewport: 1280x720 CSS px, DPR 2.
- Observed: reader dialog opened; `Назад` is visible and enabled with `aria-label="Назад"`, `title="Назад"`, 40x40 px at x=67 y=33.75; outline menu is visible beside it with `aria-expanded="true"`.
- Screenshot: `reader-desktop-1280x720.jpg`.

## S2 — reader close

- Surface/invocation: browser UI; with the reader open, click the reader-scoped `button[aria-label="Назад"]`.
- Observed: reader dialog count became 0; the document heading disappeared. A second mobile run used the observed reader-arrow coordinate after closing the outline overlay and also reduced reader dialog count from 1 to 0.

## S3 — sticky section title

- Surface/invocation: browser UI; open core document `05 Клинические рекомендации Внебольничная пневмония у детей`, scroll the document paper by 520 px at x=800 y=500.
- Viewport: 1280x720 CSS px.
- Observed: paper scrollTop=520, scrollHeight=1746, clientHeight=617. The current section title `Клиническая картина` is sticky at top=86 (paper top), position=`sticky`, z-index=2, background=`rgb(251, 247, 234)`; all six section titles report the same opaque background.
- Screenshot: `reader-sticky-long-desktop-1280x720.jpg`.

## S4 — mobile overflow

- Surface/invocation: browser UI; set viewport to 375x800, navigate to `#/modules/documents/collection/core`, open the core collection and document `05 Клинические рекомендации Внебольничная пневмония у детей`.
- Observed closed-outline state: document/body/document-overlay scroll widths equal client widths; `horizontalDelta=0`. Reader Back arrow is visible at x=16 y=15.5, and outline menu at x=74 y=15.5.
- Observed open-outline state: outline panel is within x=0..336 and document/body scroll widths remain equal to client widths (375); `horizontalDelta=0`.
- Screenshots: `reader-mobile-375x800.jpg`, `reader-mobile-outline-375x800.jpg`.

## Source inspection

- `AGENTS.md:109-113` contains the new BEM rule and explicitly forbids `.block h2` / `.block button` descendant styling.
- `apps/app/src/components/OverlayDialog.tsx:90-119` gives the Back arrow, heading, subtitle, and close control direct classes.
- `apps/app/src/features/library/DocumentReaderDialog.tsx:196-206,250-270,312-369` gives reader controls and headings direct semantic classes.
- `apps/app/src/styles/doctor-ux.css:43-76,99-168,187-245,839-863` targets those classes directly; the former changed selectors (`.overlay-dialog-header h2`, `.overlay-dialog-header button`, `.document-overlay-section h2`, `.document-overlay-paper h1`, and outline descendant selectors) are absent. `git diff --check` passed for the reviewed files.

Console note: no browser errors were observed. Repeated warnings reported missing optional `ambulatory.db`, `regulatory.db`, and `reference.db` packs (404); these did not affect the core reader scenarios.
