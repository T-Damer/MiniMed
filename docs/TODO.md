# MiniMed TODO

Short-term 1.0 follow-up work that remains after the 0.6.0 release.

## UX and navigation
- Move primary navigation to a compact bottom bubble and remove the in-app page header.
- Add a ChatGPT-like left history drawer opened by a fixed floating button or swipe.
- Add short, restrained transitions for page and document opening.
- Redesign Knowledge Base controls so local/downloaded content and available packs are clearer.

## Downloads and model loading
- Make module downloads resumable and self-healing: retry transient network failures, back off, preserve partial bytes, and expose actionable state only when automatic recovery is exhausted.
- Show download speed and detailed progress for OCR/content processing.
- Replace the model auto-start checkbox with automatic background model loading and a loader/progress indicator over the Settings navigation icon.
- Keep model choice and offline-search controls in Settings.

## Search and knowledge graph
- Improve search ranking and add more Russian clinical retrieval cases.
- Make knowledge graph interactions reliable on hover/focus and visually distinguish legal, drugs, clinical recommendations, and notes with section-specific colors and outlines.
- Add compact archive/download counters: available documents in yellow at top-left and downloaded documents in green at bottom-right.

## Patient notes and voice
- Add local patient cards and nested personal notes with a separate trust boundary from official knowledge.
- Include patient notes in local search with explicit source labels.
- Add optional local Russian speech-to-text for dictated notes.

## Data and AI
- Revisit OCR for scan-only Russian documents and validate that language is preserved.
- Run a small, measured Replicate benchmark only when a candidate model/prompt pair is ready; do not scale the failed 0.6.0 pilot without a quality gate.

## Platform roadmap
- 1.1 idea: portable Rust `MedicalCore` with a versioned JSON CLI, differential tests against the current core, and an optional terminal UI.

## 1.0 release checklist
- Finish the UI/navigation and download reliability items above.
- Add regression coverage for page transitions, document opening, download retry/resume, and model-loading states.
- Verify the public `/app/` browser build and Android release candidate after the 1.0 changes.
