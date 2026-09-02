# Data + search completion goal

> Status: active execution goal; the data/search subsystem is not complete  
> Updated: 1 September 2026  
> Scope: MiniMed `1.0` data and deterministic offline search

This document turns the product direction into one finite, auditable execution goal. It is subordinate
to [TECHNICAL_PLAN.md](TECHNICAL_PLAN.md), uses the implemented-state record in
[CURRENT_STATE.md](CURRENT_STATE.md), and should be read together with [SEARCH.md](SEARCH.md),
[DRUG_KNOWLEDGE_PIPELINE.md](DRUG_KNOWLEDGE_PIPELINE.md), and the domain terms in
[CONTEXT.md](CONTEXT.md).

## Objective

Complete MiniMed's data and search subsystem as a reproducible, fully local, deterministic system
that does not require a network connection or an LLM. The finished subsystem must:

1. ingest and version the supported Russian medical sources without hand-editing generated packs;
2. normalize medicines, conditions, findings, investigations, interventions, names, and source mentions;
3. search exact names and natural Russian clinical queries across distinct search modes;
4. return a source-backed top-five differential for supported diagnostic scenarios;
5. calculate a source-backed dose directly from a natural-language query when every required input is
   present;
6. ask for a missing input or abstain when the installed corpus cannot support the result;
7. open the exact source document, section, and span behind every high-risk result;
8. preserve all existing expensive `.db` artifacts until a verified replacement has been built and
   compared.

The goal is complete when every acceptance gate in this document is proven by current repository
artifacts and runnable checks. Passing unit tests alone does not establish completion.

This remains an execution target, not a claim that every item is implemented. A capability remains
planned, unsupported, or blocked until current repository artifacts and runnable checks prove its gate.

The current measured implementation slice is recorded in [CURRENT_STATE.md](CURRENT_STATE.md): the
bundled production core contains ESKLP identity pointers and clinical-recommendation terminology
aliases/keywords, exact-module download pointers work offline, large SQLite packs use OPFS, and
medication presentation retrieval has regression coverage. A local 116-instruction GRLS slice now
links 99 registrations exactly to ESKLP and the runtime composes ESKLP, GRLS, and exact-TN Allmed
layers into one product model. The complete reviewed dose/indication corpus, clinical-grade diagnostic
and dose validation, publication rights for the separate Allmed packaging-photo module, and the
larger generated Recall@5/MRR@5/section-recall benchmark remain open.

## Completion boundary

"Complete" does not mean that every fact in medicine is present. It means:

- the ingestion, terminology, evidence, query parsing, retrieval, diagnosis, and dosing paths are
  implemented end to end;
- installed source coverage is explicit and machine-readable;
- supported concepts and rules work to the gates below;
- unsupported requests reliably abstain instead of being filled from model memory;
- adding a new source edition expands coverage without changing the runtime architecture.

Coverage is divided into two levels:

| Level | Meaning |
| --- | --- |
| `searchable` | The identity or document can be found and opened, but no structured clinical conclusion is promised. |
| `clinically-supported` | The relevant fact or rule has population/applicability metadata and exact evidence sufficient for the corresponding diagnostic or dosing workflow. |

A searchable medicine must not silently become dose-capable. A searchable condition must not silently
become a supported diagnostic candidate.

The capability manifest is explicit at database/pack, document/version, and entity level. It preserves
stable and external identifiers, source/version/checksum provenance, and workflow capabilities such as
`terminology`, `diagnosis`, `treatment`, `investigation`, and `dose`. `clinically-supported` requires a
reviewed typed assertion, exact evidence in the current source version, and population/applicability
metadata; `dose` additionally requires a structured dose rule. Package strength/form records,
reference mentions, proposed assertions, and unknown predicates never promote a clinical capability.

## Product invariants

- Retrieval precedes interpretation; original source material remains the authority.
- Ordinary search, diagnosis candidate ranking, and dose evaluation work offline without an LLM.
- LLM output may propose aliases, mappings, relations, or test paraphrases, but cannot self-promote a
  clinical assertion through the existing review boundary.
- Existing SQLite packs are read-only inputs. Builders produce new versioned artifacts; they never patch
  released databases by hand.
- Patient context is used at query time and is not copied into the medical knowledge corpus.
- A result score is a retrieval/ranking score, not diagnostic probability or prescribing authority.
- A dose result is a deterministic evaluation of a cited rule, not generated prose.

## Required search modes

### 1. Medication identity

Find MNN/INN, SMNN, KLP, trade names, forms, strengths, routes, packages, manufacturers, registration
records, and current instructions. Exact medicine identity remains ahead of graph-related results.

