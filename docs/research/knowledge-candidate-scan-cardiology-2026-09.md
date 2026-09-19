# Cardiology knowledge-candidate extraction — 2026-09-19

## Scope

This is a source-backed authoring queue for the concept-first extraction path in draft PR #174.
It records assessment/risk instruments that are explicitly present in current Russian clinical
recommendations and preserves recommendation identity/version.

Nothing in this file automatically becomes a MiniMed clinical rule or redistributable calculator.
Existing MiniMed tools should receive reviewed source-document links; new instruments remain
`proposed` until their identity, formula/content rights, population and validation source are reviewed.

## Atrial fibrillation and atrial flutter — current 2025 recommendation

Current recommendation: **«Фибрилляция и трепетание предсердий»**, registry ID 382, version 2,
approved/revised 2025, adults.

Registry metadata:
https://minzdrav.clinirec.ru/kr/fibrillyaciya-i-trepetanie-predserdii/

Assessment appendix:
https://sudact.ru/law/klinicheskie-rekomendatsii-fibrilliatsiia-i-trepetanie-predserdii-u/prilozhenie-g/

| Candidate | Type | MiniMed disposition |
| --- | --- | --- |
| modified EHRA symptom scale | scale | concept/source-link review |
| CHA₂DS₂-VASc | scale | already implemented; add current 2025 source link, do not duplicate tool identity |
| HAS-BLED | scale | already implemented; normalize source spelling `HAS-BLEED` to canonical HAS-BLED only by explicit review |
| SAMeT₂R₂ | scale | new concept candidate |

The recommendation uses CHA₂DS₂-VASc for thromboembolic-risk assessment, HAS-BLED for bleeding-risk
assessment, and SAMeT₂R₂ for the probability of maintaining adequate TTR during vitamin-K-antagonist
therapy. Their co-occurrence must not be treated as synonymy.

Current text examples:
https://sudact.ru/law/klinicheskie-rekomendatsii-fibrilliatsiia-i-trepetanie-predserdii-u_1/klinicheskie-rekomendatsii/lechenie/3.1/3.1.1/
https://sudact.ru/law/klinicheskie-rekomendatsii-fibrilliatsiia-i-trepetanie-predserdii-u_1/klinicheskie-rekomendatsii/profilaktika-i-dispansernoe-nabliudenie/

### Freshness decision

Use ID 382/version 2/year 2025 as the current source identity. Older AF recommendation editions may
remain historical provenance but must not win current discovery/source badges.

## Chronic heart failure — current 2024 recommendation

Current recommendation: **«Хроническая сердечная недостаточность»**, registry ID 156, version 2,
approved/revised 2024, adults, revision due no later than 2026.

Registry metadata:
https://minzdrav.clinirec.ru/kr/hronicheskaya-serdechnaya-nedostatochnost/

Current source mirror:
https://meganorm.ru/mega_doc/dop1/8/spravochnaya_informatsiya_standarty_i_poryadki_okazaniya/2/klinicheskie_rekomendatsii_khronicheskaya_serdechnaya.html

Confirmed assessment candidates:

| Candidate | Type | Source position | MiniMed disposition |
| --- | --- | --- | --- |
| ШОКС / clinical condition scale for CHF | scale | Appendix Г1 | new concept candidate |
| Six-Minute Walk Test | assessment_method | Appendix Г2 | new concept candidate; performance test, not a symptom scale |
| HFA-PEFF | scale/criterion set | Appendix Г3 | reviewer chooses final entity class; do not infer diagnosis from score automatically |
| H₂FPEF | scale | Appendix Г3 | new concept candidate |
| NYHA functional classification | classification | recommendation text | source-backed classification concept |

Assessment appendix sources:
https://sudact.ru/law/klinicheskie-rekomendatsii-khronicheskaia-serdechnaia-nedostatochnost-odobreny-minzdravom/prilozhenie-g1-gn/prilozhenie-g1/
https://sudact.ru/law/klinicheskie-rekomendatsii-khronicheskaia-serdechnaia-nedostatochnost-odobreny-minzdravom/prilozhenie-g1-gn/prilozhenie-g3/shkala-hfa-peff/
https://sudact.ru/law/klinicheskie-rekomendatsii-khronicheskaia-serdechnaia-nedostatochnost-odobreny-minzdravom/prilozhenie-g1-gn/prilozhenie-g3/shkala-h2fpef/

The recommendation explicitly names HFA-PEFF and H₂FPEF for non-invasive assessment of the probability
of HFpEF. MiniMed may represent the instruments and source links, but a positive result must not silently
be converted into an autonomous diagnosis.

### Pediatric boundary

There is a separate current **2025 pediatric CHF** recommendation (registry ID 401, version 2).
Do not reuse the adult instrument/population contract for children merely because the disease label
overlaps. Pediatric extraction is a separate batch.

Registry:
https://minzdrav.clinirec.ru/kr/hronicheskaya-serdechnaya-nedostatochnost-u-detey/

## NSTE-ACS — current 2024 recommendation

Current recommendation: **«Острый коронарный синдром без подъема сегмента ST электрокардиограммы»**,
registry ID 154, version 4, approved/revised 2024, adults.

Registry metadata:
https://minzdrav.clinirec.ru/kr/ostryy-koronarnyy-sindrom-bez-podema-segmenta-st-elektrokardiogrammy/

The current appendix inventory exposes five distinct risk instruments:

| Candidate | Type | Source position | MiniMed disposition |
| --- | --- | --- | --- |
| GRACE 1.0 | scale | Appendix Г1 | new concept candidate |
| ARC-HBR | criterion_set / scale | Appendix Г2 | reviewer chooses final type |
| CRUSADE | scale | Appendix Г3 | new concept candidate |
| PRECISE-DAPT | scale | Appendix Г4 | new concept candidate |
| ОРАКУЛ bleeding-risk scale | scale | Appendix Г5 | new concept candidate |

Current appendix:
https://www.consultant.ru/document/cons_doc_LAW_489058/6e3b74e12dd38fa2dc87ae963cb86ba66d45b2a3/

Current risk-stratification section:
https://sudact.ru/law/klinicheskie-rekomendatsii-ostryi-koronarnyi-sindrom-bez-podema_1/klinicheskie-rekomendatsii/2/2.5/2.5.1/

The recommendation specifically identifies GRACE 1.0 for adverse-outcome risk, while ARC-HBR,
CRUSADE, PRECISE-DAPT and ОРАКУЛ address bleeding risk in different contexts. They must remain distinct
concepts despite all being “risk scores.”

## Extraction implications

1. **Current-edition linking matters.** AF should link to 382/version 2/2025; CHF to 156/version 2/2024;
   NSTE-ACS to 154/version 4/2024.
2. **Existing tool identity wins.** CHA₂DS₂-VASc and HAS-BLED already exist in MiniMed; this pass should
   add current source links rather than create another tool definition.
3. **Performance tests are not scales by default.** The Six-Minute Walk Test reinforces the new
   `assessment_method` entity type added in PR #174.
4. **Similar purpose is not synonymy.** GRACE, ARC-HBR, CRUSADE, PRECISE-DAPT and ОРАКУЛ have different
   targets/populations and must not collapse into a generic risk-score entity.
5. **Typos/variant spellings stay reviewable.** A source spelling such as `HAS-BLEED` should be stored
   as source text/provenance; canonical alias promotion to HAS-BLED is an explicit reviewer decision.
6. **Diagnosis remains separate from scoring.** HFA-PEFF/H₂FPEF discovery does not authorize an
   unreviewed diagnostic verdict.
