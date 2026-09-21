# Definition reference: execution plan

Updated: 2026-09-21. Owner: draft PR #180, `experiment/system-one-search-benchmark`, stacked on #174. This plan refines the existing `TECHNICAL_PLAN.md`; it does not authorize a merge, release, model download or architecture replacement.

## Product outcome

An optional offline reference inside MiniMed: find a term by name or remembered description, open the source definition and complete criterion/context blocks, compare source variants, and inspect origin/history where supported. The phone must not load the entire JSON corpus into JavaScript to perform a lookup. Continue broad source collection, but count meaningful coverage and preserve unresolved records instead of padding the count.

## Starting evidence

Pinned starting code: `4ec354452750bda59b2cab6cce3447ffabe6e1bb`.
The development catalog has 18,133 source/editorial records, not 18,133 reviewed canonical concepts. The separately returned owner-only psychiatry module has 450 records and is not public repository content. The last full JSON-index audit took 5,597.5 ms to construct; current process RSS was 1,033,625,600 bytes. That includes the runtime and audit, not incremental Android memory. See `research/mass-definitions-delivery-2026-09-21.md` and its linked measurements.

`definition-draft-lookup.ts` currently imports every JSON collection, retains parsed assets, and creates a second full index when an owner overlay is supplied. The public `knowledge_discovery_pack.py` admits reviewed facts/links; unreviewed extractions must NOT be promoted merely to pass that gate. Existing content tables, `knowledge_*` structures, installer, MedicalCore and native/WASM storage ownership remain the integration target.

## Execution order and acceptance

### R1 — Reproducible SQLite projection and bounded storage access (active)

- [ ] Implement an offline builder/adapter for existing V1/V2/V3 definition inputs. Use the repository's ordinary content-pack schema and builder; retain proposed/source-local identities until explicit canonical mapping exists.
- [ ] Preserve source edition/hash, original name, exact block text/order, definition-versus-context roles, all source locators, review/rights state and mention-only status. Namespace module-local numeric references; reject collisions and broken references.
- [ ] Share source metadata and source blocks, not a repeated publisher or full context object per result. Do not invent approved knowledge facts, synonym relations, scale scoring or eponym authorship.
- [ ] Add a storage-layer bounded lookup/detail adapter that receives an already-owned database executor, never opens a second native connection or OPFS worker. Search returns at most 20 compact hits. Context is paginated/read only on demand, with bounded per-call text size.
- [ ] Exact identity precedes broad text search; short names/abbreviations must not disappear solely because of stop-word removal. Parameterize values, constrain result counts and do not log queries or source text.
- [ ] Validate builder output with integrity/foreign-key checks, round-trip text/locator/ID checks, source collisions, damaged input, mention-only and ambiguous-name regressions. Measure complete corpus bytes and fresh-process lookup resource use; compare against the recorded baseline without equating RSS with incremental index memory.

A schema change requires a numbered migration and regenerated schema. Reusing existing tables without schema changes does not require a fictitious migration. Whether FTS external-content optimization is necessary is a measured decision; do not redesign storage just to reach a gzip target.

R1 exit: real complete input converted, bounded SQLite lookup and lazy detail exercised, no changes to general clinical ranking. This alone does not qualify the full app or Android installation.

### R2 — Existing installer, app composition and lifecycle

- [ ] Route installation/open/update/removal through the existing content-module installer and storage owner. Validate the module manifest and schema/edition/hash before activation; retain the working edition on a failed update.
- [ ] Replace the default all-JSON definition preview path with the SQLite-backed path. Do not silently fall back to the unbounded JSON index on error.
- [ ] Expose a typed asynchronous reference operation through the existing core/ports direction. UI receives compact hits and loads full definition/context when the card is opened; it does not import SQL/native libraries.
- [ ] Owner-only imports stay local and separate from downloadable editions. Do not upload the supplied PDF, source text/profile or owner-derived test fixtures to public CI/GitHub.
- [ ] Test install, interrupted/corrupt update, restart offline, disable/remove, search after each transition, and race/cancellation/stale response handling. Prove no whole-corpus text is transferred to the UI.
- [ ] Exercise the actual app composition in browser and existing Android path. Measure native and WASM fallback separately when both are supported. Report cold/warm p50/p95, baseline/incremental PSS or RSS, peak memory during install/open, and installed/transport bytes.

