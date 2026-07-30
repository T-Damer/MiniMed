import { describe, expect, it } from 'vitest';

import { loadHardMedicalQueries, loadHardQueryManifest } from './hard-query-dataset';

describe('hard medical query fixture', () => {
  it('loads 1500 unique queries and preserves the declared scenario structure', () => {
    const rows = loadHardMedicalQueries();
    const manifest = loadHardQueryManifest();

    expect(rows).toHaveLength(1500);
    expect(new Set(rows.map((row) => row.query_id)).size).toBe(1500);
    expect(new Set(rows.map((row) => row.query)).size).toBe(1500);
    expect(new Set(rows.map((row) => row.scenario_id)).size).toBe(300);
    expect(manifest.queryCount).toBe(1500);
  });

  it('keeps equal style slices and fixed dev, validation and held-out partitions', () => {
    const rows = loadHardMedicalQueries();
    const count = (field: 'style' | 'split', value: string) =>
      rows.filter((row) => row[field] === value).length;

    expect(count('style', 'professional')).toBe(300);
    expect(count('style', 'colloquial')).toBe(300);
    expect(count('style', 'keywords')).toBe(300);
    expect(count('style', 'noisy')).toBe(300);
    expect(count('style', 'case')).toBe(300);
    expect(count('split', 'dev')).toBe(900);
    expect(count('split', 'validation')).toBe(300);
    expect(count('split', 'hidden_test')).toBe(300);
    expect(rows.filter((row) => row.answerability === 'partial_or_no_answer')).toHaveLength(40);
  });

  it('supports deterministic split loading without changing ids', () => {
    const validation = loadHardMedicalQueries({ split: 'validation' });
    expect(validation).toHaveLength(300);
    expect(validation.every((row) => row.split === 'validation')).toBe(true);
    expect(new Set(validation.map((row) => row.query_id)).size).toBe(300);
  });
});
