import type { StoredCalculationResult } from '@/features/calculators/clinical-calculations';

const STORAGE_KEY = 'minimed.calculation-history.v2';
const MAX_RECORDS = 100;

export type { StoredCalculationResult };

export interface CalculationRecord {
  readonly id: string;
  readonly calculatorId: string;
  readonly subjectLabel: string;
  readonly createdAt: string;
  readonly inputSummary: string;
  readonly result: StoredCalculationResult;
  /** Protected patient identity; records with this field never enter localStorage history. */
  readonly patientId?: string;
  readonly episodeId?: string;
  readonly definitionVersion?: string;
  readonly normalizedInputs?: Readonly<Record<string, string | number>>;
  readonly contextSnapshot?: Readonly<Record<string, string | number>>;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function recordValue(record: Readonly<Record<string, unknown>>, key: string): unknown {
  return record[key];
}

function isCalculationRecord(value: unknown): value is CalculationRecord {
  if (!isRecord(value)) return false;
  const result = recordValue(value, 'result');
  if (!isRecord(result)) return false;
  return (
    typeof recordValue(value, 'id') === 'string' &&
    typeof recordValue(value, 'calculatorId') === 'string' &&
    typeof recordValue(value, 'subjectLabel') === 'string' &&
    typeof recordValue(value, 'createdAt') === 'string' &&
    typeof recordValue(value, 'inputSummary') === 'string' &&
    recordValue(result, 'ok') === true &&
    typeof recordValue(result, 'calculatorId') === 'string' &&
    typeof recordValue(result, 'formula') === 'string' &&
    Array.isArray(recordValue(result, 'trace')) &&
    Array.isArray(recordValue(result, 'warnings')) &&
    (typeof recordValue(result, 'value') === 'number' ||
      Array.isArray(recordValue(result, 'values')) ||
      Array.isArray(recordValue(result, 'textValues')))
  );
}

export function loadCalculationHistory(): readonly CalculationRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (
      parsed
        .filter(isCalculationRecord)
        // A patient-bound result belongs to the encrypted vault. Ignore any stale or tampered
        // localStorage entry rather than exposing a protected identity through ordinary history.
        .filter((record) => record.patientId === undefined)
        .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, MAX_RECORDS)
    );
  } catch {
    return [];
  }
}

export function findCalculationRecord(recordId: string): CalculationRecord | undefined {
  return loadCalculationHistory().find((record) => record.id === recordId);
}

function persist(records: readonly CalculationRecord[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records.slice(0, MAX_RECORDS)));
}

export function createCalculationRecord(input: {
  readonly calculatorId: string;
  readonly subjectLabel: string;
  readonly inputSummary: string;
  readonly result: StoredCalculationResult;
  readonly patientId?: string;
  readonly episodeId?: string;
  readonly definitionVersion?: string;
  readonly normalizedInputs?: Readonly<Record<string, string | number>>;
  readonly contextSnapshot?: Readonly<Record<string, string | number>>;
}): CalculationRecord {
  return {
    id: crypto.randomUUID(),
    calculatorId: input.calculatorId,
    subjectLabel: input.subjectLabel.trim(),
    createdAt: new Date().toISOString(),
    inputSummary: input.inputSummary,
    result: input.result,
    ...(input.patientId ? { patientId: input.patientId } : {}),
    ...(input.episodeId ? { episodeId: input.episodeId } : {}),
    ...(input.definitionVersion ? { definitionVersion: input.definitionVersion } : {}),
    ...(input.normalizedInputs ? { normalizedInputs: input.normalizedInputs } : {}),
    ...(input.contextSnapshot ? { contextSnapshot: input.contextSnapshot } : {}),
  };
}

export function saveCalculationRecord(record: CalculationRecord): readonly CalculationRecord[] {
  if (record.patientId) return loadCalculationHistory();
  const next = [record, ...loadCalculationHistory().filter((item) => item.id !== record.id)].slice(
    0,
    MAX_RECORDS,
  );
  persist(next);
  return next;
}

export function deleteCalculationRecord(id: string): readonly CalculationRecord[] {
  const next = loadCalculationHistory().filter((record) => record.id !== id);
  persist(next);
  return next;
}
