# Public Russian medication pilot

MiniMed's first public drug-data slice contains concise source-linked registry cards, not copied full instructions.

## Included medication identities

| Medication/form | Registry record | Registration number |
|---|---:|---|
| Paracetamol pediatric suspension 120 mg/5 ml | `1000114162` | `ЛП-№(002094)-(РГ-RU)` |
| Ibuprofen pediatric suspension 100 mg/5 ml | `1000141345` | `ЛП-№(006579)-(РГ-RU)` |
| Amoxicillin tablets 500 mg | `1000035147` | `ЛП-№(013359)-(РГ-RU)` |
| Amoxicillin + clavulanic acid suspension 400 mg + 57 mg/5 ml | `1000045857` | `ЛП-№(003017)-(РГ-RU)` |
| Azithromycin suspension 200 mg/5 ml | `1000107564` | `ЛП-№(001367)-(РГ-RU)` |
| Ceftriaxone injection powder 1 g | `1000135207` | `ЛП-№(005496)-(РГ-RU)` |
| Oral rehydration salts powder 18.9 g | `1000120007` | `ЛП-№(012750)-(РГ-RU)` |
| Oseltamivir capsules 30 mg | `1000165168` | `ЛП-№(002417)-(РГ-RU)` |

## Modular knowledge files

The pack builder composes every `knowledge*.yaml` and `knowledge*.json` file into one validated workspace.

- YAML is suitable for human-reviewed editorial material.
- JSON is preferred for imported registry snapshots because exact evidence quotes are preserved without YAML punctuation ambiguity.
- Duplicate IDs and schema-version mismatches fail the build.
- Evidence is checked against deterministic document, section, chunk, and exact-quote provenance.

## Clinical boundary

Registry presence establishes an identity snapshot only. It does not establish indication, pediatric suitability, dose, duration, contraindications, interactions, or renal/hepatic adjustment.

All registry facts and document links in this pilot remain `proposed`. The only treatment relation is the existing amoxicillin–pediatric-pneumonia proposal grounded in clinical recommendation `714_2`; it also remains proposed pending named clinical review.

Proposed records are persisted with their evidence for review, while only records promoted by an identified human reviewer may enter the structured `knowledge_fts` projection. The registry cards themselves remain discoverable through the ordinary source-chunk index.

The Android release gate extracts the finished SQLite file from the APK and verifies the current build report, recommendation provenance, official-registry provenance, medication graph counts, signature, and byte-for-byte database identity instead of relying on obsolete fixed corpus counts.
