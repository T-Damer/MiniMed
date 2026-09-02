# Repository audit

> Snapshot: 31 August 2026  
> Scope: current working tree, including uncommitted work  
> Purpose: architecture map, change review, cleanup record, and prioritized fixes

## Executive summary

LocalMed Search is an offline-first medical-source navigator. The repository consistently follows
the central dependency rule `UI → MedicalCore → ports → adapters`, and the content path keeps source
material ahead of generated artifacts. No new backend, telemetry path, provider dependency, or
network-only runtime was found.

The current tree is large mainly for two legitimate reasons:

- 1,568 tracked files are the vendored `llama.cpp` Android subtree;
- medical corpora, extraction fixtures, research notes, benchmark sets, and generated test packs are
  intentionally retained because they are product evidence rather than disposable build debris.

At audit time the repository had 2,715 tracked files. Of the 878 first-party files in the principal
application, package, content, tooling, documentation, and CI scopes, every top-level ownership area
was classified below. Vendored source files are covered as one third-party subtree; this report does
not pretend that every upstream C/C++ file was independently reviewed.

The implemented cleanup and refactoring are deliberately small:

- removed an unreachable free-position personal-library layout and its state/CSS path;
- made independent MedicalCore lexical branches concurrent;
- cached aliases for one initialized MedicalCore lifetime;
- fixed false-positive clipboard success notifications;
- corrected a stale search-context regression test;
- removed two local generated/cache directories from the worktree and ignored their exact paths;
- fixed the two blocking Biome findings discovered by the baseline check.

The public pilot workflow still passes `--include-unreviewed-knowledge`. This is intentionally kept
for tests at the user's request. It remains a test/prerelease exception: proposed knowledge must not
be presented as reviewed clinical guidance in a production release.

## System map

```text
content/raw + synced public sources
              │
              ▼
tools/ingest: deterministic parsing, source spans, checksums, provenance
              │
              ▼
prepared Markdown / manifests / proposed knowledge
              │
              ▼
schema/sql migrations → pack builder → SQLite + FTS5 + deterministic vectors
              │
              ▼
storage-sqlite / storage-capacitor ──┐
storage in-memory / multi-store ─────┤ implement MedicalStore
                                    ▼
                          packages/core MedicalCore
                    query analysis → branch search → fusion
                         → context/source resolution
                                    │
                                    ▼
                         apps/app SolidJS UI
             search, readers, tools, notes, patient vault
```

The main trust boundary is the pack builder. Original text and provenance enter there through typed
contracts and numbered migrations. Generated model text is not allowed to replace source material.
The runtime reads released packs through a storage port; UI code does not import SQL or provider SDKs.

## Top-level ownership

| Path | Meaning | Main interactions |
| --- | --- | --- |
| `apps/app/` | SolidJS/Vite/Capacitor product and native shells | Calls MedicalCore and local state services; renders pack and personal-library data |
| `apps/landing/` | Static public landing application | Describes/releases the product; does not own medical retrieval |
| `packages/contracts/` | Zod schemas and public cross-package types | Shared by ingest, storage, core, tools, and UI package boundaries |
| `packages/domain/` | Stored domain records and JSON shapes | Supplies stable content entities without UI/runtime dependencies |
| `packages/search-lexical/` | Russian normalization, intent, aliases, snippets | Used by MedicalCore and benchmark tooling |
| `packages/search-semantic/` | Portable deterministic embeddings | Used by builders and runtime hybrid retrieval |
| `packages/core/` | MedicalCore orchestration and ranking | Depends on search packages and the MedicalStore port, never concrete UI/storage |
| `packages/storage/` | MedicalStore port, in-memory and multi-pack composition | Implemented by SQLite adapters and used by tests/core |
| `packages/storage-sqlite/` | Browser SQLite WASM adapter | Reads immutable packs, FTS, vectors, and provenance |
| `packages/storage-capacitor/` | Native Capacitor SQLite adapter | Provides the same read contract on Android/iOS |
| `packages/test-fixtures/` | Small deterministic pack/test inputs | Shared by package and integration tests |
| `packages/tester-box/` | Local-model qualification research | Benchmark-only; cannot become the source of clinical claims |
| `content/` | Reviewed/proposed source material and module definitions | Input to ingest and pack publication; all medical material retained |
| `schema/sql/` | Numbered SQLite migrations | Defines released pack shape; generated databases are never hand-edited |
| `tools/ingest/` | Python content acquisition, validation, projection, pack builds | Converts sources into traceable runtime artifacts |
| `tools/benchmarks/` | Retrieval, regulatory, embeddings, and ECG evaluation | Reads produced packs and asserts release quality |
| `tools/catalogs/` | Catalog support files | Feeds regulated/reference catalog workflows |
| `scripts/` | Release, schema, source-safety, OCR, and asset utilities | Thin orchestration over package/tool contracts |
| `.github/workflows/` | CI, Pages, packs, native/release jobs | Runs repository commands and publishes controlled artifacts |
| `docs/` | Architecture authority, current state, ADRs, research | Explains contracts and records evidence/limits |
| `branding/` | Product identity assets | Consumed by app/landing/release packaging |
| `.omo/` | Planning/review artifacts | Development evidence, not product runtime |
| `examples/` | Redistributable sample documents plus licenses | Exercises personal-document readers |
| `tmp/` | Current medical image/PDF research material | Retained because medical research is explicitly in scope |

