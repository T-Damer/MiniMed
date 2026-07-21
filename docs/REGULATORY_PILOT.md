# Russian regulatory pilot

## Scope

The first regulatory pack contains two active pediatric Minzdrav orders:

- `192н` — dispensary observation of minors;
- `211н` — preventive medical examinations of minors.

Cards retain official publication and registration metadata, effective dates, clause/page locators, and
stable anchors. They are source-navigation summaries, not legal advice or individual status decisions.

The `211н` card intentionally excludes the full form appendices and age-by-age examination table. Open
the current full act when those details are required.

## Validation

```bash
pnpm content:rebuild:regulatory
pnpm benchmark:regulatory
```

Direct and declared-source builds must produce identical SQLite checksums. The ten-query baseline is:

- Recall@1: `0.80`;
- Recall@5: `1.00`;
- MRR@5: `0.90`;
- section recall: `1.00`;
- exact context resolution: `1.00`;
- official metadata validation: `1.00`.

## Next

Add amendment/supersession fixtures and improve top-1 separation between closely related orders before
expanding to high-consequence administrative acts.
