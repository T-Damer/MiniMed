# Terminology/search measurement — PR #171

Measured with pinned Bun 1.2.3, production `MedicalCore`, the production Capacitor SQL adapter and a
read-only Bun SQLite transport in a Linux x64 container. No LLM, Android bridge round trip, browser
DOM, physical phone, or cold OS disk-cache performance is represented by these numbers.

## Same-corpus before/after

Input: 19,987-document public core, 422,838,272 bytes, SHA-256
`d0797f8c33e7d1050831d8ff02958f49b9f30f10335f716ac3fe287407e1572a`.
Each case has one first execution and seven warm repetitions, with the same fixed query order.
Changes cache the compiled alias vocabulary and document/term projections per core revision and
hydrate only candidate metadata. Reinitialization/removal replaces the cache; tests verify parity.

| Fixed public query | Before p50, ms | After p50, ms | Before p95, ms | After p95, ms |
| --- | ---: | ---: | ---: | ---: |
| синдром Мюнхгаузена | 553.66 | 165.27 | 635.65 | 197.17 |
| пневмония | 603.97 | 285.81 | 661.63 | 322.38 |
| эозинофильный эзофагит | 512.44 | 127.61 | 547.31 | 251.84 |
| цефтриаксон | 435.28 | 101.07 | 547.18 | 113.02 |
| паническая атака | 526.68 | 149.43 | 646.57 | 177.55 |
| нарушение восприятия собственного тела | 683.44 | 213.38 | 805.91 | 314.36 |

Top-five document IDs remained identical for all six unchanged-corpus cases. Seven samples only
support a small engineering comparison, not a population latency guarantee; p95 here is the sample
maximum. The benchmark records input hashes before/after and rejects mutated inputs.

## Added terminology

With the complete discovery candidate mounted, the combined inventory contains 81,781 documents.
Three warm repetitions of the same cases measured p50 129–316 ms. `синдром Мюнхгаузена` correctly
ranked `discovery.medical.term.mesh.M0014205` first (p50 224.67 ms); by-proxy remains a different
ConceptUI. Its first process query took **3,480 ms** due to initial projection/index construction.
This is a remaining cold-start cost, not a claimed subsecond first search on Android.

## Reader

Previously the document route awaited the full catalog before requesting the selected document.
The route now requests the selected document first, yields a render opportunity, then reads a compact
navigation projection. Full medication metadata is fetched later only for supplement handling.
Installed-target and exact-anchor checks remain; sections/chunks may be requested concurrently from
the same existing storage owner, without opening a second worker/database.

On the 19,987-document core, catalog-before-document consumed 318–364 ms of core-layer work, versus
about 0.5 ms for the selected record first. With the terminology candidate, catalog-first consumed
about 2,060 ms versus 1.14 ms for that selected record first. **These are data-access timings, not
measured screen paint/complete-document timings.** Compact navigation still costs time after the
first record. Large-document rendering and real Android timings need their own browser/device runs.

## Reproduce

```sh
bun tools/benchmarks/src/run-terminology-performance.ts \
  --core=apps/app/public/content/core.db --rounds=7 \
  --label=after --report=data/build/terminology-performance.json
# Add --pack=/path/to/minimed.terminology.discovery.db for optional MeSH inventory.

uv run --project tools/ingest python tools/ingest/tests/build_terminology_e2e.py \
  data/build/terminology-e2e
bun run build:app
bunx playwright test apps/app/e2e/terminology.spec.ts --workers=1 --retries=0
```

The browser fixture replaces only HTTP SQLite/report assets with explicitly synthetic schema-2
packs. Real application, storage, search and reader code execute. Never substitute its invented
fixture definition for clinical source data or include it in a release corpus.