## Application files and interactions

### Entry, shell, and composition

- `apps/app/src/main.tsx` loads the global style layers and mounts `App`.
- `apps/app/src/app/App.tsx` is the shell: it connects routing, bootstrap state, root views, readers,
  floating windows, and bottom navigation. Root features are lazy-loaded and then kept alive after
  their first visit.
- `apps/app/src/app/use-app-session.ts` owns asynchronous MedicalCore/module bootstrap.
- `apps/app/src/app/use-root-navigation.ts` and `use-bottom-nav.ts` isolate hash navigation and root
  gesture/animation policy from view components.
- `apps/app/src/composition/` is the only UI-side assembly boundary. It selects native storage where
  available, otherwise SQLite WASM, and composes installed packs into the MedicalStore port.

This separation is sound: the shell knows application state, composition knows concrete adapters,
and feature views consume stable contracts.

### Shared components

`apps/app/src/components/` owns primitives used across features: page chrome, buttons/switches,
dialogs, breadcrumbs, search input, context menus, glyphs, virtualized grids, safe markup, sticky
surfaces, and floating-window infrastructure. These components are appropriate shared seams because
they encode repeated interaction or accessibility behavior, not business rules.

### Feature ownership

| Feature | Responsibility | Important dependencies |
| --- | --- | --- |
| `features/search/` | query composer, scopes, worker protocol, results | MedicalCore, lexical analysis, personal overlay |
| `features/knowledge/` | knowledge navigation | installed content exposed by core |
| `features/library/` | official/personal readers, PDF/EPUB/DOCX/PPTX, DICOM/NIfTI, highlights | user-library state, PDF.js, medical image runtimes, print layer |
| `features/modules/` | installed module/catalog views and legal documents | module catalog and core document APIs |
| `features/medications/` | regulated medication catalog/search | medication records from installed packs |
| `features/assessments/` | questionnaire catalog, engine, results, user questionnaires | typed assessment definitions and local result state |
| `features/calculators/` | deterministic calculators and ECG photo tools | calculator contracts, tool modules, patient recording |
| `features/notes/` | notes, templates, patient workspace and longitudinal records | local state, attachments, print, vault contracts |
| `features/printing/` | browser/native print and share | reader/note/calculator prepared output |
| `features/models/` | optional local model lifecycle | grounded wrapper only; retrieval remains usable without it |
| `features/asr/` | optional local transcription | notes input; not required for core product use |
| `features/network/` | bounded downloads/retry | optional packs/assets, with offline failure handling |
| `features/settings/` | preferences, updates, optional ECG model settings | local preference/native update state |
| `features/history/` | local search history | app state; does not log clinical text remotely |
| `features/status/` | installed/runtime status | composition and module state |
| `features/tool-links/` | deterministic links from content to tools | assessment/calculator registries |

### Local state

`apps/app/src/state/` owns persistence and platform boundaries that should not live inside Solid
components: app preferences, notes, attachments, reminders, user-library ingest/indexing, thumbnails,
PDF.js handles, floating windows, patient-domain records, encrypted native patient vault access,
assessment results, calculator history, and native UI/update contracts. Feature components should
remain coordinators over these modules rather than duplicate persistence logic.

### Styles

`apps/app/src/styles/` contains feature-level BEM styles loaded by `main.tsx`; reusable component CSS
lives beside components where already established. The source CSS is about 552 KiB. That is not by
itself a runtime defect—the production build can deduplicate/minify it—but there is no recorded
compressed bundle budget, so regressions cannot currently be distinguished from harmless source
growth. The verified production build emits a 418.66 KiB minified main CSS chunk (70.84 KiB gzip).

## Retrieval and storage packages

### Contracts and domain

`packages/contracts/src/` defines the validation boundary for documents, sections, chunks,
provenance, module catalogs, calculators, tool modules, and clinical observations. `packages/domain/`
contains stored domain forms. These packages are intentionally data-oriented and do not depend on
SolidJS, Capacitor, SQLite, or an AI provider.

### Search pipeline

