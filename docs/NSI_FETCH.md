# NSI Minzdrava fetch (АТХ and other dictionaries)

Reference dictionaries of `nsi.rosminzdrav.ru` are fetched through its REST API
(`/port/rest/{versions,passport,data}`, Swagger at `/port/swagger-ui.html`, group `external`).
The API needs a user key (`userKey`); the host presents a certificate chain of the Russian national
root CA («Russian Trusted Root CA», Минцифры). Owner rules:

- the key is `NSI_USER_TOKEN` in the git-ignored `.env`; it is never printed, written to files or
  commits, nor given to app, test or browser processes;
- the root CA is trusted **inside a disposable container only** (never in the macOS keychain, a host
  trust store, `NODE_EXTRA_CA_CERTS` or with insecure flags). The container downloads it from
  `https://gu-st.ru/content/lending/russian_trusted_root_ca_pem.crt` and refuses to continue unless
  its SHA-256 is `D2:6D:2D:02:31:B7:C3:9F:92:CC:73:85:12:BA:54:10:35:19:E4:40:5D:68:B5:BD:70:3E:97:88:CA:8E:CF:31`
  (the published fingerprint; valid until 2032-02-27).

## Command

```bash
scripts/fetch-nsi-dictionary.sh                       # АТХ, OID 1.2.643.5.1.13.13.99.2.473
scripts/fetch-nsi-dictionary.sh <oid> <label>         # any other dictionary
bun scripts/build-atc-names.ts                        # app asset from the newest fetched АТХ
```

The wrapper writes a 0600 env-file holding only `NSI_USER_TOKEN`, runs `scripts/fetch-nsi-dictionary.mjs`
in `node:24-bookworm-slim` with `--rm` (no image or container stays), and deletes the env-file. Output,
git-ignored under `data/raw/nsi/<label>/v<version>/`: `rows.json` (all rows of the latest version),
`passport.json`, `MANIFEST.json` (source URL without key, OID, version, publish date, row count,
SHA-256 of `rows.json`, known versions). It fails if the version list and the current passport
disagree or the row count differs from the passport.

Pre-release freshness check: run the fetch, compare `MANIFEST.json` `version` with
`version` in `apps/app/src/features/medications/atc-names.json`; if newer, run `build-atc-names.ts`.

## Terms

The passport has no licence text and `laws` is empty for АТХ. It states that the dictionary is built
from data of the WHO Collaborating Centre for Drug Statistics Methodology (Oslo) and is also published
in ЕСНСИ (ID 01-23381). WHOCC requires a reference to the Centre; its notice forbids commercial
copying and altering of the material, so a public release still needs a WHOCC request (see
`docs/research/data-sources-2026-10.md` §3.8). The app shows the dictionary name, version and date and
the WHOCC attribution under the ATC code explanation.
