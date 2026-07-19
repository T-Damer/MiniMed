# MiniMed Android embedded preview

This branch contains a small native Android engineering preview that proves the
fully offline delivery path:

- a debug-signed installable APK;
- an SQLite knowledge pack embedded at `assets/minimed-core.db`;
- free-form Russian clinical text input;
- deterministic local normalization, aliases and ranking;
- no `INTERNET` permission;
- CI extraction and integrity verification of the database from the final APK.

The nine cards are synthetic regression data and are **not clinical guidance**.

## Build locally

```bash
python3 tools/build_demo_db.py app/src/main/assets/minimed-core.db
gradle :app:assembleDebug
```

The GitHub Actions release workflow builds and verifies the APK reproducibly.
