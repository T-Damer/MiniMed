# MiniMed TODO

Short-term 1.0 follow-up work that remains after the 0.6.0 release-candidate implementation.

## In progress — documents/library & notes UX batch

- [x] Outline resize: visible grip, live column resize, width persists, TOC above blurred paper.
- [x] Zoom pill in the reader header (microscope toggle, zoom mode hides extras, TOC stays).
- [x] Per-page PDF scaling; two-page spread via reading menu; book mode fits content to screen.
- [x] PDF text selection (word-layer pointer events).
- [x] Markdown prints rendered HTML; DOCX prints with original styles; PDFs print as original.
- [x] Photos open in a zoom lightbox; photo-only printing.
- [x] OCR is opt-in («Распознать текст»), image→PDF copies sized to the image.
- [x] Book mode/search gated without extractable text; light reading paper.
- [x] Library: whole card clickable, RMB anywhere, back climbs folder hierarchy.
- [x] Library: any file type accepted (JSON/exe/zip bug fixed), kind icons, video/audio player.
- [x] Library: list view + free-form placement (3 view modes with size modifiers).
- [x] Folder cards drawn as real folders with name/contents below.
- [x] EPUB (epub.js) and DOCX (docx-preview) render as originals.
- [x] RTF import (cp1251 + group-stack parser).
- [x] Notes: undo/redo with shortcut labels, selection-menu active states, quote escape.
- [x] Notes: mentions search across documents/calculators/tests/notes, clickable hash links.
- [x] Notes: voice recording (10-min chunks, Telegram-style bubbles) + ASR queue via
      ParityController; transformers.js worker with Parakeet v3 / Whisper-tiny; Settings picker.
- [x] Text highlighting: `==mark==` in notes; saved highlights in text documents.
- [x] assessments-subpage-header column layout on mobile; animated next-button progress ring.
- [x] Floating windows: collapse to header, marquee title.
- [ ] ASR ONNX inference quality pass on device (worker + engine seam are ready).
- [ ] Highlighting for PDF/EPUB surfaces (text documents only for now).
- [ ] PDF text-selection quality check in a live browser.
- [ ] Reading scale for text/markdown content (PDF-only today).
- [ ] e2e + on-device validation of the whole batch.

## Памятки для пациентов (proposal, awaiting approval)

New top-level collection in the knowledge base: curated packs we publish
(`minimed.handouts.<theme>`) plus doctor-uploaded memos (image/video/text via the attachment
stack), optional per-section download, and a questionnaire builder on the existing tool-module
JSON framework. Phased: collection+viewers, doctor uploads, builder, publication pipeline.

## Done since the 0.6.0 release-candidate baseline

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
  partial bytes, transfer speed and per-stage progress on `#/settings/downloads`.
- Ten realistic Russian doctor queries in the public-pilot gate, plus the alias gaps they exposed.
- Personal notes: patient cards with categorized nested notes, a badged personal results block outside
  the official results container, linked installed documents, and follow-up reminders with a red tab
  badge and recorded completion condition.
- Local reminder notifications and note images: Android schedules opted-in reminders without a server,
  browsers notify while the tab is open, and validated image attachments stay in IndexedDB.
- Dependency hygiene: ruff, biome, playwright and astro bumps, and the Dependabot uv ecosystem fix
  that stopped every tools/ingest update from failing `uv sync --locked`.
- Compact pass on the knowledge base: tabs now connect to the panel they switch and seven document
  cards fit where two did, verified against the running app at 375px.
- Section ranking on realistic phrasing: the within-group preference now reads the question
  (diagnostics/routing/treatment vocabulary) and disclaimers no longer lead registry cards.
  Top-section accuracy 0.885 -> 1.000, doctor-workflow 0.4 -> 1.0.

## UX and navigation

- Optional: open the history drawer by swipe as well as by button.
- The search page still spends a lot of height before the first result: five scope cards and a tall
  query box. Worth a pass once the scope picker's real usage is known.

## Search and knowledge graph

- Offer to install a missing area directly from search when a query targets content that is not
  installed. The core already knows which areas exist.
- Keep adding real Russian retrieval cases as they surface from use.

## Patient notes and voice

Cards, nested notes, search integration, and follow-up reminders have landed. Voice and data
portability remain.

- Optional local Russian speech-to-text for dictated notes. Not started: it needs a Russian-capable
  transcription model in the browser/WebView runtime, sized like the existing model tiers, and it must
  stay optional so notes remain fully usable by typing.
- Consider exporting or wiping a single card for handover and retention, once real use shows whether
  that is needed.

## Data and AI

- Qualify the local models for grounded clinical answers before enabling clinical orchestration
  (issue #122): citation fidelity, unsupported-claim rate, abstention, latency, and memory per model.
- OCR for the scan-only Russian recommendations, verifying the output stays Russian rather than being
  translated (issue #121).
- Run a measured Replicate benchmark only when a candidate model/prompt pair is ready, and keep spend
  inside the agreed 10–15 USD ceiling.

## Platform roadmap

- 1.1 idea: portable Rust `MedicalCore` with a versioned JSON CLI, differential tests against the
  current core, and an optional terminal UI.

## 1.0 release checklist

- Finish search-driven installation of a missing area.
- Verify the public `/app/` browser build and the Android release candidate after the 1.0 changes.
