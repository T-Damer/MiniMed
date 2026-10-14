# ATC codes in the interaction and medication-safety indexes — review (ATC4, 2026-10-14)

Machine-readable record: [atc-index-review-2026-10-14.json](atc-index-review-2026-10-14.json) (every judged hit with the
code, its sources, the class rule and its basis, the reader counts and quotes) and
[atc-index-selection-audit-2026-10-14.json](atc-index-selection-audit-2026-10-14.json) (conflict candidates the code
selection ignored). Reviewer: AI against the product's own instruction texts; no clinician has signed it off. Owner's
brief: the data is 90–99 % right, so the review covers only what the completed codes **change**.

> **Status 2026-10-14 (later):** the owner decided the open points; the text below is the review as written, the changes are in «Owner decisions 2026-10-14» at the end:
> R05 memberships withdrawn (the class word narrowed), flax seed admitted, the two interferon cards kept. Shipped memberships: 17 → 16.
>
> **Status 2026-10-14 (ATC4c):** the owner then asked for the other over-broad class words to be narrowed the same way, a data-declared way to add a class to one card, and an
> assessment from the doctor's side. Decisions, counts and the «User-perspective assessment» are at the end («Owner decisions 2026-10-14, second part»).

## Where ATC codes are used

| Index | Uses ATC? | How |
| --- | --- | --- |
| Interaction (INT1, `interaction-index.json`) | yes | (1) **class membership**: a drug is hit by `c:<code>` when any of its card codes starts with the class code (`drugTargetSet`), so a sentence of another instruction that names a class («противовирусные препараты», «НПВП», «снотворные и седативные средства») is shown for every member; class codes come from the НСИ «АТХ» group names (levels 2–4) plus 35 documented aliases; (2) **own-class suppression** at build time: in warnings (not in the interaction section) a class mention is dropped when the document's own card belongs to the class («как и другие НПВП») |
| Medication safety (SAFE1, `safety-index.json`) | **no** | pregnancy, lactation and age limits are matched by substance names and registration numbers only. Rebuilt from the published ЕСКЛП modules: **byte-identical**, nothing to publish. A test keeps it that way |
| Drug comparison (CMP1) | yes (ATC3) | already carries both codes; not touched here |

## Which code each rule type uses

`apps/app/src/features/drug-interactions/atc-codes.ts` (`selectAtcCodes`), unit-tested, used by `scripts/build-drug-interactions.ts`:

- the node's completed `atcCode` (registry value, filled `~`, refined group stub);
- a node flagged `conflict` or `unconfirmed` contributes **only the registry value**, never a candidate: no code that rests on
  disagreeing sources or on one OCR text can add a warning (audit: 215 candidate codes of 675 + 7 flagged nodes, none in the index);
- a stub conflict with an `atcConsensus` (two independent kinds of source on one substance code, ATC3): **both** the registry stub and the
  consensus code, for both rule types. Reasoning: the stub stays the official value and the substance code is the more
  specific one; a class rule asks «is this drug a member», and a false «not a member» hides a quoted sentence the doctor
  would want, while a false «member» shows a verbatim quote he can dismiss — and every added membership is reviewed here.
  Measured effect now: none, all 13 consensus codes were already on their cards through other nodes of the same МНН
  (the sildenafil `C02KX`/`G04BE03` and retinol `D11AH`/`A11CA01` cases pre-date this change). A substance rule (`s:`
  targets: substance names) does not use ATC at all;
- minus the data-declared exceptions `data/atc-code-exceptions.json` (card + code + reason + review): applied at build time,
  the index never holds an excepted code, nothing in the app branches on a drug id.

## What changed

Index built from the original ЕСКЛП release against the index built from the published modules (atc2/atc3 codes), same
instruction modules (the old index is reproduced exactly from the old release, apart from the «~» placeholder the old cards carried): 120 cards have another code set,
but a refined stub (`J05AX` → `J05AX13`) keeps its class memberships, so only **20 class memberships on 15 cards were gained,
0 lost**, plus **5 own-class suppressions** (one class target removed from sentences of the three sacubitril/valsartan
instructions). Each membership means: every instruction that names the class now has a hit for that drug.

| Verdict | Memberships | Suppressions |
| --- | ---: | ---: |
| plausible | 12 | 5 |
| unsure | 6 (5 shipped, 1 left out) | 0 |
| wrong | 2 (excluded) | 0 |

Shipped in the index: **17** memberships on 13 cards (readers = cards whose instruction names the class): N05C 4 sedative
herbal drops/tinctures (179 reader cards each), M03/M03A botulinum toxin A (107/4), J05 bulevirtide and remdesivir (73 each),
J05AB remdesivir (9), C09D sacubitril/valsartan (82), L01 ixazomib (107), R05/R05C cough mixture and liquorice extract (50/2 each),
N02B xenon–oxygen (2), R02AA eucalyptus tincture (10).