Examples:

```text
нурофен таблетки 200 мг
нурофен сироп
нурофен спироп
мирамистин мазь
цефтриаксон внутримышечно
сальбутамол ингалятор
турбухалер
цефипим
```

### 2. Condition and terminology

Find the canonical condition/finding, definition, classification, synonyms, abbreviations, related
documents, investigations, interventions, and medicines. Exact terms inside instructions are linkable
to the same local concept card.

Examples:

```text
синдром Жильбера
АГ
гипертонический криз
аллергический ринит
лихорадка у ребёнка
```

Ambiguous abbreviations remain unresolved or produce a clarification; they do not receive a guessed
automatic link.

### 3. Treatment and investigation

Use only typed, source-backed paths appropriate to the intent:

```text
Condition → recommended intervention → medicine/instruction
Condition → recommended investigation → source section
Medicine → registered indication → condition
```

Examples:

```text
лечение аллергии ребёнку 15 лет
что обследовать при железодефицитной анемии
капли в нос ребёнку 6 месяцев при насморке
лечение боли в горле ребёнку 6 лет
жаропонижающее ребёнку 4 лет
```

An RLS MKB mention can support navigation but cannot become a registered indication or treatment
recommendation.

### 4. Diagnostic support

For a supported scenario, return up to five candidate conditions with:

- findings for and against each candidate;
- urgent exclusions/red flags;
- missing discriminating inputs;
- relevant investigations;
- exact supporting source sections;
- an explicit corpus gap when the installed evidence is insufficient.

This mode ranks source-supported candidates. It does not declare a final diagnosis and does not infer
probabilities from retrieval weights.

### 5. Dose from a query

The user should not need to open a separate calculator. Internally, the search path must still use a
deterministic dose-rule evaluator:

```text
query
  → medicine + indication + age + weight + form + route + organ context
  → applicable cited dose rule
  → mg per dose / mg per day
  → optional volume conversion from an exact concentration
  → frequency + duration + maximum + source span
```

Examples:

```text
цефтриаксон ребёнку 12 лет 30 кг внутримышечно при пневмонии
парацетамол суспензия ребёнку 4 лет 18 кг
ибупрофен 100 мг/5 мл ребёнку весом 8,5 кг
```

When indication, weight, route, strength, or another required applicability field is missing, the
result is a focused clarification. When no compatible source rule exists, the result is an abstention.

## Data model

Reuse the existing relational knowledge model. Do not add a separate graph database.

### Concept layer

- `knowledge_entities`: canonical medical concepts and medicine identity levels;
- `knowledge_names`: preferred names, synonyms, eponyms, abbreviations, transliterations, common
  spelling variants, and trade names;
- source-native identifiers remain attached to the canonical concept; names are search keys, not join
  keys.

### Source layer

Every source edition retains URL, retrieval time, version/date, checksum, rights status, document,
section, chunk, stable anchor, and source span. Generated projections never replace the source text.

### Assertion layer

Each clinical relation is one assertion from one source edition. It includes:

- subject, predicate, and object;
- exact evidence;
- jurisdiction and authority;
- registered/guideline/off-label/reference status;
- population and applicability;
- validity period;
- extraction and review status.

Compatible assertions may be grouped for presentation. Conflicting assertions remain separately
inspectable.

### Search projection

FTS, alias indexes, document links, and bounded adjacency indexes are generated from validated source
and assertion records. Explicit clinical-recommendation keyword sections may add recall vocabulary to
the projection, but those terms never become exact diagnoses or clinical assertions. They can be
rebuilt without changing canonical source data.

The current GRLS projection also carries source-exact proposed dosage paragraphs with structured
numeric expressions. They remain outside dose-capable search and calculation until automated review
confirms the complete regimen, population, route, indication, and evidence span.

Automated dose review uses two independent immutable decisions over the same fact fingerprint and
exact evidence. A model may accept, reject, or abstain, but may not rewrite the extracted fact. The
importer promotes only matching high-confidence consensus that also passes deterministic completeness
checks; source text is not exported unless derivative-processing rights are explicitly declared.

## Query analysis contract

One deterministic parser produces a structured query analysis used by every mode. Each extracted fact
retains its source character range.

Minimum shape:

```json
{
  "intent": "medication|definition|treatment|investigation|diagnosis|dose",
  "entities": [],
  "age": null,
  "weightKg": null,
  "sex": null,
  "pregnancy": null,
  "duration": null,
  "measurements": [],
  "doseForm": null,
  "strength": null,
  "route": null,
  "frequency": null,
  "positiveFindings": [],
  "negativeFindings": [],
  "currentMedicines": [],
  "comorbidities": [],
  "organFunction": [],
  "uncertainties": []
}
```

