# Compact definition preview: implementation and verification

Date: 2026-09-21. Draft PR #180, branch `experiment/system-one-search-benchmark`, still stacked on #174. This is a development preview, not a released terminology edition. The design and the user's separate etymology requirement are recorded in [definition-catalog-and-etymology-2026-09-21.md](definition-catalog-and-etymology-2026-09-21.md).

## Implemented slice

- `content/definition-drafts/catalog.json`: 36 original editorial definition paraphrases with explicit `requires-review`, `local-dev` and `editorial-paraphrase` markers. Five shared source records cover the NCPZ psychiatric textbook library, a third-party psychiatric dictionary mirror, NINDS, NIDCD and NHS. Each entry references an integer source ID plus an article/chapter path and a textual locator. The five collection records resolve to eleven distinct source pages; they are not five repeatedly copied bibliographies.
- `packages/core/src/definition-catalog.ts`: validated read-only draft catalog and bounded reverse lookup over titles, aliases, definition text and criterion items. No model or network is needed for lookup. Source titles and editorial notes do not enter the retrieval index. Exact titles remain ahead of aliases and descriptive hits. Russian inflection handling and bounded spelling/prefix recovery are local to this glossary; the existing clinical/drug query normalizer is unchanged.
- The Jaspers consciousness-obscuration criteria and reactive-state triad retain separate staging IDs, complete four-/three-item lists and source caveats. Ambiguous shared aliases may return both. Neither is represented as a newly invented score or an approved clinical rule.
- `apps/app/src/composition/definition-draft-lookup.ts`: lazy asset import and shared lookup instance, with failed initialization eligible for explicit retry. The loader rejects production use.
- `DefinitionDraftMatches.tsx` and its scoped stylesheet: an unchecked-by-default DEV checkbox, review badge, definition, full criterion list, optional caveat and explicit external source links. The existing `UnifiedSearchCatalog` mounts it only for the all-source/conditions scopes and a nontrivial query, never the diagnosis/personal/calculator-only scope. Ordinary document search does not depend on this preview.
- `packages/core/src/definition-catalog.test.ts` and `tools/benchmarks/data/definition-reverse-probes.json`: title identity, ambiguity, negation, reverse-definition and untrusted-catalog regressions. These are authored repository tests; their presence does not mean repository Vitest was executed in this environment.

The preview does not create reviewed knowledge facts, canonical same-as relations, diagnostic recommendations or treatment rules. Source reputation, clinical review and redistribution eligibility remain different questions. New etymology fields and their user interface are **planned only**, not implemented.

## Actual local execution

A full Git checkout could not be obtained in the execution container because GitHub host/proxy DNS resolution failed; the connected GitHub read/write tools remained usable. Bun and the repository dependency installation were unavailable. Consequently, this pass compiled and executed an isolated copy of the new core module together with the relevant extracted public lexical exports and the draft JSON, rather than claiming a checked-out whole-repository build.

Environment: Node 22.16.0, TypeScript 5.8.3, strict compiler options, sanitized process environment. An independent Node assertion harness executed 129 checks over names/aliases, descriptive probes, source references, malformed data, URL containment and query limits. All 129 passed. TypeScript syntax parsing also covered the prepared TSX/loader/test sources; this is not Solid rendering or browser integration validation.

The final isolated rerun retained the same ranking results:

| Check | Result |
| --- | --- |
| Canonical definition titles | 36/36 first |
| Authored reverse probes | 19/20 first; 20/20 within the first three |
| Jaspers ambiguity | Both separate meanings retained, with 4 and 3 criterion items |
| Draft-only state, duplicate IDs, missing sources and unsafe URLs | Rejection cases passed in isolated harness |

The initial reverse pass met the authored rank bounds on 15/20 cases. General Russian-inflection and incomplete-phrase candidate recovery improved the result; probe sentences were not inserted as aliases. The remaining first-position error is `r07`, «лица в узорах на стене»: pareidolia is second, not first. Preserve this failure as ranking work, not a reason to advertise perfect reverse lookup.

This small public authored set was used during development. It is not independent clinician validation, does not establish quality on thousands of terms, and is not part of the existing 33-query clinical challenge denominator.

## Size and performance boundaries

For the local compact serialization of this 36-entry catalog:

| Representation | Bytes |
| --- | ---: |
| Minified UTF-8 JSON | 20,834 |
| Gzip, local Node zlib level 9 | 5,207 |
| Shared source-list JSON | 1,143 |

The gzip figure is a measurement of the local serialization, not a published download artifact. JSON formatting/property ordering or another compressor can change it. These numbers do not include generated JavaScript, the in-memory index, SQLite indexes or application/native overhead. No SQLite installed-size or physical-device memory claim is made.

A 2,000-query warm lookup-only rerun over this tiny index measured approximately 0.033 ms median and 0.088 ms p95 on the execution host. It excludes initialization, asset loading, UI, document search and Android/WebView. It must not be presented as device or full-corpus search latency.

The parser enforces a 256 KiB serialized catalog ceiling. Larger collections must move into optional, versioned modules using the existing installation and storage ownership contracts, with the source registry version/hash bound to numeric references. Do not expand a bundled object indefinitely.

## Local development check

After checking out this branch in the normal repository environment:

```bash
# Use the repository-pinned Bun and installed dependencies.
bunx vitest run packages/core/src/definition-catalog.test.ts
bun run typecheck
bun run build
```

In a development server, use the all-source or conditions search, enter a term or remembered definition and select «Искать также по определениям — DEV, требует проверки». The checkbox loads the preview asset from the app; searching does not contact the source websites. Only an explicit click on a citation opens an external site. A production build is not intended to expose this preview.

The commands above are reproduction instructions, **not a report that they ran here**. Repository-pinned Bun/Vitest/Biome, whole-workspace typecheck/build, browser automation, production-bundle inspection and physical Android checks still need execution. Existing PR CI blockers are not resolved by this isolated result.

## Remaining work

1. Validate the actual browser composition and production exclusion with the normal toolchain. Keep the PR draft until integration checks and existing blockers are resolved.
2. Expand through prepared source material and explicit review queues. Existing Krasota i Meditsina ingestion can contribute to a subsequent batch, but no new bulk Krasota i Meditsina dump was completed in this starter. Do not infer definitions from unavailable page text.
3. Project qualified drafts into the existing canonical knowledge/module model; deduplicate shared sources without losing exact edition/page/anchor references. A SQLite change requires a numbered migration.
4. Implement the separately planned etymology/root dictionary with its own provenance and review state; literal translations must not become clinical equivalence or diagnostic expansion.

No released core, full-text pack, APK or model was replaced. No merge or release was performed. Commits use `[skip ci]`; this pass did not dispatch workflows or upload Actions artifacts. This companion note records the new slice separately; the earlier dated measurements in `CURRENT_STATE.md` are not rewritten as if they qualified it.