Basis of a **plausible** verdict: the instruction prints the class as its pharmacotherapeutic group and ATC code (valerian, peony, motherwort and
Zelenin drops `N05CM`, remdesivir `J05AB16`, botulinum toxin `M03AX01`, the cough mixture `R05CA10`), or the registry's own group names it (bulevirtide
«противовирусное средство», ixazomib «противоопухолевые средства», sacubitril/valsartan «антагонисты рецепторов ангиотензина II, комбинации») and the
sentences quoted for the class are about a drug like this.

### Wrong (excluded by `atc-code-exceptions.json`)

- **интерферон альфа-2b + лоратадин**, intranasal ointment, `L03AB` (class «Интерфероны» 36 readers, «Иммуностимуляторы» 1 reader): a topical form
  pulled into a systemic class rule. Its instruction: «При интраназальном применении концентрация действующих веществ, достигаемая в плазме крови,
  значительно ниже предела обнаружения … и не имеет клинической значимости»; the reader sentences are about systemic interferon (eltrombopag
  with interferon therapy for hepatitis C, CYP450, liver enzymes). The code is right for the product; its use in the class rule is not.

### Unsure

Shipped because the product's own instruction prints the class (explicit source); the doubt is the breadth of the class
word, not the code:

- **R05** (cough mixture, liquorice extract): the НСИ name of the whole group R05 is «Противокашлевые препараты и средства для лечения простудных заболеваний»,
  so the word «противокашлевые» hits all 93 cards under R05, of which only 15 are antitussives (R05D/R05F); expectorants are read as antitussives
  («не применять с противокашлевыми»). The same already happens for the 78 existing expectorant and mucolytic cards. See «For the owner».
- **N02B** xenon–oxygen (inhaled analgesic, instruction prints `N02BG`): 3 reader sentences are about antipyretic analgesics.
- **J05AB** remdesivir: 14 sentences speak of nucleoside analogues of reverse-transcriptase therapy (lamivudine, steatosis).
- **R02AA** eucalyptus tincture (rinse/inhalation, instruction prints `R02AA20`): of 14 sentences some are about skin or surgical antiseptics.

Left out (source not explicit):

- **льна посевного семена** `A06AC05` («Слабительные средства», 97 reader documents): the code rests only on the НСИ dictionary; the registered group is
  «обволакивающее средство растительного происхождения» and the instruction names a mild laxative action as a secondary effect; the quoted
  sentences concern stimulant laxatives. Declared as an exception; the owner may admit it by deleting the entry and rebuilding.

### Own-class suppressions (all plausible)

The three sacubitril/valsartan instructions (Акриварио, САРВЕЛЛИО, Валсуперио®) no longer count «ARB» sentences of their contraindications
and warnings for the group «ARB combinations» (C09D) because the drug now belongs to C09D itself — the rule every ARB label already gets. The
sentence stays for single ARBs (C09C) and the interaction section is never suppressed. Design limit: another ARB combination loses one such warning
sentence from the sacubitril/valsartan side (the reverse direction is unchanged).

## For the owner

All four points were decided on 2026-10-14; see «Owner decisions 2026-10-14» below.

1. **R05 rule breadth** (78 expectorant/mucolytic/cold-remedy cards): decided, the class word is narrowed to `R05D` + `R05F` (OD1).
2. **Other topical interferon cards in `L03AB`**: decided, kept: the instruction of one shows systemic use, the other has no instruction in the product (OD2).
3. **Льна семена** `A06AC05`: decided, admitted (OD3).
4. The 8 card codes that the НСИ dictionary does not know at level 4 (`L01XE`, `V03AA`, `J01DA06`, …, registry values) are unchanged and match no class.

