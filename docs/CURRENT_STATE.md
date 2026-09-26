# Current state

> Updated: 24 September 2026
> Released version: `0.6.39` (public prerelease toward `1.0`)
> Unreleased work: draft PR #174 (concept-first knowledge) and stacked draft PR #180
> (search quality, definition reference, spelling)

This file records what exists now, its trust boundaries and the ordered next work. Keep it short:
append dated measurements to `docs/state/` or `docs/research/`, and link them from here. The target
architecture and acceptance gates live in [TECHNICAL_PLAN.md](TECHNICAL_PLAN.md).

Detailed history, moved verbatim on 2026-09-24:

- [state/branch-log-2026-09.md](state/branch-log-2026-09.md) — dated PR #174/#180 entries
  (definition reference R1–R2, source intake, spelling, reverse definitions, RapidFuzz).
- [state/implemented-0.6.39.md](state/implemented-0.6.39.md) — implemented behaviour, verified
  baseline and runtime benchmark up to the 0.6.39 release.
- [state/ecg-research-log.md](state/ecg-research-log.md) — ECG digitizer, rule layer and every
  measured or rejected model/engine candidate.

## Browser integration workspace — 2026-09-25

- Integration branch: `feature/browser-integration`. It combines the browser transcription branch
  with the patient self-monitoring diary and canvas/app-link work while deliberately making no new
  Android or iOS qualification claim.
- Shared browser form controls (`TextField`, `TextArea`, `ChoiceGroup`, `Checkbox`,
  `FileButton`) are reused by the diary/transcript surfaces. Hidden labels are self-contained and
  do not depend on the main app's global visually-hidden utility.
- The patient card can issue a blood-pressure, glucose or medication diary. The lightweight
  `app/diary/` entry stores patient-entered readings locally, exchanges invitation/result payloads
  through QR codes and can export an HL7 FHIR R4 bundle. Doctor-side import remains idempotent by
  diary/entry id and can attach imported events to an open visit. The QR transport caps both encoded
  input and decompressed JSON (1 MiB), rejects oversized individual QR chunks, limits photo import
  batches/files, and releases camera/ImageBitmap resources on every exit path. The local diary index
  is reconstructed from source records after corrupt/stale/quota-failed index writes, and patients
  can explicitly remove a stored diary. Its scoped service worker caches static assets only.
- Note drawings support links to MiniMed documents, calculators, assessments and notes through the
  shared note-link target index. Drawing attachments render an actual Excalidraw preview in note
  timelines instead of a generic file icon.
- Text and Markdown readers now expose a persistent reading scale in the existing document menu:
  90/100/110/125/140%. Plain text, Markdown body text, headings, tables, code and captions scale as
  layout typography rather than a visual transform, preserving selection and scroll geometry. The
  preference is local/session-safe when storage is unavailable and remains independent of PDF
  pinch/zoom and two-page mode.
- Voice notes use the browser MediaRecorder + optional local Whisper path documented below. Persisted
  audio opens the editable transcript panel; a transcript can be copied or inserted at the current
  note caret, including a timestamped form.
- `NoteMarkdownEditor` and `notes-polish.css` were resolved manually rather than choosing one
  feature branch wholesale: canvas link-target behavior and structured browser-ASR behavior are both
  present in the integration tree.
- Draft PR #185 (`feature/browser-integration` → `main`) is the consolidated review surface.
  GitHub Actions are intentionally not used because the repository Actions quota is exhausted.
  Dependency-free source validation passes **57/57** top-level invariants on
  `56fe5dfabe1c17419ffc3e74c0202a43714a556b` across diary, canvas, MediaRecorder, structured ASR,
  persistent Whisper lifecycle, transcript retention, portable personal-notes backup, diarization
  admission and integration wiring. The source gate's three over-escaped word-boundary regexes were
  corrected before that run. A full browser `tsc/vitest/vite build` is still a pre-merge gate when
  a checkout/build environment is available.

## Portable personal-notes backup — 2026-09-26

- Personal notes now have their own plaintext JSON backup domain, deliberately separate from the
  encrypted/optional-plaintext patient-vault backup. Schema v1 includes stable card/note ids,
  arbitrary note files, note images and transcript records including edited speaker labels.
- Binary note files retain their exact ids and carry declared size plus SHA-256. Import decodes and
  verifies all binaries and every cross-store link (card→note, file/image→note,
  transcript→source-audio) before changing durable state. Duplicate ids, note hierarchy cycles,
  missing parents and transcript/audio mismatches are rejected.
