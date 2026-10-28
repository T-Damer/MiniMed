# Connected patient diary — plan

- Status: **D1–D4 implemented except the ЕСИА/МИС route** (2026-10-28): offline day page
  (DIARY5), the end-to-end encrypted sync service, doctor accounts, live sync, the doctor dashboard
  with charts, curators and key rotation, urgent alerts, content-free push, export,
  `?profile=diaries` (DIARY6), the pilot on `med.1damer.com` (2026-10-27), and D4 (DIARY11): dose
  and checkpoint reminders by push with «Принял» on Android, the patient told what the doctor
  changed (plan, tip, correction), open doctor sign-up for the prototype, the faculty self-host
  package ([DIARY_SELFHOST.md](DIARY_SELFHOST.md)). Running and deploying:
  [DIARY_SERVICE.md](DIARY_SERVICE.md).
  Owner request 2026-10-27 (a psychiatric faculty asked for a «separate diary program»: doctors now
  follow patients through messengers).
- Architecture decision: [ADR-0026](adr/0026-connected-diary-service.md) (proposed).
- Consent drafts for the faculty lawyer: [diary-consent/](diary-consent/).
- What exists today: the serverless patient diary (`apps/app/diary/`, `apps/app/src/diary/`,
  `apps/app/src/features/diary/`, `docs/CURRENT_STATE.md` «Patient diary» DIARY2–DIARY4). It keeps working
  unchanged as the offline mode; this plan adds a **connected** mode on top of it.

## Goal

A doctor prescribes treatment and self-monitoring, the patient records it on their phone every day, and the doctor
follows it **live** between visits (telemedicine; psychiatric patients rarely come often) — with charts, corrections,
tips and an urgent alert, without anyone but the patient's doctors being able to read the data.

## Decisions so far (owner, 2026-10-27)

| Topic | Decision |
| --- | --- |
| Live monitoring | Required. A small sync server is accepted for the diary only (ADR-0026). |
| Encryption | End to end. The server stores ciphertext; charts and exports are built on the doctor's device. |
| One app | Patient and doctor use the MiniMed web app (one origin, one install). Patient mode is narrowed to the diary. |
| Install | The doctor installs the PWA with the patient at the visit, so install friction is not a design problem. |
| Reminders | Not now. No `.ics` file (too much friction). When added, they come from the same app via server push. |
| Doctor accounts | Login from any device. Curators with access levels and a management sheet. |
| Sharing | `curators: []` per patient: invite another doctor of the system, who accepts. |
| Heatmap | GitHub-style year grid (reference: uiwjs/react-heat-map), our own SolidJS SVG component. |
| Doctor contacts | The doctor leaves one or more contacts (phone, Telegram, link, e-mail) shown to the patient. |
| Hosting | Pilot by us; later the faculty's Ubuntu/Debian server. Production on a Yandex Cloud VM; this Mac for development. |
| Domain | `med.1damer.com` (no «psy» in any patient-visible name, see Privacy). |
| Consent | Before the first entry the patient sees the ИДС and the personal-data consent (drafts in `diary-consent/`). |

### Recommended defaults taken in this plan (owner may override)

1. **Pilot doctors are invited** (faculty doctors). Open sign-up is the owner's wish, but a self-registered doctor outside
   the clinic has no processing agreement with the operator (152-ФЗ ст. 6 ч. 3), which would make *us* the operator of
   their patients' health data. Open sign-up waits for that legal model.
2. **No Cloudflare proxy in front of patients.** Russian ISPs have cut Cloudflare-proxied connections after ~16 KB since
   June 2025 (confirmed by Cloudflare; 2026 reports say it continues on some networks), and a foreign TLS terminator raises
   a cross-border question (152-ФЗ ст. 12). Production DNS for `med.1damer.com` stays at Cloudflare as **DNS only**;
   the VM terminates TLS itself. `cloudflared` is used for the development tunnel `med-dev.1damer.com` from this Mac.
3. **Pilot legal route (a):** the app is the patient's self-monitoring diary shared with their doctors; the doctor keeps
   decisions in the clinic's own records as now. Route (b) — ЕСИА identification and the clinic's МИС with УКЭП as order
   193н expects for formal remote monitoring — is a later project. **The faculty lawyer decides** (see Legal).
4. **Heatmap brightness = share of the day's plan done**, not mood and not a raw count (see Patient side).
5. **Wellbeing scale 0–10** by default; the doctor can switch a checkpoint to a bipolar −5…+5 mood scale.