Not reviewed: hits that did not change; the reader-sentence quality of the class phrases in general (INT1's own hand check, 96 % targets right);
by a clinician.

## Owner decisions 2026-10-14

Machine-readable: `ownerDecisions` in [the JSON record](atc-index-review-2026-10-14.json) (OD1–OD3, per-drug lists, quotes). The index was
rebuilt (`bun scripts/build-drug-interactions.ts`; the build before the change reproduced the committed file byte for byte); 2 100 458 → 2 101 607 bytes. Counts
below are **pairs** the class rules make visible: (card, instruction sentence or document of another drug), before against after, the three
decisions together on the committed index. In the top-200 drug pairs the share with a mention moved 2 530 → 2 520 of 19 900.

| Decision | Cards | Pairs lost (document / sentence) | Pairs gained (document / sentence) |
| --- | ---: | ---: | ---: |
| OD1 «противокашлевые» → `R05D` + `R05F` | 78 lose, 15 keep | 7 111 / 7 699 | 244 / 304 |
| OD2 two interferon cards | 0 changed | 0 | 0 |
| OD3 flax seed in `A06AC05` | 1 gains | 0 | 97 / 133 |

### OD1. «Противокашлевые» narrowed to the cough suppressants

The derived class word stood for the whole of R05 (`Противокашлевые препараты и средства для лечения простудных заболеваний`). It is now an alias
in `class-phrases.ts` (`CLASS_ALIASES`) for `R05D` and `R05F`, with the basis recorded in the alias.

- **R05F is in.** Its НСИ name is «Комбинированные препараты противокашлевых и отхаркивающих средств» (`R05FA` opium derivatives + expectorants,
  `R05FB` other suppressants + expectorants): every member contains a suppressant by the definition of the group, and the warnings the word is
  used for («не применять с противокашлевыми … скопление мокроты») follow the suppressant, not the combination partner. The group already stands behind
  the class word «отхаркивающие», so a combination is read as both. All 5 R05F cards in the index name codeine, butamirate or dextromethorphan.
- **Out:** `R05C` (expectorants and mucolytics) and `R05X` (other cold remedies: paracetamol/decongestant powders, camphor/menthol rubs).
- **78 cards lose the class** (each loses 81–93 documents / 86–100 sentences): 52 coded `R05C` (one also `R05X`) and 26 coded only `R05X`. By code: `R05CB` mucolytics 8 (acetylcysteine,
  ambroxol, bromhexine, carbocisteine, dornase alfa, erdosteine, mannitol), `R05CA` expectorants 37 (guaifenesin, marshmallow, thyme, plantain, liquorice, ivy, primrose, adhatoda, ammonia/anise and
  ammonium chloride mixtures, other herbal combinations), `R05C` bare 7 (ambroxol and bromhexine combinations, myrtol, an anise/plantain herbal tea), `R05X` cold remedies 26 (paracetamol/ascorbic acid/
  decongestant powders, camphor/menthol/essential-oil rubs, pelargonium, elder-flower herbal mixture, bromhexine and diphenhydramine combinations, 3 dextromethorphan combinations, see below).
  The full list with the figures of each card is `ownerDecisions[0].effect.lostByDrug`.
- **15 cards keep it and gain 14–17 documents each:** `R05D` 10 (butamirate, levodropropizine, prenoxdiazine, glaucine + ephedrine ×2, dextromethorphan + guaifenesin + racementhol,
  Iceland moss ×2, two antibody-based preparations), `R05F` 5 (codeine ×3, butamirate + guaifenesin, dextromethorphan + terpin hydrate + levomenthol). The gain is the
  suppressant warnings that expectorant instructions carry (bromhexine, ambroxol: «не назначают одновременно с противокашлевыми средствами»): they were dropped as
  «own class» while R05 meant every expectorant, and now reach the suppressants they are about.
- The two first-review memberships in `R05` (H01 cough mixture, H18 liquorice extract, both `R05CA`) no longer exist: withdrawn; their `R05C` memberships (H02, H19) stay.
- **Residual risk (owner to decide).** Three dextromethorphan cold remedies are coded `R05X` (dextromethorphan + paracetamol + pseudoephedrine, the same with ascorbic acid, dextromethorphan +
  phenylephrine + chlorphenamine) and lose the antitussive class sentences with the rest of `R05X`; a fourth (dextromethorphan + paracetamol + phenylephrine + chlorphenamine, `N02BE71`) never had
  them. Their substance rules still find the substance. A declared per-card extra-code list would bring them back; none exists today. **Done in ATC4c (OD5):** the `addClasses` declaration exists; the one of the four whose instruction is in the product (Каффетин® Колд) is back among the cough suppressants.

### OD2. Two topical interferon cards: kept

The condition was that the product's own instruction shows a topical product with negligible systemic absorption, like the excluded nasal ointment.

- **бензокаин + интерферон альфа-2b + таурин = Генферон**, *vaginal and rectal suppositories* (the first review wrote gel/ointment; that was wrong). Instruction
  `drug.rf.15a7cbb6003585558ca4.instruction` (ГРЛС leaflet). It states **no** plasma level or absorption (no «концентрация», «плазма», «всасывание», «системный», «фармакокинетика»).
  It indicates uses beyond the site of application — «для лечения острого бронхита в составе комплексной терапии», «хронического рецидивирующего цистита», «хронического эндометрита» — with
  «По 1 суппозиторию (1 000 000 МЕ) ректально 2 раза в сутки в течение 5 дней» for bronchitis, and lists the reactions of the systemic drug: «явления, возникающие при применении всех
  видов интерферона альфа-2b, такие как озноб, повышение температуры, … лейкопения … тромбоцитопения». Systemic indication and systemic effects: kept in `L03AB`.
- **интерферон альфа-2b + таурин = Генферон лайт**: nasal spray, nasal drops and vaginal/rectal suppositories (registrations ЛП-№(007682)-(РГ-RU), ЛП-№(007484)-(РГ-RU), ЛП-002309,
  ЛП-№(008492)-(РГ-RU)). **No instruction of this product is in the product** (15 ГРЛС instruction modules + the holder-site module, searched by trade name, substances and the four numbers),
  so there is no text that could support a block, and one card-level exception could not be right for both a nasal spray and a rectal suppository. Kept.
- Result: `atc-code-exceptions.json` keeps its single entry (interferon + loratadine). A follow-up for later: the card «интерферон-альфа-2b» joins systemic injections (Альтевир, Лайфферон) and
  topical forms (Виферон gel/ointment, Гриппферон, Инфагель); a card-level exception cannot separate them.

### OD3. Flax seed admitted

The exception for `льна посевного семена` / `A06AC05` was removed; the owner decision is the basis (the code rests on the НСИ dictionary alone; the instruction names a mild laxative
action). The card is hit by the class «Слабительные средства» (`A06`): **+97 documents / +133 sentences** on that one card, all the stimulant-laxative and laxative sentences the first
review had read for H13 (hypokalaemia, QT, laxatives as drugs).

### Other class words that look as broad as R05 (listed here, decided in ATC4c below)

Same pattern — a word that names one part of a group, resolved to the whole group, by the derived НСИ names or by an alias. Cards = cards of the index under the code, readers = documents
that name the class.

| Word → code | Cards / readers | Why it looks too broad |
| --- | ---: | --- |
| «макролиды», «линкозамиды», «стрептограмины» → `J01F` | 9 / 153 | all three words stand for the group of 7 macrolides + 2 lincosamides: a «macrolide» warning is shown for clindamycin and lincomycin and the reverse (narrow to `J01FA`, `J01FF`, `J01FG`) |
| alias «цитостатики» → `L01` | 183 / 178 | all antineoplastic agents, including ≈ 49 protein-kinase inhibitors and ≈ 39 monoclonal antibodies that are not cytostatics in the strict sense (the derived «противоопухолевые» → `L01` is right) |
| «противодиарейные» → `A07` | 40 / 15 | group name is a list; 16 live probiotics, 9 adsorbents, mesalazine, oral antibiotics are not antidiarrhoeals in the sense of a warning (narrow to `A07D`, `A07F`, `A07X`) |
| «психостимуляторы» → `N06B` | 32 / 30 | 28 of the 32 cards are `N06BX` nootropics (piracetam and others), not stimulants |
| «деконгестанты» → `R01A`; → `S01G` | 35 / 15; 10 / 27 | `R01A` holds nasal corticosteroids (8) and antiallergics (3), `S01G` ophthalmic antiallergics (6) |
| «кровезаменители» → `B05` | 61 / 14 | electrolyte, parenteral-nutrition and dialysis solutions are not blood substitutes |
| «анальгетики» → `N02` | 89 / 84 | includes 12 migraine drugs (ergot alkaloids, triptans, CGRP antagonists) |
| «снотворные» → `N05C` | 42 / 307 | 30 of the 42 are `N05CM` (valerian and other herbal sedatives); hypnotic warnings are shown for them (already seen in the first review, the herbal drops) |

Under-inclusive rather than over-broad (a warning is missed, not shown wrongly): alias «гипотензивные», «антигипертензивные» → `C02` only (18 cards; diuretics, beta-blockers, ACE inhibitors, calcium-channel
blockers are not in it, though an instruction that says «гипотензивные средства» means them).

These were not changed by the first owner decision (R05 only); the owner extended it to all of them the same day, see «Owner decisions 2026-10-14, second part (ATC4c)».

## Owner decisions 2026-10-14, second part (ATC4c)

Machine-readable: `ownerDecisions` OD4 (the words, per-drug lists) and OD5 (class additions) and `userPerspective` (scenarios) in [the JSON record](atc-index-review-2026-10-14.json).
Tests: `class-words.data.test.ts`, `atc-codes.test.ts`, `class-phrases.test.ts`. The index was rebuilt from the published modules
(`bun scripts/build-drug-interactions.ts`; the build before the change reproduced the committed file byte for byte): 2 101 607 → 2 127 209 bytes.

### A. The over-broad class words, narrowed by subgroup

Owner: yes to narrowing the same way as «противокашлевые» (a word that names one part of a group maps to that part only), and to widening «гипотензивные». The exact
subgroups were decided from the WHO ATC structure (the НСИ names) and from how the instruction sentences use each word (the basis is recorded in each alias in
`class-phrases.ts`, and below). **Pairs** here: (card, instruction sentence or document of ANOTHER drug) that the doctor reaches through ANY rule of the build
(substance name or class), measured on indexes that differ by that one word only; «document» counts pairs for which no sentence of that document stays reachable. Lost / gained,
document / sentence.

| Word | Class codes before → after | Cards before → after | Pairs lost | Pairs gained | For the doctor |
| --- | --- | --- | ---: | ---: | --- |
| «макролиды» | `J01F` → `J01FA` | 9 → 7 (−2 / +0) | 70 / 166 | 0 / 0 | better |
| «линкозамиды» | `J01F` → `J01FF` | 9 → 2 (−7 / +0) | 28 / 28 | 0 / 0 | better |
| «стрептограмины» | `J01F` → `J01FG` | 9 → 0 (−9 / +0) | 0 / 18 | 0 / 0 | neutral |
| «цитостатики» | `L01` → `L01A` + `L01B` + `L01C` + `L01D` + `L01XA` + `L01XB` + `L01XX` | 183 → 74 (−109 / +0) | 7 482 / 9 137 | 115 / 126 | better |
| «психостимуляторы» | `N06B` + `N06CB` → `N06BA` + `N06BC` + `N06CB` | 32 → 4 (−28 / +0) | 828 / 1 034 | 4 / 4 | better |
| «снотворные» | `N05C` → `N05CA` + `N05CB` + `N05CC` + `N05CD` + `N05CE` + `N05CF` + `N05CH` + `N05CJ` + `N05CX` | 42 → 12 (−30 / +0) | 3 214 / 4 376 | 50 / 110 | better |
| «противодиарейные» | `A07` → `A07B` + `A07D` + `A07X` | 40 → 13 (−27 / +0) | 400 / 405 | 0 / 0 | better |
| «анальгетики» | `A03EA` + `N02` + `S02DA` → `A03EA` + `N02A` + `N02B` + `S02DA` | 91 → 78 (−13 / +0) | 1 056 / 1 100 | 536 / 673 | better |
| «деконгестанты» | `R01A` + `S01G` → `R01AA` + `R01AB` + `R01BA` + `S01GA` | 41 → 18 (−23 / +0) | 314 / 366 | 119 / 145 | better |
| «кровезаменители» | `B05` → `B05A` | 61 → 17 (−44 / +0) | 592 / 613 | 0 / 0 | better |
| «гипотензивные / антигипертензивные» | `C02` → `C02` + `C03A` + `C03B` + `C03C` + `C03D` + `C03E` + `C07` + `C08` + `C09` | 18 → 115 (−0 / +97) | 0 / 0 | 25 208 / 45 278 | better |

All words together and the two class additions: 13 984 document pairs lost and 26 130 gained (17 243 / 46 443 sentence pairs)
of 465 620 document pairs in the index; the share of the 19 900 pairs of the 200 most common drugs that have a mention moved 2520 → 2578. A pair gained
without a class rule behind it comes from own-class suppression (see the limits below).

What each decision rests on (full lists of the cards that lose or gain a word, with codes and per-card pairs: `ownerDecisions[OD4].words[].effect`):

- **«Макролиды» → `J01FA`, «линкозамиды» → `J01FF`, «стрептограмины» → `J01FG`.** The НСИ name of `J01F` lists three classes; each word was resolving to the whole. Lost: the
  macrolide sentences (CYP3A4, QT, hydroxychloroquine) stop reaching clindamycin and lincomycin, the lincosamide sentences stop reaching the seven macrolides. No streptogramin
  is among the cards, so that word reaches nobody now (neutral). Limit: a sentence that says «антибиотики из группы макролидов» still reaches every antibiotic through «антибиотики»
  (`J01`), so the pair counts there do not move (scenario M3).
- **«Цитостатики» → `L01A`, `L01B`, `L01C`, `L01D`, `L01XA`, `L01XB`, `L01XX`.** The sentences that use the word are about chemotherapy: leukopenia/agranulocytosis with ACE
  inhibitors, haematotoxicity, live vaccines, warfarin potentiation. That is alkylating agents, antimetabolites, plant alkaloids, cytotoxic antibiotics, platinum, methylhydrazines
  and the residual `L01XX`. Not the 52 protein-kinase inhibitors (`L01E`, old registry `L01XE`) or the 40 monoclonal antibodies and conjugates (`L01F`, `L01XC`, `L01XY`), 10 other targeted
  agents, 5 photosensitisers/retinoids and 2 stub-coded cards (`L01`, `L01X`) that lose it; the word «противоопухолевые» keeps the whole `L01`. `L01XX` is a mixed group:
  hydroxycarbamide, asparaginase, eribulin, mitotane, arsenic trioxide are cytotoxic and would be missed without it, venetoclax, olaparib, selinexor and sotorasib come along (kept as
  the lesser harm: a missed real warning is worse than an extra quote).
- **«Психостимуляторы» → `N06BA`, `N06BC`, `N06CB`.** The sentences speak of methylphenidate, amphetamine, caffeine. `N06BX` is nootropics (28 of the 32 cards before); `N06BC` (caffeine)
  is added to the owner's `N06BA` because the instructions name caffeine as a psychostimulant.
- **«Снотворные» → `N05CA`–`N05CF`, `N05CH`, `N05CJ`, `N05CX`, not `N05CM`.** `N05CM` is the herbal and bromide sedatives (30 cards: valerian, motherwort, peony, bromcamphor) and dexmedetomidine. «Седативные»
  stays on all of `N05C`, so «седативные и снотворные средства» still reaches them. Residual: two phenobarbital drops coded only `N05CM` (Корвалол) and dexmedetomidine lose the hypnotic sentences.
- **«Противодиарейные» → `A07B`, `A07D`, `A07X`.** The sentences are about adsorbent and motility-reducing antidiarrhoeals (lincomycin, aminophylline absorption; «не принимайте
  препараты, останавливающие диарею»). Probiotics `A07F` (16 live-organism cards) have their own phrase «противодиарейные микроорганизмы», intestinal anti-infectives and anti-inflammatories
  `A07A`/`A07E` and rehydration salts `A07C` are not antidiarrhoeals in that sense.
- **«Анальгетики» → `A03EA`, `N02A`, `N02B`, `S02DA`, not `N02C`.** Migraine drugs (12 cards: ergot alkaloids, triptans, CGRP antagonists) are not what the sentences mean (methadone with
  nevirapine, folate need under analgesics, other central analgesics); `A03EA`/`S02DA` stay as before. A turpentine rub coded `N02` falls out with them.
- **«Деконгестанты» → `R01AA`, `R01AB`, `R01BA`, `S01GA`.** The sentences are about sympathomimetic vasoconstrictors with MAO inhibitors, tricyclics and antihypertensives; nasal corticosteroids
  `R01AD`, antiallergics `R01AC`/`S01GX` and other nasal products (`R01AX`: sea water, antiseptics) are not.
- **«Кровезаменители» → `B05A`.** Colloid plasma substitutes (dextran, gelatin, hydroxyethyl starch, albumin, povidone) are what «коллоидные кровезаменители» with metamizole means; infusion, nutrition,
  irrigation and dialysis solutions are not.
- **«Гипотензивные» (and «антигипертензивные») → `C02`, `C03A`–`C03E`, `C07`, `C08`, `C09`.** The instructions list diuretics, beta-blockers, calcium-channel blockers, ACE inhibitors and ARBs as
  «гипотензивные препараты»; loop diuretics are included (furosemide is listed as an antihypertensive in the cisplatin instruction), vasopressin antagonists `C03X` are not. **This ADDS warnings**: 97
  cards gain the ~380 instructions that name antihypertensives (NSAIDs weaken them; metformin and insulin; additive hypotension; sildenafil; anaesthetics). In a sample of 28 of those sentences all were real
  statements about drugs that lower the pressure (the only false hit, «гипер- или гипотензивных кризов» in the morphine instruction, existed before).

### B. A class added to one card (`addClasses`)

`atc-code-exceptions.json` now has a second list beside `exceptions`: `addClasses` (card, ATC group codes, reason, **evidence = the instruction document, section and a verbatim quote**, review entry).
`selectAtcCodes(…, additions)` adds the classes to the card's codes at build time (origin `declared`; the card's own-class suppression follows), `parseAtcClassAdditions` validates the file, and
`scripts/build-drug-interactions.ts` **refuses an addition whose quote is not in that instruction's section** (`additionEvidenceHolds`) or whose document is not in any module, whose card or class does not
exist. No UI code branches on a drug id; the index holds the result.

