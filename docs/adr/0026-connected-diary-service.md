# ADR-0026: Connected patient diary with an end-to-end encrypted sync server

- Status: accepted (owner, 2026-10-27: «keep end-to-end», live monitoring); implemented in DIARY6
  (`apps/diary-server`, `packages/diary-sync`, [DIARY_SERVICE.md](../DIARY_SERVICE.md)).
- Decision: project owner, 2026-10-27 (a psychiatric faculty needs live remote follow-up instead of messengers;
  «keep end-to-end»).
- Amends: [ADR-0004](0004-no-backend-before-1.0.md) and the «hosted backend» non-goal of
  [TECHNICAL_PLAN.md](../TECHNICAL_PLAN.md) — **for the patient diary only**.
- Related: [DIARY_PLAN.md](../DIARY_PLAN.md), [ADR-0015](0015-encrypted-patient-vault-and-longitudinal-observations.md),
  [ADR-0016](0016-keychain-or-plaintext-patient-vault.md), [ADR-0019](0019-local-device-sync-bluetooth-webrtc.md).

## Context

The diary already works without a server: the invitation travels in the link fragment, entries stay on the patient's
phone and return as QR codes or a file at the next visit. Psychiatric patients rarely come in person, so the doctor
must see records between visits, answer them, and learn about an urgent answer (suicidal ideation) quickly. A browser
cannot accept connections, and WebRTC needs both sides online at once plus a relay on mobile networks, so asynchronous
delivery needs a store-and-forward server. Health data of psychiatric patients is special-category personal data and
medical secrecy; the developer hosting the server should not be able to read it.

## Decision

1. **Scope.** One small HTTP service for the diary. Search, documents, the patient vault and everything else stay
   serverless and offline-first; the QR/file diary transport stays as the offline adapter. The app must remain useful
   with the service unreachable.
2. **Stack.** `apps/diary-server`: Bun, `bun:sqlite` (WAL) with numbered migrations, `Bun.password` (argon2id), Web Push
   (VAPID), server-sent events. No Postgres, Docker or new runtime. It serves the built web app and `/api` from one
   origin, binds `127.0.0.1` behind Caddy. Contracts in `packages/contracts/src/diary-sync.ts`; client crypto and sync
   in `packages/diary-sync` (pure TypeScript, Web Crypto only, no new library).
3. **Keys.**
   - Each patient has a symmetric **data key per epoch** (AES-256-GCM). Records are encrypted on the device that writes
     them; the associated data binds patient id, record id, revision and epoch.
   - Each doctor has an **ECDH P-256** key pair (wrapping) and an **ECDSA P-256** key pair (signing). The private keys
     are stored on the server encrypted under a key derived from the password (PBKDF2-SHA-256, ≥ 600 000 iterations,
     per-user salt). Login uses a different derivation (HKDF of the same secret, then argon2id on the server), so the
     server never sees the encryption key. A **recovery code** shown once at sign-up wraps the same private keys.
   - Each patient **device** generates its own key pairs at pairing. The pairing QR (link fragment, never sent to the
     server) carries the server origin, the patient id, a one-time pairing secret and the current data key; the
     pairing secret is single-use and the device then receives epoch keys wrapped to its own key.
   As built: the QR carries only the patient id and the secret (84-character link); the epoch keys
   travel sealed with a key derived from the secret, uploaded by the doctor with the pairing and
   deleted by the server when the phone pairs.
   Since 2026-11-05 (SEC-AUDIT1) the phone shows the server only a proof of the secret (HKDF with
   its own label) and the server keeps `sha256(proof)`; before, the phone sent the secret itself,
   which let the server open the sealed epoch keys. Phones from before still send the secret and
   the server derives the proof, so their codes keep working.
   - Sign-in by **access code**: the code is the account's password (e-mail = a digest of it). The
     server receives and keeps only `sha256` of the code's proof (`inviteProof`), never the code
     (SEC-AUDIT1; plain codes stored before are re-keyed on the next registration). The operator who
     mints a code still knows it, and the e-mail digest lets someone with the database try all
     ~2^59 codes offline: code accounts are end-to-end against the server, not against those two.
   - Every member (curator or device) receives each epoch key **wrapped to its public key**. That is how a doctor on any
     device decrypts: login → unlock the private keys → unwrap the patient keys → decrypt records → build charts locally.
4. **Records.** Append-only envelopes `{patient, id, rev, epoch, author, body (iv.ciphertext), sig}` with a server
   sequence number; clients pull everything after their cursor. A correction is a new revision signed by its author.
   Plan versions, tips, consent records and records all use the same envelope. Kind and content are inside the
   ciphertext.
