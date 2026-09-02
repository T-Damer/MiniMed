# ADR-0016: Device Keychain or explicit plaintext patient vault

- Status: accepted
- Date: 2026-08-30

## Context

The password-derived vault in ADR-0015 adds a separate password and biometric recovery flow to a
local-only application. MiniMed instead needs seamless native startup while still making the browser
storage limitation explicit. A device-bound wrapping key cannot make a portable encrypted backup.
The application is still in local development, so the existing persisted format does not require a
migration.

## Decision

On Android and iOS, keep the patient snapshot and files encrypted with AES-256-GCM in IndexedDB. Wrap
the random data key with a non-exportable Android Keystore key or an iOS Keychain item accessible only
while the device is unlocked. Do not request a MiniMed password, fingerprint, Face ID, or device
credential prompt.

When native device key storage is unavailable, including the browser build, offer plaintext IndexedDB
storage only after an explicit warning. Keep the patient domain separate from ordinary notes and out
of localStorage, search, logs, notifications, and backend integrations in either mode. Preserve the
session lock and privacy curtain as disclosure controls, not as a claim that plaintext browser data is
encrypted at rest.

Portable full-vault and patient exports are plaintext and must say so before download. Delete the
schema-v2 DEV database and native legacy key when schema v3 initializes; do not migrate old records.
Integrity, transaction, or key access failures close the session rather than substituting an empty
snapshot.

## Consequences

- Native use is seamless and encrypted at rest under the platform device boundary.
- Browser users can work locally without a password, but must acknowledge that other software with
  access to the browser profile may read the data.
- Reinstalling the app, clearing Keychain/Keystore, or moving IndexedDB without its device key makes
  native encrypted data unrecoverable.
- Portable exports require external secure storage because MiniMed does not encrypt them.
- Physical Android and iOS validation remains required for Keychain/Keystore failure and background
  recovery behavior.