- **Каффетин® Колд** (dextromethorphan + paracetamol + pseudoephedrine + ascorbic acid, `R05X`) → `R05D`. Evidence, «Показания к применению»: «Декстрометорфан уменьшает кашель, вызванный незначительным раздражением
  горла и дыхательных путей.» It regains the antitussive sentences of the expectorant instructions (+98 document / +107 sentence pairs).
- **Not applied** where the instruction is not in the product, so there is no evidence from the product's own text: dextromethorphan + paracetamol + pseudoephedrine, dextromethorphan + phenylephrine +
  chlorphenamine (both `R05X`) and dextromethorphan + paracetamol + phenylephrine + chlorphenamine (`N02BE71`).
- **Полидекса с фенилэфрином** (dexamethasone + neomycin + polymyxin B + phenylephrine nasal spray, `R01AD53`) → `R01AA`: not asked for; the narrowing of «деконгестанты» would have taken the decongestant
  sentences (MAO inhibitors, antihypertensives) away from a product that calls itself «деконгестанты и другие препараты для местного применения»; it also gains the «симпатомиметики» sentences it never had.
- The same gap exists, undeclared, for cold remedies coded `R05X`/`N02BE` that contain pseudoephedrine, phenylephrine or paracetamol (not in the decongestant or analgesic classes by code, as before), phenobarbital
  drops coded only `N05CM`, and камилофин-кофеин-меклоксамин-пропифеназон-эрготамин (`N02CA52`, no instruction in the product).

