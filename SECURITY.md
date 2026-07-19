# Security policy

## Supported versions

Only the current `main` branch and the latest tagged pre-release are supported during the
private prototype stage.

## Reporting

Do not open a public issue for a vulnerability or accidental disclosure of clinical data,
API keys, source documents, or content packs. Contact the repository owner privately.

## Security invariants

- No production API key is committed or logged.
- The offline search path performs no network request.
- Real patient data is forbidden in tests, fixtures, telemetry, and crash reports.
- Content pack checksums are verified before installation once external packs are enabled.
- Generated HTML never renders untrusted source text with `innerHTML`.
