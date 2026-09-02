import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { ECG_TRAINING_PROFILE } from './ecg-training-manifest';
import {
  evaluateEcgPhotoBenchmark,
  parseEcgPhotoBenchmarkManifest,
  parseEcgPhotoBenchmarkResultFile,
  validateEcgClinicalRealPhoneHoldoutManifest,
  validateEcgRealPhoneDigitizationHoldoutManifest,
  validateEcgRealPhoneHoldoutFiles,
} from './evaluate-ecg-photo-benchmark';

function fixture(
  caseId: string,
  expectedQuality: 'usable' | 'review' | undefined,
  expectedCodes: readonly string[] = [],
) {
  return {
    case_id: caseId,
    fixture_kind: 'quality-only' as const,
    labels: [],
    local_file: `${caseId}.png`,
    title: caseId,
    ...(expectedQuality === undefined ? {} : { expected_quality: expectedQuality }),
    ...(expectedCodes.length === 0
      ? {}
      : { expected_photo_quality_codes: expectedCodes, forbid_usable: true }),
  };
}

function manifestValue() {
  return {
    dataset_id: 'ecg-photo-test',
    cases: [
      {
        ...fixture('calibrated-1', 'usable'),
        reference_rr_ms: 1_000,
        reference_heart_rate_bpm: 60,
      },
      {
        ...fixture('calibrated-2', 'usable'),
        reference_rr_ms: 1_000,
        reference_heart_rate_bpm: 60,
      },
      fixture('blur-negative', undefined, ['blur']),
      fixture('glare-negative', 'review', ['glare']),
    ],
  };
}

function resultValue(blurPromoted = false) {
  return {
    schema_version: 1,
    dataset_id: 'ecg-photo-test',
    results: [
      {
        case_id: 'calibrated-1',
        quality: 'usable',
        photo_quality_issue_codes: [],
        layout: '12x1',
        lead_count: 12,
        rhythm_coverage: 0.95,
        duration_seconds: 5,
        rr_ms: 980,
        heart_rate_bpm: 61,
      },
      {
        case_id: 'calibrated-2',
        quality: 'usable',
        photo_quality_issue_codes: [],
        layout: '12x1',
        lead_count: 10,
        rhythm_coverage: 0.8,
        duration_seconds: 5,
        rr_ms: 1_020,
        heart_rate_bpm: 59,
      },
      {
        case_id: 'blur-negative',
        quality: blurPromoted ? 'usable' : 'review',
        photo_quality_issue_codes: ['blur'],
        layout: '12x1',
        lead_count: 12,
        rhythm_coverage: 0.7,
        duration_seconds: 5,
      },
      {
        case_id: 'glare-negative',
        quality: 'review',
        photo_quality_issue_codes: ['glare'],
        layout: '12x1',
        lead_count: 8,
        rhythm_coverage: 0.4,
        duration_seconds: 5,
      },
    ],
  };
}

