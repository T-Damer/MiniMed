# Questionnaire dependencies in content modules

Clinical content modules may declare which local questionnaires they require through their existing `tags` field.

Supported declarations:

- `assessment:<assessment-id>` — require one questionnaire;
- `assessment-section:<section-id>` — require every questionnaire in a section;
- `assessment-dependencies:none` — explicitly declare that the module has no questionnaire dependencies.

Declarations are additive, deduplicated and sorted before they are persisted. `assessment-dependencies:none` cannot be combined with a positive declaration. Unknown questionnaire or section identifiers are rejected and reported.

## Runtime behavior

1. A valid declaration is authoritative and avoids opening and scanning the installed SQLite module.
2. A module without declarations uses the legacy full-text scan as a compatibility fallback.
3. A malformed declaration is logged and also falls back to the text scan rather than silently dropping a dependency.
4. The resulting dependencies use the existing source-aware installation state, so manual installation, section installation and multiple clinical modules retain questionnaires independently.

This convention keeps the portable content-module contract unchanged while allowing generated catalogs to add explicit dependency metadata incrementally.