### C. User-perspective assessment

The owner asked for the decisions to be judged by what a doctor experiences, not by counts. Method (`userPerspective` in the JSON): 40 scenarios (at least two per changed word, plus the dextromethorphan case)
run through the real code path: `checkPair` over the committed index (before) and the rebuilt one (after), the sentences read from the installed ГРЛС instruction modules, the marks from `highlightPatterns` /
`highlightSegments` with the class phrases the app derives at run time. Rule applied: a missed real warning is worse than an extra dismissible quote; noise that buries real warnings is also bad; a narrowing that
made it worse would not be applied. **Result: 20 better, 20 neutral (mostly controls that must not change), 0 worse; all narrowings and the widening are applied.**

| Scenario | Before → after (mentions found) | Verdict | What the doctor sees |
| --- | --- | --- | --- |
| M1 кларитромицин + клиндамицин («макролиды/линкозамиды») | 2 → 1 | better | The pair loses an unrelated sentence (azithromycin with hydroxychloroquine, quoted for clindamycin only because the word «макролиды» reached all of J01F); the cross-resistance sentence stays because it names clindamycin. |
| M3 клиндамицин + домперидон («макролиды») | 4 → 4 | neutral | The domperidone sentences say «антибиотики из группы макролидов»; the word «антибиотики» still reaches clindamycin, so the count does not move. Only the highlight stops marking «макролидов» as clindamycin’s class. |
| C1 иматиниб + каптоприл («цитостатики») | 1 → 0 | better | Imatinib no longer receives the captopril sentence about haematotoxicity of cytostatics. |
| C3 сорафениб + варфарин («цитостатики») | 6 → 4 | better | Sorafenib no longer receives the warfarin table row «Цитостатики … усиление метаболизма варфарина»; the four sentences of sorafenib’s own instruction about warfarin stay. |
| D1 сахаромицеты + аминофиллин («противодиарейные») | 1 → 0 | better | A yeast probiotic no longer receives the aminophylline sentence about antidiarrhoeals that reduce its absorption. |
| D4 месалазин + аминофиллин («противодиарейные») | 1 → 0 | better | Mesalazine (an anti-inflammatory) no longer receives it. |
| S2 валерианы + ритонавир («снотворные») | 2 → 2 | neutral | Valerian keeps both sentences because they also say «седативные»; only the highlight of «снотворные» goes. |
| S4 валерианы + тиамин («снотворные») | 1 → 0 | better | Valerian no longer receives the thiamine sentence about hypnotics. |
| A1 суматриптан + невирапин («анальгетики») | 1 → 0 | better | Sumatriptan no longer receives the nevirapine/methadone sentence about analgesics. |
| A4 морфин + парацетамол («анальгетики») | 0 → 1 | neutral | New: morphine’s own instruction (reduce the dose with other centrally acting analgesics) now reaches paracetamol. Real but only partly relevant; before, own-class suppression hid it from every analgesic. |
| H1 амлодипин + диклофенак («гипотензивные») | 1 → 4 | better | Amlodipine with diclofenac: the diclofenac instruction’s «диуретические и гипотензивные средства» sentences (NSAIDs weaken them) now reach amlodipine: 1 → 4. |
| H3 амлодипин + лизиноприл («гипотензивные») | 1 → 3 | better | Two antihypertensives: lisinopril’s «другие гипотензивные средства: аддитивный эффект» now reaches amlodipine: 1 → 3. |
| H4 амлодипин + метформин («гипотензивные») | 0 → 1 | better | Metformin’s «гипотензивные средства … могут снижать концентрацию глюкозы» reaches amlodipine: 0 → 1 (a missed real warning before). |
| X1 декстрометорфан + бромгексин («противокашлевые (DXM)») | 0 → 1 | better | The dextromethorphan cold remedy and the expectorant: the bromhexine sentence «не назначают одновременно с противокашлевыми» is back (1 → 0 → 1 across ATC4b and this change). |
| N2 мометазон + разагилин («деконгестанты») | 1 → 0 | better | A nasal corticosteroid no longer receives the razagiline sentence about decongestants. |
| N3 дексаметазон + разагилин («деконгестанты») | 1 → 2 | better | The phenylephrine spray keeps it (declared class) and gains the «симпатомиметики» sentence: 1 → 2. |
| B2 декстроза + метамизол («кровезаменители») | 1 → 0 | better | A glucose solution no longer receives the metamizole sentence about colloidal blood substitutes. |
| P2 пирацетам + рисперидон («психостимуляторы») | 3 → 0 | better | Piracetam no longer receives the risperidone sentences about methylphenidate-type psychostimulants (3 → 0). |

