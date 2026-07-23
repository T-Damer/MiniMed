# Grounded local assistant

The local model is an optional extractor and reranker over deterministic search results. It is not the
source of medical facts.

## Runtime

```text
query
  → deterministic analysis and SQLite retrieval
  → bounded candidate chunks
  → optional local query plan and reranking
  → exact-source clinical extraction
  → deterministic validation
  → applied result or untouched search fallback
```

Each candidate contains a stable chunk ID, document ID, anchor, title, section path, category, and
bounded snippet. The model receives no arbitrary database or network access.

## Allowed output

- Search terms and clarifying questions.
- A preferred order of retrieved candidate IDs.
- Diagnostic candidates whose label appears in a cited title or snippet.
- A contiguous source excerpt copied from a cited snippet.
- Dose evidence copied from a cited treatment snippet.
- Missing patient inputs needed before interpreting a dose passage.

The UI labels diagnostic items as candidates for verification and opens citations at their exact
anchors.

## Dose gate

A dose item is accepted only when:

1. every cited ID belongs to the retrieved candidate set;
2. at least one cited candidate is categorized as treatment;
3. the label occurs in the cited source;
4. the excerpt is an exact substring of the cited snippet;
5. the excerpt contains a numeric dose unit and a regimen cue.

Strength-only registry text such as `120 mg/5 ml` is not a dosing regimen. The model never calculates or
personalizes a dose.

## Fail closed

The original deterministic results remain visible when:

- no validated model session is ready;
- generation fails or a newer query supersedes it;
- JSON or required fields are invalid;
- text exceeds configured bounds;
- a citation ID is invented;
- a diagnosis label or excerpt is absent from the cited source;
- dose evidence fails the treatment, exact-text, or regimen checks.

## Current evidence limit

The public pilot contains source-linked clinical summaries and drug-registry identity cards. It does
not contain complete verified dosing regimens, so dose extraction should usually return an explicit
“not found in installed sources” result.

Clinical usefulness still requires evaluation with real local-model outputs and owner-supplied full
documents. Structural validity alone does not prove that a model selected the best supported passage.
