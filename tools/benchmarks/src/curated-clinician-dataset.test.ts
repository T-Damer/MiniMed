import { describe, expect, it } from 'vitest';

import { loadCuratedClinicianQueries } from './curated-clinician-dataset';

describe('curated clinician query dataset', () => {
  it('keeps a small human-written gate separate from the synthetic 1500-query corpus', () => {
    const rows = loadCuratedClinicianQueries();

    expect(rows).toHaveLength(17);
    expect(new Set(rows.map((row) => row.query_id)).size).toBe(rows.length);
    expect(new Set(rows.map((row) => row.query)).size).toBe(rows.length);
    expect(rows.filter((row) => row.intent === 'medication')).toHaveLength(5);
    expect(rows.filter((row) => row.specialty === 'pharmacology')).toHaveLength(4);
    expect(rows.some((row) => row.age_group === 'child')).toBe(true);
    expect(rows.some((row) => row.age_group === 'adult')).toBe(true);
    expect(rows.some((row) => row.answerability === 'partial_or_no_answer')).toBe(true);
    expect(rows.every((row) => row.forbidden_or_dangerous.length > 0)).toBe(true);
  });

  it('contains the concrete medication and forgotten-terminology regressions', () => {
    const rows = loadCuratedClinicianQueries();
    const queries = rows.map((row) => row.query);

    expect(queries).toContain('От чего помогает парацетамол и в каких случаях его назначают?');
    expect(queries).toContain('На какие рецепторы влияет ибупрофен? Я забыл точный механизм.');
    expect(queries).toContain(
      'Ребенку дали парацетамол, но температура почти не снизилась. Что делать дальше?',
    );
    expect(queries).toContain(
      'У ребенка белые прыщики на слизистой рта. Как называется этот симптом и что различать?',
    );
  });

  it('avoids the repeated machine-generated benchmark wording', () => {
    const rows = loadCuratedClinicianQueries();
    const machinePatterns = [
      'клиническая картина и диагностические критерии у детей',
      'какой наиболее вероятный диагноз и какие признаки его поддерживают',
      'алгоритм обследования ребенка при подозрении',
    ];

    for (const row of rows) {
      const normalized = row.query.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е');
      expect(machinePatterns.some((pattern) => normalized.includes(pattern))).toBe(false);
    }
  });
});
