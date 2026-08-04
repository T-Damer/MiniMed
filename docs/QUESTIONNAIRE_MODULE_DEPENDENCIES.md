# Questionnaire dependencies in content modules

Clinical content modules may declare which local questionnaires they require through their existing `tags` field.

Supported declarations:

- `assessment:<assessment-id>` — require one questionnaire;
- `assessment-section:<section-id>` — require every questionnaire in a section;
- `assessment-dependencies:none` — explicitly declare that the module has no questionnaire dependencies.

Declarations are additive, deduplicated and sorted before they are persisted. `assessment-dependencies:none` cannot be combined with a positive declaration. Unknown questionnaire or section identifiers are rejected and reported.

## Runtime behavior

1. The SQLite health metadata identifies the active content-pack ID. For generated clinical packages this ID is the content-module ID.
2. A valid declaration in the active remote, cached or bundled catalog is authoritative and avoids listing documents or reading their chunks.
3. A module without declarations uses the legacy full-text scan as a compatibility fallback.
4. A malformed declaration is logged and also falls back to the text scan rather than silently dropping a dependency.
5. Stores with zero or multiple content-pack IDs use the fallback because a single catalog module cannot be selected safely.
6. The resulting dependencies use the existing source-aware installation state, so manual installation, section installation and multiple clinical modules retain questionnaires independently.

The SQLite database is still opened and initialized by the module lifecycle before dependency resolution. The declaration fast path removes the expensive document/chunk traversal; eliminating the initial open requires a future lifecycle contract that passes the active module descriptor directly.

This convention keeps the portable content-module contract unchanged while allowing generated catalogs to add explicit dependency metadata incrementally.
