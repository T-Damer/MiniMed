# ATC codes in the interaction and medication-safety indexes — review (ATC4, 2026-10-14)

Machine-readable record: [atc-index-review-2026-10-14.json](atc-index-review-2026-10-14.json) (every judged hit with the
code, its sources, the class rule and its basis, the reader counts and quotes) and
[atc-index-selection-audit-2026-10-14.json](atc-index-selection-audit-2026-10-14.json) (conflict candidates the code
selection ignored). Reviewer: AI against the product's own instruction texts; no clinician has signed it off. Owner's
brief: the data is 90–99 % right, so the review covers only what the completed codes **change**.

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

1. **R05 rule breadth** (pre-existing, 78 expectorant/mucolytic cards): map the alias «противокашлевые» to `R05D` and `R05F` instead of the whole of R05. It would remove false
   «do not combine with antitussives» hits between expectorants; not applied because it changes existing hits beyond what the new codes change.
2. **Other topical interferon cards in `L03AB`** (existing, not changed by the fill): «бензокаин + интерферон альфа-2b + таурин» (gel/ointment) and «интерферон альфа-2b + таурин»
   are the same kind as the excluded nasal ointment; check their instructions for absorption statements and, if the same, add exceptions.
3. **Льна семена** `A06AC05`: admit or keep out.
4. The 8 card codes that the НСИ dictionary does not know at level 4 (`L01XE`, `V03AA`, `J01DA06`, …, registry values) are unchanged and match no class.

Not reviewed: hits that did not change; the reader-sentence quality of the class phrases in general (INT1's own hand check, 96 % targets right);
by a clinician.