## Possible / not possible

| Wish | Verdict |
| --- | --- |
| Works offline, records sync when back online | Yes: outbox in IndexedDB; Background Sync on Android Chrome, sync on open on iOS. |
| Doctor sees new records within seconds | Yes while the patient is online (push on save, server-sent events to an open dashboard). |
| Urgent alert to the doctor | Yes: the patient's device evaluates the rule and sends a content-free signal; Web Push to the doctor's devices. |
| Charts, corrections, tips, CSV/XLSX | Yes, on the doctor's device (`chart.js`, `exceljs` are already dependencies). |
| Server-side charts or statistics across patients | **No** with end-to-end encryption. Research aggregates come from a doctor's export. |
| Timed reminders without a server | **No** in a web app (no scheduled local notifications). Later: server push carrying only times. |
| «Принял» / «Отметить состояние» buttons in a notification | Android: yes. iPhone: no (web notifications have no actions there; a tap opens the app). |
| Push on phones without Google services (new Huawei/Honor) | No Web Push in Chrome there; those patients see updates when they open the app. |
| Revoking what a removed curator already read | No. Removal stops future access (key rotation), not past reads. |
| P2P sync without a server | Rejected: both sides must be online at once and mobile networks need a relay anyway. |

## Patient side

Patient mode is set by pairing (the doctor's QR), not by a URL parameter. It shows only the diary: no search, no bottom
bar, a calmer accent palette (own `--accent` tokens, light and dark). Its service worker stores the diary shell only
(target ≤ 5 MB, today's full shell is 73.6 MB) and never downloads the core or modules.

**First run** (after scanning at the visit): welcome (doctor, clinic) → «Согласие на наблюдение» (summary, full text, «Я
прочитал(а)») → «Согласие на обработку данных» (separate screen; 152-ФЗ requires a separate document) → «Если станет
плохо» (crisis contacts) → the diary. The signed paper originals stay at the clinic; the doctor marks them signed.

**One screen, «Сегодня»:**

- Header: doctor avatar and name, «Связаться» (the doctor's contacts as `tel:` / `https:` buttons).
- Heatmap strip: the last months, scrollable to the year; a day opens that day for back-filling.
- Checklist of the day, grouped by time slot (утро / день / вечер / ночь or exact times): each dose is a cell with a
  check circle. Tap the circle = taken now (time editable); tap the cell = a sheet «Как вы себя чувствуете после приёма»
  (effect chips declared in the plan + an auto-growing text area). «Пропущено» with an optional reason.
- Checkpoints placed by the doctor: «Самочувствие утром 08:00», «вечером 21:00» (scale sheet), «Показатели» (ЧСС, АД,
  SpO₂ — one sheet, the existing number fields and validation), questionnaires as buttons with a due badge
  («PHQ-9 · раз в неделю · пора»).
- «Добавить описание состояния»: time (now, editable) + auto-growing text area, saved as a time-bound note.
- A doctor's tip shows as a «?» on the label it belongs to; opening it marks it read and the «?» disappears.

**Heatmap levels** (5, like the reference): 0 = nothing recorded; 1–4 = under 25 / 50 / 75 / ≥ 75 % of the day's planned
items done (doses, checkpoints, due questionnaires). A day with nothing planned but with records is level 2. Tooltip:
«8 из 10 отметок». Mood is not encoded in colour: a depressed patient should not watch their calendar darken; mood is a
chart for the doctor.

**Back-filling:** every record keeps `at` (when it happened) and `enteredAt` (when typed); the doctor sees both.

**Crisis screen:** opened automatically when a red-flag rule fires and always reachable from the header. Contents:
call/write the doctor, 112, and the faculty's further help channels — **owner to complete** (the message listing the
three ways to help was cut off after «compliant doctor»). Crisis numbers come from the faculty; none are invented here.

## Doctor side

Lives in MiniMed behind a doctor profile (`?profile=psy`, a declared config: allowed routes, accent, title — the UI
does not branch on the profile id). With a single route the bottom bar is hidden.

- **Login** with e-mail and password on any device; the recovery code is shown once at sign-up.
- **Patients**: list with pseudonym/emoji, last record, 7-day adherence, unread changes; urgent flags pinned on top.
- **Patient page**: heatmap; charts for АД, ЧСС, SpO₂, wellbeing morning/evening; questionnaire totals over time with
  the severity bands of the scale's schema; adherence per medicine; a timeline of notes and after-dose feelings.
  On any element: **correct** (a new revision signed by the doctor, the patient's original kept and visible) or **leave a
  tip**. Export CSV / XLSX.
- **Plan composer, one screen**: medicines from the drug picker (installed modules; a light name list when none are
  installed) with structured schedules; vitals preset on by default (ЧСС, АД, SpO₂, Самочувствие утром, Самочувствие
  вечером); checkpoint times; «+ Опросник» buttons; red-flag rules; contacts; a note. Saving publishes a new plan
  version; the patient's app picks it up, no new QR.
- **Curators sheet** (owner only edits): rows with avatar, name, e-mail, role segmented control «Чтение | Изменение»,
  owner badge, remove icon; «Добавить куратора» by exact e-mail; pending invitations with their state; «Передать
  пациента» (ownership transfer). A doctor not covered by the patient's signed consent stays pending until the patient
  confirms «К наблюдению подключается врач …» in the app.

Roles: **owner** (everything + curators), **editor** (plan, tips, corrections), **reader** (view, export).

## Data model (diary format v3)

Built on v2 (`features/diary/diary-model.ts`); DEV format policy allows the break, existing patient data is converted.

- **Plan item** gains `drug` (МНН, trade name, form, strength, card id when known) and a structured `schedule`:
  slots (`morning | day | evening | night` or `HH:MM`, meal relation `before | with | after | any`, dose), interval
  (every N hours), as needed (max per day), course start/end, titration steps (from date → dose).
- **Checkpoint**: a field set or a questionnaire id + its schedule (times of day, weekdays, every N days).
- **Questionnaires**: self-report scales only — today's packs have PHQ-9, GAD-7, Zung SDS, Zung SAS, EPDS
  (`content/tool-modules/psychology.json`); clinician-rated HAM-D stays on the doctor side. The patient shell bundles
  the allowed scales; the plan carries ids and versions. Rights are checked per scale before bundling.
- **Red-flag rules** are declared in the field or questionnaire schema (e.g. PHQ-9 item 9 ≥ 1); vital thresholds are
  set by the doctor in the plan. Default values: **faculty to confirm**.
- **Records** are append-only with revisions: `{id, rev, kind, at, enteredAt, author: patient|doctor, values, note}`.
  Notes up to 4 000 characters (v2 limit was 200).
- **Tips**: `{id, target (field | plan item | record), text, author, readAt?}`.
- **Contacts**: `[{kind: phone | telegram | link | email, label, value}]` in the plan.
- **Consent record** (encrypted, in the patient's data): document version, paper signed on (date), witnessed by.

## Architecture

```text
Patient (MiniMed, patient mode) ─┐                     ┌─ Doctor (MiniMed, ?profile=psy)
  diary shell, own precache       │   HTTPS, ciphertext │   drug picker, questionnaires
  IndexedDB outbox                ├──▶ diary server ◀───┤   charts, export, curators
  device key pair                 │   Bun + bun:sqlite  │   password-unlocked key pair
                                  │   Web Push, SSE     │
```

- `packages/contracts/src/diary-sync.ts`: zod schemas of every request and stored envelope.
- `packages/diary-sync` (new, pure TS + Web Crypto): keys, wrapping, envelopes, signatures, sync cursor. Used by the app
  and the server tests; no SolidJS, no provider SDK.
- App: a `DiarySyncPort` in core with an HTTP adapter; UI never calls `fetch` for the diary directly. The QR/file
  transport stays as the offline adapter.
- `apps/diary-server` (new): Bun HTTP server, `bun:sqlite` (WAL), numbered migrations, argon2id via `Bun.password`,
  Web Push (VAPID), server-sent events. Serves the built app and `/api` from one origin. Binds `127.0.0.1` behind Caddy.
- Security details and what the server can see: ADR-0026.

## Hosting

| | Development | Pilot production | Later |
| --- | --- | --- | --- |
| Machine | this Mac | Yandex Cloud VM, Ubuntu 24.04, `ru-central1` | faculty Ubuntu/Debian server |
| Address | `med-dev.1damer.com` via a new `cloudflared` tunnel | `med.1damer.com`, Cloudflare DNS only (no proxy) | faculty domain or the same |
| TLS | Cloudflare edge (dev data only) | Caddy + Let's Encrypt on the VM | same package |
| Process | `bun` from the checkout | systemd unit, nightly `sqlite .backup` to private YC Object Storage | `.deb` or install script + systemd |

No patient data on the development tunnel (test patients only). Creating the tunnel and DNS records changes the
Cloudflare account: done only on the owner's go.

## Privacy

- Nothing patient-visible says «psy»: domain, app name on the home screen («Дневник»), icon, notification text.
  A home screen or browser history must not reveal psychiatric care.
- Notifications are content-free («Новая рекомендация врача», «Срочная отметка у пациента 🦊»).
- Pseudonyms and emoji are encrypted too; the server knows random ids only.
- Never log clinical text, keys, tokens or ciphertext bodies (AGENTS.md).

## Legal (summary — the faculty lawyer decides)

Research of 2026-10-27 (sources in the consent drafts):

- **Telemedicine** (323-ФЗ ст. 36.2; order 193н of 11.04.2025, in force 01.09.2025, replaced 965н): remote monitoring
  is prescribed after an in-person visit, manual entry by the patient is allowed, but participants are identified via
  ЕСИА and the doctor's records are signed with УКЭП in the clinic's МИС. A developer-hosted app is neither — hence
  route (a) for the pilot and route (b) as a later project.
- **Operator model** (152-ФЗ): the clinic is the operator, the developer processes on its behalf under a written
  agreement (ст. 6 ч. 3), named in the consent; the clinic updates its Roskomnadzor notice (ст. 22); data stored in
  Russia (ст. 18 ч. 5, Yandex Cloud `ru-central1`).
- **Consents**: ИДС on remote monitoring (323-ФЗ ст. 20; 3185-1 ст. 11) and, as a **separate document**, consent to
  processing health data (152-ФЗ ст. 9 ч. 4, ст. 10 ч. 2 п. 1), both signed on paper at the visit. Electronic signing
  would need ЕСИА or УКЭП (ст. 20 ч. 7). Patients 15–17 sign the ИДС themselves (323-ФЗ ст. 54 ч. 2; 3185-1 ст. 4);
  for the data consent the cautious path is a parent's co-signature.
- **Medical secrecy** (3185-1 ст. 9; 323-ФЗ ст. 13): sharing with curators and the processor is covered in the ИДС
  draft; doctors outside its wording need the patient's confirmation in the app.
- **Withdrawal**: a button under «Информация» stops sync, deletes the patient's server records and tells the doctor.

## Phases

| # | Scope | Done when |
| --- | --- | --- |
| D0 | ADR-0026 accepted; faculty lawyer reviews `diary-consent/`; owner completes the crisis channels; VM and DNS | ADR status accepted, consent texts approved, `med.1damer.com` answers over HTTPS |
| D1 | Format v3 + patient «Сегодня» screen: schedules, dose checklist, after-dose sheet, vitals preset, checkpoints, notes, heatmap + day back-fill, questionnaires, contacts, crisis screen, consent screens, patient accent and shell precache | the whole patient flow works offline with the existing QR transport; e2e at 390 px light/dark, Chromium + WebKit |
| D2 | `packages/diary-sync` + `apps/diary-server`: doctor accounts (invite), keys and recovery code, pairing by QR, record sync with revisions, curators and roles, key rotation, alerts with Web Push to doctors, consent withdrawal | two doctors and one patient in three browser contexts: pairing, live sync, role enforcement, removal + rotation, alert push; server sees no plaintext (test inspects the DB) |
| D3 | Doctor dashboard: list, patient page with charts, corrections, tips with read state, one-screen composer, curators sheet, CSV/XLSX | a doctor runs a week of a test patient end to end on a phone and a laptop |
| D4 | Dose reminders by server push (times only) with Android notification actions; patient push for new tips; faculty self-host package; open sign-up; route (b) ЕСИА/МИС | Done 2026-10-28 except ЕСИА/МИС: reminders and push kinds (server tests incl. the RFC 8291 vector, reminder schedule tests, a paired phone in the browser), self-host package built and started locally (`install.sh` not yet run on a Linux server). Open sign-up: owner 2026-10-28, the pilot is a prototype with students and stable patients, so the legal model does not hold it back. Not tested on a real Android/iPhone notification yet |

## Open questions

1. The crisis channels after «compliant doctor» (owner's message was cut off).
2. Faculty: legal route (a) or (b); consent wording; red-flag defaults; crisis numbers; doctor response hours stated
   in the ИДС.
3. Which self-report scales beyond PHQ-9 / GAD-7 the faculty wants, and their rights.
4. Bipolar mood scale (−5…+5) needed from the start, or 0–10 only.
