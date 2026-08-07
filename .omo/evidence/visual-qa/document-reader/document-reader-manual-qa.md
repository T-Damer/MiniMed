# MiniMed document reader manual QA

Verdict: PASS

Scope: `http://127.0.0.1:5173/#/modules/documents/collection/core`, current workspace build, fresh browser captures on 2026-08-07.

## manualQa

### surfaceEvidence

| scenario id | criterion reference | surface | exact invocation | verdict | artifactRefs |
|---|---|---|---|---|---|
| S1 | Reader Back arrow next to outline menu | Browser UI, 1280x720 | Navigate to the route; click `Показать документы ядра`; click the first core document button | PASS | A1, A2 |
| S2 | Back arrow closes reader | Browser UI, 1280x720 and 375x800 | With the reader open, click the reader-scoped accessible `button[aria-label="Назад"]`; on mobile, close the outline overlay first, then click the observed reader Back arrow | PASS | A2, A3 |
| S3 | Sticky document section titles have opaque background | Browser UI, 1280x720 | Open core document `05 Клинические рекомендации Внебольничная пневмония у детей`; scroll the paper 520px at x=800,y=500; inspect the visible section title and computed styles | PASS | A4, A5 |
| S4 | 375px has no horizontal overflow | Browser UI, 375x800 | Set viewport to 375x800; open the same core collection/document; inspect closed-outline and open-outline states, screenshots, and root/body/paper scroll widths | PASS | A6, A7, A8 |
| S5 | BEM rule and changed CSS selectors | Source inspection | Read `AGENTS.md`; inspect changed `OverlayDialog.tsx`, `DocumentReaderDialog.tsx`, and `doctor-ux.css`; run targeted `rg` and `git diff --check` | PASS | A2, A9 |

### adversarialCases

| scenario id | criterion reference | adversarial class | expected behavior | verdict | artifactRefs |
|---|---|---|---|---|---|
| A-S1 | Accessible Back arrow | Accessibility / control discoverability | Back control has a semantic button role, accessible name, title, visible focusable-sized target, and sits beside the outline control | PASS | A2, A3 |
| A-S2 | Reader close | Overlay-state interference | Closing from the reader must remove the reader dialog; when the outline drawer is open, its backdrop must be closed before the reader Back action is invoked | PASS | A3 |
| A-S3 | Sticky titles | Transparency / overlap | A sticky section title must remain visible at the paper top and use a non-transparent computed background so body text does not show through | PASS | A4, A5 |
| A-S4 | Mobile 375px | Responsive overflow | At 375x800, root, body, overlay, layout, and paper must not widen beyond the viewport; opening the outline must preserve zero horizontal delta | PASS | A6, A7, A8 |
| A-S5 | BEM selector rule | CSS regression / descendant selectors | Changed reader styles must use direct semantic classes and must not reintroduce `.block h2` or `.block button` selectors | PASS | A2, A9 |

## artifactRefs

| id | kind | description | path |
|---|---|---|---|
| A1 | screenshot | Desktop reader at 1280x720 with Back arrow immediately before outline menu | [.omo/evidence/visual-qa/document-reader/reader-desktop-1280x720.jpg](./reader-desktop-1280x720.jpg) |
| A2 | source-and-log | Browser actions, computed control metrics, route/viewport observations, source line references, and console note | [.omo/evidence/visual-qa/document-reader/reader-browser-evidence.md](./reader-browser-evidence.md) |
| A3 | interaction-log | Fresh desktop/mobile Back invocations and post-click dialog counts recorded in the browser evidence log | [.omo/evidence/visual-qa/document-reader/reader-browser-evidence.md](./reader-browser-evidence.md) |
| A4 | screenshot | Long core document after 520px scroll showing sticky section titles | [.omo/evidence/visual-qa/document-reader/reader-sticky-long-desktop-1280x720.jpg](./reader-sticky-long-desktop-1280x720.jpg) |
| A5 | computed-style | Sticky title position, z-index, and opaque `rgb(251, 247, 234)` background metrics | [.omo/evidence/visual-qa/document-reader/reader-browser-evidence.md](./reader-browser-evidence.md) |
| A6 | screenshot | Mobile reader at 375x800 with Back arrow and outline menu | [.omo/evidence/visual-qa/document-reader/reader-mobile-375x800.jpg](./reader-mobile-375x800.jpg) |
| A7 | screenshot | Mobile reader with outline drawer open at 375x800 | [.omo/evidence/visual-qa/document-reader/reader-mobile-outline-375x800.jpg](./reader-mobile-outline-375x800.jpg) |
| A8 | layout-metrics | 375px root/body/layout/paper scroll-width measurements, including `horizontalDelta=0` in both outline states | [.omo/evidence/visual-qa/document-reader/reader-browser-evidence.md](./reader-browser-evidence.md) |
| A9 | source-check | BEM rule at `AGENTS.md:109-113`, direct classes in changed JSX/CSS, and clean `git diff --check` | [.omo/evidence/visual-qa/document-reader/reader-browser-evidence.md](./reader-browser-evidence.md) |

## Findings

No product findings for the requested fix. The browser emitted only pre-existing optional-pack 404 warnings for `ambulatory.db`, `regulatory.db`, and `reference.db`; they did not affect the core reader route or these scenarios.