- Import is a full replacement of the personal-notes domain. It snapshots the current durable state
  first and attempts rollback if a later store replacement fails. Active transcription jobs are
  quiesced before transcript-store replacement. Restored queued/running transcript records become
  explicit retryable failures instead of pretending an inference job survived the backup.
- Backup v1 intentionally excludes ephemeral editor drafts and the single previous-revision recovery
  slot. A successful import clears those stale local recovery records so an imported note cannot
  reopen with text from the previous device state; rejected imports leave them untouched.
- Notes UI validates/parses the selected JSON before showing the destructive confirmation and displays
  its card/note/file/image/transcript counts. Export/import actions live in a separate data menu rather
  than the create-note menu. Raw backup files above 512 MiB are rejected before parsing. Export also
  estimates the final base64-expanded JSON before reading attachment blobs and refuses a result above
  512 MiB, avoiding a late browser-memory spike after hundreds of megabytes have already been copied.
- Backup v1 also supports `scope: card` for handover. Each ordinary note card has an explicit export
  action that serializes only that card and its files/images/transcripts. Importing a card backup
  replaces or adds only that card; all unrelated cards remain unchanged, and note/file/image/transcript
  ID collisions with another card are rejected before mutation. Legacy v1 backups without a scope are
  read as full backups for compatibility with earlier branch exports.
- Card wipe remains a separate destructive action and explicitly states that the card, nested notes,
  files, images and transcripts are removed. The existing retention journal makes that cascade
  retryable across browser restarts.
- Unit coverage includes exact-ID full round trip with audio bytes, image and edited speaker name,
  same-size binary corruption rejected by SHA-256, missing transcript source-audio rejection, scoped
  card round trip preserving unrelated data and working drafts, plus cross-card ID-conflict rejection.
  Patient-vault data is never read or replaced by this format.

## Browser voice transcription — 2026-09-25

- Browser voice notes use MediaRecorder with a 64 kbit/s target, one-second chunks and a 10-minute
  ceiling. Unsupported recorder startup, runtime recorder errors and empty captures release the
  microphone and surface an error instead of saving a broken attachment.
- Quantized Whisper Base/Small remains optional and local after its existing first model download.
  The worker requests word timestamps and returns millisecond transcript segments. Browser
  transcription rejects recordings over 10 minutes before the expensive decode when metadata is
  available. One worker owns one pipeline: switching Base↔Small unloads the previous runtime first,
  so readiness cannot point at a model the worker no longer holds and the two pipelines do not
  overlap in memory. Unchecking a model now truly deactivates the worker while keeping its admitted
  cache; Settings can separately delete one cached model plus its resumable partials without touching
  already-saved transcripts.
- Persisted audio attachments now retain their NoteFile in the viewer, fixing the previous path where
  a saved recording could not actually start transcription. The viewer exposes queue/running/failure/
  unsupported states, retry, editable text, copy/insert actions, timestamped segments and plain-text
  export. Real diarized speakers can be quickly relabelled as «Врач»/«Пациент». Finished transcripts
  remain separate local personal data in IndexedDB.
- Background OCR preemption re-queues speech work without marking it as a failed ASR job. Genuine ASR
  failures persist as failed with their error so retry is explicit.
- Transcript retention follows its audio attachment: replacing/deleting an attachment removes the
  separate transcript record **before** mutating the file store, so a secondary file-store failure
  cannot leave hidden derived text behind. Explicit transcript deletion keeps the source audio.
  Active transcription jobs are cancelled and tombstoned before deletion; guarded IndexedDB writes
  prevent a stale completion or concurrent manual save from recreating deleted transcript data.
  Deleting a note/card first journals every doomed note id in localStorage and then runs idempotent
  file/image cleanup; an interrupted cleanup is retried after the next browser start, closing the
  previous fire-and-forget orphan-data gap.
- Speaker-aware storage/alignment is implemented: an optional BrowserDiarizationEngine can supply
  source time regions, Whisper words are assigned by temporal overlap and adjacent words are merged
  into turns. Null/empty region sets are tested and never set `diarized=true`. The pyannote
  segmentation and CAMPPlus embedding files are pinned by immutable source revision, exact size and
  SHA-256; admitted blobs persist in a versioned IndexedDB cache for offline reuse, while cache
  failures do not block the current verified session. No diarizer runtime is enabled by default yet;
  without one the UI says «без разделения спикеров» and labels timestamps neutrally as «Речь».