(All 40 with the quoted sentences before and after: `userPerspective.scenarios`.)

- **In the built app.** Four of the pairs (M1 clarithromycin + clindamycin, H1 amlodipine + diclofenac, X1 the dextromethorphan cold remedy + bromhexine, C1 imatinib + captopril) were also run in Chromium against the
  built app with the real instruction modules installed through the tool's own download offer, on a build of the committed files (before) and of these changes (after): found 2 → 1, 1 → 4, 0 → 1, 1 → 0, the same as the code
  path; the three diclofenac sentences about «гипотензивные средства» are quoted for amlodipine with the word marked. (The highlighter also marks the singular «гипотензивное»: it does not apply the plural-only rule of
  the build-time matcher; pre-existing, not changed.) Screenshots stayed in the session scratchpad.
- **Interaction checker / prescription tool.** The prescription tool «Назначение» shows the same `InteractionPairs` over the same index and phrases, so it changes the same way. Narrowings remove quotes that were
  about another subgroup (a kinase inhibitor reading about chemotherapy, a probiotic reading about adsorbents, a nootropic reading about methylphenidate); the widening adds real quotes for antihypertensives
  (amlodipine + diclofenac 1 → 4, lisinopril + diclofenac 3 → 6, amlodipine + metformin 0 → 1), which is the point of the pair check for a hypertensive patient.
