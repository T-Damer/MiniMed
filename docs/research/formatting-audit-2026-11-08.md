# Formatting of every reader document: audit and fixes — 2026-11-08 (STATE FMT-AUDIT)

Owner request (2026-11-08): «Можем пройтись по документам еще раз и проверить что форматирование на
месте? Для этого хорошо подходят haiku sub-agents».

## Method

- **Population.** All 825 module databases the reader opens: 774 КР, 15 ГРЛС instruction groups,
  the EAEU and manufacturer-site instructions, «Красота и медицина», the definitions reference,
  Allmed drug texts, РЛС packaging, ЕСКЛП, МКБ-10/11, the herbal book, diets, feeding norms, the
  bundled `core`, `reference` and `regulatory` packs — about 780 000 chunks.
- **Script pass with the reader's own pipeline.** Every plain-text chunk went through
  `presentReaderChunkText` → `stripKnownHtmlMarkup` → `parseDocumentText`, exactly as the reader draws
  it (rich table/image chunks skipped). The blocks were scanned for: Markdown links, emphasis, tables
  and headings shown literally; HTML tags/entities; « | » in prose; a hyphen followed by a space;
  lists run into one paragraph; mojibake and Private Use characters; codes typed with Cyrillic
  look-alikes (МКБ-10, АТХ, CYP); runs of five or more short lines; junk and repeated headings. The
  scan driver (a throwaway vitest file) and its output stayed in the session scratch, not in git.
- **Twelve Claude Haiku agents** (`model: "haiku"`, ten at a time) each read one sample file
  (≈95 000 characters): the flagged sections of every family plus random clean sections, each with
  its neighbouring headings, the stored text (RAW) and the blocks the reader draws (RENDERED). They
  returned 418 findings (69 high, 212 medium, 137 low) as {module, doc, section, kind, span, cause}.

## What the agents found, grouped by cause

| cause | where | fix |
| --- | --- | --- |
| A paragraph after a list item is glued onto it («Уровень убедительности…», «Комментарии:», «У девочек принято различать:») | КР (most recommendation bullets), «Красота и медицина», ICD-11, feeding | renderer: without PDF geometry a new stored block continues an item only when it starts in lower case |
| A table row written as text: a long Markdown table's continuation chunk lost its header; a two-column glossary «АтД \| Атопический дерматит»; a row the chunking cut | РЛС packaging (≈166 000 rows), definitions, ICD-11 | renderer: runs of «\| a \| b \|» rows (any width, a cut row aligned right) and runs of equal-width «a \| b» rows are a table; a lone one-cell row is text |
| Dash lists not split: «−»/«–» markers, or «…что: - у Вас аллергия; - …» on one line | ГРЛС, ЕАЭС, Allmed, diets (Певзнер) | renderer: «–», «—», «−», «·» are list markers; two or more «; -» / «: -» items split into a list |
| A heading repeated: the first line of a section equals its title (once or several times); a sibling section holding only its title; the same heading twice in a row | ГРЛС (3 602), ЕАЭС, manufacturer sites, КР «Показания к выписке:» | renderer: the echo line goes (its line break stays for the PDF geometry); a section with only an echo is no text of its own; consecutive same headings merge |
| Sub-headings glued to the PDF paragraph after them («Дети Безопасность…») | ГРЛС, ЕАЭС | renderer: a line shorter than 70 characters before a capitalised line is not a wrapped line |
| A heading that is a sentence tail («лечение.», «для приготовления раствора для инфузий»), a table cell («300 АЕ* 1000 АЕ*», «V03AB25») or a page stamp («SPC.063.1.EAEU-RU.02.02 С. 4», «лп-шOOдт 06-гп -ву», a signature time stamp) | ГРЛС, ЕАЭС, manufacturer sites | reader: such a heading of an instruction folds into the section before it; a sentence tail or cell stays as a line of text there (nothing is dropped); stamps fold like the existing page stamps |
| Codes typed with Cyrillic look-alikes: «Е75.2», «К71», «С09АА01», «А16.10.003», «СYP2D6», «CYPЗA4», «Р450»; Latin letters inside Russian words («активноcти», «c целью»), «СDS» | КР (1 680), ГРЛС (1 560), Allmed, ЕАЭС, definitions | display: the code shows in Latin, a word in one alphabet (search already folded МКБ look-alikes) |
| HTML: `<u>`, `<sup style=…>®</sup>`, `&lt;u&gt;` escaped twice, `&Amp;` | Allmed (378), КР | `stripKnownHtmlMarkup`: `u`, `small`, `font` dropped; `sup`/`sub` lifted to ⁹/₂ when they hold digits, else their text; escaped known tags read; entity names case-insensitive |
| Converter markup: `*Источник: …*`, `> Отметка: …`, `*Построение образа*.`, `\дифференциально`, `Вт/см^(2)` | feeding (126), psychosynthesis, КР, definitions | renderer/display: whole-line `*…*`/`_…_` and «> » marks go; inline single-asterisk italics lose their stars (footnote stars stay); a backslash before a Russian letter goes; `^(2)` → ² |
| A hyphen with a stray space: «сердечно- сосудистой», «листок- вкладыш», «включен- ная» | everywhere (6 330) | display: a compound reads «сердечно-сосудистой», a cut word «включенная», also where the reader joins wrapped lines; a suspended hyphen («двух- или трёхкратно», «гипер- и гипо-») stays |
| Symbol-font characters in the Private Use Area (U+F0B1 ±, U+F061 α, U+F0B7 •, U+F0A3 ≤ or a questionnaire box) | КР-педиатрия (148), definitions, Allmed, ICD-11 | display: mapped to the real characters |
| A free-standing «** — сцеженное молоко» footnote legend lost its stars | feeding | `DocumentText`: a free «**» stays; one attached to a word is dropped as before |