- Upstream sherpa-onnx v1.13.8 has a first-party browser/WASM diarization target. MiniMed deliberately
  does not load a floating HF Space or the Node-specific npm WASM build. Runtime handoff and remaining
  artifact-pinning requirements are recorded in
  `research/browser-speaker-diarization-2026-09-25.md`.
- This branch is browser-only work; no Android qualification or APK claim is made here.

- MiniMed `0.6.39` ships optional Russian Wiktionary/Kaikki lexical downloads: seven gzip packages
  (index with source definitions plus six owner sections). Local selection: 6,939 senses, 6,940
  Russian glosses; no MeSH equivalence or clinical approval is inferred. Current-core + Russian-index
  reconstruction completed locally with 26,926 documents and 75,299 chunks, valid SQLite/FKs and
  unchanged source hashes. Published data remains `terminology-ru-2026.9.16`. See
  `RUSSIAN_TERMINOLOGY.md` for source rights, sizes and measurements. The discovery core is unchanged.

## Production versus DEV boundaries

- **Definition reference (thesaurus) is disabled in production.** The reader accepts only
  editions whose manifest says `publicationState: local-dev`, and the only catalog descriptor is the
  DEV-only `catalog.definition-reference.local.json`. The app dispatcher also rejects the
  `fragments-v1` metadata layout, so that compaction is not used in the app. All definition
  content is `requires-review`.
- Definition drafts (`content/definition-drafts`) load only under `import.meta.env.DEV`.
- Ordinary lookup is deterministic: lexical FTS5, aliases, exact-identity retention, bounded
  medication spelling alternatives. No model participates in ordinary search. Laya multilingual and
  a Russian cross-encoder were measured and not adopted (they lowered Top-1 on the frozen
  candidate set); see `research/laya-source-smoke-results-2026-09-23.md` and the cross-encoder
  PoC in `research/system-one-search-benchmark-2026-09.md`.
- Personal notes and the patient vault are separate local trust layers, never official sources.

## Unreleased on PR #180 (not yet released)

- **Search quality gates.** A corpus-derived lookup benchmark (titles, navigation aliases, declared
  aliases) and a diagnosis-free, leakage-checked clinical challenge set with graded multi-document
  relevance. See `research/system-one-search-benchmark-2026-09.md`.
- **Exact identity.** Exact title, short title and editorial navigation aliases are hard ordering
  keys, and identities lost by candidate cut-offs are restored. They are restored with one filtered
  FTS query and fall back to reading the first readable section.
- **Medication spelling.** Bounded OSA candidates from the alias vocabulary, including omitted
  one-letter source suffixes (Канефрон Н). Since 2026-09-24, alternatives are used only when no
  retrieved source passage literally contains the typed word: "дизурия" no longer ranks
  "ДЕЗОГЕСТРЕЛ" first. RapidFuzz stays experiment-only (see the branch log).
- **Clinical ranking.** Fractional coverage keys are compared in tiers (none / under half / at
  least half / all) before the relevance score. The 33-case challenge set is unchanged by this
  (Top-1 81.8%, NDCG@5 0.909 on the committed public-pilot fixture).
- **Definition reference.** Source-local definition cards with exact provenance, a bounded reverse
  (description → term) search and source-span annotations (migrations 006–009). Counts and
  evidence are in the branch log. Reviewed links now stay visible. Only `rejected` links are hidden.
- **Search index size (migration 010).** Ordinary `chunks_fts` reads its content from `chunks`
  through the `chunks_fts_source` view, with `prefix = '2 3'`. The composer writes 16 KiB pages. On
  the bundled core this is 403.2 → 342.0 MiB with an identical token stream and identical
  lookup-quality metrics. Readers are unchanged, so old packs keep working. See
  `research/core-db-size-2026-09-24.md`.

## Known limits


- Clinical starter documents are concise source-linked cards; the separately installable snapshot
  contains the official structured recommendation text, headings, tables, and embedded figures.
- The selected oseltamivir instruction still requires reviewed OCR; the clinical recommendation
  snapshot no longer depends on PDF OCR.
- Text-layer drug PDFs can still lose visually distinct subheadings that use the same font size as
  body text. Preserved layout metadata prevents list continuations from absorbing adjacent text, but
  complex layouts still require reviewed structure extraction before publication.
- The PDF reader now bounds page rasterization, cancels offscreen renders, and releases inactive
  canvases promptly; a 160-page Android stress scroll completed without a WebView crash, while
  broader large-PDF memory qualification remains a release follow-up.
