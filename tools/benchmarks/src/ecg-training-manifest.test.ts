import { describe, expect, it } from 'vitest';

import {
  ECG_TRAINING_ADULT_MIN_AGE_DAYS,
  ECG_TRAINING_PROFILE,
  type EcgTrainingManifest,
  type EcgTrainingRecord,
  summarizeEcgTrainingManifest,
  validateAdultEcgGpuTrainingManifest,
  validateEcgTrainingManifest,
} from './ecg-training-manifest';

const ARTIFACT_SHA256 = 'a'.repeat(64);

const PTB_XL_SOURCE = {
  dataset: 'PTB-XL',
  revision: '1.0.3',
  license: 'CC BY 4.0',
  rights: 'redistribution allowed for research',
} as const;

const PHONE_SOURCE = {
  dataset: 'consented-phone-holdout',
  revision: '2026-09-01',
  license: 'owner permission',
  rights: 'test-only; no redistribution',
} as const;

function record(overrides: Partial<EcgTrainingRecord> = {}): EcgTrainingRecord {
  return {
    id: 'adult-signal',
    base_ecg_id: 'base-adult-signal',
    patient_id: 'patient-adult-signal',
    source: PTB_XL_SOURCE,
    cohort: 'adult',
    age_days: ECG_TRAINING_ADULT_MIN_AGE_DAYS,
    input_kind: 'signal',
    profile: ECG_TRAINING_PROFILE,
    split: 'train',
    ground_truth_labels: ['NORM'],
    sex: 'male',
    ...overrides,
  };
}

const VALID_MANIFEST: EcgTrainingManifest = {
  records: [
    record(),
    record({
      id: 'adult-render',
      base_ecg_id: 'base-adult-render',
      patient_id: 'patient-adult-render',
      age_days: ECG_TRAINING_ADULT_MIN_AGE_DAYS,
      sex: 'female',
      input_kind: 'render',
      split: 'calibration',
      ground_truth_labels: ['STTC'],
      artifact_sha256: ARTIFACT_SHA256,
    }),
    record({
      id: 'pediatric-signal',
      base_ecg_id: 'base-pediatric-signal',
      patient_id: 'patient-pediatric-signal',
      cohort: 'pediatric',
      age_days: 7,
      input_kind: 'signal',
      split: 'validation',
      ground_truth_labels: [],
      source_label_codes: ['ZZU:C22'],
    }),
    record({
      id: 'adult-validation',
      base_ecg_id: 'base-adult-validation',
      patient_id: 'patient-adult-validation',
      age_days: ECG_TRAINING_ADULT_MIN_AGE_DAYS,
      input_kind: 'signal',
      split: 'validation',
      ground_truth_labels: ['NORM'],
    }),
    record({
      id: 'pediatric-render',
      base_ecg_id: 'base-pediatric-render',
      patient_id: 'patient-pediatric-render',
      cohort: 'pediatric',
      age_days: 365,
      input_kind: 'render',
      split: 'test',
      ground_truth_labels: [],
      source_label_codes: ['ZZU:C21'],
    }),
    record({
      id: 'adult-real-phone',
      base_ecg_id: 'base-adult-real-phone',
      patient_id: 'patient-adult-real-phone',
      source: PHONE_SOURCE,
      input_kind: 'real-phone',
      split: 'test',
      ground_truth_labels: ['AFIB/AFL', 'NORM', 'STTC'],
      artifact_sha256: ARTIFACT_SHA256,
    }),
  ],
};

function validRecord(index: number): EcgTrainingRecord {
  const value = VALID_MANIFEST.records[index];
  if (!value) throw new Error(`Missing valid record ${index}.`);
  return value;
}

