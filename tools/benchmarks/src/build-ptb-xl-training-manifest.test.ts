import { describe, expect, it } from 'vitest';

import {
  buildPtbXlTrainingManifest,
  type PtbXlTrainingManifestBuild,
} from './build-ptb-xl-training-manifest';
import { summarizeEcgTrainingManifest } from './ecg-training-manifest';

const PTBXL_DATABASE = `\uFEFFecg_id,patient_id,age,sex,report,scp_codes,strat_fold
1,101.0,45,0,"Normal, sinus rhythm","{'NORM': 100, 'SR': 0}",1
2,102.0,60,1,"Old infarction","{'IMI': 100}",9
3,103.0,55,0,"Acute infarction","{'IMI': 100}",10
4,104.0,40,0,"Ectopy","{'PAC': 100, 'PVC': 100, 'SBRAD': 100}",8
5,105.0,38,1,"Fast irregular rhythm","{'AFIB': 100, 'AFLT': 100, 'STACH': 100}",2
6,106.0,17,0,"Child","{'NORM': 100}",3
7,107.0,,1,"Missing age","{'NORM': 100}",4
8,108.0,not-an-age,0,"Invalid age","{'NORM': 100}",5
9,109.0,50,0,"No supported label","{}",6
`;

const SCP_STATEMENTS = `,Full Name,diagnostic,diagnostic_class
NORM,Normal ECG,1.0,NORM
IMI,Inferior myocardial infarction,1.0,MI
SR,Sinus rhythm,,
PAC,Premature atrial contraction,,
PVC,Premature ventricular contraction,,
SBRAD,Sinus bradycardia,,
AFIB,Atrial fibrillation,,
AFLT,Atrial flutter,,
STACH,Sinus tachycardia,,
`;

const TWELVE_SL_STATEMENTS = `ecg_id,statements
1,"[]"
2,"[]"
3,"[821]"
4,"[]"
5,"[]"
6,"[]"
7,"[]"
8,"[]"
9,"[]"
`;

const TWELVE_SL_MAPPING = `StatementNumber,Acronym,,
821,acute_mi,,
822,acute_mi_2,,
,summary_only,,
`;

function build(): PtbXlTrainingManifestBuild {
  return buildPtbXlTrainingManifest(
    PTBXL_DATABASE,
    SCP_STATEMENTS,
    TWELVE_SL_STATEMENTS,
    TWELVE_SL_MAPPING,
  );
}

