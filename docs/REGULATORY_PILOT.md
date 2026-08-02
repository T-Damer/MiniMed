# Russian regulatory pilot

## Scope

The regulatory pack contains current Russian acts, source-linked summaries, amendment chains, and
historical redirect cards for child and adult medical practice. The pediatric practice layer now
covers:

- the current pediatric-care, preventive-examination, dispensary-observation, education,
  neonatology, endocrinology, tuberculosis, vaccination, first-aid, and infectious-disease acts;
- child-care sick leave through Federal Law No. 255-FZ, Order No. 195n, and Order No. 1089n;
- the district pediatrician professional standard and the current/next qualification requirements;
- explicit redirects from 625n, 514n, 366n, 707n, 154, Order No. 5 of 1995, and 1346n;
- a status crosswalk for the pediatric study list and its medical-form identifiers.

Cards retain official publication and registration metadata where available, effective dates,
status, replacement links, and stable anchors. They are source-navigation summaries, not legal
advice or individual status decisions.

## Current-edition rule

A familiar order number is not treated as current merely because it appears in an examination bank.
Historical cards remain searchable but point to the current successor. Future Order No. 436n is
marked `future` until 1 September 2026, while Order No. 206n remains the current qualification source
until that date.

The medical-form crosswalk is deliberately conservative. The source list does not identify the
approving act and edition for most forms, so only the verified 030-PO/u replacement chain is marked
as current or superseded. Other identifiers remain searchable and require source verification before
practical use.

## Validation

```bash
bun run content:rebuild:regulatory
bun run benchmark:regulatory
```

Direct and declared-source builds must produce identical SQLite checksums. Retrieval contracts
validate the expected document, current or historical status, age audience, section anchor, context
resolution, and official metadata.

## Next

Add clause-level cards for the most-used sections of 255-FZ, 195n, 1089n, and 521n after a clinician
review, then add focused pediatric-practice retrieval fixtures without weakening the existing release
thresholds.