Regex is limited to bounded lexical/measurement recognition. It only extracts patient context and
query facts; it never chooses a diagnosis, medicine, treatment, regimen, or dose. Clinical selection
comes from concepts, typed evidence, and deterministic rules.

### Required expression families

The parser and generated tests cover at least these families, including punctuation, spacing, case,
`е/ё`, inflection, abbreviation, and common typo variants.

| Family | Representative forms |
| --- | --- |
| Age | `12 лет`, `12-летнему`, `подросток 12 лет`, `1 год 3 месяца`, `полтора года`, `6 мес`, `новорождённый`, `34 недели гестации` |
| Weight | `30 кг`, `вес 30кг`, `весом 8,5 кг`, `масса 3200 г`, `примерно двадцать килограмм` |
| Frequency | `2 раза в день`, `дважды в сутки`, `каждые 8 часов`, `утром и вечером`, `1-0-1`, `однократно`, `на ночь`, `по необходимости` |
| Route | `в/м`, `вм`, `внутримышечно`, `в/в`, `в вену`, `per os`, `под язык`, `ингаляционно`, `ректально`, `местно`, `в обе ноздри` |
| Form/strength | `суспензия`, `сироп`, `таблетки`, `мазь`, `капли`, `100 мг/5 мл`, `250 мг в 5 мл`, `0,01%`, `1 г во флаконе`, `100 мкг/доза` |
| Measurements | `200/120`, `АД 200 на 120`, `39,2°`, `сатурация 91%`, `ЧДД 40`, `пульс 130` |
| Duration/timing | `третий день`, `около недели`, `5–7 суток`, `до еды`, `после еды`, `с рождения` |
| Context | `при пневмонии`, `аллергия на пенициллин`, `уже принимает амоксициллин`, `беременность 20 недель`, `почечная недостаточность` |
| Negation/failure | `аллергии нет`, `не беременна`, `без одышки`, `температуры нет`, `антибиотики не принимал`, `парацетамол не помог` |

The list is a coverage taxonomy, not a hand-written regex backlog. New source terms extend dictionaries;
new grammatical forms extend the shared parser once.

## Retrieval and ranking

The runtime path is hybrid but deterministic:

```text
query analysis
  → exact/alias lexical candidates
  + intent-specific bounded relation candidates
  + optional qualified local vector candidates
  → applicability and validity filtering
  → source-aware ranking
  → document grouping and exact source context
```

Rules:

- exact title, MNN, trade name, form, and strength matches remain ahead of indirect graph matches;
- graph traversal is limited to intent-approved relation types and normally one or two clinical hops;
- `mentions` supports navigation and receives no treatment authority;
- contraindication and failed-treatment relations never become positive recommendations;
- incompatible age, route, form, or population blocks a clinical rule rather than merely lowering it;
- missing applicability fields produce clarifications;
- when the bounded result window has no substantive source match, the response is an explicit corpus gap
  or clarification with no clinical recommendation; generic words and model memory cannot create a hit;
- every result exposes why it matched and which source supports it.

## Test generation strategy

### Fixed regression corpus

Keep realistic physician and patient phrasing as immutable benchmark fixtures. Every production miss
that is fixed becomes a permanent fixture.

### Structured query generator

Generate the semantic scenario first, then render many surface forms. The expected parse and target are
therefore known before text generation.

```json
{
  "intent": "dose",
  "medicine": "ceftriaxone",
  "condition": "pneumonia",
  "ageYears": 12,
  "weightKg": 30,
  "route": "intramuscular"
}
```

Possible renderings:

```text
цефтриаксон ребёнку 12 лет 30 кг внутримышечно при пневмонии
доза цефтриаксона в/м, подросток 12 лет, весит 30кг, пневмония
при пневмонии сколько цефтриаксона вм ребёнку вес 30 кг возраст 12
```

### Deterministic fuzzing

Apply seeded transformations for word order, spacing, punctuation, case, decimal separators,
abbreviations, inflections, common typos, extra polite words, and irrelevant measurements. CI uses a
fixed seed. A separate rotating-seed run explores new combinations. Every discovered failure is saved as
a fixed regression fixture before the implementation is considered repaired.

### Model-assisted paraphrase mining

A model may receive a structured scenario and produce additional Russian phrasings during corpus
development. It does not choose the expected diagnosis, medicine, dose, or document. Accepted
paraphrases are validated against the scenario and then frozen as ordinary fixtures. Runtime and CI do
not require the model.

## Metrics and acceptance gates

