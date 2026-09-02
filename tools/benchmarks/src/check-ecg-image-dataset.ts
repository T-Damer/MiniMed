import assert from 'node:assert/strict';

import { ECG_IMAGE_LABELS, loadEcgImageDataset, parseEcgImageDataset } from './ecg-image-dataset';

const dataset = loadEcgImageDataset();
const classification = dataset.cases.filter((fixture) => fixture.fixture_kind === 'classification');
const qualityOnly = dataset.cases.filter((fixture) => fixture.fixture_kind === 'quality-only');
assert.equal(classification.length, 36);
assert.equal(qualityOnly.length, 13);
assert.deepEqual(
  new Set(classification.flatMap((fixture) => fixture.labels)),
  new Set(ECG_IMAGE_LABELS),
);
assert.deepEqual(
  dataset.sources.find((source) => source.source_id === 'learnecg'),
  {
    source_id: 'learnecg',
    name: 'LearnECG examples',
    source_url: 'https://learnecg.ru/ecg_example/ecg_example_menu.php',
    license: null,
    rights_status: 'link-only; redistribution permission not confirmed',
    redistribution_allowed: false,
  },
);

const fixture = qualityOnly[0];
assert.ok(fixture);
assert.throws(
  () => parseEcgImageDataset({ ...dataset, cases: [{ ...fixture, labels: ['NORM'] }] }),
  /cannot have diagnostic labels/u,
);
console.log(JSON.stringify({ dataset: dataset.dataset_id, cases: dataset.cases.length }));