- Scroll-driven app-chrome hiding is scoped to generic document readers; CT/MRI and ordinary
  application pages keep their normal navigation chrome.
- Medication registry cards establish identity, form, strength, and registration status; they do not
  establish a verified regimen.
- The GRLS `data/build/medications.db` pipeline proof is still one-drug; it is not the local Allmed
  catalog. Allmed cards are reference snapshots, not verified dosing. Similar products, normalized
  dosing facts, ATC classification, and additional dosage forms remain absent from the official
  instruction pack.
- The verified ESKLP archive is available through fifteen preview identity modules and the bundled
  core's lightweight pointers. It remains metadata-only (`trustedDoseData: false`): neither the
  preview modules nor the core establish a verified dose or indication corpus.
- The MKB companion is a local-dev reference pack: the full-detail crawl is network-heavy and must be
  explicitly requested, while its code-to-medicine relations remain proposed/reference-only rather
  than treatment guidance. The public AJAX endpoint is used for forms and manufacturers; raw HTML is
  not bundled.
- The local RLS MKB companion is a classification/reference index with sparse downloaded detail
  content and medicine mentions, not a complete drug-instruction or dosing corpus. The local GRLS
  instruction builds are selected/current samples rather than complete coverage. There is no released
  deterministic linker yet from exact terms inside instructions (for example, `синдром Жильбера`) to
  stable local condition cards, and ambiguous abbreviations are not context-disambiguated.
- The published corpus still lacks complete verified drug instructions, legal/normative material,
  vaccination calendars, nutrition, growth, development, and calculation-rule sources. The complete
  clinical-recommendation snapshot is not yet a complete physician knowledge base.
- A separate Allmed packaging-image pack is built locally with 4,214 images and 4 rejected source
  references; its exact local ZIP/index artifacts are recorded in
  [DRUG_KNOWLEDGE_PIPELINE.md](DRUG_KNOWLEDGE_PIPELINE.md). It is not published or in the application
  catalog because the source terms require written permission for copying, distribution, and
  publication while the footer is contradictory, so the pack remains local-dev only and packaging
  images remain outside the production core. The Settings card, module installer/remover, installed
  source-assets resolver, image checksum validation, and medication-reader rendering are already
  implemented and activate when an authorized catalog entry is supplied. Dose/indication coverage and clinical-grade
  diagnostic/dose validation are also not complete. The larger generated clinician-query benchmark
  for Recall@5, MRR@5, and section recall remains pending.
- The full GRLS export has no confirmed ATC field, so most catalog records remain visibly unclassified.
- The installed corpus must abstain from dose output when no supplied source contains the exact regimen.
- Small local models can satisfy a JSON shape while citing semantically irrelevant exact text; the
  20-case tester-box result is a screening benchmark, not clinical qualification.
- Browser inference is CPU/WASM; model download size and latency remain substantial.
- The ECG photo tool extracts waveforms only for the fixed 3x4+1R layout and falls back to manual
  calipers when its quality gate fails. Findings come from confirmed manual measurements and
  deterministic adult rules. The optional numeric model is a probabilistic hypothesis, not a
  diagnosis. No diagnostic CNN is shipped. Every measured and rejected candidate is in
  [state/ecg-research-log.md](state/ecg-research-log.md).
- The patient vault is browser-tested at the domain/contract level, but native Keychain/Keystore
  failure, memory pressure, and recovery after background suspension still require physical Android
  and iOS device qualification. It intentionally has no cloud sync or server-side backup; portable
  backups are plaintext and require the user's own secure handling.
- Physical Android interruption, memory-pressure, and local-model inference qualification remain release
  follow-up checks even when the debug APK and browser automation are green.
- Personal notes use unencrypted device-local browser storage and are a notebook rather than an
  electronic medical record. Browser-local Russian transcription is implemented with optional
  Whisper Base/Small, editable stored transcripts and word timestamps. Full-backup export/import,
  single-card handover and a rollback-safe whole-notebook wipe are implemented. Verified
  multi-speaker diarization still waits for a fully pinned browser WASM runtime.

## Ordered next work toward 1.0


The private, resumable `krasotaimedicina.ru` discovery crawl uses Crawlee Python with a persistent
request queue, robots enforcement, bounded same-host paths, raw HTML/image checksums, and per-page
manifests. A preparer/build path exists for repeatable snapshots, but the crawl is still running. Raw
and built output remains ignored private data with `rightsStatus: unresolved` and
`publicationState: blocked`; it is not a publishable MiniMed content pack.

