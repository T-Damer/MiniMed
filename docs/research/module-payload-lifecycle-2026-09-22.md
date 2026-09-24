# Module payload lifetime and cancellation verification

Date: 2026-09-22. Draft PR #180, branch `experiment/system-one-search-benchmark`, still stacked on #174. No merge or release.

Verified implementation: `1f6117ab76df679253e7d7814bff3f777b6b1a18`.
Input: `fdf42b07e8aef6b4bf19929738c6607b94cf0e96` plus the scoped changes subsequently committed above.
Successful run: https://github.com/T-Damer/MiniMed/actions/runs/35690073788
Numeric evidence: [same-run report](module-payload-lifecycle-2026-09-22.json).

## Implementation

New index installations store an immutable Blob in the existing IndexedDB `versions` record. The large-file path creates an object URL directly from that Blob and reuses the existing OPFS worker/owner, without first reading the full index into the page's ArrayBuffer. Old ArrayBuffer records remain readable; no forced redownload or bulk migration is introduced. Explicit byte consumers and small in-memory SQLite still receive bytes. This is backward reading of old records, not qualification of downgrading to an old application unable to read Blob records.

Blob construction and SHA-256 hashing no longer make a preliminary full ordinary-buffer copy. View offsets/lengths remain exact; shared-memory inputs are copied into ordinary memory where required. The installer retains only the index buffer it needs for validation, rather than a second map of all artifact payloads. New OPFS identities include the actual index checksum (decoded checksum for gzip), preventing equal-size, differently checksummed inputs from sharing a validation cache. Source-assets layout and source contents are unchanged.

Late cancellation is checked after asynchronous hashing, decoding, staging and SQLite validation, and before registry activation. Cancellation during backend activation restores the previous active pointer before settlement. A cancelled operation must finish cleanup before the same module retries, and simultaneous editions of one module cannot race their activation receipts. A restore or cleanup failure is reported as failure, not successful cancellation. These guarantees cover settled operations in the tested process, not arbitrary crashes between IndexedDB and registry writes.

## Tests and measurements

Six new lifecycle regression cases failed on the previous installer. After the fix, **80 selected Vitest cases passed, zero failed**. App and core TypeScript checks, scoped Biome checks and schema synchronization passed. The selected cases include late cancellation, retry while cleanup is pending, competing editions, restoration/cleanup errors, corrupt archive and invalid SQLite rejection, old payload compatibility, exact subarray snapshots, previous-pointer restoration, and OPFS owner/key behavior. This is not a green whole-repository CI claim.

The before/after browser runs used the same runner, prepared database and actual App, with fresh Chromium contexts. The baseline restored the previous storage and installer source files; both sides already included the small archive-only pre-copy removal. Each run used the full **18,133-entry public local-dev dictionary**, with a synthetic **528,384-byte core**. The exact dictionary bytes were **111,288,320 installed / 27,398,230 transported** on both sides. This is a memory-lifetime change, not a data-size reduction.

| Main-page CDP `backingStorageSize` snapshot | Before | After |
| --- | ---: | ---: |
| Core ready, before dictionary installation | 70,064,682 | 70,131,600 |
| Dictionary card open after installation | 405,312,932 | 210,141,932 |
| Dictionary search after restricted-network restart | 405,849,738 | 71,990,607 |

Values are bytes. They are **not total application RAM, a sampled installation peak, worker memory or Android PSS**. Blob/native storage is not fully represented by this main-page metric. No forced-GC steady-state or full process comparison was performed. The after-install snapshot still shows substantial binary storage; decompression still allocates the full decoded index and this is not a fully streaming installer.

Both runs verified first-run consent, dismissal during download, complete dictionary installation, bounded source-card reads and reuse after reload with database downloads blocked. Exactly one core GET and one dictionary archive GET occurred per run. The new run additionally verified an actual persisted Blob/checksum and zero large main-thread `Blob.arrayBuffer()` reads on reopen. Development JavaScript and the core report remained served; this is not complete production offline-start qualification.

## Reproduce and remaining work

Use the locked dependencies. Prepare a new immutable local edition with `scripts/prepare-definition-reference.py`, then run `node scripts/verify-reference-app.mjs --expect-blob` with the supported Playwright Chromium installed. Existing edition files are not overwritten. The regular tests/harness and reports remain; completed temporary workflow and patch helper were removed.

Further work: full streaming decode/staging, whole-process and device installation peaks, OPFS cache eviction with explicit owner lifecycle, complete interrupted-update/crash/rollback tests, production offline startup and owner-only annotation integration. No private PDF or derived text, model weights, database binary, APK, release asset or Actions artifact was published. Source review/rights and clinical relevance gates are unchanged.
