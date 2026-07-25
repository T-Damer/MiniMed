# Documentation agent notes

Read the root `AGENTS.md` first. Keep documents concise and distinguish implemented behavior from
roadmap ideas.

## Product shape

- Primary browser navigation: search, knowledge base/documents, settings.
- Search history belongs beside search, not in a separate top-level page.
- Search task scopes: diagnosis, clinical recommendations, medications, legal documents, and all
  sources without diagnostic model assistance.
- Deterministic local search remains complete without a model. Only diagnosis may use the optional
  grounded local-model wrapper.
- Personal notes and future transcription are a separate local trust layer; never present them as an
  official source.

## Release order

- `1.0`: complete/qualified corpus, reliable content lifecycle, measured Russian clinical scenarios,
  and a safe local personal overlay.
- `1.1` idea: portable Rust `MedicalCore` plus a stable JSON CLI. Do not begin a broad runtime rewrite
  before 1.0 or before golden cross-language fixtures exist.

Update `CURRENT_STATE.md` only for implemented or measured changes. Update `TECHNICAL_PLAN.md` only
when the target architecture or release gates change. Do not duplicate long implementation details
that are already enforced by tests or ADRs.
