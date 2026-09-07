# Landing examples

`searchCards.json` is a read-only snapshot of three documents and their original chunks from
`apps/app/public/content/core.db`. IDs, anchors, version labels, source checksums and the database
checksum are retained. Text is copied without rewriting; summaries remain labelled as summaries,
and the medication record is not represented as a complete drug instruction.

`calculator.json` and `questionnaire.json` are unchanged selected definitions from
`content/tool-modules/core-clinical.json` and `content/tool-modules/obstetrics-gynecology.json`.
The small calculation and scoring checks assert these snapshots still match the source schemas.
Refresh these snapshots from their source when changing the examples; do not edit medical copy here.
