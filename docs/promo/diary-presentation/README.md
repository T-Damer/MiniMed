# Diary presentation

A 13-slide deck about the patient diary module (16:9, 1280×720 per slide), in the app's paper style.

- `index.html` — the public version: no institution, author or hosting details. Open it in a browser;
  arrows/PageDown move between slides, printing gives one slide per page.
- `index.full.html` — the version with the title page and the university band filled in. It is
  gitignored and lives only on the owner's machine.
- `img/` — screenshots from the live demo, the illustrations (`icons/`, sources also in
  `apps/app/src/assets/illustrations/`), emoji as PNG (`emoji/`, Twemoji, CC BY 4.0) so they render
  the same everywhere.
- `tools/build-pptx.mjs` — an editable PowerPoint: every slide's graphics as one picture with the
  text laid over it as real text boxes.

```bash
cd docs/promo/diary-presentation/tools && bun install
bun build-pptx.mjs ../index.html ../diary-presentation.pptx
```

The slides print the short links `med.1damer.com/demo` (doctor) and `/demo/patient` (patient), but
the QR codes open the pages on GitVerse directly: `med.1damer.com` resolves through Cloudflare, which
a network that lets only listed domains through may not reach. Both live in `links.json` (`text` —
printed, `qr` — encoded); after changing them rebuild and verify the codes from the repository root:

```bash
bun docs/promo/diary-presentation/tools/qr-links.ts          # rewrite the QR codes in index.html
bun docs/promo/diary-presentation/tools/qr-links.ts --check  # read every code back (jsQR)
```
