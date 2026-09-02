// biome-ignore-all lint/complexity/useLiteralKeys: validated unknown records require bracket access.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ECG_IMAGE_LABELS, type EcgImageLabel } from './ecg-image-dataset';
import { ECG_TRAINING_PROFILE, type EcgTrainingProfile } from './ecg-training-manifest';

export const ECG_PHOTO_QUALITIES = ['usable', 'review', 'failed'] as const;
export type EcgPhotoQuality = (typeof ECG_PHOTO_QUALITIES)[number];
export const ECG_PHOTO_LAYOUTS = ['12x1', '3x4+1R'] as const;
export type EcgPhotoLayout = (typeof ECG_PHOTO_LAYOUTS)[number];
export const ECG_PHOTO_SOURCE_KINDS = ['real-phone', 'scan', 'synthetic'] as const;
export type EcgPhotoSourceKind = (typeof ECG_PHOTO_SOURCE_KINDS)[number];

export const ECG_PHOTO_QUALITY_ISSUE_CODES = [
  'blur',
  'cropped-paper',
  'glare',
  'missing-calibration',
] as const;
export type EcgPhotoQualityIssueCode = (typeof ECG_PHOTO_QUALITY_ISSUE_CODES)[number];

export interface EcgPhotoBenchmarkCase {
  readonly artifact_sha256?: string;
  readonly base_ecg_id?: string;
  readonly case_id: string;
  readonly capture_condition?: string;
  readonly capture_device?: string;
  readonly fixture_kind: 'classification' | 'quality-only';
  readonly labels: readonly EcgImageLabel[];
  readonly local_file: string;
  readonly patient_id?: string;
  readonly is_patient_data?: boolean;
  readonly reference_signal_file?: string;
  readonly reference_signal_sha256?: string;
  readonly source_kind?: EcgPhotoSourceKind;
  readonly title: string;
  readonly expected_quality?: EcgPhotoQuality;
  readonly forbid_usable?: boolean;
  readonly expected_photo_quality_codes?: readonly EcgPhotoQualityIssueCode[];
  readonly reference_rr_ms?: number;
  readonly reference_heart_rate_bpm?: number;
}

export interface EcgPhotoBenchmarkManifest {
  readonly dataset_id: string;
  readonly revision?: string;
  readonly license?: string;
  readonly rights?: string;
  readonly test_only?: boolean;
  readonly profile?: EcgTrainingProfile;
  readonly cases: readonly EcgPhotoBenchmarkCase[];
}

export interface EcgPhotoBenchmarkResult {
  readonly case_id: string;
  readonly quality: EcgPhotoQuality;
  readonly fixture_kind?: EcgPhotoBenchmarkCase['fixture_kind'];
  readonly labels?: readonly string[];
  readonly title?: string;
  readonly elapsed_ms?: number;
  readonly meta?: readonly string[];
  readonly photo_quality_issues?: readonly string[];
  readonly photo_quality_issue_codes?: readonly EcgPhotoQualityIssueCode[];
  readonly reasons?: readonly string[];
  readonly error?: string | null;
  readonly rectified_primary?: boolean;
  readonly layout?: EcgPhotoLayout;
  readonly lead_count?: number;
  readonly rhythm_coverage?: number;
  readonly duration_seconds?: number;
  readonly rr_ms?: number;
  readonly heart_rate_bpm?: number;
}

export interface EcgPhotoBenchmarkResultFile {
  readonly schema_version: 1;
  readonly dataset_id: string;
  readonly measured_at?: string;
  readonly results: readonly EcgPhotoBenchmarkResult[];
}

export type EcgPhotoBenchmarkFailureCode =
  | 'dataset-id-mismatch'
  | 'no-results'
  | 'unknown-case'
  | 'missing-result'
  | 'quality-mismatch'
  | 'missing-quality-issue-code'
  | 'missing-reference-measurement'
  | 'unsafe-promotion';

export interface EcgPhotoBenchmarkFailure {
  readonly case_id: string;
  readonly code: EcgPhotoBenchmarkFailureCode;
  readonly message: string;
}

