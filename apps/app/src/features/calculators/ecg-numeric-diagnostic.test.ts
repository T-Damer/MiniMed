import { describe, expect, it } from 'vitest';

import type { EcgModelCatalogItem } from '@/features/calculators/ecg-model';
import {
  ECG_DIAGNOSTIC_MODEL_CATALOG,
  ECG_NUMERIC_FEATURES,
  validateEcgDiagnosticModelFiles,
  verifyEcgDiagnosticModelDownload,
} from '@/features/calculators/ecg-numeric-diagnostic';
import {
  inferEcgNumericDiagnostic,
  parseEcgNumericDiagnosticPack,
} from '@/features/calculators/ecg-numeric-inference';

const encode = (value: string): Uint8Array => new TextEncoder().encode(value);

function validFiles(): Map<string, Uint8Array> {
  const classIds = ['NORM', 'MI', 'STTC', 'CD', 'HYP'];
  return new Map([
    [
      'minimed-ecg-diagnostic-pack.json',
      encode(
        JSON.stringify({
          format: 'minimed-ecg-diagnostic-pack',
          formatVersion: 1,
          kind: 'numeric-diagnostic',
          license: 'CC BY 4.0',
          minimumAgeYears: 18,
          name: 'Test numeric ECG',
          source: 'PTB-XL+',
          version: '1',
        }),
      ),
    ],
    [
      'hgb-model.json',
      encode(
        JSON.stringify({
          format: 'minimed-ecg-numeric-diagnostic',
          formatVersion: 1,
          version: '1',
          population: { minimumAgeYears: 18 },
          features: ECG_NUMERIC_FEATURES.map(({ id, unit }) => ({ id, unit })),
          classes: classIds.map((id) => ({
            id,
            label: id,
            threshold: 0.5,
            abstentionMargin: 0.1,
            calibrationCoefficient: 1,
            calibrationIntercept: 0,
          })),
          models: classIds.map(() => ({
            baseline: 0,
            trees: [[[0, 0, 0, false, 0, 0, true]]],
          })),
        }),
      ),
    ],
  ]);
}

describe('numeric ECG diagnostic pack', () => {
  it('validates the fixed adult feature and class contract', () => {
    expect(validateEcgDiagnosticModelFiles(validFiles())).toMatchObject({
      manifest: { name: 'Test numeric ECG', minimumAgeYears: 18 },
    });

    const incompatible = validFiles();
    incompatible.set(
      'hgb-model.json',
      encode(
        JSON.stringify({
          format: 'minimed-ecg-numeric-diagnostic',
          formatVersion: 1,
          population: { minimumAgeYears: 18 },
          features: [],
          classes: [],
          models: [],
        }),
      ),
    );
    expect(() => validateEcgDiagnosticModelFiles(incompatible)).toThrow('набор признаков');

    const mismatched = validFiles();
    const manifest = JSON.parse(
      new TextDecoder().decode(mismatched.get('minimed-ecg-diagnostic-pack.json')),
    );
    mismatched.set(
      'minimed-ecg-diagnostic-pack.json',
      encode(JSON.stringify({ ...manifest, version: '2' })),
    );
    expect(() => validateEcgDiagnosticModelFiles(mismatched)).toThrow('Версии манифеста');
  });

  it('publishes only the verified adult numeric model', async () => {
    expect(ECG_DIAGNOSTIC_MODEL_CATALOG).toHaveLength(1);
    expect(ECG_DIAGNOSTIC_MODEL_CATALOG[0]).toMatchObject({
      id: 'ptb-xl-plus-numeric-adult-2026-2',
      version: '2026.2',
      downloadBytes: 261_070,
    });

    const fixture: EcgModelCatalogItem = {
      id: 'fixture',
      name: 'Fixture',
      description: 'Fixture',
      version: '1',
      license: 'CC BY 4.0',
      sourceUrl: 'https://example.test/source',
      bundleUrl: 'https://example.test/model.zip',
      bundleSha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      downloadBytes: 3,
    };
    await expect(verifyEcgDiagnosticModelDownload(fixture, encode('abc'))).resolves.toBeInstanceOf(
      ArrayBuffer,
    );
    await expect(verifyEcgDiagnosticModelDownload(fixture, encode('abd'))).rejects.toThrow(
      'Контрольная сумма',
    );
  });

  it('runs the same validated tree inference used by the benchmark', () => {
    const model = validFiles().get('hgb-model.json');
    if (!model) throw new Error('Missing numeric ECG test model.');
    const pack = parseEcgNumericDiagnosticPack(model);
    const estimates = inferEcgNumericDiagnostic(
      pack.classes,
      pack.models,
      ECG_NUMERIC_FEATURES.map(() => 0),
    );

    expect(estimates).toHaveLength(5);
    expect(estimates[0]).toMatchObject({ id: 'NORM', status: 'positive', threshold: 0.5 });
    expect(estimates[0]?.probability).toBeCloseTo(0.622459, 5);
  });

  it('supports asymmetric safety thresholds in format version 2', () => {
    const files = validFiles();
    const bytes = files.get('hgb-model.json');
    if (!bytes) throw new Error('Missing numeric ECG test model.');
    const model = JSON.parse(new TextDecoder().decode(bytes)) as {
      classes: Record<string, unknown>[];
      formatVersion: number;
    };
    model.formatVersion = 2;
    model.classes = model.classes.map((classConfig) => ({
      ...classConfig,
      abstentionMargin: undefined,
      negativeThreshold: 0.1,
      positiveThreshold: 0.8,
    }));
    const v2 = encode(JSON.stringify(model));
    files.set('hgb-model.json', v2);

    expect(validateEcgDiagnosticModelFiles(files).manifest.version).toBe('1');
    const pack = parseEcgNumericDiagnosticPack(v2);
    const row = ECG_NUMERIC_FEATURES.map(() => 0);
    const estimate = inferEcgNumericDiagnostic(pack.classes, pack.models, row)[0];
    expect(estimate).toMatchObject({ id: 'NORM', status: 'uncertain' });
    if (!estimate) throw new Error('Missing numeric ECG estimate.');
    expect(
      inferEcgNumericDiagnostic(
        pack.classes.map((classConfig, index) =>
          index === 0
            ? {
                ...classConfig,
                threshold: 0.7,
                negativeThreshold: estimate.probability,
              }
            : classConfig,
        ),
        pack.models,
        row,
      )[0]?.status,
    ).toBe('negative');
    expect(
      inferEcgNumericDiagnostic(
        pack.classes.map((classConfig, index) =>
          index === 0 ? { ...classConfig, positiveThreshold: estimate.probability } : classConfig,
        ),
        pack.models,
        row,
      )[0]?.status,
    ).toBe('positive');
  });
});