- **Reading.** The drug instruction screen and reader do not highlight or link interaction sentences; they appear as quotes in the two tools above (each quote opens the instruction at its place, unchanged) with the
  words that name the other drug marked. The marks come from the same alias table at run time, so a narrowed word is marked only for drugs of the narrowed subgroup (M3, S2).
- **Comparing.** Not affected: the drug comparison tool has its own index (`comparison-index.json`, both ATC codes per card from ATC3) and imports nothing from `drug-interactions`; the «По группам АТХ» tree is
  built from `atc-names.json` and card codes. Neither reads class words or aliases.
- **Search.** Class words do **not** feed main search: `CLASS_ALIASES` is imported only by the interaction build, loader and highlighter; the search core is lexical text matching, and the interaction-query parser reads
  drug names. Before and after are identical by construction. What search returns today for a class word (dev corpus): «макролиды» → МКБ «T36.3 Макролидами», two КР on pneumonia, and in the drug scope Кофетамин,
  Бициллин 3, Эсциталопрам (instructions that mention macrolides); «гипотензивные» → «Гипотензивный синдром», МКБ T46.5, and Урапидил, Мазь «Нитро»; «снотворные» → МКБ T42 and Налбуфин among herbal extracts;
  «противодиарейные» → T47.6 and instructions that mention antidiarrhoeals (Пенициллин, Аминофиллин, Линкомицин). Should it? Probably yes: a doctor typing «макролиды» wants azithromycin, clarithromycin …, and the
  narrowed table is the right source for «class word → ATC groups → members». That belongs to the ATC5 task (search by ATC code); nothing was implemented here.

Limits (also in the JSON): the tool reads only the best instruction of each card; own-class suppression works per code, so with a word that stands for several codes a sentence in which an instruction describes its own
class reaches the sibling subgroups (cytostatics +115 document pairs, analgesics +536, hypnotics +50; in the analgesic case most of it is real, the morphine and tramadol sentences about other analgesics, the rest is the
self-description of paracetamol cold remedies shown to 13 opioid cards); no clinician has judged the verdicts; not tested in the full app in a browser against the rebuilt asset (see CURRENT_STATE).