`packages/search-lexical/src/` performs Russian text normalization, intent/audience detection,
bounded query expansion, alias handling, and highlighted snippet construction. JSON lexicons are
runtime data, while unit tests lock down medical phrases, negation, strengths, and markup behavior.

`packages/search-semantic/src/` supplies deterministic portable vectors. It is a local retrieval
signal, not a generative model, and therefore preserves the offline fallback.

`packages/core/src/create-medical-core.ts` is the principal orchestration file:

1. validate/analyse the query;
2. obtain aliases;
3. create bounded lexical branches;
4. query the MedicalStore for lexical/vector candidates;
5. fuse and group results deterministically;
6. resolve readable source context and provenance.

This audit changed steps 2–4 only: aliases are cached until initialize/close resets the lifecycle,
and independent branches execute with `Promise.all`. Returned arrays retain input branch order, so
ranking remains deterministic. `packages/core/tests/search-execution.test.ts` is the single focused
regression check for both properties.

### Storage

`packages/storage/src/` is the stable port plus in-memory and multi-store implementations.
`storage-sqlite` and `storage-capacitor` translate that port to browser/native SQLite. Adapters own SQL;
the core owns retrieval semantics. Multi-store composition lets optional packs participate without
making the core aware of installation details.

## Content, ingest, and release flow

Content directories contain source-linked starter material, regulated/reference pilot data,
fixtures, and deterministic tool-module definitions. They are product inputs, not cleanup targets.
The medical research under `docs/research/`, ECG/model evaluation files, and `tmp/pdfs/` was retained
under the user's explicit rule that medical research is needed.

`tools/ingest/src/localmed_ingest/` divides work by source and transformation stage:

- source sync/download and checksum metadata;
- format-specific parsing and stable source spans;
- prepared document/section/chunk construction;
- proposed knowledge projection with review state;
- regulated, Allmed, GRLS, ESKLP, and tool-module builders;
- SQLite pack construction through numbered schema migrations.

`tools/benchmarks/` then tests retrieval expectations and experimental paths. Benchmark inputs are
evidence and should not be deleted merely because they are not bundled in the app.

The Android release workflow uses proposed knowledge in its test/prerelease corpus via
`--include-unreviewed-knowledge`. The flag is retained. Before any production-grade release, the
publication boundary must still distinguish proposed from reviewed records in presentation and
release policy.

## Cleanup performed

| Item | Action | Reason |
| --- | --- | --- |
| `.tmp-home/` | moved to system Trash; exact path ignored | local 24 KiB RTK history/cache, no product input |
| `apps/app/.omo/` | moved to system Trash; exact path ignored | generated QA image evidence duplicated outside source ownership |
| dead personal-library `free` mode | deleted TSX/state/CSS path | initializer and setter could only produce grid/list; branch was unreachable |
| medical research, corpora, fixtures, pack databases | retained | source/evidence/product data |
| `tmp/pdfs/` | retained | medical-image/PDF research, explicitly protected by scope |
| vendored `llama.cpp` | retained | required local-model native dependency |
| deleted `tools/needle/` and `docs/NEEDLE_FINETUNE.md` in the incoming tree | left deleted | no live references found; deletion predates this audit |
| deleted `DocumentBookModeButton.tsx` in the incoming tree | left deleted | no live imports found; deletion predates this audit |

Removal was intentionally narrow. Large or unfamiliar files were not classified as junk based only
on size or lack of direct UI imports.

## Fixes and measurable effects

### Completed

1. **False clipboard success** — `PatientWorkspace.tsx` used optional chaining on
   `navigator.clipboard`, so an unavailable API resolved as success and showed a success message.
   Direct calls now reach the existing error handler. No new abstraction was needed.
2. **Stale test expectation** — `search-context.test.ts` expected a hard-coded section type that no
   longer matched its fixture. It now checks preservation of the fixture hit's actual type.
3. **Alias I/O** — MedicalCore previously re-read aliases for analysis and each branch. One lifecycle
   promise now shares that immutable read and resets on initialize, close, or failure.
4. **Serial branch search** — independent lexical branches previously awaited in a loop. Concurrent
   execution reduces branch latency to approximately the slowest branch rather than their sum,
   subject to adapter scheduling.
5. **Unreachable library mode** — removal reduced `UserLibraryPage.tsx` by roughly 180 lines and
   removed matching dead CSS. The maintained grid/list paths remain virtualized.
6. **Blocking static checks** — the questionnaire SVG now has a title, and the flagged CSS formatting
   was normalized.
7. **Python type narrowing** — `source_sync.py` now captures already-validated remote metadata before
   its nested HEAD callback, allowing strict Pyright validation without changing network behaviour.

### Remaining, ordered by value