### Retrieval metrics

For each scored query `q`, the fixture defines `RequiredEntities(q)` as the distinct canonical entity
keys that must be found. `Top5(q)` is the first five ranked result entities after deduplicating repeated
chunks or sections for the same entity; a document or result without a stable entity mapping is not
silently inferred to be relevant. `ExpectedSections(q)` is the explicit document-section annotation.
No-answer/clarification fixtures are scored by their separate abstention gates.

```text
Recall@5(q) = |distinct Top5(q) ∩ RequiredEntities(q)| / |RequiredEntities(q)|
Hit@5(q) = 1 when Top5(q) contains at least one required entity, otherwise 0
RR@5(q) = 1 / rank of the first required entity, or 0 when none is in Top5(q)
MRR@5 = mean RR@5(q) across queries
SectionHit@5(q) = 1 when any ExpectedSections(q) entry appears in the first five
                    ranked document-section results, otherwise 0
```

`Recall@5` measures coverage of all required entities, while `Hit@5` is a separate yes/no query-level
signal: one found entity can make Hit@5 equal to `1` while Recall@5 remains below `1`. `MRR@5` rewards
the rank of the first found required entity. `SectionHit@5` is a section-level signal and is not
satisfied by finding the correct document while opening an irrelevant section. Aggregate values are
the arithmetic means of the per-query values.

Initial release gates:

| Gate | Minimum |
| --- | ---: |
| Retrieval Recall@5 | `0.90` |
| Retrieval Hit@5 | `0.90` |
| MRR@5 | `0.65` |
| SectionHit@5 | `0.90` |
| Exact supported medication identity at Top1 (fixtures with explicit identity annotation) | `0.98` |

These metrics measure retrieval only. They cannot prove diagnostic or dosing correctness.

### Parser gates

| Gate | Minimum |
| --- | ---: |
| Intent and canonical entity macro-F1 | `0.95` |
| Critical numeric value + unit + route exact match on supported fixtures | `1.00` |
| Explicit negation polarity exact match on supported fixtures | `1.00` |

### Diagnostic gates

| Gate | Minimum |
| --- | ---: |
| Expected condition in Top5 for clinically-supported held-out cases | `0.80` |
| Red-flag retrieval on the approved urgent-case fixture set | `1.00` |
| Unsupported/insufficient scenario produces clarification or abstention | `0.98` |
| Candidate without exact source evidence | `0` allowed |

The diagnostic benchmark must include common presentations, mimics, explicit negative findings,
insufficient-data cases, and urgent routing cases. Development and held-out cases remain separate.

### Dose gates

| Gate | Minimum |
| --- | ---: |
| Exact result for clinically-supported dose fixtures | `1.00` |
| Incompatible population/form/route correctly rejected | `1.00` |
| Missing required input produces a focused clarification | `1.00` |
| No compatible cited rule produces abstention | `1.00` |
| Strength/concentration incorrectly presented as patient dose | `0` allowed |

Exact dose comparison includes value, unit, basis (`per dose`, `per day`, or `mg/kg`), route,
frequency, maximum, and the source rule selected. Volume conversion is tested only when the exact
concentration is known.

## Execution sequence

### Phase 0 — Preserve and inventory

1. Record the path, size, checksum, schema version, content-pack metadata, and source coverage of every
   existing expensive database artifact.
2. Identify which artifact is generated, raw, prepared, released, or local-only.
3. Run read-only integrity and representative-query checks.
4. Establish the current benchmark baseline before changing ranking or parsing.

Complete when every existing `.db` is accounted for, recoverable from its current location, and excluded
from destructive or implicit rebuilds.

### Phase 1 — Coverage and canonical identity

1. Preserve the reproducible ESKLP identity pack and its fifteen preview modules.
2. Preserve RLS MKB/classification concepts and exact source-native identifiers.
3. Inventory available GRLS instructions and clinical recommendations.
4. Produce a coverage manifest for searchable and clinically-supported capabilities.
5. Resolve duplicate identities by official IDs and evidence, never display-name equality.

Complete when every installed entity and document reports its source/version and capability level.

### Phase 2 — Query parser

1. Consolidate existing age, mass, measurements, medication, route, duration, and negation extraction
   behind one typed query-analysis contract.
2. Add the required expression families without per-medicine clinical regex rules.
3. Add the structured generator, seeded mutation layer, and parser fixtures.
4. Preserve original character ranges for every extracted fact.

Complete when the parser gates pass on fixed and held-out generated fixtures.

### Phase 3 — Evidence and links

1. Resolve exact document mentions to canonical concepts without rewriting source text.
2. Extract source-scoped registered-indication, recommendation, contraindication, investigation,
   administration, and dose assertions.
