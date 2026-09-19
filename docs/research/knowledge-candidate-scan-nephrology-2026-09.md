# Nephrology knowledge-candidate extraction — 2026-09-19

## Scope

This is a source-backed authoring queue for PR #174. It records current Russian clinical-recommendation
identity, named renal-function equations/classifications, and variant boundaries.

The pass deliberately does **not** equate every occurrence of “CKD-EPI” or “Schwartz” with an existing
MiniMed calculator. Formula year, biomarker inputs, assay assumptions and population are part of the
instrument identity and require explicit review.

## Adult chronic kidney disease — current 2024 recommendation

Current recommendation: **«Хроническая болезнь почек (ХБП)»**, registry ID 469, version 3,
approved/revised 2024, adults, revision due no later than 2026.

Registry metadata:
https://minzdrav.clinirec.ru/kr/hronicheskaya-bolezn-pochek-hbp/

Current recommendation mirror:
https://sudact.ru/law/klinicheskie-rekomendatsii-khronicheskaia-bolezn-pochek-khbp-odobreny/klinicheskie-rekomendatsii/

### Source-backed concepts

| Candidate | Type | Source evidence | MiniMed disposition |
| --- | --- | --- | --- |
| CKD G-stage classification by eGFR | classification | section 1.5 | reviewed classification concept |
| albuminuria categories | classification | section 1.5 | reviewed classification concept; preserve source category scheme |
| urine albumin/creatinine ratio (ACR) | measurement/ratio | diagnostic section | knowledge/measurement concept, not an assessment scale |
| urine total protein/creatinine ratio | measurement/ratio | diagnostic section | knowledge/measurement concept |
| CKD-EPI creatinine eGFR equation | calculator/equation family | section 2.3 / Appendix Г | **variant review required** before linking to existing CKD-EPI 2021 calculator |
| CKD-EPI cystatin-C equation (2012) | calculator/equation | section 2.3 / Appendix Г | separate formula candidate |

Classification source:
https://sudact.ru/law/klinicheskie-rekomendatsii-khronicheskaia-bolezn-pochek-khbp-odobreny/klinicheskie-rekomendatsii/1/1.5/

Laboratory/eGFR source:
https://sudact.ru/law/klinicheskie-rekomendatsii-khronicheskaia-bolezn-pochek-khbp-utv/klinicheskie-rekomendatsii/2/2.3-laboratornye-diagnosticheskie-issledovaniia/

### Important formula-identity boundary

MiniMed currently has an installed **CKD-EPI 2021** calculator. The current adult Russian recommendation
uses the broader CKD-EPI name and separately identifies a cystatin-C 2012 equation; its text also carries
assumptions characteristic of earlier CKD-EPI implementations.

Therefore:

- do not attach the 2024 recommendation to the MiniMed CKD-EPI 2021 tool merely because both contain
  the string `CKD-EPI`;
- review the exact Appendix Г equation/version first;
- if the recommendation formula differs, represent it as a separate equation variant linked to the
  common CKD-EPI family concept;
- source-linked clinical classifications (G-stage/albuminuria) are independent of calculator identity.

This is exactly the kind of false equivalence that concept-first identity must prevent.

## Pediatric chronic kidney disease — current 2025 recommendation

Current recommendation: **«Хроническая болезнь почек»**, registry ID 713, version 2,
approved/revised 2025, children/adolescents, revision due no later than 2027.

Registry:
https://minzdrav.clinirec.ru/kr/hronicheskaya-bolezn-pochek/

Current source mirror:
https://meganorm.ru/mega_doc/dop1/8/spravochnaya_informatsiya_standarty_i_poryadki_okazaniya/2/klinicheskie_rekomendatsii_khronicheskaya_bolezn_pochek.html

Confirmed equation/method candidates:

| Candidate | Type | Population/input distinction | MiniMed disposition |
| --- | --- | --- | --- |
| Bedside Schwartz 2009 | calculator/equation | pediatric, height + IDMS-standardized creatinine | existing MiniMed Schwartz tool: current-source linkage after exact formula/unit parity check |
| Schwartz-Lyon 2012 | calculator/equation | pediatric, sex/age-specific coefficient | new variant candidate |
| CKiD combined equation | calculator/equation | height + creatinine + cystatin C + BUN (+ sex factor) | new candidate |
| Schwartz cystatin-C equation (2012) | calculator/equation | cystatin C | new candidate |
| CKiD U25 creatinine equation | calculator/equation | 1–25 years with age/sex coefficients | new candidate |
| CKiD U25 cystatin-C equation | calculator/equation | 1–25 years, cystatin C + age/sex coefficient | new candidate |
| Smits neonatal eGFR approach | calculator/equation | term neonates/early age | new candidate; neonatal population boundary |

The recommendation explicitly notes that ordinary adult/older-child CKD thresholds are not directly
portable to neonates/young infants and that GFR is physiologically age-dependent early in life. This
population qualifier belongs in the equation/concept metadata.

### Existing MiniMed tool linkage

MiniMed already has a schema-driven pediatric eGFR/Schwartz calculator. The 2025 recommendation is a
high-value current Russian source link, but link promotion should occur only after comparing:

- coefficient and creatinine units;
- IDMS/enzymatic assay expectation;
- population/age contract;
- exact equation version.

A matching name alone is insufficient.

## Cross-age conclusions

1. Adult ID 469 v3 (2024) and pediatric ID 713 v2 (2025) are separate current source documents.
2. Adult CKD stage/albuminuria classification and pediatric age-specific interpretation should not be
   collapsed into a single unqualified rule.
3. Formula families need variant identity: CKD-EPI, Bedside Schwartz, Schwartz-Lyon, CKiD and CKiD U25
   are related but not interchangeable.
4. ACR/PCR are measured ratios, not “scales”; the knowledge schema should eventually distinguish
   measurement/formula concepts from assessment-method concepts rather than forcing them into
   `scale`.
5. This pass identifies source-backed candidates only; no dose/treatment rule is generated.
