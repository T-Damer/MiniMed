# «Рецепт» coverage and the «По названию» strip — November 2026 (STATE SRCHDRUG1)

Owner 2026-11-13, searching «Кветиапин»: (1) a «По названию» section of 6 cards sat above results
that already listed the drug; (2) the drug card's «Рецепт» said «Для этого препарата в указателе
доз нет карточки: назначение по нему не рассчитывается» — a no-go; (3) «Выбрать» in the drug
comparison was plain text. This note records what was measured before and after the fixes.

## How it was measured

- **Data:** the shipped indexes of the build (`features/prescription/data/dose-rules-index.json`,
  ЕСКЛП edition 2026-08-28, ГРЛС instruction modules `grls-2026.11.06.kd1`;
  `features/drug-comparison/data/comparison-index.json`), and in the browser the published
  nervous-system ЕСКЛП group with its ГРЛС instructions and the EAEU texts (local release copies,
  `docs/data-ledger.json`), installed through the кветиапин pointer as a doctor would.
- **«Common drugs»:** the ЖНВЛП substances with an N ATC code (nervous system, the owner's field):
  102 ЕСКЛП cards, listed from the dose index (`e: 1`, an `a` code starting with N). For the whole
  register the static counts below use all 3 324 cards and the 905 ЖНВЛП ones.
- **Script:** `apps/app/e2e/recipe-coverage.measure.spec.ts` (not a gate). Per card it opens the
  card, «⋯» → «Рецепт», and classifies what the sheet says; a second test runs 25 queries and
  compares the title answers with the whole (scrolled) result list.

  ```bash
  bun run build:app
  RECIPE_COVERAGE=out.json RECIPE_COVERAGE_SLUGS="$(cat slugs.json)" \
    E2E_PORT=4231 bunx playwright test recipe-coverage -g coverage --workers=1
  TITLE_OVERLAP=overlap.json E2E_PORT=4231 bunx playwright test recipe-coverage -g title --workers=1
  ```

## Why «Рецепт» refused

1. **The sheet asked the dose index about the wrong document.** A substance card (`esklp.mnn.<slug>`)
   shows a *representative instruction* of one of its registrations (`representativeInstructionProduct`:
   own text first, ГРЛС before EAEU before a holder's site, the everyday form, the trade name equal to
   the substance). The reader handed «Рецепт» the id of that shown instruction, and the dose index keeps
   only the best instructions per card (`DOSE_DOCUMENTS_PER_CARD`, кветиапин: 1 of its 3 indexed
   ГРЛС texts, the shown КВЕТИАПИН-АЛИУМ not among them). Not found → «нет карточки», although the
   index has a card for **every** ЕСКЛП substance (3 324 of 3 324).
   *Fix:* `prescription/drug-on-screen.ts` — the card the screen was opened on (or its core pointer)
   first, then an indexed instruction, then the substance name, then a trade name of one card only.
2. **No instruction, no prescription.** 1 083 of 3 324 cards (133 of the 905 ЖНВЛП; 5 of the 102
   nervous-system ЖНВЛП: пипофезин, тапентадол, леводопа+бенсеразид, налоксон+оксикодон,
   динитрогена оксид) have no instruction in the dose index; for them, and for an instruction that
   is not installed, the sheet said «рецепт собрать не из чего». The Rp. line needs only the
   registry (Latin name, form, strength — every card has registry rows), so it is now built from
   ЕСКЛП and the doctor writes «Способ применения» by hand (the «Текст рецепта» editor opens by
   itself when there is no instruction). Nothing about the dose is filled in: doses still come only
   from the instruction sentences, quoted.

## Counts

ЖНВЛП substances with an N ATC code (102 cards), nervous-system group installed, «⋯» → «Рецепт»
on each card (390 px, the built app):

| Outcome of the sheet | Before (`f41a1ede1`) | After (SRCHDRUG1) |
| --- | ---: | ---: |
| «нет карточки» — refused | **47** | **0** |
| no instruction: «доз из неё не взять» / «рецепт собрать не из чего» — refused | **3** ¹ | **0** |
| no instruction: Rp. from the registry, the sign by hand | — | 5 |
| instruction not installed (download offered) | 1 | 1 |
| the Rp. text or its editor at once (one form and strength) | 8 | 12 |
| asks for the form or the strength first | 43 | 84 |

Refused: **50 of 102 before, 0 after.** «After» includes the 47 cards that said «нет карточки»: they
now open the prescription for the card on screen (most ask for the form and the strength first,
as every card with several does).

¹ леводопа+бенсеразид, налоксон+оксикодон, тапентадол; the other two cards without an instruction
(пипофезин, динитрогена оксид) were among the 47 «нет карточки».

Whole register, from the shipped indexes (static, no UI): cards the dose index has no instruction
for — before refused, after written by hand with the registry's Rp. line — 1 083 of 3 324
(ЖНВЛП 133 of 905). Cards reachable by their own id after the fix: 3 324 of 3 324; by their
registry name alone: 3 324 of 3 324 (`drug-on-screen.test.ts`).

## «По названию»

The strip (`SearchTitleMatches`, PERF5 2026-11-06) showed up to six documents whose titles carry
the query words, from an on-device title index, before the full-text results; PERF5 measured it at
≈510 ms after the last key on a Mac and the results at ≈600–900 ms, so it led by a few hundred
milliseconds. 25 queries (10 nervous-system drug names, 15 diseases), before-build, every result
group drawn (a 30 000 px viewport, the list is virtualized):

| Queries | Title answers | Already in the results | Not in the results |
| --- | ---: | ---: | ---: |
| 10 drug names (кветиапин, галоперидол, сертралин…) | 47 | **47** | 0 |
| 15 diseases (пневмония, депрессия, эпилепсия…) | 78 | 58 | 20 |

For a drug every title answer repeated a result: the owner's «Кветиапин» showed КВЕТИАПИН,
Кветиапин, Кветиапин-СЗ, Кветиапин-Виал, КВЕТИАПИН-АЛИУМ and КВЕТИАПИН АВЕКСИМА twice. For a disease
a fifth of them were narrower reference articles the list leaves out («Пневмония у детей»,
«Эпилепсия у беременных», «Сахарный диабет 1 типа у детей», «ВИЧ-деменция»).

**Decision:** folded, not deleted. Nothing is shown above the results while the search runs (the
results skeleton is the one loading state); once the results are in, only title matches the list
does not contain — by id, or by title with case, «ё» and signs set aside (a catalog pointer and its
card share the title, not the id) — follow the list once, as a list group «Ещё по названию»
(`titleMatchesBeyondResults`, `SearchTitleExtras`). For drug names that group is empty. The phrase
choices above the results (««X» — N значений, выберите нужный») follow the same rule: a document the
list shows is not offered again, and a phrase left with fewer than two choices is not asked
(`meaningsBeyondResults`). Search ranking is unchanged, so `benchmark:all` is unaffected by design
(it measures the core's list, not this UI).

## Not covered

- **Doses are unchanged.** Only the card lookup and the hand-written path changed; the dose index,
  its quotes and the release setting «computed doses off» (RX5) are as they were. Кветиапин has one
  instruction in the dose index (Кветиапин пролонг-алиум, a prolonged-release text), so the sheet
  quotes that text even for the ordinary tablets; more instructions per card is a dose-index build
  question (`DOSE_DOCUMENTS_PER_CARD`), not touched here.
- Measured on one group (nervous system) in a desktop browser; the other 15 ЕСКЛП groups and a
  phone were not run. The id fix does not depend on the group; the static counts cover the register.
- The owner's own set of modules (Allmed, holders' sites, EAEU on the phone) was not reproduced; the
  fix asks for the opened card first, so it does not depend on which instruction the screen shows.
- Seen while measuring, not fixed (outside this task): a drug group installed through a card's
  pointer lands its companions (ГРЛС instructions, EAEU) seconds later, but the search core was
  rebuilt for the first pack only (`minimed:install:core-reload` `modules:1`, no second reload in
  4 minutes) — the e2e reloads the page to search them.
