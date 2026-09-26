# Definition lookup and local CPU model: measured verification

## Checked revision and reproducibility

The measurements below come from [run 35535234283, job 106142983728](https://github.com/T-Damer/MiniMed/actions/runs/35535234283/job/106142983728), not from an inferred green status.

- PR #180 head: `fbe7d0001a7ed0eaabb65fa08e58c1cdfbd809f6`.
- Checked PR merge tree: `0009d94cbcb5a8da7853defbfb6be70d5b783e9e`.
- Base #174 revision: `6a256067de960321605736f00f3cbc0991f42a61`.
- Bundled core SHA-256: `d0797f8c33e7d1050831d8ff02958f49b9f30f10335f716ac3fe287407e1572a`.
- Optional definitions DB SHA-256: `385d1f04962edb879fd11ac36ea9842a5d04138c273dea9d9f649bd9766af60f`.
- Definition fixture SHA-256: `22242e81b55a8a972b256612ae05931eeca2223d127031d7116b9579cc44971e`.

The optional pack was built by the normal ingester: **9 documents, 27 sections, 27 chunks**, SQLite integrity OK, zero foreign-key violations, no ingest errors or warnings. It remains lexical-only, local-dev and proposed, with visible clinical-review notices. It is not a released APK database or a set of approved graph facts. The original public sources and setup commands are documented in [the implementation note](local-definition-model-demo-2026-09-20.md).

## Exact requests work; paraphrases remain weak

The ordinary lexical/lookup MedicalCore path searched the existing bundled core plus the optional pack, not only nine isolated cards. All six original requested term formulations returned the new definition or explicit naming clarification at rank 1, including `Симтом белого пятна`, `Синдром Кандинского`, `Симптом Волковича-Дьяконова`, `Симптом рубашки`, `Детская мастурбация`, and `Транзиторные состояния детей`.

| Separate slice | Actual result |
| --- | --- |
| Named/spelling/editorial-alias cases | 29/30 new cards at rank 1 |
| Bare Voskresensky eponym | Both different meanings present, at ranks 1 and 2 |
| Combined strict regression gate | 30/31 passed; the gate correctly failed |
| Authored descriptive probes | 2/6 targets in Top-5 |

The remaining named case is `Пограничные состояния новорождённых`: the new neonatal card ranks **2**, not 1. The report does not include the competing Top-1 document, so this is an unresolved collision case, not proven evidence that the first result is medically wrong. Do not force the new pilot document above an existing exact title merely to satisfy a hand-authored label. The generic corpus-derived lookup benchmark already treats identity collisions separately; this definition regression needs the same care.

The descriptive probes expose a more substantial retrieval limitation:

| Query | Rank of the expected definition in Top-20 |
| --- | ---: |
| после надавливания кожа белеет затем восстанавливает цвет | Absent |
| мысли и движения ощущаются сделанными извне | Absent |
| боль из эпигастрия переместилась в правую подвздошную область | 9 |
| боль при скольжении пальцами через натянутую рубашку | 1 |
| ребёнок занимается самостимуляцией это обязательно заболевание | 2 |
| временные изменения после рождения при адаптации к внеутробной жизни | Absent |

The definition bodies were directly readable for all expected targets. Returned target hits preserved their stored chunk, section, version and anchor. A false `exactContext` for an absent target in the report means there was no returned target to inspect, not a demonstrated corrupted anchor.

These are transparent user-requested regressions and authored description probes, not independent clinical gold. They were not added to reranker training or merged into the old 33-query clinical score. In particular, the result is **not** an improvement from 81.82% to 100%. A reranker restricted to an already selected pool cannot recover a definition absent from that pool. The next retrieval work must measure candidate inclusion as well as ranking, and compare lexical and semantic modes on these probes without rewriting the expected answers to match the output.

## A real offline model was executed

The workflow loaded `ARGA100/ru-reranker-modernbert-small`, revision `8d4ea05d7c793bc812879ca18e7e310ac4cb228f`, on CPU. There are **34,539,649 parameters**; the five downloaded model/tokenizer/card assets total **142,927,939 bytes**. After explicit setup, inference uses only local files and a Python audit hook blocks socket connection/address-resolution operations. This is a process-level regression guard, not an OS network sandbox.

Two distinct execution measurements from the same job must not be conflated:

1. Direct model smoke on **three short public definition candidates**: model setup/load 7,957.7 ms, first inference 65.1 ms, second warm inference 58.5 ms; peak RSS **466,440 KiB (about 455.5 MiB)**. This is neither a 40-candidate per-query p95 nor an Android measurement.
2. Actual MedicalCore-to-persistent-Python CLI: the first descriptive query invoked the real model in observe mode (3,627.0 ms including lazy model startup); the next shirt-sign query took 392.5 ms; the exact white-spot-sign query bypassed the model (0 model ms). The default selected order remained identical to the deterministic baseline throughout.

The first vague CLI query (`боль в правой подвздошной области`) placed the operative-access card first in the baseline and the naming-clarification card first in the experimental order. That smoke proves the integration executes; it must not be advertised as successful medical relevance. The shirt-sign query selected the shirt-sign card in both orders.

The older frozen-pool neural evaluation remains a **negative result**, documented separately in the implementation note: deterministic/hybrid Top-1 27/33, raw cross-encoder 19/33, gated cross-encoder 27/33 with zero accepted Top-1 changes. No beneficial neural ranking change is enabled in MiniMed. The CLI is a working research tool, not an Android feature or clinical decision model.

## Type checks and tests

On the measured merge tree above:

- All **16 Python contract unittest methods** passed (with additional parameterized subcases).
- All **15 TypeScript classifier-boundary cases** passed.
- `bunx tsc --noEmit -p tools/benchmarks/tsconfig.json` passed after `8fb3613815e096088e90ddb04595cb899e572191` repaired raw-record property access and precise benchmark input types. No strictness option was disabled.
- Definition ingestion and real offline model execution passed.
- The full-corpus definition gate **failed 1/31 strict cases**, as detailed above; description probes remain diagnostic, 2/6 passed.

A separate expanded benchmark unit run [35535104416, job 106142609211](https://github.com/T-Damer/MiniMed/actions/runs/35535104416/job/106142609211), on a workspace with the same mechanical type repairs, ran **140 tests: 137 passed, 3 failed**. All three failures occur while validating the compressed checksum of the pre-existing 1,500-query hard-query fixture. The checksum protection and fixture labels were not changed or bypassed. The later source-only repair retained test failure status while publishing independently typechecked changes.

The overall repository CI is not qualified as green. Existing whole-repository formatting checks and the hard-query fixture integrity issue remain, as does the definition regression described above. No merge, released core update, model-weight upload to Git, Actions artifact upload, APK build, Android performance qualification, or browser UI integration was performed.

## Run the demo locally

In a supported environment with Bun 1.2.3 and uv (the executed qualification used Linux/CPU):

```bash
git switch experiment/system-one-search-benchmark
bash scripts/prepare-local-search-demo.sh
bun tools/benchmarks/src/local-search-demo.ts
```

Enter one query per line. Setup downloads dependencies and the pinned model; inference afterward is local. Output shows `baseline`, `experimental`, `selected`, timings and existing source anchors. Default observe mode never replaces the selected baseline with the model order. Use the optional full-core command in the implementation note for a realistic corpus rather than treating the small-pack smoke as search-quality evidence.
