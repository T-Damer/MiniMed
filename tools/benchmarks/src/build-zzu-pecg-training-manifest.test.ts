import { describe, expect, it } from 'vitest';
import {
  buildZzuPecgTrainingManifest,
  type ZzuPecgTrainingManifestBuild,
} from './build-zzu-pecg-training-manifest';
import { summarizeEcgTrainingManifest } from './ecg-training-manifest';

const ATTRIBUTES = `\uFEFFFilename,ECG_ID,Patient_ID,Age,Gender,Acquisition_date,Sampling_point,Lead,AHA_code,CHN_code,ICD-10 code,pSQI,basSQI,bSQI\r
"lead,one.mat",ECG-1,PAT-1,10d,Female,2020-01-01,1000,12,"'AHA1'; 'AHA1'","'CHN1'; 'CHN1'","'I10'; 'I10'",0.1,0.2,0.3\r
lead-two.mat,ECG-2,PAT-1,572d,Male,2020-01-02,1000,12,"'AHA2'",,"'I20'",0.1,0.2,0.3\r
lead-three.mat,ECG-3,PAT-2,5474d,Other,2020-01-03,1000,12,,"'ambiguous prose'",,0.1,0.2,0.3\r
lead-four.mat,ECG-4,PAT-3,100d,Female,2020-01-04,1000,9,"'AHA9'",,"'I40'",0.1,0.2,0.3\r
lead-five.mat,ECG-5,PAT-4,6570d,Female,2020-01-05,1000,12,"'AHA5'",,"'I50'",0.1,0.2,0.3\r
`;

function build(): ZzuPecgTrainingManifestBuild {
  return buildZzuPecgTrainingManifest(ATTRIBUTES);
}

describe('ZZU-pECG training manifest builder', () => {
  it('keeps twelve-lead pediatric records with exact source-native labels', () => {
    const result = build();

    expect(result.excludedCounts).toEqual({ nineLead: 1, nonPediatric: 1 });
    expect(result.manifest.records).toHaveLength(3);
    expect(result.manifest.records.map((record) => record.age_days)).toEqual([10, 572, 5474]);
    expect(result.manifest.records.map((record) => record.ground_truth_labels)).toEqual([
      [],
      [],
      [],
    ]);
    expect(result.manifest.records[0]?.source_label_codes).toEqual([
      'AHA:AHA1',
      'CHN:CHN1',
      'ICD10:I10',
    ]);
    expect(result.manifest.records[2]?.source_label_codes).toEqual(['CHN:ambiguous prose']);
    expect(result.manifest.records[0]?.sex).toBe('female');
    expect(result.manifest.records[1]?.sex).toBe('male');
    expect(result.manifest.records[2]?.sex).toBe('unknown');
    expect(result.manifest.records.every((record) => record.cohort === 'pediatric')).toBe(true);
    expect(result.manifest.records.every((record) => record.input_kind === 'signal')).toBe(true);
    expect(result.manifest.records.every((record) => record.profile.leads === 12)).toBe(true);
    expect(result.manifest.records[0]?.id).toBe('zzu-pecg:record:ECG-1');
    expect(result.manifest.records[0]?.base_ecg_id).toBe('zzu-pecg:base:ECG-1');
    expect(result.manifest.records[0]?.patient_id).toBe('zzu-pecg:patient:PAT-1');

    const samePatient = result.manifest.records.filter(
      (record) => record.patient_id === 'zzu-pecg:patient:PAT-1',
    );
    expect(new Set(samePatient.map((record) => record.split))).toHaveLength(1);
  });

  it('uses a deterministic patient split and summary', () => {
    const first = build();
    const second = build();
    expect(first.manifest.records.map(({ id, split }) => ({ id, split }))).toEqual(
      second.manifest.records.map(({ id, split }) => ({ id, split })),
    );

    const summary = summarizeEcgTrainingManifest(first.manifest);
    expect(summary).toEqual(summarizeEcgTrainingManifest(second.manifest));
    expect(summary.recordCount).toBe(3);
    expect(summary.bySource).toEqual({ 'ZZU-pECG': 3 });
    expect(summary.byCohort).toEqual({ adult: 0, pediatric: 3 });
    expect(summary.byInputKind).toEqual({ signal: 3, render: 0, 'real-phone': 0 });
    expect(summary.byAgeGroup['7–30d']).toBe(1);
    expect(summary.byAgeGroup['1–3y']).toBe(1);
    expect(summary.byAgeGroup['12–16y']).toBe(1);
    expect(Object.values(summary.bySplit).reduce((total, count) => total + count, 0)).toBe(3);
  });

  it('keeps source and profile metadata fixed', () => {
    const [record] = build().manifest.records;
    expect(record?.source).toEqual({
      dataset: 'ZZU-pECG',
      revision: 'Figshare 27078763 v1',
      license: 'CC BY 4.0',
      rights: 'ZZU-pECG v1 (Figshare 27078763); retain CC BY 4.0 attribution and identify changes.',
    });
    expect(record?.profile).toEqual({
      leads: 12,
      layout: '12x1',
      speed_mm_per_s: 50,
      gain_mm_per_mV: 10,
    });
  });

  const invalidCases: readonly { name: string; attributes: string; error: RegExp }[] = [
    {
      name: 'rejects a malformed age',
      attributes: ATTRIBUTES.replace('10d', 'ten'),
      error: /AttributesDictionary\.csv line 2 has invalid Age/iu,
    },
    {
      name: 'rejects a missing age',
      attributes: ATTRIBUTES.replace('10d', ''),
      error: /AttributesDictionary\.csv line 2 .*Age must be non-empty/iu,
    },
    {
      name: 'rejects a duplicate ECG id',
      attributes: ATTRIBUTES.replace('ECG-2,PAT-1', 'ECG-1,PAT-1'),
      error: /duplicates ECG_ID/iu,
    },
    {
      name: 'rejects missing required columns',
      attributes:
        '\uFEFFFilename,ECG_ID,Patient_ID,Age,Gender\r\nfile.mat,ECG-1,PAT-1,10d,Female\r\n',
      error: /AttributesDictionary\.csv is missing required column Lead/iu,
    },
    {
      name: 'rejects a record without source-native labels',
      attributes: ATTRIBUTES.replace(
        "\"'AHA1'; 'AHA1'\",\"'CHN1'; 'CHN1'\",\"'I10'; 'I10'\"",
        ',,',
      ),
      error: /must contain at least one source label code/iu,
    },
  ];

  for (const invalidCase of invalidCases) {
    it(invalidCase.name, () => {
      expect(() => buildZzuPecgTrainingManifest(invalidCase.attributes)).toThrow(invalidCase.error);
    });
  }
});
