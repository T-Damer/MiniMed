# Clinical UX and search contract

## Primary workflow

MiniMed is opened during clinical work to search immediately. Search is always the primary action and must never be blocked by update prompts, onboarding, release notes, module warnings, or background tasks.

Content updates are passive:

- no modal, toast, popup, interstitial, or forced confirmation on the search screen;
- a small counter on the Modules navigation icon indicates available module updates;
- details, changelog, sizes, install, pause, retry, and rollback live only on the Modules page;
- installed modules and the current search remain usable while catalog checks or downloads run;
- network failures stay silent on the search screen and are visible only in module status.

## Progressive disclosure

Search results expose the least information needed to choose the next action:

1. document/disease heading and one best matching fragment;
2. expanding the heading reveals additional relevant sections;
3. `Open source` opens the exact matching fragment;
4. source context is collapsed by default and can be expanded around the fragment;
5. full document/PDF remains a deeper explicit action.

The source reader uses a sticky header with the current document title, close action, and local in-document search. Long pages provide a return-to-top control.

Medication queries without a patient/use context open a complete medication card: registered identity, indications, contraindications, age restrictions, dosing evidence, interactions, adverse effects, monitoring, pregnancy/lactation, renal/hepatic considerations, source status, and missing/unreviewed fields. Patient-specific medication queries show the relevant fragment first but retain access to the complete card.

## Archive and graph

The archive list must support local filtering by title, specialty, source type, and version. Selecting a document opens it immediately.

The graph is an optional readable navigation view, not a decorative force graph. It groups clinical domains and their documents using clear labels, medical icons, and accessible buttons. Selecting a document opens the same reader as the list. Dense overlapping SVG text, unlabeled dots, or a second confirmation click are not acceptable.

## Icon language

Use a small local subset of Phosphor Bold-style medical icons; use Heroicons-style system icons only where no medical symbol exists. Do not ship an entire icon font.

Icons and restrained color accents encode section/domain semantics:

- lungs: lower respiratory system;
- airway/trachea: upper airway and larynx;
- stomach/abdomen: gastrointestinal disease;
- brain: neurology and altered consciousness;
- shield/virus: infection and immunity;
- pill: general medication;
- split tablet/capsule with microbe mark: antibacterial medication;
- prescription: prescribing/recipe information;
- flask: diagnostics and laboratory testing;
- route/ambulance: routing and emergency care;
- calendar: follow-up and observation.

A document may show several organ/domain icons. Primary involvement uses full opacity; secondary or uncommon involvement uses reduced opacity. Icons are navigation hints, not claims of pathogenesis or diagnostic certainty.

## Query understanding

The Russian query parser uses a separate versioned symptom-expression lexicon in addition to corpus aliases. It must recognize colloquial and inflected phrases such as `вздутие живота`, `живот вздулся`, `пучит`, and `метеоризм` as one symptom concept.

A patient description is not treated as a reference lookup. The UI shows:

- recognized clinical facts as complete phrases, not isolated words;
- missing-field and ambiguity suggestions in a dedicated non-blocking block;
- likely diagnostic/source groups even when clarification is requested;
- warnings for contradictory, uncertain, or mutually overlapping concepts;
- separate intent branches for diagnosis, next diagnostics, treatment, differentiation, medication, care, and administrative questions.

Queries such as `менингит или энцефалит у ребёнка` must suggest clinically useful discriminators (consciousness, focal signs, seizures, meningeal signs, rash, age, duration, investigations) and still return ranked source-grounded results.

A future local model may classify/rerank and generate clarification wording, but it may not invent medical claims. It receives only retrieved local evidence and structured query facts; deterministic retrieval, omission rules, citations, and safety gates remain authoritative.

## Language and metadata

Use clinician-facing Russian. Prefer `В клинических рекомендациях` over bureaucratic or generated wording such as `В российской педиатрической рекомендации`.

Document revision, source checksum, database/module version, and update availability are secondary metadata in the document header. They must not interrupt the clinical text or be repeated in every snippet.

## Test contract

Every release must cover:

- debounced patient-case search and stale-response cancellation;
- diagnosis, treatment, next-diagnostics, differential-diagnosis, medication, and regulatory intents;
- symptom phrase extraction, negation, uncertainty, duration, age, and conflicting concepts;
- progressive result expansion and exact source navigation;
- archive filtering, graph navigation, document open/close, sticky reader, and return-to-top;
- medication full-card behavior without patient context;
- module update badge without search-screen popups;
- Russian source ranking, current-versus-superseded documents, and provenance.

Small local-model evaluations are added only after a reproducible mobile model exists. Until then, deterministic scenario suites and source-grounded benchmarks are the release gate.

## Delivery backlog

### 0.3.2

- passive module-update counter and no-interruption rule;
- archive search and one-click document opening;
- readable graph navigation;
- 500 ms debounced search;
- symptom-expression lexicon with abdominal distension and neuroinfection ambiguity cases;
- progressive search/source disclosure;
- clinician-facing wording cleanup and layout tightening;
- expanded UI/parser/clinical-query tests.

### Next increments

- persistent module registry and real Android file adapter;
- background WorkManager download notification;
- first full-text pediatric module and structured tables;
- complete medication-card runtime;
- PDF.js source assets and exact-page navigation;
- core summary-only results that offer the missing module;
- evaluated Russian embedding/reranker, then optional constrained local synthesis.
