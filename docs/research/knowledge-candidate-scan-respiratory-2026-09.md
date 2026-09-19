# Knowledge candidate scan — respiratory smoke, 2026-09-18

## Purpose

This is a measured authoring smoke for the concept-first extraction path in draft PR #174.
It checks whether a deterministic pass over real MiniMed clinical-recommendation SQLite can reduce
manual review work without turning text matches into reviewed medical knowledge.

The measurement is intentionally about **candidate quality and pipeline cost**, not clinical coverage.
A candidate is only a source locator with `reviewStatus=proposed`.

## Corpus

The same local respiratory verification slice was used before and after the scanner refinement:

- 3 source-preserving clinical recommendations;
- source type: `clinical_recommendation`;
- ordinary MiniMed document/version/section/chunk/anchor schema;
- no generated medical assertions were added during the scan.

This local verification corpus is not committed by this PR.

## Pass 1 — structural heuristics only

The first deterministic implementation looked for headings/body phrases containing patterns such as:

- `шкала`, `score`, `индекс`;
- `опросник`, `анкета`;
- `критерии`;
- `классификация`;
- severity/stage wording.

Result:

- **47 proposed candidates**.

Manual inspection showed systematic noise rather than random parser failure. The main families were:

- clinical-recommendation methodology and evidence-grading text;
- quality-of-care criteria;
- table-of-contents rows;
- bibliography/reference rows;
- generic guideline template headings such as a broad “classification” section;
- weak sentence fragments where a keyword existed but no usable instrument name was extracted.

## Pass 2 — context filtering + reviewed inventory channel

The scanner was then changed to:

1. suppress heuristic promotion in quality, methodology, table-of-contents and bibliography contexts;
2. reject generic/negated classification headings and weak severity labels;
3. require a usable extracted label for body heuristics;
4. optionally load exact names/aliases from already reviewed MiniMed `tool_definitions` and
   `knowledge_entities/knowledge_names`;
5. emit exact known-instrument matches as a separate high-confidence channel;
6. suppress a weaker heuristic hit when the same chunk/type is already represented by a sufficiently
   overlapping reviewed instrument match;
7. fingerprint every inventory SQLite in the immutable candidate manifest so later review fails
   closed if the known-name inventory changes.

Result on the **same 3 recommendations**:

- **23 proposed candidates**.

So this refinement removed 24 review rows (**51.1%**) from this smoke corpus while retaining the
separate known-instrument lookup path.

## Interpretation

The 23 rows are **not** 23 confirmed instruments. They still require explicit accept/reject review,
stable concept identity and source verification. In particular:

- an exact known-tool alias is evidence that a reviewed MiniMed instrument name occurs in the source,
  not evidence that the source contains the same version/scoring rules;
- a classification/severity heading can be clinically useful without being an executable tool;
- a mention does not authorize copying a copyrighted form or normative table;
- scoring rules/cutoffs are never inferred by this scanner.

The expected authoring flow remains:

```text
clinical recommendation
    ↓
structural candidates + exact reviewed-name candidates
    ↓
proposed immutable workspace
    ↓
explicit review / stable conceptId
    ↓
knowledge module
    ↓
compact discovery projection
```

## Next measurement

The next useful corpus should include a specialty where many standardized instruments are expected
(e.g. psychiatry/neurology/cardiology) and compare:

- candidate recall against a manually prepared expected-name list;
- false-positive rate after review;
- known-inventory hits missed by the structural channel;
- newly discovered instruments absent from MiniMed inventory;
- raw/gzip discovery-pack size after accepted concepts are projected.

An LLM may help classify the residual proposed queue, but it must remain an authoring/review aid:
it does not promote candidates or create scoring rules automatically.
