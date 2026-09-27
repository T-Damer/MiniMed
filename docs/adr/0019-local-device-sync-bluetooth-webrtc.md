# ADR-0019: Local device sync over Bluetooth with WebRTC bulk transfer

- Status: proposed
- Date: 2026-09-27

## Context

A clinician uses MiniMed on several own devices (phone, tablet, desktop browser). Today personal
data moves only by manual export/import (personal-notes backup, patient diary QR, FHIR export).
The product must stay offline-first without accounts, cloud sync or a hosted backend
(TECHNICAL_PLAN «Non-goals»), and the patient vault is encrypted at rest with a device-bound key
(ADR-0016), so it cannot be copied as ciphertext to another device.

A browser cannot listen for incoming connections, and a WebRTC connection needs both peers'
ICE credentials and DTLS fingerprints, so a one-way QR code is not enough. HTTPS pages cannot
reach a phone's plain-HTTP LAN address.

## Decision

1. **Pairing and signalling over Bluetooth LE.** The Android app exposes a BLE GATT peripheral
   (native plugin); desktop Chrome/Edge connect with Web Bluetooth; Android/tablet peers use the
   native plugin on both sides. BLE carries the WebRTC offer/answer both ways and small payloads.
   Both devices show the same 6-digit confirmation code derived from the exchanged fingerprints;
   the user confirms once per device pair. Paired devices store each other's identity keys.
2. **Bulk transfer over a WebRTC data channel** on the local network (host candidates only by
   default). Using a public STUN server for devices on different networks is an explicit, separate
   opt-in; TURN relays are out of scope (they are a backend).
3. **Fallback without Bluetooth** (Safari/Firefox, iPhone): the desktop shows a QR code with the
   offer; the answer returns through the system share sheet and is pasted on the desktop; the same
   confirmation code applies.
4. **Background sync.** When paired devices are reachable and MiniMed is running (Android: a
   foreground-service or scheduled job within platform limits), sync starts automatically without
   prompts; the user can pause it per device.
5. **Data model.** Every synced record (notes, patients and their events, collections/favourites,
   settings chosen for sync) keeps a revision history with a hybrid logical clock and device id.
   Different fields merge automatically. Concurrent edits of the same text keep both versions as a
   conflict block labelled with device and time, e.g. `<<<<<<< Телефон · 27.09.2026 14:32` …
   `=======` … `>>>>>>> Ноутбук · 27.09.2026 15:10`, rendered in the UI with «Оставить эту /
   Оставить обе / Объединить вручную». Delete-vs-edit never deletes silently. Append-only patient
   events rarely conflict; conflicting patient-card fields use a choice card, not text markers.
   All versions stay in history; a merge decision can be reverted.
6. **Patient vault.** Records are decrypted on the sender, travel inside the DTLS channel plus an
   application-layer AEAD keyed from the pairing, and are re-encrypted on the receiver with its own
   device key. Nothing is written to logs, notifications or search.
7. **UI.** Settings → «Синхронизация»: list of paired devices with a device-type icon (phone,
   tablet, desktop; at least these three), last sync time, status, pause/remove, and «Добавить
   устройство» (Bluetooth first, QR fallback).

## Consequences

- No server, account or cloud storage; data never leaves the user's devices.
- Requires native Android code (BLE peripheral, background execution) and physical-device
  qualification, MIUI included. Web Bluetooth works only in Chromium browsers; iOS peripheral mode is
  limited, so iPhone starts with the QR fallback.
- BLE throughput (tens of KB/s) suits notes and settings; photos and audio need the WebRTC channel.
- Conflict handling and history add storage and a migration of synced record formats (DEV format
  policy allows breaking changes; patient data must still be preserved).
- A USB (WebUSB + Android Open Accessory) transport is deferred until Bluetooth proves unreliable.

## Delivery order

1. One-way «copy everything to a new device» over BLE signalling + WebRTC, with the confirmation code.
2. Paired-device list in Settings → «Синхронизация» with device-type icons.
3. Two-way merge with revision history, conflict blocks and background sync.
