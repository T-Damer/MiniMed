# MiniMed 0.4.0 execution map

The version roadmap in `README.md` describes outcomes. This document records the mergeable vertical
slices used to reach them without combining every corpus, runtime and product change in one pull
request.

## 0.3.4 foundation

Primary branch: `agent/doctor-datasets-model-diagnostics` — PR #98.

Release boundary:

- doctor-facing document overlays and compact reader;
- interactive knowledge graph;
- explicit local-model selection and useful failure diagnostics;
- GitHub-first model artifact policy;
- persistent downloadable SQLite modules;
- checksum, integrity, FTS, installation, removal and rollback lifecycle;
- first regulatory and respiratory full-text module pipelines;
- safe live replacement of the running multi-store `MedicalCore`.

This foundation must merge before the larger inventories are rebased onto `main`.

## 0.3.5 catalog and module production

The work is split into independent stacked pull requests:

1. PR #100 — complete clinical-recommendation inventory, coverage ledger and specialty taxonomy;
2. PR #101 — medication-registration and official health-law inventories;
3. PR #104 — build real loadable metadata modules from every categorized ledger record;
4. later source-promotion PRs — synchronize, extract and benchmark every source eligible for full-text
   publication;
5. Android storage PR — native private-file storage, resumable/background downloads and notifications.

The goal is not a fixed recommendation count. Every discovered record must have an explicit coverage
state, and every source that passes rights, provenance, extraction, integrity and retrieval gates
should be promoted into an immutable full-text module.

## 0.3.6 grounded local assistant

Primary stack: PR #102.

Initial working boundary:

- deterministic query analysis and SQLite retrieval execute first;
- the model sees only a bounded set of already retrieved source-fragment IDs and snippets;
- it may propose search terms, clarifying questions and an order for those exact IDs;
- unknown IDs, invalid JSON, unavailable models and runtime errors return the untouched deterministic
  response;
- no model-generated diagnosis, treatment, dose or new medical fact is shown.

Follow-up gates:

- checksum-verified model artifacts hosted by MiniMed;
- physical Android qualification of at least one Russian-capable model;
- native LiteRT-LM CPU/GPU/NPU adapter where supported;
- Russian safety benchmarks and unsupported-claim rejection;
- exact evidence-linked formatting before any generated clinical statement is exposed.

## 0.4.0 doctor pilot gate

0.4.0 requires all of the following, not merely version metadata:

- broad categorized clinical, medication and regulatory coverage with an auditable coverage ledger;
- loadable metadata modules for every inventoried record and progressive full-text promotion;
- a working source-grounded local assistant with deterministic fallback;
- stable and preview module/model channels;
- production Android signing, migrations, interrupted-update recovery and storage management;
- physical phone/tablet usability and performance qualification;
- privacy-safe diagnostics and clinician-reviewed Russian UX;
- explicit provenance, edition, applicability and supersession visibility.

Each version/release PR must update `README.md`, `CHANGELOG.md`, `docs/TODO.md`, this execution map and
the relevant coverage reports to reflect what actually shipped.
