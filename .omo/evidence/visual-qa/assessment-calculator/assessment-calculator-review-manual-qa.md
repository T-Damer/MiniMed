# Manual QA — assessment and calculator flows

Build: live `http://127.0.0.1:5173`, browser QA on 2026-08-07. No product files edited.

## Findings

- **High — calculator result unreadable.** `/app/#/calculators/unit-conversion`: after entering `100` and activating `Рассчитать и сохранить`, `100 000 g` renders in `rgb(238,232,218)` on a near-white result surface. The value is not reliably readable in [calculator-result-mobile.png](./calculator-result-mobile.png) and [calculator-result.png](./calculator-result.png); DOM evidence is [calculator-result-dom.txt](./calculator-result-dom.txt).
- **High — assessment controls are covered on mobile.** `/app/#/assessments/braverman-behavioral-profile` at 390×844: the sticky `.assessment-submit-panel` spans y=626.6–811.0 and the first radio ends at y=735.6, while fixed bottom navigation spans y=784–834. The answer controls are behind the sticky summary/nav in [assessment-use-mobile.png](./assessment-use-mobile.png).
- **Medium — enabled/disabled states look disabled or unreadable.** Assessment `Удалить раздел`, `Распечатать бланк`, calculator selects, and status toasts use pale text on white/light surfaces. Examples: [assessment-overview-mobile.png](./assessment-overview-mobile.png), [assessment-locked-mobile.png](./assessment-locked-mobile.png), [calculator-detail-mobile.png](./calculator-detail-mobile.png), [calculator-locked-mobile.png](./calculator-locked-mobile.png).
- **Medium — assessment removal copy is misleading.** After removing the first assessment section, the live status reads `Раздел отключён. Ручные и обязательные для базы знаний опросники сохранены.` This does not clearly describe what remains available or what was removed; see [assessment-locked-dom.txt](./assessment-locked-dom.txt).

## manualQa

### surfaceEvidence

| scenario id | criterion reference | surface | exact invocation | verdict | artifactRefs |
|---|---|---|---|---|---|
| S1 | C1 locked assessment catalog | Browser UI `/app/#/assessments` | Navigate to `http://127.0.0.1:5173/#/assessments`; inspect the first section at `0/2` and activate `Скачать тест отдельно`/`Скачать раздел` states | PASS for state exposure; visual contrast finding remains | A1, A2, A3 |
| S2 | C1 assessment download/use | Browser UI `/app/#/assessments/braverman-behavioral-profile` | From `/app/#/assessments`, activate first `Скачать раздел`, then first `Пройти`; inspect route, 24 radio groups, progress, disabled `Рассчитать профиль` | PASS for navigation and usable DOM structure; mobile overlap is a finding | A4, A5 |
| S3 | C2 locked calculator catalog | Browser UI `/app/#/calculators` | Navigate to `http://127.0.0.1:5173/#/calculators`; inspect `0/1 скачано`, `Можно скачать`, `После скачивания`, and `В плане` cards | PASS for locked/planned-state clarity; contrast finding remains | A6, A7 |
| S4 | C2 calculator download/use | Browser UI `/app/#/calculators/unit-conversion` | From `/app/#/calculators`, activate first `Скачать раздел`, then `Открыть калькулятор`; fill `Значение=100`; activate `Рассчитать и сохранить` | PASS for calculation, local-save status, formula/result/actions; result contrast is a failure | A8, A9, A10 |
| S5 | C3 navigation clarity | Browser UI assessment/calculator detail routes | Activate `К каталогу тестов` and `К каталогу калькуляторов`; verify return URLs; use bottom `Тесты`/`Калькуляторы` buttons | PASS | A4, A8 |
| S6 | C4 responsive/accessibility | Browser UI at 390×844 | Set viewport to 390×844; capture assessment overview/use and calculator overview/detail/result; inspect accessible names in DOM snapshots | FAIL: sticky overlap and contrast defects; visible route controls otherwise have names | A2, A4, A5, A8, A9, A10, A11 |

### adversarialCases