5. **Curators and roles.** Per patient `curators: [{doctor, role: owner | editor | reader, status}]`. The membership
   list is server-visible metadata; each change is a statement signed by the owner. The server refuses writes from
   readers; clients verify that every record's signer held a writing role at that time, so neither the server nor a
   reader can inject records unnoticed. Invitation → the doctor accepts → the patient confirms when the doctor is not
   covered by the signed consent. **Removing** a curator or a device starts a new epoch: the owner's device creates a
   new data key and wraps it for the remaining members. Past reads cannot be revoked.
   *Carers (DIARY25, owner 2026-11-04).* An owner or editor adds a carer (опекун) after ticking that the patient
   consents; the carer's phone pairs with a one-time code like the patient's (`kind: carer`), holds its own key copies,
   reads and marks the whole diary, and names itself in an encrypted `member-<device>` record, so every mark shows who
   made it. It cannot withdraw the patient's consent. The patient's phone lists who has access and removes a carer;
   then the patient's phone itself starts the new epoch (the only epoch a device may create). A removed carer's phone
   deletes its copy of the diary.
6. **Alerts.** Red-flag rules live in the field and questionnaire schemas and in the plan. The patient's device
   evaluates them, shows the crisis screen, and posts a content-free alert `{patient, at}`; the server sends Web Push
   to the curators' subscribed devices with a fixed text («Срочная отметка у пациента») and the pseudonym emoji is
   resolved on the doctor's device.
7. **What the server can see.** Doctors' e-mails, display names and auth hashes; random patient and device ids; the
   membership graph and roles; whether a device is the patient's or a carer's; record sizes and times; alert times;
   push endpoints; reminder moments and, while the diary has a carer, its dose moments and which are marked taken
   (the missed-dose notice, DIARY25). **Not**: names (carers' included), pseudonyms, plans, medicines, values, notes,
   questionnaire answers. The service owner's «Обзор сервиса» (`GET /api/admin/stats`, `DIARY_ADMIN_EMAILS`) shows only aggregates of these: counts and times per service and per doctor (name, e-mail, number of diaries, last record time), never a patient identifier or a record body. **Doctors' totals (owner 2026-11-10).** Each doctor's app also sends anonymous per-doctor totals (`PUT /api/doctor/totals`): the number of the doctor's own diaries with a plan, the active prescriptions, and the medicine intakes due and taken over 7 and 30 days, summed over the diaries where that doctor is the owner (demo diaries and the demo account excluded). It sends them at most once an hour and only when they changed; the server keeps one row of six numbers and a time per doctor. **Never per patient**: no patient id, name, plan or record reaches the server this way, and a payload with any other field is refused. The overview shows the sums and, per doctor, prescriptions, the 30-day adherence share and the date of the doctor's last report; the numbers are as fresh as the doctor's last visit to the diaries.
8. **Hosting.** Production on a Yandex Cloud VM in `ru-central1` (data stored in Russia, 152-ФЗ ст. 18 ч. 5) with TLS on
   the VM; DNS for `med.1damer.com` is Cloudflare **DNS only**. No proxy (Cloudflare or other foreign TLS terminator) in
   the patients' path: Russian ISPs have been cutting Cloudflare-proxied connections since June 2025, and a foreign
   terminator raises a cross-border transfer question (ст. 12). Development uses a `cloudflared` tunnel from the
   owner's Mac with test data only. The faculty can later run the same service on its own Ubuntu/Debian server.
9. **Accounts.** Doctors are invited during the pilot; open sign-up waits until the operator/processor model allows it.
   Patients have no account: a paired device is authenticated by its device token and signature.
10. **Logging.** Request logs keep method, route template, status and timing; never bodies, tokens, keys, pseudonyms
    or query strings with ids.

## Alternatives rejected

- **Server-side encryption at rest only**: simpler (server charts, server alert rules), but the operator could read
  everything. Rejected by the owner.
- **Peer-to-peer (WebRTC) between doctor and patient**: needs both online and a signalling/relay server anyway.
- **A separate patient app**: the owner wants one app; patient mode is a narrowed profile with its own small precache.
- **Calendar `.ics` reminders**: too much friction for patients. Reminders come later as server push carrying times only.
- **Cloudflare Tunnel for production**: see decision 8.

## Consequences

- A server to operate: TLS renewal, backups (`sqlite .backup` nightly to private Object Storage; contents are ciphertext
  except account metadata), updates, uptime monitoring.
- No server-side analytics across patients; doctors export what they need.
- A doctor who loses the password and the recovery code loses access unless another curator re-shares the patient.
- Web Push depends on Google and Apple push services (payloads are encrypted by the Web Push protocol and content-free);
  phones without Google services get updates only when the app is opened.
- Legal: the clinic is the operator and the developer its processor under a written agreement; consents are signed on
  paper at the visit. As built (DIARY26): the patient also accepts the three joining documents (ИДС, personal-data
  consent, remote-care contract) in the app before the first entry; each acceptance (document, wording version,
  time) travels inside the encrypted `consent` record, so the server sees only that a record exists. Formal remote monitoring under order 193н (ЕСИА, the clinic's МИС, УКЭП) is out of the pilot's
  scope and needs a separate decision.

## Delivery order

As in [DIARY_PLAN.md](../DIARY_PLAN.md) phases D0–D4: diary format v3 offline first, then the server with pairing, sync,
curators and alerts, then the doctor dashboard, then reminders and the self-host package.