1. **P1: source-sync stale cache edge case.** `tools/ingest/src/localmed_ingest/source_sync.py` can
   classify a response as unchanged when Content-Disposition and Content-Length match but ETag and
   Last-Modified are absent. Equal-size changed bytes may remain stale. Add one adversarial test, then
   compare a streamed checksum before reusing the old file. This is the most important unimplemented
   correctness fix because it sits at a source trust boundary.
2. **P1: finish or correct the patient/calculator contract.** The new `patient-vault.spec.ts` expects
   calculators to select a protected patient, select an episode, and store the result in the vault.
   The current `CalculatorsView.tsx` still exposes an ordinary `datalist` and saves only to calculation
   history, even though `patient-tool-recording.ts` already contains the recording service. The focused
   browser run passed two scenarios but this scenario timed out on the missing option on all retries.
   Wire the existing service into the calculator form, or narrow the test if that feature is not part
   of the current milestone; do not make the locator pass without delivering the contract.
3. **P1: prove production publication policy.** Keep the test flag, but add/retain a separate release
   gate that fails if proposed knowledge is exposed by a production channel. This should be tied to a
   real production workflow, not inferred from the current prerelease filename.
4. **P2: note draft write amplification.** `NotesView.tsx` reads/parses/writes the full draft snapshot
   on every editor change. Debounce draft persistence and synchronously flush on save/unmount only
   after a browser regression test proves that a rapid close does not lose text.
5. **P2: ESKLP peak memory.** The verified full path materializes roughly 604,000 child rows twice;
   observed RSS is about 2.3 GiB. Stream validated rows directly into a temporary build workspace when
   the full pack becomes a release requirement. Do not optimize the research path speculatively.
6. **P2: alias presentation provenance.** `AliasRecord` exposes category but not a subtype proving
   whether an alias is a trade name or formulation. UI group-title rewriting can therefore imply a
   relationship stronger than the stored contract. Extend provenance only when reviewed source data
   can populate it; until then, use neutral alias wording.
7. **P3: component size.** The largest current UI coordinators are `UserLibraryPage.tsx` (2,102
   lines), `NotesView.tsx` (1,837), `PatientWorkspace.tsx` (1,751), `UserDocumentReader.tsx` (1,543),
   and `CalculatorsView.tsx` (1,427). Size alone is not a defect. The next extraction should happen
   only alongside a behavior change, at existing ownership seams: route/controller vs catalog,
   timeline editor, renderer dispatch, or calculator host. Blind file splitting would increase props
   and indirection without reducing complexity.
8. **P3: CSS budget.** Record minified and compressed CSS/JS chunk sizes in the existing build output
   and fail only on a meaningful regression threshold. Source byte count is not a useful gate.

## Risk and invariant review

- Offline operation remains intact: retrieval, personal data, tools, and readers do not require a
  hosted backend or LLM.
- UI code still reaches SQLite only through composition/adapters and MedicalCore ports.
- Core code has no SolidJS, Capacitor, or provider dependency.
- No private source document, patient record, API key, or model weight was added by this audit.
- Medical source text and provenance were not edited or removed.
- No schema or persisted-data format changed.
- The alias cache assumes aliases are immutable for one initialized core lifetime. Application pack
  changes already replace/reinitialize the core; if live in-place store mutation is introduced, it
  must also invalidate this cache.
- Concurrent store reads are read-only. Adapters that serialize internally still remain correct;
  they simply gain no latency benefit from concurrency.

## Verification record

The baseline before fixes established:

- TypeScript typecheck passed.
- The full check found two blocking issues, both fixed.
- The test suite exposed one stale search-context expectation; the focused reproduction failed before
  and passed after the correction.
- Focused MedicalCore search-context and search-execution tests pass.
- Focused ingest tests (18 tests), calculator content lint, and Python AST parsing passed during the
  repository audit.

Final full-suite results should be recorded here after the post-change verification run:

| Check | Result |
| --- | --- |
| `bun run check` | pass; 17 warnings and 135 informational diagnostics, no errors |
| `bun run typecheck` | pass for every workspace package |
| `bun run test` | pass: 160 Vitest files / 2,325 tests and 119 pytest tests |
| `bun run build` | pass: schema, app, and landing production builds |
| `bun run python:check` | pass: Ruff format/lint, strict Pyright, 119 pytest tests |
| `bun run benchmark:all` | pass: Recall@1/5 and MRR@5 = 1; case pass rate = 1; p50 6.62 ms, p95 9.46 ms |
| `bun run native:source:check` | pass; native bridge and packaged DB checksum verified |
| `patient-vault.spec.ts` | partial: 2 pass, 1 fails; test expects missing calculator/vault integration described above |

Private-corpus builds and physical-device qualification are intentionally separate: they require real
source inputs, native SDK/device state, and substantially more resources than a source-code audit.
