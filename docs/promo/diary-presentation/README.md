# Diary presentation

A 17-slide deck about the patient diary module (16:9, 1280×720 per slide), in the app's paper style.
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

## Analogues (slide 3)

Checked 2026-11-04 from the vendors' own pages and store listings; «—» on the slide means «no» or
«not described anywhere we found». Product names on the slide link to these sites.

- [Medsenger](https://about.medsenger.ru/ru/) (ООО «Телепат», RU) — the closest one. Its agent «Опросники и
  лекарства» sends questionnaires of arbitrary questions on a schedule, reminds about doses with
  confirmation and dose, plots charts and heat maps, and runs algorithms that warn the doctor
  ([docs](https://docs.telepat.online/steps/45)). The agents act on the data on the server, so it is
  not end-to-end encrypted, and no HL7 FHIR is mentioned anywhere. It does have a consilium, consultants and a doctor's
  assistant, and relatives/social workers in the channel (Medsenger.Care); a licence is 10 000 ₽ a month per doctor.
  Full inventory: `docs/research/medsenger-2026-11.md`.
- [СберЗдоровье](https://sberhealth.ru/) remote monitoring (RU) — a smart tonometer feeds a «Дневник
  наблюдений» that the patient and the doctor see; the doctor is alerted on deviations
  ([CNews](https://zoom.cnews.ru/news/item/565425)). No own questionnaires, no relatives.
- [mindLAMP](https://www.digitalpsych.org/mindlamp) (BIDMC/Harvard, US, open source) — surveys
  configurable without code, a clinician/researcher dashboard with notifications; research-oriented,
  English.
- [Medisafe](https://www.medisafe.com/), [MyTherapy](https://www.mytherapyapp.com/) — medication
  reminders. Medisafe's Medfriend (a relative or carer) sees the schedule and history and is alerted
  30 min after a missed dose's last reminder
  ([help](https://medisafe.com/faq/what-is-a-medfriend)); doctors get reports or a one-time code,
  not a live view.
- Not on the slide (no doctor link, too far): [Daylio](https://daylio.net/), [eMoods](https://emoodtracker.com/), [Bearable](https://bearable.app/)
  — mood diaries; the doctor gets an exported PDF/CSV. The APA evaluation notes Daylio's shared files
  are not encrypted ([APA](https://psychiatry.org/psychiatrists/practice/mental-health-apps/evaluations/daylio-evaluation));
  eMoods keeps data on the device; Bearable says only the user holds the key (vendor claim).

MiniMed's carer access (a guardian sees the intake log and helps keep to the treatment) is shown as
«в планах»; it is not built yet.

## Case (slide 4)

«Новая жизнь», Оренбургский областной клинический наркологический диспансер (ГАУЗ «ООКНД»),
03.2024–03.2025, on Medsenger: parents with alcohol dependence at risk of losing parental rights
(the parents are the patients). Figures on the slide — 107 patients, 83,2 % keep sobriety, mean
remission 5,4 months, 9 children returned to the family, 718 remote consultations (62 by video) —
and the feedback (doctors: dynamics between visits, team work; patients: questionnaires take long
and come too often; doctors: some filled them while drunk) are from the project's results
presentation: <https://about.medsenger.ru/ru/docs/new-life-narcology-presentation.pdf>. The
«Семья — часть лечения» card (a parent as carer of a teenager) is our own next step, not part of
that project.
