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

Official and personal full documents open as hash-router pages under `#/modules/documents/…` with Kobalte breadcrumbs, not as stacked modal dialogs. Official documents use `#/modules/documents/d/<token>`; personal books use `#/modules/documents/user/<id>`. One-level `OverlayDialog` remains for the knowledge graph («Карта связей»), search short-card/context preview, help, confirmations, and module details. Search and archive pages should not permanently reserve half of the screen for long source text.

The reader should:

- keep a compact readable line length;
- provide document search and an outline;
- open at the exact source anchor;
- keep source/version details available in a disclosure;
- preserve breadcrumb navigation back to the origin section (Поиск, Документы, and so on).

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

Use `OverlayDialog` only for one-level focused workflows: knowledge graph, search context preview, help, confirmations, chooser dialogs, and module details. Reuse the same document page reader regardless of whether the document was opened from search, archive, graph, or a source citation. Opening a document from the graph closes the graph overlay first, then navigates to `#/modules/documents/d/…`.

## Graph

The graph is a real node-edge view with pan, zoom and drag. It must retain an accessible non-canvas representation before it becomes the only way to navigate knowledge relationships.