3. Preserve applicability and exact evidence.
4. Keep ambiguous or unsupported relations proposed/unresolved.

Complete when every searchable clinical edge opens its exact evidence and reference-only mentions cannot
rank as treatment authority.

Current GRLS slice: the 123-instruction v2 pack projects 548 exact instruction-section facts to exact
registration entities. Administration, indication, contraindication, warning, adverse-reaction, and
storage excerpts are present but remain `proposed`; dose fields and population applicability are not yet
structurally parsed or clinically promoted. Expansion reuses checksum-matched prepared extractions, so
new batches do not repeat prior OCR.

### Phase 4 — Hybrid search planner

1. Keep current lexical retrieval as the baseline candidate lane.
2. Add intent-specific bounded relation candidates.
3. Apply applicability, source, status, and validity filters before final ranking.
4. Expose match reasons and corpus gaps.
5. Keep the exact medication-presentation branch and add regression cases for every exact-medication
   and title-ranking failure.

Complete when retrieval gates pass without regression in exact medication lookup.

### Phase 5 — Diagnostic support

1. Build candidates only from supported finding/condition/investigation assertions.
2. Score positive, negative, missing, and urgent evidence separately.
3. Return top-five candidates, discriminating questions, investigations, and exact sources.
4. Abstain outside the supported coverage manifest.

Complete when diagnostic and red-flag gates pass on held-out scenarios.

### Phase 6 — Dose from search

1. Normalize source dose rules into the existing typed fact/rule layer.
2. Match query context to exactly one compatible rule or return a clarification/conflict.
3. Evaluate mg/kg, fixed dose, daily dose, frequency, maximum, duration, and concentration conversion
   deterministically.
4. Render the result inside search with the exact source span and captured inputs.

Complete when every dose gate passes and unsupported queries never emit a numeric dose.

### Phase 7 — Qualification and packaging

1. Run the full fixed, held-out, generated, fuzz, unsupported-answer, and source-scope benchmarks.
2. Run all applicable repository checks required by `AGENTS.md`.
3. Rebuild release candidates from prepared sources, verify checksums, and compare representative queries
   with the preserved baseline.
4. Update [CURRENT_STATE.md](CURRENT_STATE.md) with measured coverage and remaining unsupported areas.

Complete when all gates pass against the release-candidate packs and no required evidence is missing.

## Required benchmark scenarios

The fixed benchmark must include at least:

- exact MNN, SMNN, KLP, trade-name, form, strength, and route queries;
- common typos and conversational names such as `спироп`;
- pediatric age and mass expressed in several grammatical forms;
- route ambiguity and strength-versus-body-mass collisions;
- condition definitions and in-document term links;
- treatment, investigation, diagnosis, and dosing intents;
- explicit negative findings and failed prior treatment;
- missing indication, weight, route, form, concentration, or duration;
- incompatible age/form/route cases;
- urgent measurements such as `АД 200/120` that must not become direct drug suggestions;
- unsupported medicines and conditions that must produce a corpus gap;
- queries containing irrelevant numbers or nearby medicine names.

New random wording alone does not expand semantic coverage. The benchmark must vary both phrasing and
the underlying clinical scenario.

## Out of scope

- requiring a local or hosted LLM for ordinary runtime search;
- free-form generated diagnosis, dose, or prescription text;
- importing UMLS, SNOMED CT, PrimeKG, or another mega-graph without a measured scenario benefit and
  compatible rights;
- a separate graph database or backend;
- inferring dose from package strength, pharmacologic class, another form, or another product;
- treating retrieval rank as diagnostic probability;
- claiming complete medical coverage when the installed manifest says otherwise.

## Final completion checklist

- [ ] Existing `.db` artifacts are inventoried, checksummed, and preserved.
- [ ] Source ingestion is reproducible and versioned.
- [ ] Coverage manifest distinguishes searchable and clinically-supported content.
- [ ] Medication, terminology, treatment, investigation, diagnosis, and dose modes work offline.
- [ ] Query parser gates pass, including numbers, units, routes, and negations.
- [ ] Retrieval gates pass without exact-medication regression.
- [ ] Diagnostic top-five, red-flag, and abstention gates pass.
- [ ] Dose exactness, incompatibility, clarification, and abstention gates pass.
- [ ] Every high-risk result opens exact evidence.
- [ ] Generated/fuzz failures are frozen as regression fixtures.
- [ ] Release candidate packs pass integrity and source-scope checks.
- [ ] `CURRENT_STATE.md` records measured coverage and remaining gaps.