describe('PTB-XL training manifest builder', () => {
  it('builds adult-only namespaced records with official labels and split summary inputs', () => {
    const result = build();

    expect(result.excludedCounts).toEqual({
      missingAge: 1,
      invalidAge: 1,
      pediatric: 1,
      unlabeled: 1,
    });
    expect(result.manifest.records).toHaveLength(5);
    expect(result.manifest.records.map((record) => record.split)).toEqual([
      'train',
      'validation',
      'test',
      'train',
      'train',
    ]);
    expect(result.manifest.records.every((record) => record.id.startsWith('ptb-xl:'))).toBe(true);
    expect(
      result.manifest.records.every((record) => record.base_ecg_id.startsWith('ptb-xl:')),
    ).toBe(true);
    expect(result.manifest.records.every((record) => record.patient_id.startsWith('ptb-xl:'))).toBe(
      true,
    );
    expect(result.manifest.records.every((record) => record.age_days === undefined)).toBe(true);
    expect(result.manifest.records[0]?.ground_truth_labels).toEqual(['NORM']);
    expect(result.manifest.records[1]?.ground_truth_labels).toEqual(['Old MI']);
    expect(result.manifest.records[2]?.ground_truth_labels).toEqual(['Acute MI']);
    expect(result.manifest.records[3]?.ground_truth_labels).toEqual(['PAC', 'PVC', 'BRADY']);
    expect(result.manifest.records[4]?.ground_truth_labels).toEqual(['AFIB/AFL', 'TACHY']);
    expect(result.manifest.records[2]?.sex).toBe('male');
    expect(result.manifest.records[1]?.sex).toBe('female');
    expect(summarizeEcgTrainingManifest(result.manifest)).toEqual({
      recordCount: 5,
      bySplit: { train: 3, calibration: 0, validation: 1, test: 1 },
      bySource: { 'PTB-XL/PTB-XL+': 5 },
      byCohort: { adult: 5, pediatric: 0 },
      byInputKind: { signal: 5, render: 0, 'real-phone': 0 },
      byAgeGroup: {
        '0–6d': 0,
        '7–30d': 0,
        '1–3mo': 0,
        '3–6mo': 0,
        '6–12mo': 0,
        '1–3y': 0,
        '3–5y': 0,
        '5–8y': 0,
        '8–12y': 0,
        '12–16y': 0,
        '16–17y': 0,
        '18+': 5,
      },
    });
  });

  it('keeps the validator profile and deterministic source metadata intact', () => {
    const result = build();
    const [first] = result.manifest.records;
    expect(first?.profile).toEqual({
      leads: 12,
      layout: '12x1',
      speed_mm_per_s: 50,
      gain_mm_per_mV: 10,
    });
    expect(first?.source).toEqual({
      dataset: 'PTB-XL/PTB-XL+',
      revision: 'PTB-XL 1.0.3 + PTB-XL+ 1.0.1',
      license: 'CC BY 4.0',
      rights: 'PhysioNet PTB-XL 1.0.3 and PTB-XL+ 1.0.1; retain attribution and identify changes.',
    });
  });

  const invalidCases: readonly {
    readonly name: string;
    readonly database?: string;
    readonly scp?: string;
    readonly statements?: string;
    readonly mapping?: string;
    readonly error: RegExp;
  }[] = [
    {
      name: 'rejects a duplicate metadata ECG id',
      database: `${PTBXL_DATABASE}1,101.0,45,0,"Duplicate","{'NORM': 100}",1\n`,
      error: /duplicates metadata ecg_id/iu,
    },
    {
      name: 'rejects an invalid metadata id',
      database: PTBXL_DATABASE.replace('1,101.0,45', 'bad,101.0,45'),
      error: /invalid id/iu,
    },
    {
      name: 'rejects an invalid fold',
      database: PTBXL_DATABASE.replace(',1\n2,102', ',11\n2,102'),
      error: /invalid strat_fold/iu,
    },
    {
      name: 'rejects a malformed Python-ish SCP dictionary',
      database: PTBXL_DATABASE.replace("{'NORM': 100, 'SR': 0}", "{'NORM': 100"),
      error: /ptbxl_database\.csv line 2 scp_codes.*malformed/iu,
    },
    {
      name: 'rejects a malformed Python-ish 12SL list',
      statements: TWELVE_SL_STATEMENTS.replace('[821]', '[821'),
      error: /12sl_statements\.csv line 4 statements.*malformed/iu,
    },
    {
      name: 'rejects missing required CSV columns',
      scp: ',Full Name,diagnostic\nNORM,Normal ECG,1.0\n',
      error: /scp_statements\.csv is missing required column diagnostic_class/iu,
    },
    {
      name: 'rejects data hidden under an unnamed CSV column',
      mapping: TWELVE_SL_MAPPING.replace('821,acute_mi,,', '821,acute_mi,unexpected,'),
      error: /data in unnamed column/iu,
    },
    {
      name: 'lets the manifest validator catch patient leakage across folds',
      database: PTBXL_DATABASE.replace('2,102.0,60', '2,101.0,60'),
      error: /patient_id.*both.*train.*validation/iu,
    },
  ];

  for (const invalidCase of invalidCases) {
    it(invalidCase.name, () => {
      expect(() =>
        buildPtbXlTrainingManifest(
          invalidCase.database ?? PTBXL_DATABASE,
          invalidCase.scp ?? SCP_STATEMENTS,
          invalidCase.statements ?? TWELVE_SL_STATEMENTS,
          invalidCase.mapping ?? TWELVE_SL_MAPPING,
        ),
      ).toThrow(invalidCase.error);
    });
  }
});
