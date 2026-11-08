---
type: "source-file"
file: "content/definition-drafts/discovered-names-2026.09.23.json"
layout: "compact"
---

Заголовок файла `content/definition-drafts/discovered-names-2026.09.23.json`: источники, квитанции, состояние проверки. Записи терминов — в заметках понятий.

```source-file
{
 "format": "minimed-discovered-names-v1",
 "inputReceipts": [
  {
   "path": "content/definition-drafts/ruwiki-reference-2026.09.22-v2/records-001.json",
   "sha256": "289681e6c2bfca0e36e54968e45ac8c5fc9af8d828bc18c7a8aaf2d6779661cc"
  },
  {
   "path": "content/definition-drafts/ruwiki-reference-2026.09.22-v2/records-002.json",
   "sha256": "c0c3d240336f83077a809a67705bfd9078fbf3f6fc782a37714c270ae28a6bdf"
  },
  {
   "path": "content/definition-drafts/ruwiki-reference-2026.09.22-v2/records-003.json",
   "sha256": "2ef930b83b110cc3b493b5e1b624575cd66f1caa4bc44cfc1f24c92e6b506eac"
  },
  {
   "path": "content/definition-drafts/ruwiki-reference-2026.09.22-v2/records-004.json",
   "sha256": "e4e497a33e817b243fe45618ed0574be0a969fcdf35155825ab99512e05c502d"
  },
  {
   "path": "content/definition-drafts/ruwiki-reference-2026.09.22-v2/records-005.json",
   "sha256": "77d5241517265689f285762a14ddc27931bca376fa9914c25344330822adeedb"
  },
  {
   "path": "content/definition-drafts/ruwiki-reference-2026.09.22-v2/records-006.json",
   "sha256": "3cf67bb67c672774704c7641cdf6bea95e425cd8009278bd7b1294c56f28ea51"
  },
  {
   "path": "content/definition-drafts/ruwiki-reference-2026.09.22-v2/records-007.json",
   "sha256": "2e53c98dc863a8ae9c5f69b8dc498578606e1ba5ff308d0d9bafde492fc1e903"
  },
  {
   "path": "content/definition-drafts/ruwiki-reference-2026.09.22-v2/records-008.json",
   "sha256": "fb0d90d2c93c01a6880b0a1a8248fdd20e7a161ff3b0a3b632d9ab4c18439403"
  },
  {
   "path": "content/definition-drafts/ruwiki-reference-2026.09.22-v2/records-009.json",
   "sha256": "c76084b6c1c5227583827ab2e01b0455724b6f9a79c49bcb3c144d88b0922ade"
  },
  {
   "path": "content/definition-drafts/ruwiki-reference-2026.09.22-v2/records-010.json",
   "sha256": "77526d6698665819f5e2bf87c8d539567d34cb7d1ac9cad01c1ba22a6351f798"
  },
  {
   "path": "content/definition-drafts/ruwiki-reference-2026.09.22-v2/records-011.json",
   "sha256": "4cc4976f7e251e1d56904401ee78239589ff47764e3cab145a3ee1e7f72e8c69"
  }
 ],
 "names": "@names",
 "publicationState": "local-dev",
 "purpose": "discovery-only",
 "reviewStatus": "requires-review",
 "sources": [
  {
   "accessed": "2026-09-22",
   "attribution": "Авторы соответствующих статей русской Википедии; индивидуальные страницы и история авторства указаны в блоках.",
   "authority": "third-party",
   "baseUrl": "https://ru.wikipedia.org/wiki/",
   "changes": "Category selection and projection of complete API-provided plain-text introductions. No model rewriting, translation, invented aliases, scoring or harmonization.",
   "id": 1,
   "license": "CC-BY-SA-4.0",
   "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0/",
   "releaseEligible": false,
   "sourceLimitations": "Community encyclopedia, not clinical guidance. Plain-text API introductions omit media/tables and may differ from current article revisions. Exact retrieval snapshots are retained separately.",
   "sourceType": "wikipedia-api-introductions",
   "sourceUrl": "https://ru.wikipedia.org/w/api.php",
   "title": "Русская Википедия — медицинские и смежные определения"
  },
  {
   "accessed": "2026-09-22",
   "attribution": "Авторы соответствующих статей русской Википедии; индивидуальные страницы и история авторства указаны в блоках.",
   "authority": "third-party",
   "baseUrl": "https://ru.wikipedia.org/wiki/",
   "changes": "Pinned article revisions rendered to plain text. Paragraph/list order retained; tables preserve physical cells and declared spans. Layout, scripts and media omitted. No rewriting, clinical review, inferred roots, executable instruments or scoring.",
   "id": 2,
   "license": "CC-BY-SA-4.0",
   "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0/",
   "releaseEligible": false,
   "sourceLimitations": "Article revision is pinned; transcluded templates may reflect render-time versions. Exact API response is archived. Table geometry requires review. Media are not copied. An encyclopedia description is not proof of complete or licensed clinical scoring.",
   "sourceType": "wikipedia-api-parsed-sections",
   "sourceUrl": "https://ru.wikipedia.org/w/api.php",
   "tableGeometryEncoding": "header/rowspan/colspan; split rows by tableRowCounts",
   "title": "Русская Википедия — разделы справочных статей"
  }
 ]
}
```
