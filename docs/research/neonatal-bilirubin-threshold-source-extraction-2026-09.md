# Neonatal bilirubin threshold extraction — 2026-09-19

## Current sources

The old OCR blocker is superseded by two current 2025 Russian clinical recommendations with explicit
numeric Appendix A3.3 tables.

### Gestational age >=35 weeks

Clinical recommendation **«Неонатальная желтуха»**, registry ID 916, version 1, 2025.

Registry metadata:
https://minzdrav.clinirec.ru/kr/neonatalnaya-zheltuha/

Threshold appendix:
https://base.garant.ru/412124590/8d2cab3ed1429a023f68bed96854e161/

Research artifact:

`docs/research/data/neonatal-jaundice-treatment-thresholds-kr916-v1-2025.json`

It stores six postnatal-age bins and three distinct total-serum-bilirubin threshold series:

- standard phototherapy;
- intensive phototherapy;
- exchange transfusion.

The recommendation text applies this early-neonatal framework to term and late-preterm newborns with
gestational age >=35 weeks.

### Gestational/corrected age 22–34 weeks

Clinical recommendation **«Гипербилирубинемия недоношенных»**, registry ID 917, version 1, 2025.

Registry metadata:
https://minzdrav.clinirec.ru/kr/giperbilirubinemiya-nedonoshennyh/

Research artifact:

`docs/research/data/preterm-hyperbilirubinemia-treatment-thresholds-kr917-v1-2025.json`

The grid preserves five source gestational/corrected-age bands:

- 22–25 weeks;
- 26–27;
- 28–29;
- 30–31;
- 32–34.

For every band it stores the same six postnatal-age bins for:

- standard phototherapy — Appendix A3.3.1;
- intensive phototherapy — Appendix A3.3.2;
- exchange transfusion — Appendix A3.3.3.

Source tables:

- https://sudact.ru/law/klinicheskie-rekomendatsii-giperbilirubinemiia-nedonoshennykh-odobreny-minzdravom-rossii/prilozhenie-a3/prilozhenie-a3.3/prilozhenie-a3.3.1/
- https://base.garant.ru/412124592/851f67a6758ec26eb84630fab5fb1f07/
- https://base.garant.ru/412124592/41c3ef6fbbb50d07c3ce296a882e4389/

## Deliberate boundaries

Both artifacts remain `review-required` and `publicationState: blocked`.

They do not yet define:

- inclusive/exclusive semantics exactly at every age boundary;
- interpolation between postnatal-age bins;
- interpolation between gestational/corrected-age bands;
- etiologic exclusions or hemolysis handling;
- bilirubin rise-rate logic;
- all neurotoxicity modifiers;
- phototherapy technique or discontinuation/follow-up rules.

The grids therefore must not be presented as an autonomous treatment calculator.

## Quality checks

Regression tests assert:

- complete expected grid shapes;
- exact anchor rows copied from each source;
- standard-phototherapy threshold <= intensive-phototherapy threshold <= exchange-transfusion
  threshold at every stored cell.

This ordering check detects likely transcription corruption; it is not a clinical validation of the
underlying criteria.

## OCR queue impact

The Shabalov OCR/Qwen phototherapy item no longer blocks the threshold matrix: current 2025 clinical
recommendations provide a better, source-versioned structured source.

The unrelated Fenton/INTERGROWTH and neonatal laboratory-reference OCR items remain open.
