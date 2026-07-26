# MiniMed TODO

Short-term 1.0 follow-up work that remains after the 0.6.0 release.

## Done since 0.6.0

Landed on `main` with unit, benchmark, and Chromium E2E coverage:

- Compact shell: bottom navigation bubble, no page header, shorter view/document transitions,
  reduced padding around central blocks.
- Search history as a floating drawer instead of a column beside search.
- Archive counters on the knowledge-base button: available in yellow, installed in green.
- Knowledge-base tabs renamed after their content.
- Brain glyph for the model section; no redundant availability tag on model cards.
- Background model loading, with the loader over the settings icon as the only indicator.
- Knowledge graph: no longer freezes on hover, and legal, medication, clinical, and note sources
  each get their own fill and outline.
- Download reliability: shared retry/backoff for module *and* model downloads, awaited flush of
  partial bytes, floating status card with transfer speed and per-stage progress.
- Ten realistic Russian doctor queries in the public-pilot gate, plus the alias gaps they exposed.

## UX and navigation

- Knowledge-base tab content still does not read as a sibling of its tabs; the panels need a visual
  pass, not just the renamed labels.
- Optional: open the history drawer by swipe as well as by button.

## Search and knowledge graph

- Section ranking on realistic phrasing: for the `doctor-workflow` cases the correct section is
  top-ranked only 40% of the time versus 88.5% corpus-wide. The section is always retrieved, just not
  first, so this is a scoring problem inside a matched document.
- Offer to install a missing area directly from search when a query targets content that is not
  installed. The core already knows which areas exist.
- Keep adding real Russian retrieval cases as they surface from use.

## Patient notes and voice

Not started; the largest remaining 1.0 feature.

- Local patient cards with nested personal notes, in a trust boundary separate from official
  knowledge and never labelled as an official source.
- Include notes in local search with an explicit personal-source label.
- Optional local Russian speech-to-text for dictated notes.

## Data and AI

- Qualify the local models for grounded clinical answers before enabling clinical orchestration
  (issue #122): citation fidelity, unsupported-claim rate, abstention, latency, and memory per model.
- OCR for the scan-only Russian recommendations, verifying the output stays Russian rather than being
  translated (issue #121).
- Publish the 723-module clinical snapshot to the preview channel (issue #120).
- Run a measured Replicate benchmark only when a candidate model/prompt pair is ready, and keep spend
  inside the agreed 10–15 USD ceiling.

## Platform roadmap

- 1.1 idea: portable Rust `MedicalCore` with a versioned JSON CLI, differential tests against the
  current core, and an optional terminal UI.

## 1.0 release checklist

- Finish patient notes, the knowledge-base panel pass, and search-driven installation.
- Improve section ranking for messy queries, or record an accepted threshold with rationale.
- Verify the public `/app/` browser build and the Android release candidate after the 1.0 changes.
