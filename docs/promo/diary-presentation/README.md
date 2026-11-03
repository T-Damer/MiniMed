# Diary presentation

A 15-slide deck about the patient diary module (16:9, 1280×720 per slide), in the app's paper style.
Every content slide carries two tags: its part of the talk (Введение, Основная часть, Демо,
Техническая часть in green, Заключение) and its topic. Phone screenshots sit under a drawn status
bar, so the frame's camera cut-out never covers the app.

- `index.html` — the public version: no institution, author or hosting details. Open it in a browser;
  arrows/PageDown move between slides, printing gives one slide per page.
- `index.full.html` — the version with the title page, the university band and the hosting line
  filled in. It is built from `index.html` by a script kept only on the owner's machine
  (`output/diary-presentation/personalize.py`), so `index.html` is the one source to edit; the full
  file is gitignored.
- `img/` — screenshots from the live demo, the illustrations (`icons/`, sources also in
  `apps/app/src/assets/illustrations/`), emoji as PNG (`emoji/`, Twemoji, CC BY 4.0) so they render
  the same everywhere.
- `tools/build-pptx.mjs` — an editable PowerPoint: every slide's graphics as one picture with the
  text laid over it as real text boxes.
- `tools/build-pdf.mjs` — a PDF built the same way (picture + real, selectable text). Use it rather
  than the browser's own «Print to PDF»: Chromium keeps soft shadows as blur masks, and Preview and
  Keynote draw those as grey rectangles.

```bash
cd docs/promo/diary-presentation/tools && bun install
bun build-pptx.mjs ../index.html ../diary-presentation.pptx
bun build-pdf.mjs ../index.html ../diary-presentation.pdf
```

The slides print the short links `med.1damer.com/demo` (doctor) and `/demo/patient` (patient), but
the QR codes open the pages on GitVerse directly: `med.1damer.com` resolves through Cloudflare, which
a network that lets only listed domains through may not reach. Both live in `links.json` (`text` —
printed, `qr` — encoded); after changing them rebuild and verify the codes from the repository root:

```bash
bun docs/promo/diary-presentation/tools/qr-links.ts          # rewrite the QR codes in index.html
bun docs/promo/diary-presentation/tools/qr-links.ts --check  # read every code back (jsQR)
```
