# Doctor-facing application UX

MiniMed is a clinical reference, not a developer dashboard. The primary interface should describe what the doctor can do, what information was found, and which source supports it.

## Primary navigation

Use clinician-facing labels:

- `Поиск`;
- `Документы`;
- `База знаний`;
- `История`;
- `Настройки`.

Runtime names, database engines, schema versions, raw timings and implementation acronyms belong in collapsed technical diagnostics.

## Documents

A complete document opens outside tab navigation in a shared overlay or dedicated document route. Search and archive pages should not permanently reserve half of the screen for long source text.

The reader should:

- keep a compact readable line length;
- provide document search and an outline;
- open at the exact source anchor;
- keep source/version details available in a disclosure;
- preserve the search or archive workspace behind the overlay.

## Search explanations

Primary copy uses complete Russian sentences. It should answer:

1. what MiniMed recognized in the request;
2. why the displayed document is relevant;
3. what important information is missing;
4. what the doctor can open or clarify next.

Terms such as `FTS5`, `VECTOR`, `runtime`, `schema`, raw milliseconds and confidence percentages are secondary diagnostics, not result headings.

## Local models

The model page uses explicit actions: `Скачать и проверить`, `Повторить проверку`, `Остановить модель`. A failed test opens a readable error dialog and never blocks ordinary search.

Models downloaded by public builds come from a MiniMed GitHub Release mirror and are checksum verified. Upstream fallback is disabled by default.

## Reusable components

Use one overlay shell for documents, errors and future focused workflows. Reuse the same document reader regardless of whether the document was opened from search, archive, graph or a source citation.

## Graph

The graph is a real node-edge view with pan, zoom and drag. It must retain an accessible non-canvas representation before it becomes the only way to navigate knowledge relationships.