R2 exit: a user can install the reference, restart without network, search and open a complete source card using the normal application. No APK publication or merge without authorization.

### R3 — Useful cards, extraction QA and conservative grouping

- [ ] Audit broken headings, sentence fragments, missing list items, contextual subtypes and tables needing review. Preserve originals and record issues rather than silently rewriting them.
- [ ] Group only source variants with an established shared concept identity. Identical titles alone are not proof of equivalence; retain separate senses and different eponym meanings. Display alternate sources instead of filling the first page with duplicates.
- [ ] Keep separate states: source-fidelity review, clinical review, source authority and redistribution eligibility. A requires-review source can be browsable without becoming an approved clinical fact.
- [ ] Distinguish instrument mention, description, complete questionnaire and executable scoring. No “calculate” or “take test” action is inferred from a scale name.

R3 exit: one understandable card per confirmed concept, explicit ambiguous alternatives, and traceable alternate definitions/editions. No automatic harmonization of the 2006 textbook with modern guidance.

### R4 — Independent coverage and reverse-search work boundary

- [ ] Create approximately 200–300 varied development probes across terms, symptoms, syndromes, criteria and scales, with acceptable multi-target cases and corpus-absent/out-of-scope queries. This is a target, not a completed or independent clinician set.
- [ ] Keep name identity, candidate recall, concept ranking, source variant visibility, no-answer behavior and latency as separate metrics. Do not reuse exact source text as supposed independent paraphrase gold.
- [ ] Maintain a held-out clinician-authored set separately when available. Visible authored probes remain development tests, not clinical validation.
- [ ] Coordinate with the parallel general-search work: deliver fixed corpus/IDs/probes and reproducible misses. Do not simultaneously tune its ranking in this PR iteration or inject every failing probe as a synonym.
- [ ] Evaluate a local classifier only after candidate recall is measured. The current neural experiment has no demonstrated shipped quality gain; exact-name lookup must not need a model.

### R5 — Continued source expansion, etymology and history

- [ ] Expand into verified and explicitly review-required source families by measured gaps; 20,000+ Russian source records is an authoring target, not a ceiling or unique-concept claim. Do not count empty cards, synonyms or English MeSH text as Russian definitions.
- [ ] Report new concepts, fuller definitions, additional source variants and unresolved mentions separately for every ingestion batch.
- [ ] Implement the sourced root/origin dictionary from `research/definition-catalog-and-etymology-2026-09-21.md`: original language/spelling, literal component meanings, independent review and shared numeric source/root references. Missing origin stays missing, not generated from word shape.
- [ ] Add the historical-reference module through the same card/module architecture. Person biography, naming history and discovery priority are separate sourced claims. Never infer discoverer identity from a surname alone.

## Resource and safety gates

No arbitrary final mobile budget is advertised before measurement. The acceptance invariant is bounded query results and on-demand context, with no whole-corpus JS hydration. Record actual package sizes and device measurements; “5 MB gzip” is not installed SQLite or memory. Stage a focused DEV module until source rights and integration are qualified. Production pack text, diagnoses, general ranking gold, user data, provider tokens and existing download ownership are out of scope for opportunistic changes.

## Progress log

- 2026-09-21: plan established from the measured mass-extraction state. R1 started; R2–R5 remain pending. Implementation commits and executed verification will be appended here and in `CURRENT_STATE.md`. A checked box requires code plus the relevant evidence, not a proposed command.