describe('ECG training manifest preflight', () => {
  it('accepts a valid manifest and reports deterministic dimensions', () => {
    const manifest = validateEcgTrainingManifest(VALID_MANIFEST);
    const summary = summarizeEcgTrainingManifest(manifest);

    expect(summary).toEqual({
      recordCount: 6,
      bySplit: { train: 1, calibration: 1, validation: 2, test: 2 },
      bySource: { 'consented-phone-holdout': 1, 'PTB-XL': 5 },
      byCohort: { adult: 4, pediatric: 2 },
      byInputKind: { signal: 3, render: 2, 'real-phone': 1 },
      byAgeGroup: {
        '0–6d': 0,
        '7–30d': 1,
        '1–3mo': 0,
        '3–6mo': 0,
        '6–12mo': 0,
        '1–3y': 1,
        '3–5y': 0,
        '5–8y': 0,
        '8–12y': 0,
        '12–16y': 0,
        '16–17y': 0,
        '18+': 4,
      },
    });
    expect(summarizeEcgTrainingManifest({ records: [...manifest.records].reverse() })).toEqual(
      summary,
    );
  });

  const invalidCases: readonly {
    readonly name: string;
    readonly value: unknown;
    readonly error: RegExp;
  }[] = [
    {
      name: 'rejects duplicate record ids',
      value: {
        records: [validRecord(0), { ...validRecord(1), id: 'adult-signal' }],
      },
      error: /record IDs must be unique/iu,
    },
    {
      name: 'rejects empty source revision',
      value: {
        records: [{ ...validRecord(0), source: { ...PTB_XL_SOURCE, revision: '' } }],
      },
      error: /source\.revision/iu,
    },
    {
      name: 'rejects empty source license',
      value: {
        records: [{ ...validRecord(0), source: { ...PTB_XL_SOURCE, license: ' ' } }],
      },
      error: /source\.license/iu,
    },
    {
      name: 'rejects empty source rights',
      value: {
        records: [{ ...validRecord(0), source: { ...PTB_XL_SOURCE, rights: '' } }],
      },
      error: /source\.rights/iu,
    },
    {
      name: 'rejects empty ground truth labels',
      value: {
        records: [{ ...validRecord(0), ground_truth_labels: [] }],
      },
      error: /ground_truth_labels/iu,
    },
    {
      name: 'rejects labels outside ECG_IMAGE_LABELS',
      value: {
        records: [{ ...validRecord(0), ground_truth_labels: ['not-a-label'] }],
      },
      error: /ground_truth_labels/iu,
    },
    {
      name: 'rejects patient leakage across splits',
      value: {
        records: [validRecord(0), { ...validRecord(1), patient_id: validRecord(0).patient_id }],
      },
      error: /patient_id.*both.*train.*calibration/iu,
    },
    {
      name: 'rejects base ECG leakage across splits',
      value: {
        records: [validRecord(0), { ...validRecord(1), base_ecg_id: validRecord(0).base_ecg_id }],
      },
      error: /base_ecg_id.*both.*train.*calibration/iu,
    },
    {
      name: 'rejects real-phone outside test',
      value: {
        records: [{ ...validRecord(5), split: 'validation' }],
      },
      error: /real-phone.*only allowed.*test/iu,
    },
    {
      name: 'requires exact age for pediatric records',
      value: {
        records: [{ ...validRecord(2), age_days: undefined }],
      },
      error: /age_days.*required.*pediatric/iu,
    },
    {
      name: 'requires source-native labels for pediatric records',
      value: {
        records: [{ ...validRecord(2), source_label_codes: undefined }],
      },
      error: /source_label_codes.*required.*pediatric/iu,
    },
    {
      name: 'rejects adult diagnostic labels on pediatric records',
      value: {
        records: [{ ...validRecord(2), ground_truth_labels: ['BRADY'] }],
      },
      error: /cannot map pediatric records to adult ECG image labels/iu,
    },
    {
      name: 'rejects a non-fixed ECG profile',
      value: {
        records: [
          {
            ...validRecord(0),
            profile: { ...ECG_TRAINING_PROFILE, speed_mm_per_s: 25 },
          },
        ],
      },
      error: /fixed.*profile/iu,
    },
    {
      name: 'rejects an uncontrolled sex value',
      value: { records: [{ ...validRecord(0), sex: 'unspecified' }] },
      error: /sex.*unsupported/iu,
    },
    {
      name: 'rejects uppercase artifact checksum',
      value: {
        records: [{ ...validRecord(1), artifact_sha256: ARTIFACT_SHA256.toUpperCase() }],
      },
      error: /artifact_sha256.*64 lowercase hexadecimal/iu,
    },
    {
      name: 'rejects malformed artifact checksum',
      value: {
        records: [{ ...validRecord(1), artifact_sha256: `${ARTIFACT_SHA256.slice(0, 63)}g` }],
      },
      error: /artifact_sha256.*64 lowercase hexadecimal/iu,
    },
  ];

  for (const invalidCase of invalidCases) {
    it(invalidCase.name, () => {
      expect(() => validateEcgTrainingManifest(invalidCase.value)).toThrow(invalidCase.error);
    });
  }

  it('allows absent checksums in the general source manifest', () => {
    const withoutAge = { ...record() } as { age_days?: number };
    delete withoutAge.age_days;
    const manifest = validateEcgTrainingManifest({
      records: [withoutAge],
    });
    expect(manifest.records[0]?.artifact_sha256).toBeUndefined();
  });

  it('uses conservative sequential age-day cutoffs', () => {
    expect(ECG_TRAINING_ADULT_MIN_AGE_DAYS).toBe(6_575);

    const ages = [
      0, 6, 7, 30, 31, 89, 90, 179, 180, 364, 365, 1_094, 1_095, 1_824, 1_825, 2_919, 2_920, 4_379,
      4_380, 5_839, 5_840, 6_569, 6_570, 6_573, 6_574, 6_575,
    ];
    const records = ages.map((ageDays, index) =>
      record({
        id: `age-${ageDays}`,
        base_ecg_id: `base-age-${ageDays}`,
        patient_id: `patient-age-${ageDays}`,
        cohort: ageDays >= ECG_TRAINING_ADULT_MIN_AGE_DAYS ? 'adult' : 'pediatric',
        age_days: ageDays,
        split: index % 2 === 0 ? 'train' : 'calibration',
        ground_truth_labels: ageDays >= ECG_TRAINING_ADULT_MIN_AGE_DAYS ? ['NORM'] : [],
        ...(ageDays < ECG_TRAINING_ADULT_MIN_AGE_DAYS
          ? { source_label_codes: [`ZZU:${ageDays}`] }
          : {}),
      }),
    );
    const summary = summarizeEcgTrainingManifest(validateEcgTrainingManifest({ records }));

    expect(summary.byAgeGroup).toEqual({
      '0–6d': 2,
      '7–30d': 2,
      '1–3mo': 2,
      '3–6mo': 2,
      '6–12mo': 2,
      '1–3y': 2,
      '3–5y': 2,
      '5–8y': 2,
      '8–12y': 2,
      '12–16y': 2,
      '16–17y': 5,
      '18+': 1,
    });
    expect(() => validateEcgTrainingManifest({ records: [record({ age_days: 6_574 })] })).toThrow(
      /outside the adult cohort/iu,
    );
  });

  const strictInvalidCases: readonly {
    readonly name: string;
    readonly value: unknown;
    readonly error: RegExp;
  }[] = [
    {
      name: 'requires an adult record in every split',
      value: {
        records: VALID_MANIFEST.records.filter((item) => item.id !== 'adult-validation'),
      },
      error: /non-empty splits: validation/iu,
    },
    {
      name: 'requires an adult signal train record',
      value: {
        records: VALID_MANIFEST.records.map((item) =>
          item.id === 'adult-signal' ? { ...item, input_kind: 'render' } : item,
        ),
      },
      error: /adult signal train/iu,
    },
    {
      name: 'requires an adult render outside test',
      value: {
        records: VALID_MANIFEST.records.map((item) =>
          item.id === 'adult-render' ? { ...item, input_kind: 'signal' } : item,
        ),
      },
      error: /render record outside test/iu,
    },
    {
      name: 'requires an adult real-phone test record',
      value: {
        records: VALID_MANIFEST.records.map((item) =>
          item.id === 'adult-real-phone' ? { ...item, input_kind: 'signal' } : item,
        ),
      },
      error: /real-phone record in test/iu,
    },
    {
      name: 'requires render and phone checksums',
      value: {
        records: VALID_MANIFEST.records.map((item) => {
          if (item.id !== 'adult-render') return item;
          const withoutChecksum = { ...item } as { artifact_sha256?: string };
          delete withoutChecksum.artifact_sha256;
          return withoutChecksum;
        }),
      },
      error: /require artifact_sha256: adult-render/iu,
    },
    {
      name: 'requires pinned adult source revisions',
      value: {
        records: VALID_MANIFEST.records.map((item) =>
          item.id === 'adult-signal'
            ? { ...item, source: { ...item.source, revision: 'LATEST' } }
            : item,
        ),
      },
      error: /pinned.*adult-signal/iu,
    },
    {
      name: 'requires phone labels to cover non-phone labels',
      value: {
        records: VALID_MANIFEST.records.map((item) =>
          item.id === 'adult-real-phone' ? { ...item, ground_truth_labels: ['NORM'] } : item,
        ),
      },
      error: /missing: STTC/iu,
    },
  ];

  it('accepts the strict adult GPU-ready fixture', () => {
    expect(validateAdultEcgGpuTrainingManifest(VALID_MANIFEST)).toEqual(
      validateEcgTrainingManifest(VALID_MANIFEST),
    );
  });

  for (const invalidCase of strictInvalidCases) {
    it(invalidCase.name, () => {
      expect(() => validateAdultEcgGpuTrainingManifest(invalidCase.value)).toThrow(
        invalidCase.error,
      );
    });
  }
});
