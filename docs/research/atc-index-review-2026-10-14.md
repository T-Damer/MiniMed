# ATC codes in the interaction and medication-safety indexes — review (ATC4, 2026-10-14)

Machine-readable record: [atc-index-review-2026-10-14.json](atc-index-review-2026-10-14.json) (every judged hit with the
code, its sources, the class rule and its basis, the reader counts and quotes) and
[atc-index-selection-audit-2026-10-14.json](atc-index-selection-audit-2026-10-14.json) (conflict candidates the code
selection ignored). Reviewer: AI against the product's own instruction texts; no clinician has signed it off. Owner's
brief: the data is 90–99 % right, so the review covers only what the completed codes **change**.

> **Status 2026-10-14 (later):** the owner decided the open points; the text below is the review as written, the changes are in «Owner decisions 2026-10-14» at the end:
> R05 memberships withdrawn (the class word narrowed), flax seed admitted, the two interferon cards kept. Shipped memberships: 17 → 16.

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
  them. Their substance rules still find the substance. A declared per-card extra-code list would bring them back; none exists today.

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

### Other class words that look as broad as R05 (listed, not changed)

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

None of these were changed: the owner decision covers R05 only.
