# ADR-0015: Encrypted patient vault and longitudinal observations

- Status: superseded by ADR-0016
- Date: 2026-08-29

## Context

MiniMed needs patient-specific calculator and questionnaire context, dated measurements, treatment
events, and graphs without turning ordinary notes or the medical-source index into an electronic
medical record. Patient data must remain local and must not be readable while the app is locked.
Historical instrument results also must not change when a profile, reference rule, or tool definition
is edited later.

## Decision

Use a separate schema-v2 protected domain:

```text
PatientProfile
└─ ClinicalEpisode «Осмотр»
   └─ PatientEvent → PatientObservation[]
```

The browser stores one encrypted IndexedDB snapshot for profiles, episodes, events, and observations;
patient files use a separate encrypted object store. The random AES-256-GCM data key is wrapped by a
15-Unicode-character-or-longer password through PBKDF2-HMAC-SHA-256 with 600,000 iterations. Every
encrypted record receives a fresh 96-bit IV and AAD containing its type, id, and schema version.
There is no SQLite, backend, localStorage copy, search index entry, clinical log, or notification text
for protected patient data.

On supported native shells, AndroidX Biometric/Android Keystore and iOS LocalAuthentication/Keychain
can hold a device-bound wrapper for the same data key. The password remains the portable fallback;
the native wrapper is omitted from portable backups because it cannot be moved to another device.
The app shows a privacy curtain when backgrounded or blurred, removes the in-memory session after
five minutes, and offers explicit lock, encrypted backup, patient export, and cascading deletion.

Instrument definitions are schema v2 only. A calculator or questionnaire declares patient bindings,
an explicit evaluation state, provenance, and stable observation mappings. Results are persisted only
after a complete calculation/assessment with an explicitly selected patient. Tool results are
immutable; correcting a manual observation appends a revision and marks the prior value superseded.
No automatic name matching is allowed. Reference verdicts and context are captured in the event and
are never recomputed from current profile data.

## Consequences

- Ordinary notes continue to work without unlocking the patient vault.
- Dynamic charts can safely separate incompatible units, methods, instruments, scales, and versions.
- A missing or unverified reference is visible as `unavailable` or `missing-context`; MiniMed never
  invents a laboratory or growth norm. Manual laboratory ranges come only from the user's report.
- Native biometric behavior and recovery after backgrounding still require physical Android/iOS
  device qualification before release.
