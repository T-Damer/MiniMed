# Native reader

Decision (2026-09-30, user): the reader is one of the most important features of the app. The
native reader opens official sources and the user's own files — Markdown, plain text, HTML, EPUB
and PDF first — inside the app, offline, without a WebView.

## Principles

- **Original text only.** Importers turn a file into display blocks; they never rewrite, summarise
  or drop source text. Anything a block type cannot show (unknown HTML element, broken table) is
  kept as plain text, not silently removed.
- **Offline and closed.** No remote loads: HTML and EPUB images come only from the same file or
  package; scripts, styles, forms and iframes are dropped. External links open only on tap, in the
  system browser.
- **Stable positions.** Every block carries an anchor (heading slug or ordinal) and, where the
  source has them, page numbers and character spans, so reading position, search hits and
  collections survive re-import.
- **One renderer.** Official sources and user files render through the same design-system block
  components, so type, spacing and themes match the WebView reader.

## Layers

| Layer | Package | Owner |
| --- | --- | --- |
| Document model: blocks, inline spans, outline, anchors, pages | `shared/reader/` (commonMain) | claude-coordinator |
| Importers: Markdown (GFM, `==mark==`), plain text, HTML, EPUB | `shared/reader/` | claude-coordinator |
| PDF: page rendering and text, `expect`/`actual` per platform | `shared/reader/pdf/` | claude-coordinator |
| Block renderer, reader top bar, find bar, outline, reading menu | `shared/designsystem/` | claude-coordinator |
| Official source text (`parseDocumentText` port, its golden) | `shared/ui/` or `shared/text/` | codex-native |
| Reader screens, file picking and personal files storage | `shared/ui/`, `patient/` | see `STATE.md` |

Libraries: `org.jetbrains:markdown` (JetBrains, Apache-2.0; CommonMark + GFM tables, all our
targets) and `com.fleeksoft.ksoup:ksoup-lite` (Apache-2.0; jsoup port for HTML/XHTML). Both parse
only; neither renders. PDF uses platform APIs: Android `PdfRenderer` (text via
`PdfRenderer.Page.getTextContents()` on Android 15+), iOS PDFKit; desktop and Wasm are developer
targets and may show a «PDF opens on the phone» notice.

## Web reference

The WebView reader (`apps/app/src/features/library/`) is the design reference: opaque sticky chrome
with back, outline, breadcrumbs, find and reading settings; chrome hides on scroll down and returns
on scroll up (`docs/NATIVE_STICKY_CHROME.md`); sections with serif headings and a rule; inline
document links; images with captions; text scale 90–140 %; two-page spreads for PDF.

## Ready (R1)

- `reader/NativeDocument.kt`: blocks (heading with web `md-` anchors, paragraph, list with task
  boxes, quote and GitHub alerts, code, display math, table with alignment and spans, image, rule,
  raw, page mark), inlines, outline, `plainText()` for find.
- `reader/NativeMarkdownImporter.kt`: GFM Markdown with `==mark==`, `$math$`, reference links; raw
  HTML is not interpreted (`<br>` breaks the line, tags are dropped, their text kept). Tests in
  `NativeMarkdownImporterTest`.
- `designsystem/NativeDocumentView.kt`: `LazyListScope.nativeDocumentItems(document, actions)` —
  level-2 headings are sticky section titles; text scale; links through `actions.onLink`; images
  through the screen's `actions.image` slot (alt text otherwise); find hits per block (tables map
  them to cells; lists and quotes do not mark them yet). Tables follow CSS automatic layout and scroll
  sideways only when their words alone overflow the page.
- `designsystem/NativeReaderParts.kt`: `NativeReaderTopBar` (primary Back, bounded title, tools),
  `NativeReaderTool`, `NativeReaderChromeState` (hide on scroll down, show on scroll up),
  `NativeFindBar`, `NativeOutlinePanel`, `NativeReadingMenu` (90–140 %), `NativeScrollTopButton`.
- Design gallery scene `?scene=design-reader` (`&find=…`), rendered by `NativeDesignGalleryTest`.

## Ready (R2, R3 on Android)

- `reader/NativeFileImport.kt`: format by magic bytes, then extension, then reported type; text up
  to 32 MB; decoding by byte-order mark, declared HTML charset, strict UTF-8, else Windows-1251;
  `NativePlainTextImporter` (paragraphs at blank lines, line breaks kept).
- `reader/NativeHtmlImporter.kt` (Ksoup 0.2.5): headings (anchor = `id` or slug), paragraphs, lists,
  quotes, `pre`, tables with `colspan`/`rowspan`/alignment, figures, inline markup and links;
  scripts, styles, forms, frames and media are dropped, nothing is loaded.
- `reader/NativeFilePicker.kt` (`expect`): `rememberNativeFilePicker` — Android Storage Access
  Framework, desktop AWT dialog, browser `<input type=file>`; iOS not yet (`nativeFilePickerAvailable`
  is false). Files over 256 MB are refused before reading. `readDocument(context, uri)` (Android)
  reads a URI handed over by «open with».
- `NativePdfPages` (`expect`): Android `PdfRenderer` in a private cache copy deleted on close, pages
  rendered lazily at twice the view width on one thread, pinch zoom to 4× with panning, page
  indicator; damaged or password-protected files show a notice. Desktop, iOS and Wasm show a notice.
- `designsystem/NativeDocumentReader.kt` (reader screen from parts: bar above the list so section
  titles stick under it, outline drawer, find, text size, scroll-top) and `NativeFileReader.kt`
  (document, PDF or an explanation; `data:` images).
- Android debug build: launcher entry «Reader lab» (`androidApp/src/debug`) — the reader with «open
  file», and the «open with» target for PDF, Markdown, HTML and text. Checked on the emulator with a
  PDF, a Markdown file and a Windows-1251 HTML file.

Not yet: find inside PDF (Android 15 page text), EPUB, iOS picker and PDFKit, images next to a
Markdown/HTML file, find highlights inside lists and quotes, reading position restore for files.

## Phases

1. **R1 — model and Markdown.** Document model, Markdown importer with tests, block renderer, reader
   chrome parts in the design system, a reader scene in the design gallery.
2. **R2 — own files.** Plain text and HTML importers; opening a file from the system picker on
   Android and desktop into the reader.
3. **R3 — PDF.** Android page renderer with zoom and lazy pages, page position, find through the
   page text where the platform provides it.
4. **R4 — EPUB.** Zip container, spine order, XHTML chapters through the HTML importer, images.
5. **R5 — reading tools.** Find with hit navigation, outline sheet, text scale, position restore and
   highlights across formats.

DOCX, spreadsheets, DICOM and audio/video follow after R5.