describe('ECG photo benchmark evaluator', () => {
  it('passes calibrated positives and blur/glare negatives, then rejects unsafe promotion', () => {
    const manifest = parseEcgPhotoBenchmarkManifest(manifestValue());
    const passing = evaluateEcgPhotoBenchmark(
      manifest,
      parseEcgPhotoBenchmarkResultFile(resultValue()),
    );
    expect(passing).toMatchObject({
      passed: true,
      result_count: 4,
      expected_case_count: 4,
      failures: [],
      quality_counts: { usable: 2, review: 2, failed: 0 },
      photo_quality_issue_counts: {
        blur: 1,
        'cropped-paper': 0,
        glare: 1,
        'missing-calibration': 0,
      },
      digitization_metrics: {
        structured_result_count: 4,
        mean_lead_count: 10.5,
        mean_rhythm_coverage: 0.7125,
        rr_result_count: 2,
        heart_rate_result_count: 2,
        rr_reference_count: 2,
        rr_mae_ms: 20,
        heart_rate_reference_count: 2,
        heart_rate_mae_bpm: 1,
      },
    });

    const unsafe = evaluateEcgPhotoBenchmark(
      manifest,
      parseEcgPhotoBenchmarkResultFile(resultValue(true)),
    );
    expect(unsafe.passed).toBe(false);
    expect(unsafe.failures).toContainEqual(
      expect.objectContaining({ case_id: 'blur-negative', code: 'unsafe-promotion' }),
    );

    const missingResult = evaluateEcgPhotoBenchmark(manifest, {
      ...parseEcgPhotoBenchmarkResultFile(resultValue()),
      results: parseEcgPhotoBenchmarkResultFile(resultValue()).results.slice(0, 3),
    });
    expect(missingResult.failures).toContainEqual(
      expect.objectContaining({ case_id: 'glare-negative', code: 'missing-result' }),
    );

    const missingMeasurementValue = resultValue();
    delete missingMeasurementValue.results[0]?.rr_ms;
    const missingMeasurement = evaluateEcgPhotoBenchmark(
      manifest,
      parseEcgPhotoBenchmarkResultFile(missingMeasurementValue),
    );
    expect(missingMeasurement.failures).toContainEqual(
      expect.objectContaining({
        case_id: 'calibrated-1',
        code: 'missing-reference-measurement',
      }),
    );
  });

  it('rejects malformed structured measurements and references', () => {
    expect(() =>
      parseEcgPhotoBenchmarkResultFile({
        schema_version: 1,
        dataset_id: 'bad',
        results: [{ case_id: 'bad', quality: 'usable', lead_count: 11.5 }],
      }),
    ).toThrow(/lead_count.*integer/iu);
    expect(() =>
      parseEcgPhotoBenchmarkResultFile({
        schema_version: 1,
        dataset_id: 'bad',
        results: [{ case_id: 'bad', quality: 'usable', rhythm_coverage: 1.1 }],
      }),
    ).toThrow(/rhythm_coverage.*at most 1/iu);
    expect(() =>
      parseEcgPhotoBenchmarkManifest({
        dataset_id: 'bad',
        cases: [{ ...fixture('bad', 'usable'), reference_rr_ms: 0 }],
      }),
    ).toThrow(/reference_rr_ms.*greater than 0/iu);
  });

  it('validates immutable real-phone holdout provenance and file bytes', () => {
    const bytes = Buffer.from('phone-photo-fixture');
    const signalBytes = Buffer.from('reference-signal-fixture');
    const artifactSha256 = createHash('sha256').update(bytes).digest('hex');
    const referenceSignalSha256 = createHash('sha256').update(signalBytes).digest('hex');
    const value = {
      dataset_id: 'local-real-phone-holdout-v1',
      revision: '2026-09-01-v1',
      license: 'owner permission',
      rights: 'test-only; no redistribution',
      test_only: true,
      profile: ECG_TRAINING_PROFILE,
      cases: [
        {
          case_id: 'phone-1',
          fixture_kind: 'quality-only',
          labels: [],
          local_file: 'phone-1.png',
          title: 'Phone capture 1',
          source_kind: 'real-phone',
          artifact_sha256: artifactSha256,
          base_ecg_id: 'base-1',
          is_patient_data: false,
          capture_device: 'iPhone test device',
          capture_condition: 'room light',
          reference_signal_file: 'signal.json',
          reference_signal_sha256: referenceSignalSha256,
          reference_rr_ms: 1_000,
        },
      ],
    };
    const manifest = validateEcgRealPhoneDigitizationHoldoutManifest(value);
    const directory = mkdtempSync(join(tmpdir(), 'minimed-real-phone-holdout-'));
    try {
      writeFileSync(join(directory, 'phone-1.png'), bytes);
      writeFileSync(join(directory, 'signal.json'), signalBytes);
      expect(() => validateEcgRealPhoneHoldoutFiles(directory, manifest)).not.toThrow();
      writeFileSync(join(directory, 'phone-1.png'), 'changed');
      expect(() => validateEcgRealPhoneHoldoutFiles(directory, manifest)).toThrow(
        /SHA-256 mismatch/iu,
      );
      writeFileSync(join(directory, 'phone-1.png'), bytes);
      writeFileSync(join(directory, 'signal.json'), 'changed');
      expect(() => validateEcgRealPhoneHoldoutFiles(directory, manifest)).toThrow(
        /Reference signal SHA-256 mismatch/iu,
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }

    expect(() =>
      validateEcgRealPhoneDigitizationHoldoutManifest({ ...value, revision: 'LATEST' }),
    ).toThrow(/pinned revision/iu);
    expect(() =>
      validateEcgRealPhoneDigitizationHoldoutManifest({
        ...value,
        cases: [{ ...value.cases[0], capture_device: undefined }],
      }),
    ).toThrow(/capture device.*phone-1/iu);
    expect(() => validateEcgClinicalRealPhoneHoldoutManifest(value)).toThrow(
      /classification labels.*phone-1/iu,
    );
    expect(() =>
      validateEcgClinicalRealPhoneHoldoutManifest({
        ...value,
        cases: [
          {
            ...value.cases[0],
            fixture_kind: 'classification',
            labels: ['NORM'],
            is_patient_data: true,
            patient_id: 'patient-1',
          },
        ],
      }),
    ).not.toThrow();
    expect(() =>
      parseEcgPhotoBenchmarkManifest({
        ...value,
        cases: [{ ...value.cases[0], local_file: '../escape.png' }],
      }),
    ).toThrow(/relative path/iu);
  });
});