export interface EcgPhotoBenchmarkSummary {
  readonly schema_version: 1;
  readonly dataset_id: string;
  readonly result_count: number;
  readonly expected_case_count: number;
  readonly passed: boolean;
  readonly failures: readonly EcgPhotoBenchmarkFailure[];
  readonly quality_counts: Readonly<Record<EcgPhotoQuality, number>>;
  readonly photo_quality_issue_counts: Readonly<Record<EcgPhotoQualityIssueCode, number>>;
  readonly digitization_metrics: {
    readonly structured_result_count: number;
    readonly mean_lead_count: number | null;
    readonly mean_rhythm_coverage: number | null;
    readonly rr_result_count: number;
    readonly heart_rate_result_count: number;
    readonly rr_reference_count: number;
    readonly rr_mae_ms: number | null;
    readonly heart_rate_reference_count: number;
    readonly heart_rate_mae_bpm: number | null;
  };
}

const ISSUE_CODE_SET = new Set<string>(ECG_PHOTO_QUALITY_ISSUE_CODES);
const IMAGE_LABEL_SET = new Set<string>(ECG_IMAGE_LABELS);
const ARTIFACT_SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const UNPINNED_REVISIONS = new Set(['head', 'latest', 'main', 'master', 'unknown']);
const BLOCKING_ISSUE_CODES = new Set<EcgPhotoQualityIssueCode>([
  'blur',
  'glare',
  'missing-calibration',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${path} must be a non-empty string.`);
  }
  return value.trim();
}

function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, path);
}

function optionalBoolean(value: unknown, path: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new Error(`${path} must be a boolean.`);
  return value;
}

function localFile(value: unknown, path: string): string {
  const file = requiredString(value, path);
  if (isAbsolute(file) || /^[a-z]:[\\/]/iu.test(file) || file.split(/[\\/]/u).includes('..')) {
    throw new Error(`${path} must be a relative path inside the benchmark directory.`);
  }
  return file;
}

function optionalArtifactSha256(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !ARTIFACT_SHA256_PATTERN.test(value)) {
    throw new Error(`${path} must be exactly 64 lowercase hexadecimal characters.`);
  }
  return value;
}

function optionalProfile(value: unknown, path: string): EcgTrainingProfile | undefined {
  if (value === undefined) return undefined;
  if (
    !isRecord(value) ||
    value['leads'] !== ECG_TRAINING_PROFILE.leads ||
    value['layout'] !== ECG_TRAINING_PROFILE.layout ||
    value['speed_mm_per_s'] !== ECG_TRAINING_PROFILE.speed_mm_per_s ||
    value['gain_mm_per_mV'] !== ECG_TRAINING_PROFILE.gain_mm_per_mV
  ) {
    throw new Error(`${path} must use the fixed 12-lead 12x1 50 mm/s 10 mm/mV profile.`);
  }
  return ECG_TRAINING_PROFILE;
}

function enumValue<T extends string>(value: unknown, values: readonly T[], path: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    throw new Error(`${path} has an unsupported value.`);
  }
  return value as T;
}

function optionalEnum<T extends string>(
  value: unknown,
  values: readonly T[],
  path: string,
): T | undefined {
  return value === undefined ? undefined : enumValue(value, values, path);
}

function optionalStringArray(value: unknown, path: string): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${path} must be an array of strings.`);
  }
  return value.map((item) => requiredString(item, `${path}[]`));
}