| scenario id | criterion reference | adversarial class | expected behavior | verdict | artifactRefs |
|---|---|---|---|---|---|
| A1 | C1/C4 | misleading state copy | Removing a section should clearly state the removal and retained local data | FAIL — assessment toast uses confusing `Ручные и обязательные...` wording | A3 |
| A2 | C4 | contrast/readability | Enabled controls, disabled controls, status text, and numeric results remain readable | FAIL — pale text on white/light surfaces; calculator output is effectively unreadable | A2, A3, A7, A9, A10 |
| A3 | C1/C4 | sticky/fixed overlap | Fixed summaries/nav must not cover required answer controls | FAIL — first assessment radio is under the sticky summary; bottom nav also overlaps the panel | A5 |
| A4 | C1/C2 | locked vs installed confusion | Locked cards expose download; installed cards expose use/open; planned cards cannot imply availability | PASS — observed `Скачать раздел`, `Пройти`/`Открыть калькулятор`, and `В плане` states | A1, A3, A6, A7 |
| A5 | C3 | broken back/navigation | Detail back controls and primary bottom navigation return to the correct catalog/route | PASS — both catalog buttons returned to their matching hash routes | A4, A8 |
| A6 | C4 | accessibility naming | Inputs, radios, summaries, and buttons have usable accessible names | PASS for inspected visible controls; assessment radio names and detail/catalog buttons were exposed in the browser accessibility snapshot | A4, A8 |

## artifactRefs

| id | kind | description | path |
|---|---|---|---|
| A1 | screenshot | Assessment installed overview, 390×844 | `/Users/d/Projects/Personal/MiniMed/.omo/evidence/visual-qa/assessment-calculator/assessment-overview-mobile.png` |
| A2 | screenshot | Assessment installed overview, default viewport | `/Users/d/Projects/Personal/MiniMed/.omo/evidence/visual-qa/assessment-calculator/assessment-overview-viewport.png` |
| A3 | screenshot + DOM | Assessment locked state and removal status copy | `/Users/d/Projects/Personal/MiniMed/.omo/evidence/visual-qa/assessment-calculator/assessment-locked-mobile.png`; `/Users/d/Projects/Personal/MiniMed/.omo/evidence/visual-qa/assessment-calculator/assessment-locked-dom.txt` |
| A4 | screenshot | Assessment use screen, default viewport | `/Users/d/Projects/Personal/MiniMed/.omo/evidence/visual-qa/assessment-calculator/assessment-use-viewport.png` |
| A5 | screenshot | Assessment use screen, 390×844; sticky overlap | `/Users/d/Projects/Personal/MiniMed/.omo/evidence/visual-qa/assessment-calculator/assessment-use-mobile.png` |
| A6 | screenshot | Calculator locked state and removal status copy | `/Users/d/Projects/Personal/MiniMed/.omo/evidence/visual-qa/assessment-calculator/calculator-locked-mobile.png`; `/Users/d/Projects/Personal/MiniMed/.omo/evidence/visual-qa/assessment-calculator/calculator-locked-dom.txt` |
| A7 | screenshot | Calculator installed overview, 390×844 | `/Users/d/Projects/Personal/MiniMed/.omo/evidence/visual-qa/assessment-calculator/calculator-overview-mobile.png` |
| A8 | screenshot | Calculator input screen, default viewport and 390×844 | `/Users/d/Projects/Personal/MiniMed/.omo/evidence/visual-qa/assessment-calculator/calculator-detail-before.png`; `/Users/d/Projects/Personal/MiniMed/.omo/evidence/visual-qa/assessment-calculator/calculator-detail-mobile.png` |
| A9 | screenshot | Calculator result, default viewport | `/Users/d/Projects/Personal/MiniMed/.omo/evidence/visual-qa/assessment-calculator/calculator-result.png` |
| A10 | screenshot + DOM | Calculator result, 390×844 and accessible result text | `/Users/d/Projects/Personal/MiniMed/.omo/evidence/visual-qa/assessment-calculator/calculator-result-mobile.png`; `/Users/d/Projects/Personal/MiniMed/.omo/evidence/visual-qa/assessment-calculator/calculator-result-dom.txt` |
| A11 | screenshot | Calculator locked overview, default viewport | `/Users/d/Projects/Personal/MiniMed/.omo/evidence/visual-qa/assessment-calculator/calculator-overview-viewport.png` |

