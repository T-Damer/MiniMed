# One visual language for screens and tools — November 2026 (STATE PERF6)

Owner 2026-11-11: pages and tools look different from each other (the ECG tool feels foreign); use
lists more; «Файлы» by document kind plus «Мой компьютер». Inventory taken with
`apps/app/e2e/ui-inventory.spec.ts` (`UI_INVENTORY=1`): 26 screens at 390×844, light and dark,
against `DESIGN.md` and the shared components (`Page`/`PageHero`, `Button`, chips, `Card`, sheets).
The one list pattern the app had was Settings' inset group (and the search home's «Разделы»); it is
now the shared `ListGroup`/`ListRow` (`components/ListRow.tsx`, DESIGN.md «List»).

## Gap table

| screen / tool | gap against the shared language | done here |
| --- | --- | --- |
| ECG by photo (first step) | no page header look: ✕ instead of ‹, a full-width green «Фото» button over a row of two more, the auto-marking offer as a small bordered strip | closes with ‹ (`OverlayDialog closeAs="back"`); camera / gallery / typed measurements and «Авторазметка · 19 МБ» are list rows; the 5-step flow is unchanged |
| «Формы» | every form a card with its own big «Заполнить форму» button (DESIGN.md: a card that opens something is the tap target) | one list: tile, title, «Форма № …», chevron |
| Calculator sections | cards with a «ИНСТРУМЕНТЫ РАЗДЕЛА» kicker, a heavy sans title, a status line | list rows with a coloured tile per section (declared in `CALCULATOR_SECTIONS`), description (2 lines), size or «n из m», a download/remove button of the shared `list-action` style |
| Test sections («Психиатрия» …) | cards with a wide «Скачать · 680 КБ» button and «0/5 тестов на устройстве · раздел не скачан» | list rows like the calculators; the opened section keeps its page |
| «Файлы» | no title in the header row (a search field stands in), only big folder pictures | «Места» (Мой компьютер) and «По виду» (one row per kind with a count) as lists above the folders; the folders keep their grid/list toggle |
| «Пациенты» (empty) | «Карточек пока нет.» in a card stuck to the top — against «Empty states are centred» | the shared centred `EmptyState` with «Добавить пациента» |
| Knowledge base «Наборы документов» | Georgia titles on cards with download buttons — the same content as a list | not changed: next |
| Notes root | separate cards per entry instead of one inset group | not changed: next |
| Diary sign-in | no hero band; its own card over the garden | by design (a sign-in screen); only its motion and blur changed (PERF6) |
| Skin by photo | a dark device frame | by design (a camera-like tool) |
| Settings, search home «Разделы», drug tools | already the shared look | — |

## Screenshots

Before and after, light and dark, are in the shared notes folder of this work
(`perf6-screens/`, outside the repository); rerun the script for current ones.