function optionalFiniteNumber(
  value: unknown,
  path: string,
  options: {
    readonly minExclusive?: number;
    readonly minInclusive?: number;
    readonly max?: number;
  } = {},
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number.`);
  }
  if (options.minExclusive !== undefined && value <= options.minExclusive) {
    throw new Error(`${path} must be greater than ${options.minExclusive}.`);
  }
  if (options.minInclusive !== undefined && value < options.minInclusive) {
    throw new Error(`${path} must be at least ${options.minInclusive}.`);
  }
  if (options.max !== undefined && value > options.max) {
    throw new Error(`${path} must be at most ${options.max}.`);
  }
  return value;
}

function optionalIssueCodes(
  value: unknown,
  path: string,
): readonly EcgPhotoQualityIssueCode[] | undefined {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== 'string' || !ISSUE_CODE_SET.has(item))
  ) {
    throw new Error(`${path} must contain only known ECG photo quality issue codes.`);
  }
  const codes = value as EcgPhotoQualityIssueCode[];
  if (new Set(codes).size !== codes.length) throw new Error(`${path} must not contain duplicates.`);
  return codes;
}

function parseExpectedFields(
  value: Record<string, unknown>,
  path: string,
): Pick<
  EcgPhotoBenchmarkCase,
  | 'expected_quality'
  | 'forbid_usable'
  | 'expected_photo_quality_codes'
  | 'reference_rr_ms'
  | 'reference_heart_rate_bpm'
> {
  const expectedQuality = optionalEnum(
    value['expected_quality'],
    ECG_PHOTO_QUALITIES,
    `${path}.expected_quality`,
  );
  const forbidUsable = value['forbid_usable'];
  if (forbidUsable !== undefined && typeof forbidUsable !== 'boolean') {
    throw new Error(`${path}.forbid_usable must be a boolean.`);
  }
  const expectedPhotoQualityCodes = optionalIssueCodes(
    value['expected_photo_quality_codes'],
    `${path}.expected_photo_quality_codes`,
  );
  const referenceRrMs = optionalFiniteNumber(value['reference_rr_ms'], `${path}.reference_rr_ms`, {
    minExclusive: 0,
  });
  const referenceHeartRateBpm = optionalFiniteNumber(
    value['reference_heart_rate_bpm'],
    `${path}.reference_heart_rate_bpm`,
    { minExclusive: 0 },
  );
  return {
    ...(expectedQuality === undefined ? {} : { expected_quality: expectedQuality }),
    ...(forbidUsable === undefined ? {} : { forbid_usable: forbidUsable }),
    ...(expectedPhotoQualityCodes === undefined
      ? {}
      : { expected_photo_quality_codes: expectedPhotoQualityCodes }),
    ...(referenceRrMs === undefined ? {} : { reference_rr_ms: referenceRrMs }),
    ...(referenceHeartRateBpm === undefined
      ? {}
      : { reference_heart_rate_bpm: referenceHeartRateBpm }),
  };
}

export function parseEcgPhotoBenchmarkManifest(value: unknown): EcgPhotoBenchmarkManifest {
  if (!isRecord(value) || !Array.isArray(value['cases'])) {
    throw new Error('ECG photo benchmark manifest must contain cases.');
  }
  const cases = value['cases'].map((rawCase, index) => {
    const path = `cases[${index}]`;
    if (!isRecord(rawCase)) throw new Error(`${path} must be an object.`);
    const fixtureKind = enumValue(
      rawCase['fixture_kind'],
      ['classification', 'quality-only'] as const,
      `${path}.fixture_kind`,
    );
    if (
      !Array.isArray(rawCase['labels']) ||
      rawCase['labels'].some((label) => typeof label !== 'string' || !IMAGE_LABEL_SET.has(label))
    ) {
      throw new Error(`${path}.labels must contain only ECG image labels.`);
    }
    const labels = rawCase['labels'] as readonly EcgImageLabel[];
    if (fixtureKind === 'classification' && labels.length === 0) {
      throw new Error(`${path}.labels is required for a classification case.`);
    }
    if (fixtureKind === 'quality-only' && labels.length > 0) {
      throw new Error(`${path}.labels must be empty for a quality-only case.`);
    }
    const artifactSha256 = optionalArtifactSha256(
      rawCase['artifact_sha256'],
      `${path}.artifact_sha256`,
    );
    const baseEcgId = optionalString(rawCase['base_ecg_id'], `${path}.base_ecg_id`);
    const captureCondition = optionalString(
      rawCase['capture_condition'],
      `${path}.capture_condition`,
    );
    const captureDevice = optionalString(rawCase['capture_device'], `${path}.capture_device`);
    const patientId = optionalString(rawCase['patient_id'], `${path}.patient_id`);
    const isPatientData = optionalBoolean(rawCase['is_patient_data'], `${path}.is_patient_data`);
    const referenceSignalFile =
      rawCase['reference_signal_file'] === undefined
        ? undefined
        : localFile(rawCase['reference_signal_file'], `${path}.reference_signal_file`);
    const referenceSignalSha256 = optionalArtifactSha256(
      rawCase['reference_signal_sha256'],
      `${path}.reference_signal_sha256`,
    );
    const sourceKind = optionalEnum(
      rawCase['source_kind'],
      ECG_PHOTO_SOURCE_KINDS,
      `${path}.source_kind`,
    );
    return {
      ...(artifactSha256 === undefined ? {} : { artifact_sha256: artifactSha256 }),
      ...(baseEcgId === undefined ? {} : { base_ecg_id: baseEcgId }),
      case_id: requiredString(rawCase['case_id'], `${path}.case_id`),
      ...(captureCondition === undefined ? {} : { capture_condition: captureCondition }),
      ...(captureDevice === undefined ? {} : { capture_device: captureDevice }),
      fixture_kind: fixtureKind,
      labels,
      local_file: localFile(rawCase['local_file'], `${path}.local_file`),
      ...(patientId === undefined ? {} : { patient_id: patientId }),
      ...(isPatientData === undefined ? {} : { is_patient_data: isPatientData }),
      ...(referenceSignalFile === undefined ? {} : { reference_signal_file: referenceSignalFile }),
      ...(referenceSignalSha256 === undefined
        ? {}
        : { reference_signal_sha256: referenceSignalSha256 }),
      ...(sourceKind === undefined ? {} : { source_kind: sourceKind }),
      title: requiredString(rawCase['title'], `${path}.title`),
      ...parseExpectedFields(rawCase, path),
    };
  });
  if (cases.length === 0) throw new Error('ECG photo benchmark manifest is empty.');
  if (new Set(cases.map((fixture) => fixture.case_id)).size !== cases.length) {
    throw new Error('ECG photo benchmark case IDs must be unique.');
  }
  const revision = optionalString(value['revision'], 'revision');
  const license = optionalString(value['license'], 'license');
  const rights = optionalString(value['rights'], 'rights');
  const testOnly = value['test_only'];
  if (testOnly !== undefined && typeof testOnly !== 'boolean') {
    throw new Error('test_only must be a boolean.');
  }
  const profile = optionalProfile(value['profile'], 'profile');
  return {
    dataset_id: requiredString(value['dataset_id'], 'dataset_id'),
    ...(revision === undefined ? {} : { revision }),
    ...(license === undefined ? {} : { license }),
    ...(rights === undefined ? {} : { rights }),
    ...(testOnly === undefined ? {} : { test_only: testOnly }),
    ...(profile === undefined ? {} : { profile }),
    cases,
  };
}

export const validateEcgPhotoBenchmarkManifest = parseEcgPhotoBenchmarkManifest;

export function validateEcgRealPhoneDigitizationHoldoutManifest(
  value: unknown,
): EcgPhotoBenchmarkManifest {
  const manifest = parseEcgPhotoBenchmarkManifest(value);
  if (!manifest.revision || UNPINNED_REVISIONS.has(manifest.revision.toLowerCase())) {
    throw new Error('Real-phone holdout requires a pinned revision.');
  }
  if (!manifest.license || !manifest.rights) {
    throw new Error('Real-phone holdout requires license and rights metadata.');
  }
  if (manifest.test_only !== true) throw new Error('Real-phone holdout must be test_only.');
  if (manifest.profile !== ECG_TRAINING_PROFILE) {
    throw new Error('Real-phone holdout requires the fixed 12x1 50 mm/s 10 mm/mV profile.');
  }

  const missing: string[] = [];
  for (const fixture of manifest.cases) {
    if (
      fixture.source_kind !== 'real-phone' ||
      !fixture.artifact_sha256 ||
      !fixture.base_ecg_id ||
      !fixture.capture_device ||
      !fixture.capture_condition ||
      fixture.is_patient_data === undefined ||
      !fixture.reference_signal_file ||
      !fixture.reference_signal_sha256 ||
      (fixture.reference_rr_ms === undefined && fixture.reference_heart_rate_bpm === undefined)
    ) {
      missing.push(fixture.case_id);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `Real-phone digitization cases require real-phone provenance, image/reference SHA-256, base ECG ID, capture device/condition, explicit patient-data status, and an independent RR or heart-rate reference: ${missing.sort().join(', ')}.`,
    );
  }
  const checksums = manifest.cases.map((fixture) => fixture.artifact_sha256);
  if (new Set(checksums).size !== checksums.length) {
    throw new Error('Real-phone holdout artifact_sha256 values must be unique.');
  }
  return manifest;
}

export function validateEcgClinicalRealPhoneHoldoutManifest(
  value: unknown,
): EcgPhotoBenchmarkManifest {
  const manifest = validateEcgRealPhoneDigitizationHoldoutManifest(value);
  const invalid = manifest.cases
    .filter(
      (fixture) =>
        fixture.fixture_kind !== 'classification' ||
        fixture.is_patient_data !== true ||
        !fixture.patient_id,
    )
    .map((fixture) => fixture.case_id)
    .sort();
  if (invalid.length > 0) {
    throw new Error(
      `Clinical real-phone holdout cases require classification labels, patient data provenance, and patient IDs: ${invalid.join(', ')}.`,
    );
  }
  return manifest;
}

export function validateEcgRealPhoneHoldoutFiles(
  directory: string,
  manifest: EcgPhotoBenchmarkManifest,
): void {
  const root = resolve(directory);
  for (const fixture of manifest.cases) {
    if (!fixture.artifact_sha256) {
      throw new Error(`Missing artifact_sha256 for ${fixture.case_id}.`);
    }
    const digest = createHash('sha256')
      .update(readFileSync(resolve(root, fixture.local_file)))
      .digest('hex');
    if (digest !== fixture.artifact_sha256) {
      throw new Error(`SHA-256 mismatch for ${fixture.case_id}.`);
    }
    if (!fixture.reference_signal_file || !fixture.reference_signal_sha256) {
      throw new Error(`Missing reference signal provenance for ${fixture.case_id}.`);
    }
    const signalDigest = createHash('sha256')
      .update(readFileSync(resolve(root, fixture.reference_signal_file)))
      .digest('hex');
    if (signalDigest !== fixture.reference_signal_sha256) {
      throw new Error(`Reference signal SHA-256 mismatch for ${fixture.case_id}.`);
    }
  }
}

function parseResult(value: unknown, index: number): EcgPhotoBenchmarkResult {
  const path = `results[${index}]`;
  if (!isRecord(value)) throw new Error(`${path} must be an object.`);
  const fixtureKind = optionalEnum(
    value['fixture_kind'],
    ['classification', 'quality-only'] as const,
    `${path}.fixture_kind`,
  );
  const labels = optionalStringArray(value['labels'], `${path}.labels`);
  const title = optionalString(value['title'], `${path}.title`);
  const elapsedMs = value['elapsed_ms'];
  if (
    elapsedMs !== undefined &&
    (typeof elapsedMs !== 'number' || !Number.isFinite(elapsedMs) || elapsedMs < 0)
  ) {
    throw new Error(`${path}.elapsed_ms must be a non-negative number.`);
  }
  const meta = optionalStringArray(value['meta'], `${path}.meta`);
  const photoQualityIssues = optionalStringArray(
    value['photo_quality_issues'],
    `${path}.photo_quality_issues`,
  );
  const photoQualityIssueCodes = optionalIssueCodes(
    value['photo_quality_issue_codes'],
    `${path}.photo_quality_issue_codes`,
  );
  const reasons = optionalStringArray(value['reasons'], `${path}.reasons`);
  const error = value['error'];
  if (error !== undefined && error !== null && typeof error !== 'string') {
    throw new Error(`${path}.error must be a string or null.`);
  }
  const rectifiedPrimary = value['rectified_primary'];
  if (rectifiedPrimary !== undefined && typeof rectifiedPrimary !== 'boolean') {
    throw new Error(`${path}.rectified_primary must be a boolean.`);
  }
  const layout = optionalEnum(value['layout'], ECG_PHOTO_LAYOUTS, `${path}.layout`);
  const leadCount = optionalFiniteNumber(value['lead_count'], `${path}.lead_count`, {
    minInclusive: 0,
    max: 12,
  });
  if (leadCount !== undefined && !Number.isInteger(leadCount)) {
    throw new Error(`${path}.lead_count must be an integer.`);
  }
  const rhythmCoverage = optionalFiniteNumber(value['rhythm_coverage'], `${path}.rhythm_coverage`, {
    minInclusive: 0,
    max: 1,
  });
  const durationSeconds = optionalFiniteNumber(
    value['duration_seconds'],
    `${path}.duration_seconds`,
    { minExclusive: 0 },
  );
  const rrMs = optionalFiniteNumber(value['rr_ms'], `${path}.rr_ms`, { minExclusive: 0 });
  const heartRateBpm = optionalFiniteNumber(value['heart_rate_bpm'], `${path}.heart_rate_bpm`, {
    minExclusive: 0,
  });
  return {
    case_id: requiredString(value['case_id'], `${path}.case_id`),
    quality: enumValue(value['quality'], ECG_PHOTO_QUALITIES, `${path}.quality`),
    ...(fixtureKind === undefined ? {} : { fixture_kind: fixtureKind }),
    ...(labels === undefined ? {} : { labels }),
    ...(title === undefined ? {} : { title }),
    ...(elapsedMs === undefined ? {} : { elapsed_ms: elapsedMs }),
    ...(meta === undefined ? {} : { meta }),
    ...(photoQualityIssues === undefined ? {} : { photo_quality_issues: photoQualityIssues }),
    ...(photoQualityIssueCodes === undefined
      ? {}
      : { photo_quality_issue_codes: photoQualityIssueCodes }),
    ...(reasons === undefined ? {} : { reasons }),
    ...(error === undefined ? {} : { error: error as string | null }),
    ...(rectifiedPrimary === undefined ? {} : { rectified_primary: rectifiedPrimary }),
    ...(layout === undefined ? {} : { layout }),
    ...(leadCount === undefined ? {} : { lead_count: leadCount }),
    ...(rhythmCoverage === undefined ? {} : { rhythm_coverage: rhythmCoverage }),
    ...(durationSeconds === undefined ? {} : { duration_seconds: durationSeconds }),
    ...(rrMs === undefined ? {} : { rr_ms: rrMs }),
    ...(heartRateBpm === undefined ? {} : { heart_rate_bpm: heartRateBpm }),
  };
}

export function parseEcgPhotoBenchmarkResult(value: unknown): EcgPhotoBenchmarkResult {
  if (!isRecord(value)) throw new Error('ECG photo benchmark result must be an object.');
  return parseResult(value, 0);
}

export function parseEcgPhotoBenchmarkResultFile(value: unknown): EcgPhotoBenchmarkResultFile {
  if (!isRecord(value)) throw new Error('ECG photo benchmark result file must be an object.');
  if (value['schema_version'] !== 1) {
    throw new Error('Unsupported ECG photo benchmark result schema.');
  }
  if (!Array.isArray(value['results'])) {
    throw new Error('ECG photo benchmark result file must contain a results array.');
  }
  const results = value['results'].map(parseResult);
  if (new Set(results.map((result) => result.case_id)).size !== results.length) {
    throw new Error('ECG photo benchmark result case IDs must be unique.');
  }
  const measuredAt = optionalString(value['measured_at'], 'measured_at');
  return {
    schema_version: 1,
    dataset_id: requiredString(value['dataset_id'], 'dataset_id'),
    ...(measuredAt === undefined ? {} : { measured_at: measuredAt }),
    results,
  };
}

export const validateEcgPhotoBenchmarkResultFile = parseEcgPhotoBenchmarkResultFile;

function failure(
  caseId: string,
  code: EcgPhotoBenchmarkFailureCode,
  message: string,
): EcgPhotoBenchmarkFailure {
  return { case_id: caseId, code, message };
}

export function evaluateEcgPhotoBenchmark(
  manifest: EcgPhotoBenchmarkManifest,
  resultFile: EcgPhotoBenchmarkResultFile,
): EcgPhotoBenchmarkSummary {
  const failures: EcgPhotoBenchmarkFailure[] = [];
  const cases = new Map(manifest.cases.map((fixture) => [fixture.case_id, fixture]));
  const expectedCaseCount = manifest.cases.filter(
    (fixture) =>
      fixture.expected_quality !== undefined ||
      fixture.forbid_usable !== undefined ||
      fixture.expected_photo_quality_codes !== undefined ||
      fixture.reference_rr_ms !== undefined ||
      fixture.reference_heart_rate_bpm !== undefined,
  ).length;

  if (manifest.dataset_id !== resultFile.dataset_id) {
    failures.push(
      failure(
        '',
        'dataset-id-mismatch',
        `Result dataset_id ${JSON.stringify(resultFile.dataset_id)} does not match manifest ${JSON.stringify(manifest.dataset_id)}.`,
      ),
    );
  }
  if (resultFile.results.length === 0)
    failures.push(failure('', 'no-results', 'Result has no cases.'));

  for (const result of resultFile.results) {
    const fixture = cases.get(result.case_id);
    if (!fixture) {
      failures.push(
        failure(result.case_id, 'unknown-case', 'Result case is not present in the manifest.'),
      );
      continue;
    }

    const expectedQuality = fixture.expected_quality;
    const actualIssueCodes = new Set(result.photo_quality_issue_codes ?? []);
    const unsafeByExpectedQuality =
      expectedQuality !== undefined && expectedQuality !== 'usable' && result.quality === 'usable';
    const unsafeByExpectation = fixture.forbid_usable === true && result.quality === 'usable';
    const unsafeByBlockingIssue =
      result.quality === 'usable' &&
      [...actualIssueCodes].some((code) => BLOCKING_ISSUE_CODES.has(code));

    if (unsafeByExpectedQuality || unsafeByExpectation || unsafeByBlockingIssue) {
      failures.push(
        failure(
          result.case_id,
          'unsafe-promotion',
          'This case is forbidden from producing a usable result.',
        ),
      );
    } else if (expectedQuality !== undefined && result.quality !== expectedQuality) {
      failures.push(
        failure(
          result.case_id,
          'quality-mismatch',
          `Expected quality ${expectedQuality}, got ${result.quality}.`,
        ),
      );
    }

    for (const expectedCode of fixture.expected_photo_quality_codes ?? []) {
      if (!actualIssueCodes.has(expectedCode)) {
        failures.push(
          failure(
            result.case_id,
            'missing-quality-issue-code',
            `Expected photo quality issue code ${expectedCode} was not detected.`,
          ),
        );
      }
    }
    if (fixture.reference_rr_ms !== undefined && result.rr_ms === undefined) {
      failures.push(
        failure(
          result.case_id,
          'missing-reference-measurement',
          'Reference RR is declared but the digitizer returned no structured RR measurement.',
        ),
      );
    }
    if (fixture.reference_heart_rate_bpm !== undefined && result.heart_rate_bpm === undefined) {
      failures.push(
        failure(
          result.case_id,
          'missing-reference-measurement',
          'Reference heart rate is declared but the digitizer returned no structured heart-rate measurement.',
        ),
      );
    }
  }

  const resultIds = new Set(resultFile.results.map((result) => result.case_id));
  for (const fixture of manifest.cases) {
    const hasExpectation =
      fixture.expected_quality !== undefined ||
      fixture.forbid_usable !== undefined ||
      fixture.expected_photo_quality_codes !== undefined ||
      fixture.reference_rr_ms !== undefined ||
      fixture.reference_heart_rate_bpm !== undefined;
    if (hasExpectation && !resultIds.has(fixture.case_id)) {
      failures.push(
        failure(fixture.case_id, 'missing-result', 'Expected benchmark case has no result.'),
      );
    }
  }

  const matchedResults = resultFile.results.filter((result) => cases.has(result.case_id));
  const qualityCounts: Record<EcgPhotoQuality, number> = { usable: 0, review: 0, failed: 0 };
  const issueCounts: Record<EcgPhotoQualityIssueCode, number> = {
    blur: 0,
    'cropped-paper': 0,
    glare: 0,
    'missing-calibration': 0,
  };
  const leadCounts: number[] = [];
  const rhythmCoverages: number[] = [];
  const rrErrors: number[] = [];
  const heartRateErrors: number[] = [];
  let structuredResultCount = 0;
  let rrResultCount = 0;
  let heartRateResultCount = 0;
  for (const result of matchedResults) {
    qualityCounts[result.quality] += 1;
    for (const code of result.photo_quality_issue_codes ?? []) issueCounts[code] += 1;
    if (
      result.layout !== undefined ||
      result.lead_count !== undefined ||
      result.rhythm_coverage !== undefined ||
      result.duration_seconds !== undefined
    ) {
      structuredResultCount += 1;
    }
    if (result.lead_count !== undefined) leadCounts.push(result.lead_count);
    if (result.rhythm_coverage !== undefined) rhythmCoverages.push(result.rhythm_coverage);
    if (result.rr_ms !== undefined) rrResultCount += 1;
    if (result.heart_rate_bpm !== undefined) heartRateResultCount += 1;
    const fixture = cases.get(result.case_id);
    if (fixture?.reference_rr_ms !== undefined && result.rr_ms !== undefined) {
      rrErrors.push(Math.abs(result.rr_ms - fixture.reference_rr_ms));
    }
    if (fixture?.reference_heart_rate_bpm !== undefined && result.heart_rate_bpm !== undefined) {
      heartRateErrors.push(Math.abs(result.heart_rate_bpm - fixture.reference_heart_rate_bpm));
    }
  }
  const mean = (values: readonly number[]): number | null =>
    values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;

  return {
    schema_version: 1,
    dataset_id: manifest.dataset_id,
    result_count: resultFile.results.length,
    expected_case_count: expectedCaseCount,
    passed: failures.length === 0,
    failures,
    quality_counts: qualityCounts,
    photo_quality_issue_counts: issueCounts,
    digitization_metrics: {
      structured_result_count: structuredResultCount,
      mean_lead_count: mean(leadCounts),
      mean_rhythm_coverage: mean(rhythmCoverages),
      rr_result_count: rrResultCount,
      heart_rate_result_count: heartRateResultCount,
      rr_reference_count: rrErrors.length,
      rr_mae_ms: mean(rrErrors),
      heart_rate_reference_count: heartRateErrors.length,
      heart_rate_mae_bpm: mean(heartRateErrors),
    },
  };
}

interface CliOptions {
  readonly manifest: string;
  readonly result: string;
}

function cliOptions(args: readonly string[]): CliOptions {
  const options: Partial<Record<'manifest' | 'result', string>> = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (
      (name !== '--manifest' && name !== '--result') ||
      value === undefined ||
      value.startsWith('--')
    ) {
      throw new Error('Usage: --manifest <path> --result <path>');
    }
    const key = name.slice(2) as 'manifest' | 'result';
    if (options[key] !== undefined) throw new Error(`Duplicate option ${name}.`);
    options[key] = value;
  }
  if (!options.manifest || !options.result)
    throw new Error('Usage: --manifest <path> --result <path>');
  return { manifest: options.manifest, result: options.result };
}

function readJson(path: string, label: string): unknown {
  try {
    return JSON.parse(readFileSync(resolve(path), 'utf8')) as unknown;
  } catch (cause) {
    throw new Error(
      `Unable to read ${label} JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
}

export function runEcgPhotoBenchmarkEvaluator(args = process.argv.slice(2)): number {
  try {
    const options = cliOptions(args);
    const manifest = parseEcgPhotoBenchmarkManifest(readJson(options.manifest, 'manifest'));
    const result = parseEcgPhotoBenchmarkResultFile(readJson(options.result, 'result'));
    const summary = evaluateEcgPhotoBenchmark(manifest, result);
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return summary.passed ? 0 : 1;
  } catch (cause) {
    process.stderr.write(
      `ECG photo benchmark evaluation failed: ${cause instanceof Error ? cause.message : String(cause)}\n`,
    );
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runEcgPhotoBenchmarkEvaluator();
}