False positives the agents raised and the check confirmed as fine: `[text](https://…)` links and
`**bold**` (the reader draws a link and drops the stars; the sample dump did not show that), «#» and
«**» marks after drug names in КР (off-label and ЖНВЛП markers), suspended hyphens, chemical names
(«10-N-глюкуронид»), and rich tables the sample showed as a JSON first row (the reader draws them
as tables).

## Before and after (the same scan, all 825 modules)

Counts of rendered blocks (junk headings: the stored headings before, the headings the reader shows
after; repeated headings: as the reader shows them):

| kind | before | after |
| --- | ---: | ---: |
| Markdown table rows shown as text | 166 535 | 1 |
| « \| » inside a paragraph | 190 426 | 2 319 |
| repeated heading | 4 129 | 1 |
| junk heading | 2 444 | 307 |
| look-alike code | 3 751 | 41 |
| list run into one paragraph | 2 426 | 377 |
| hyphen with a stray space | 6 330 | 2 065 (≈1 000 of them suspended hyphens; the line-join fix came after this scan) |
| HTML tag or entity | 384 | 9 |
| Markdown emphasis | 156 | 23 |
| mojibake / Private Use | 192 | 10 |
| runs of short lines | 1 802 | 2 293 |

The runs of short lines grew because sub-headings and frequency lines («Очень частые: > 1/10»,
«Частые: > 1/100») are no longer glued into one paragraph: each now stands alone, which the detector
counts.

Screenshots (375 px, light and dark, `vite preview` of `origin/main` and of the branch): КР «Болезнь
Гоше» §2.3 (the evidence line and «Комментарии» leave the bullet), «Эписпадия» (the text after the
list), «Окситоцин» (sub-headings apart from their paragraphs). They stay in the session scratch.

## Reader speed (PERF5's measurement, before the merge)

`e2e/perf-baseline.spec.ts` with `PERF_ONLY=reader` (phone emulation, 4× CPU), the production
builds of `main` (7e049c943) and of this branch alternated on one browser profile, three rounds each:

| document | all sections mounted, main → branch | blocking ms | first text |
| --- | ---: | ---: | ---: |
| КР 814_1 (longest, 170 sections) | 2 550–2 700 → 3 270–3 280 ms | 240–270 → 340–365 | ~60 ms, unchanged |
| КР 714_2 (typical long) | 565–595 → 590–620 ms | 9–17 → 13–20 | unchanged |
| fluconazole instruction (longest) | 740–755 → 805–825 ms | 180–185 → 190–195 | unchanged |

- **Cause: more blocks, not the text code.** In 814_1 the КР evidence lines and «Комментарии» are now
  paragraphs of their own: 623 → 1 236 paragraphs, lists split around them. A build of the branch
  with only the old list rule mounts 814_1 in 2 530–2 650 ms, as `main` does. The extra time is
  main-thread rendering inside frame tasks (trace: `RunTask` self time +610 ms; JS, layout and
  style barely move). Body-wide `text-wrap: pretty` is about 150 ms of it (a test build without it on
  reader paragraphs: 3 090–3 140 ms); it stays, that is a typography decision.
- **The text code was made cheap.** First run over all 814_1 chunks, unthrottled: presentation
  44 → 30 ms (`main` 27 ms), parsing 30 ms (`main` 28 ms). The repairs skip a chunk on a cheap
  pre-check, the four code patterns are one, and lookarounds use a plain letter class: `\p{L}` in a
  lookbehind compiles into a far larger matcher (the code pass alone was 7.5 → 1.7 ms cold).
- `e2e/perf-budget.spec.ts` (first text < 1.5 s, all sections < 5 s on 714_2) passes.

## Left alone, and why

- **Scanned tables the preparer did not mark as tables** (ГРЛС/ЕАЭС interaction tables drawn as
  word soup, ≈770 « | » paragraphs): the cell order is lost in the OCR text; a renderer guess would
  invent a table. Needs the OCR table pass of the preparer.
- **EAEU and manufacturer headings that are a whole sentence or a label** (≈60 left, «Не применимо,
  отсутствуют показания к применению.»): they start with a capital, so no safe rule separates them
  from real headings. A preparer fix would mean rebuilding the EAEU module, whose builders are skipped
  (`NOT_INDEXED`, FIX-BATCH2).
- **Text the source itself broke**: «про дукты», «кото рые» (spaces inside words from PDF
  extraction), «ПаЦИНТаЛЬНОСТЬ», a stray «\|» in an ICD-11 title, `�` (2 in КР references).
- **ASCII box tables** (`+---+`, `│`) in two ICD-11 cards and one regulatory act: rare; a grid parser
  is a project of its own.
- **«#» abbreviations in КР «Список сокращений»** («# – назначение off-label»): the source's own
  legend, read correctly.

No module was rebuilt: every fix is in the reader, so the published packs stay as they are.
