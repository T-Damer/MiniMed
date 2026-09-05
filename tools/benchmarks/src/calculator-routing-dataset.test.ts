import { analyzeClinicalQuery } from '@localmed/search-lexical';
import { describe, expect, it } from 'vitest';

import {
  CALCULATOR_ROUTING_MEDICATIONS,
  generateCalculatorRoutingDataset,
  loadCalculatorRoutingDataset,
  normalizeCalculatorRoutingQuery,
  validateCalculatorRoutingDataset,
} from './calculator-routing-dataset';

describe('calculator routing dataset generator', () => {
  it('materializes exact route quotas, proposed status, and unique split cases', () => {
    const dataset = generateCalculatorRoutingDataset();
    const routeCount = (value: string) =>
      dataset.cases.filter((item) => item.expectedRoute === value).length;
    const normalizedQueries = dataset.cases.map((item) =>
      normalizeCalculatorRoutingQuery(item.query),
    );

    expect(dataset).toEqual(loadCalculatorRoutingDataset());
    expect(dataset.schemaVersion).toBe(1);
    expect(dataset.reviewStatus).toBe('proposed');
    expect(dataset.cases).toHaveLength(500);
    expect(routeCount('medication-dose')).toBe(225);
    expect(routeCount('infusion-volume')).toBe(75);
    expect(routeCount('other-calculator')).toBe(50);
    expect(routeCount('none')).toBe(150);
    expect(new Set(dataset.cases.map((item) => item.id)).size).toBe(500);
    expect(new Set(normalizedQueries).size).toBe(500);
    expect(dataset.cases.some((item) => item.split === 'fixed')).toBe(true);
    expect(dataset.cases.some((item) => item.split === 'heldout')).toBe(true);
  });

  it('keeps the required examples, safety minimums, and routing surface variants', () => {
    const dataset = generateCalculatorRoutingDataset();
    const queries = dataset.cases.map((item) => item.query);
    const safetyCount = (value: string) =>
      dataset.cases.filter((item) => item.expectedSafety === value).length;

    expect(queries).toContain('Пульмикорт ребенку 12 лет при бронхиальной астме, доза');
    expect(queries).toContain('Объем инфузии при отравлении алкоголем 80кг');
    expect(queries).toContain('Трамадол ребенку 8 лет');
    expect(safetyCount('allow')).toBeGreaterThanOrEqual(230);
    expect(safetyCount('confirm')).toBeGreaterThanOrEqual(40);
    expect(safetyCount('abstain')).toBeGreaterThanOrEqual(80);
    expect(queries.some((query) => query.includes('парацетамолл'))).toBe(true);
    expect(queries.some((query) => query.includes('Панадол'))).toBe(true);
    expect(queries.some((query) => query.includes('или ибупрофен'))).toBe(true);
    expect(queries.some((query) => query.includes('передозировке'))).toBe(true);
    expect(queries.some((query) => query.includes('уже принял'))).toBe(true);
    expect(queries.some((query) => query.includes('форма') && query.includes('путь'))).toBe(true);
  });

  it('is deterministic and validates generated data without a static JSON file', () => {
    const first = generateCalculatorRoutingDataset();
    const second = generateCalculatorRoutingDataset();
    expect(first).toEqual(second);
    expect(validateCalculatorRoutingDataset(first)).toEqual(first);
  });

  it('keeps medication calculator gating aligned across all generated medication cases', () => {
    const aliases = CALCULATOR_ROUTING_MEDICATIONS.flatMap((medication, index) => [
      {
        id: `routing-generic-${index}`,
        canonicalTerm: medication.canonical,
        alias: medication.canonical,
        category: 'medication',
        weight: 1,
      },
      {
        id: `routing-brand-${index}`,
        canonicalTerm: medication.canonical,
        alias: medication.brand,
        category: 'medication',
        weight: 1,
      },
    ]);
    const failures = generateCalculatorRoutingDataset()
      .cases.filter((item) => item.expectedRoute === 'medication-dose')
      .flatMap((item) => {
        const calculation = analyzeClinicalQuery(item.query, aliases, false).analysis.calculation;
        const shouldOffer = item.expectedSafety !== 'abstain';
        const offersMedicationDose = calculation?.kind === 'medication-dose';
        if (offersMedicationDose !== shouldOffer) return [item.id];
        if (calculation?.kind !== 'medication-dose') return [];
        const actual = new Set(
          calculation.medicationCandidates.map((candidate) => candidate.canonicalTerm),
        );
        return (item.medicationCanonicalTerms ?? []).every((term) => actual.has(term))
          ? []
          : [item.id];
      });

    expect(failures).toEqual([]);
  });

  it('keeps infusion calculator gating aligned across all generated infusion cases', () => {
    const failures = generateCalculatorRoutingDataset()
      .cases.filter((item) => item.expectedRoute === 'infusion-volume')
      .flatMap((item) => {
        const calculation = analyzeClinicalQuery(item.query, [], false).analysis.calculation;
        const shouldOffer = item.expectedSafety !== 'abstain';
        return (calculation?.kind === 'infusion-volume') === shouldOffer ? [] : [item.id];
      });

    expect(failures).toEqual([]);
  });

  it('rejects missing medication identity and duplicate normalized queries', () => {
    expect(() =>
      validateCalculatorRoutingDataset({
        schemaVersion: 1,
        reviewStatus: 'proposed',
        cases: Array.from({ length: 500 }, (_, index) => ({
          id: `case-${index}`,
          query: `Запрос ${index}`,
          split: index === 0 ? 'fixed' : 'heldout',
          expectedRoute: 'medication-dose',
          expectedSafety: 'allow',
          rationale: 'Проверка.',
        })),
      }),
    ).toThrow(/medicationCanonicalTerms/iu);

    const duplicate = JSON.parse(JSON.stringify(generateCalculatorRoutingDataset())) as {
      cases: Array<{ query: string }>;
    };
    const first = duplicate.cases[0];
    const second = duplicate.cases[1];
    if (!first || !second) throw new Error('Generated dataset must contain at least two cases.');
    second.query = `  ${first.query.toUpperCase()}  `;
    expect(() => validateCalculatorRoutingDataset(duplicate)).toThrow(/normalized query/iu);
  });
});
