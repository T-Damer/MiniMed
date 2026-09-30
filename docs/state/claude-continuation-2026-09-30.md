# Continuation of the Claude UI and coordinator chats

Recovered from «Улучшения приложения: взгляд пользователя» (`416069df-ef43-40ae-9acf-1555349f5c7c`)
and «Координация трёх агентов» (`8a1cad76-e512-4515-83cc-9791654b1653`). Their final interruption
left S2 in the working tree and the coordinator's search-window change committed as `26a69921`.

## Completed changes

- S2: shared paper sheets, responsive popovers and confirmations remain; pointer cancellation
  cannot dismiss a sheet, reopening resets a gesture, and keyboard handling stays in the topmost
  dialog. Existing full-screen readers/editors retain `presentation="screen"`.
- S3: one excerpt stays visible; additional excerpts expand through the existing `Disclosure`.
  The type badge has readable contrast and occupies normal flow. Source text, anchors, module
  downloads and the medication cap of three excerpts remain unchanged.
- Lookup ranking: age/sex-qualified queries prefer a literal topic match over qualifier-only
  results. Unqualified identity searches and explicit failed-treatment/clinical ranking retain
  their previous rules. One regression test covers child/adult/sex qualifiers.
- Playwright output goes to the ignored `playwright/test-results/` directory.
- Light/dark search text, source badges, paths and highlighted matches meet 4.5:1 contrast at
  375 and 1280 px. Native text uses opaque theme colors and tabular numerals, with a shared
  light/dark contrast check.
- The recorded builder adds 1 643 audited medication aliases and a separate identity index
  (31 599 names, 31 508 exact targets). Identities retain source version/checksum and require
  exact verified catalog membership; downloads, reload and back navigation preserve that target.
  Three browser cases cover absent, installed and wrong-checksum source documents.
- RLS classification pages retain 50 137 source-listed links to packaging records. The rebuilt
  MKB module preserves all original document/section/chunk identifiers, text, anchors and raw
  source checksums. Packaging is reused from the existing release.

## Measured search gate

Ten committed doctor-lookup cases, the application lookup path and the same six local packs:

| Core | Recall@5 | MRR@5 | Forbidden-free |
| --- | ---: | ---: | ---: |
| Released, before/after | 0.70 | 0.60 | 1.00 |
| Candidate test7, before | 0.70 | 0.533 | 0.90 |
| Candidate test7, after | 0.70 | 0.60 | 1.00 |

These measurements do not qualify medical correctness, physical devices or a new data release.

## Final core qualification — 2026-09-30

The inclusive `core.0.6.45.db` passes the existing clinical and 1 500-query lookup gates;
all 15 public-pilot documents remain. Its SHA-256 is
`13f238f7fefe1b19eefa19ac9de0ea89fabff34ed96e98d987277f15ab03025f`.
The edition manifest and identity-index report match that checksum and the manifest's full
document-version/source-checksum set matches SQLite. Integrity is `ok`, with no foreign-key errors.

- Migration 012 restores the eight registration-summary chunk IDs and anchors retained by
  migration 007. Their original paragraphs, source spans, versions, raw checksums and metadata
  match 0.6.44. No shared chunk's original text changes; no document-version IDs are added or removed.
- All 444 changed clinical-pointer version checksums are hashes of the enriched catalog ledger
  records, rather than changed raw PDFs. The 273 retained PDF inputs match their recorded raw
  checksums. Moving definition extraction to the recorded JSON/PDF source snapshot changes text
  in 59 existing definitions and only quote/locator metadata in another 212; it adds 90 definitions
  and omits the previous definition projection for `529_2`. All 362 resulting definitions match their
  exact input chunks and locators: 360 are byte-exact substrings, while `26_4` and `313_3` require
  whitespace normalization. The source documents remain intact.
- Global classification labels now retain their source provenance instead of becoming an article's
  own clinical synonyms. This changes the corpus-derived discovery dataset composition; the
  final sample has 1 083 strict identities and 417 discovery cases. Strict Top-1 and identity
  recall are 1.00; discovery alias recall is 0.947. Fixed benchmark targets and thresholds remain
  unchanged.
- All 31 508 identity targets have verified catalog membership; the 20 document targets resolve
  to their exact local version, raw checksum and anchor. The definition database's decoded SHA
  matches its advertised zstd index. A gzip download needs its own verified artifact descriptor;
  the advertised zstd checksum cannot validate gzip bytes.

The regulatory index now uses an immutable URL pinned to repository commit `a2b96a5e`.
Its 401 408 bytes, SHA-256 `61b82c9cc8a6899b24e7b6208642a35ef1a448e15c08990df3c79c7b911ca040`,
three document editions and source-set digest match the catalog exactly; both regulatory targets
in the published core retain their exact versions, raw checksums and readable anchors. The mutable
`datasets-preview-1` producer had replaced that release asset with a valid 35-document pack under
the same filename and version, while the application catalog retained its three-document edition.
The browser mirror masked that mismatch; direct installers would reject the advertised checksum.
The URL repair preserves all catalog membership and source identities. The mutable producer remains
a separate limitation: a future dataset refresh must publish its corresponding catalog and preserve
previously advertised immutable artifacts. Evidence: `playwright/regulatory-artifact-source-audit.json`.

The local audit is `playwright/final-core-source-audit.json`; migration 012 is recorded by
`data/build/registry-identities-012-report.json`. These are corpus/build checks, not physical-device
qualification or a claim that the native application port is complete.

## Release status and next work

1. The qualified inclusive core and RLS module are published as `core-0.6.45` and
   `reference-rls-mkb-2026.9.30`; all nine asset hashes and sizes match GitHub. The rejected no-pilot rebuild reduced
   pilot Recall@5 from 0.787 to 0.246. Keep the 15 pilot documents until their source replacements
   pass the same gate; the 0.3 MB saving does not justify a search regression.
2. Release gates pass: 7 183 TypeScript and 875 Python tests, lint/type checks/builds, the fixed
   85-query clinical gate, seven exact-source/packaging browser scenarios and both-theme contrast.
   Native has 38 desktop tests and strict parity over 151 queries, 2 905 groups, 6 156 passages and
   206 SQL branches; Android/Wasm/iOS compile. The paired signed APK and physical Android check remain.
3. The source alias «Гастроэнтерит» → `K29.5` remains in the source review queue: it occurs verbatim in the RLS alias input
   and its reference-pointer projection. The ranking fix removes unrelated qualifier-only hits;
   it does not correct that source assertion or approve it as a clinical identity. Preserve the
   raw source and its provenance during review.
4. Complete the last WebView release and physical Android checks, then resume `native/`.
   Lookup rules and golden fixtures are aligned with the qualified release core. The existing
   native spike is retained; it is not a completed application port.

Keep at least one local copy of every currently used released artifact, as agreed on 2026-09-29.
