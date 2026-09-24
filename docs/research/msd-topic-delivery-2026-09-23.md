# MSD topic inventory and sourced definitions — 2026-09-23

Inspected all three advertised Russian topic sitemap files: **8995 unique URLs**.
This is page inventory, not a complete dictionary of terms, and stays outside the phone package.
Inspected **60** scheduled professional-version pages and accepted
**30** short complete source definitions for previously empty names.
Other outcomes remain in the acquisition report. No overlong text was truncated to fit.

The normal knowledge edition now has **8467 definition records** and
**7602 pending-name records**, **16069 searchable records** in total.
Original name IDs and discovery annotations remain intact. Source response, paragraph and
excerpt hashes are distinguished; only the short source excerpt is stored, not full articles.
All records remain source-local, medical-review-required and release-ineligible.
No clinical synonym, canonical merge, executable scale or classification adaptation is inferred.

**65 scoped Python tests passed**, strict Python and the reader's
TypeScript checks passed. The normal SQLite build/integrity/round-trip checks passed.
Actual app reader reconstructed all **30** definitions with exact text
and sources. Named lookup: **30 Top-1 / 30 Top-20**;
framed `Что такое ...?`: **30 Top-1 / 30 Top-20**.
These are source/name checks, not independent paraphrase or clinical search quality.
Files: **128872448 SQLite bytes / 26945938 gzip bytes**;
not device memory. No whole-app/Android evaluation, model integration, binary release or APK.

Earlier run 35898925103 collected/built successfully but its final push was rejected by a
concurrent branch advance. This new measured run repeats acquisition and adds the actual
reader check; publication uses ordinary non-force replay and refuses source-file conflicts.
The inverse-search companion changes remain untouched by this source intake.

Reports: `msd-topic-intake-2026-09-23.json`, `msd-topic-reader-2026-09-23.json`.
Method: `msd-topic-intake-method-2026-09-23.md`.
Ordinary preparer version: `2026.09.23-msd-topics-1`.