1. Grow the content bank before further retrieval/model work — see [CONTENT_DATA_PLAN.md](CONTENT_DATA_PLAN.md)
   for the full cross-category priority list (regulatory acts, pediatric norms/calculators, assessments,
   diets, nutrition/feeding norms). A personal textbook library under `Med/` is an acceptable cited source
   per book/edition/page ([LITERATURE_BANK.md](LITERATURE_BANK.md)) — MiniMed itself is never the cited
   source — but redistribution review still applies before any extracted table or excerpt publishes.
   Anything uncertain found while extracting goes to [LITERATURE_REVIEW_QUEUE.md](LITERATURE_REVIEW_QUEUE.md)
   for review rather than being silently trusted. In the same content phase, expand official GRLS
   instruction coverage and extend the current recommendation terminology layer: classification
   IDs/hierarchy, synonyms, eponyms, abbreviations, sourced concept explanations, and exact
   source-mention links from instructions to local concept cards. Do not create a second glossary
   database or treat an RLS MKB medicine mention as dosing/treatment authority.
2. Verify the 0.6.10 prerelease on a physical Android device, including system-bar insets, native Back,
   locally scheduled
   notifications, note-image persistence, and the published Pages `/app/`.
3. Build and qualify the missing dose/indication corpus from source-backed rules, including
   clarification/abstention behavior; resolve Allmed packaging-image rights before considering a
   distributable/cataloged module, while keeping image assets outside the core database.
4. Add verified OCR for the blocked drug instruction.
5. Expand real Russian clinician-query, unsupported-answer, and source-scope benchmark coverage.
   The 70-query medication regression after pack installation is fixed. Use `benchmark:runtime` to investigate
   symptom/phrase misses, and missing published document membership before claiming retrieval quality.
6. Qualify the existing browser Whisper path on real Russian consultations and enable multi-speaker
   diarization only after the full WASM runtime is immutable/pinned. The two speaker models already
   pass exact size+SHA admission and verified IndexedDB reuse; the executable JS/WASM runtime remains
   the missing supply-chain/runtime gate.
7. Qualify bundled local models on citation fidelity, abstention, latency, storage, and memory before
   presenting diagnostic assistance as a 1.0 capability. For ECG, qualify the digitizer and
   deterministic measurement/rule pipeline on licensed phone-photo fixtures, compare the integrated
   numeric pack with independent Minnesota/AHA/MEANS-derived rule specifications, and test manual
   measurements on an external adult population. Diagnostic CNNs remain research-only. LearnECG
   remains an external manual smoke-test source until redistribution permission is explicit.
8. Keep GigaEmbeddings benchmark-only until a physician-authored real-corpus benchmark shows a gain
   over the current hybrid and the locally verified Q8_0 conversion has an immutable hosted artifact
   plus Android parity, latency, memory, storage, battery, and thermal qualification. The public pilot
   currently shows one Recall@5 regression when Giga is added with the existing fusion weights. Keep
   the deterministic/hash hybrid and lexical fallback.

A portable Rust `MedicalCore` and stable JSON CLI are recorded as a `1.1` idea, not a 1.0 release gate.
No cross-language runtime migration should start before shared golden fixtures demonstrate parity.

No database update can safely add dose guidance until a supplied source actually contains the regimen.
Redistribution review remains a production gate; prototype manifests preserve current rights status
without treating unknown rights as approval.

Branch-specific next steps (PR #180):

1. Run the full CI (Biome, Ruff, pytest, benchmarks) on the branch and rebuild the core with
   migration 010 through the composer. Publish both distributions with their own checksums.
2. Collect a held-out Russian clinician query set (200–300 queries, multi-relevance) before any
   reranker or decision-model work. Candidate public sources are listed in the PR discussion.
3. Consider an OSA fallback for medication names only when the bounded matcher returns nothing,
   behind the corpus-evidence gate. Test negative controls at corpus scale (thousands of correctly
   spelled words), not ten.
4. Further size work: catalog-pointer `classificationPath` (9.3 MiB) as parent pointers, and a
   decision on `normalized_text` (16.9 MiB) versus a custom tokenizer.
5. Regenerate `tools/benchmarks/fixtures/hard-medical-queries-1500.parts`: the committed base64
   parts fail gzip CRC, so `hard-query-dataset.test.ts` is excluded from Vitest until then.
