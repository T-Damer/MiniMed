import type { StoredCalculationResult } from '@/features/calculators/clinical-calculations';

const STORAGE_KEY = 'minimed.calculation-history.v1';
const MAX_RECORDS = 100;

export type { StoredCalculationResult };

export interface CalculationRecord {
  readonly id: string;
  readonly calculatorId: string;
  readonly subjectLabel: string;
  readonly createdAt: string;
  readonly inputSummary: string;
  readonly result: StoredCalculationResult;
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
    return parsed
      .filter(isCalculationRecord)
      .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, MAX_RECORDS);
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
}): CalculationRecord {
  return {
    id: crypto.randomUUID(),
    calculatorId: input.calculatorId,
    subjectLabel: input.subjectLabel.trim(),
    createdAt: new Date().toISOString(),
    inputSummary: input.inputSummary,
    result: input.result,
  };
}

export function saveCalculationRecord(record: CalculationRecord): readonly CalculationRecord[] {
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
