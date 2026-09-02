export const ECG_MODEL_FORMAT = 'minimed-ecg-waveform-digitizer';
export const ECG_MODEL_FORMAT_VERSION = 1;
export const ECG_MODEL_MANIFEST_FILE = 'minimed-ecg-model.json';
export const ECG_DIGITIZER_CONFIG_FILE = 'open_ecg_digitizer.json';
export const ECG_DIGITIZER_WEIGHTS_FILE = 'onnx/open_ecg_digitizer.onnx';
export const ECG_MODEL_STORAGE_ORIGIN = 'https://minimed.local/ecg-model/';

export const ECG_STANDARD_LEADS = [
  'I',
  'II',
  'III',
  'aVR',
  'aVL',
  'aVF',
  'V1',
  'V2',
  'V3',
  'V4',
  'V5',
  'V6',
] as const;

export type EcgLeadName = (typeof ECG_STANDARD_LEADS)[number];

export interface EcgNormalizedPoint {
  readonly x: number;
  readonly y: number;
}

export interface EcgPhotoCorners {
  readonly bottomLeft: EcgNormalizedPoint;
  readonly bottomRight: EcgNormalizedPoint;
  readonly topLeft: EcgNormalizedPoint;
  readonly topRight: EcgNormalizedPoint;
}

export interface EcgNormalizedRegion {
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
}

export interface EcgPhotoQualityIssue {
  readonly code: 'blur' | 'cropped-paper' | 'glare' | 'missing-calibration';
  readonly detail: string;
  readonly region: EcgNormalizedRegion;
  readonly severity: 'blocking' | 'warning';
  readonly title: string;
}

export interface EcgModelDescriptor {
  readonly cacheName: string;
  readonly checksum: string;
  readonly fileBytes: number;
  readonly installedAt: string;
  readonly kind: 'waveform-digitizer';
  readonly license: string;
  readonly name: string;
  readonly source: string;
  readonly version: string;
}

export interface EcgDigitizedLead {
  readonly coverage: number;
  readonly durationSeconds: number;
  readonly name: EcgLeadName;
  readonly reviewed: false;
  readonly samples: Float32Array;
  readonly source: 'photo-auto';
  readonly startSecond: number;
}

export interface EcgDigitizationResult {
  readonly detectedGridCorners?: EcgPhotoCorners;
  readonly durationSeconds: number;
  readonly gridPixelsPerMillimeter: number;
  readonly heartRate?: number;
  readonly layout: '3x4+1R' | '12x1';
  readonly leads: readonly EcgDigitizedLead[];
  readonly quality: 'failed' | 'review' | 'usable';
  readonly qualityIssues: readonly EcgPhotoQualityIssue[];
  readonly qualityReasons: readonly string[];
  readonly rhythmCoverage: number;
  readonly rhythmLead?: EcgDigitizedLead;
  readonly rrIntervalsMs: readonly number[];
  readonly rrMs?: number;
  readonly sampleRateHz: 100;
}

export function ecgModelStorageUrl(path: string): string {
  return `${ECG_MODEL_STORAGE_ORIGIN}${encodeURIComponent(path)}`;
}
