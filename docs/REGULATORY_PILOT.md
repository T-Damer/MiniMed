# Russian regulatory pilot

## Scope

The regulatory pack contains two active pediatric Minzdrav orders and one superseded predecessor:

- `192н` — current dispensary observation of minors;
- `211н` — current preventive medical examinations of minors;
- `302н` — historical dispensary-observation order, superseded from 1 September 2025.

Cards retain official publication and registration metadata, effective dates, clause/page locators,
status, replacement links, and stable anchors. They are source-navigation summaries, not legal advice or
individual status decisions.

The `211н` card intentionally excludes the full form appendices and age-by-age examination table. Open
the current full act when those details are required.

## Validation

```bash
bun run content:rebuild:regulatory
bun run benchmark:regulatory
```

Direct and declared-source builds must produce identical SQLite checksums. The 12-query baseline is:

- Recall@1: `0.83`;
- Recall@5: `1.00`;
- MRR@5: `0.917`;
- required current/historical top-1: `1.00`;
- section recall: `1.00`;
- exact context resolution: `1.00`;
- official metadata validation: `1.00`.

## Next

Expand administrative coverage and add a real amendment chain with more than one historical version
before indexing high-consequence status rules.
