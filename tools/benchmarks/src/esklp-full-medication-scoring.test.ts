import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { SearchResultGroup } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import {
  aggregateEsklpMedicationEvaluations,
  type EsklpMedicationFixture,
  type EsklpMedicationQuery,
  evaluateEsklpMedicationQuery,
  validateEsklpMedicationFixture,
} from './esklp-full-medication-scoring';

const BUDESONIDE = 'esklp.mnn.будесонид';
const BUDESONIDE_FORMOTEROL = 'esklp.mnn.будесонид-формотерол';
const FORMOTEROL = 'esklp.mnn.формотерол';
const IBUPROFEN = 'esklp.mnn.ибупрофен';
const IBUPROFEN_CODEINE = 'esklp.mnn.ибупрофен-кодеин';
const IBUPROFEN_PARACETAMOL = 'esklp.mnn.ибупрофен-парацетамол';
const PARACETAMOL = 'esklp.mnn.парацетамол';
const CEFTRIAXONE = 'esklp.mnn.цефтриаксон';

function group(
  documentId: string,
  title: string,
  snippet: string,
  sectionPath: readonly string[] = [title],
  matchedTerms: readonly string[] = [],
  resultTitle = title,
): SearchResultGroup {
  return {
    documentId,
    title,
    bestScore: 1,
    categories: ['other'],
    results: [
      {
        chunkId: `${documentId}:chunk`,
        documentId,
        documentVersionId: `${documentId}@v1`,
        sectionId: `${documentId}:section`,
        anchor: `${documentId}@v1/section#chunk-1`,
        title: resultTitle,
        sectionPath,
        snippet,
        highlightedRanges: [],
        lexicalScore: 1,
        semanticScore: null,
        finalScore: 1,
        matchedTerms,
        matchedBranches: [],
        sectionType: 'other',
        category: 'other',
      },
    ],
  };
}

function query(overrides: Partial<EsklpMedicationQuery>): EsklpMedicationQuery {
  return {
    id: 'test-query',
    query: 'препарат',
    requiredEntityIds: [PARACETAMOL],
    ...overrides,
  };
}

describe('ESKLP full medication scorer', () => {
  it('validates the committed fixture and preserves the audited source-native IDs', () => {
    const path = resolve(import.meta.dirname, '../esklp-full-medication-queries.json');
    const fixture = validateEsklpMedicationFixture(
      JSON.parse(readFileSync(path, 'utf8')) as unknown,
    );

    expect(fixture).toMatchObject({
      schemaVersion: 1,
      id: 'minimed-esklp-full-medication-identity-v1',
      trustedDoseData: false,
    });
    expect(fixture.queries).toHaveLength(16);
    expect(
      fixture.queries.find((item) => item.id === 'esklp-turbuhaler')?.requiredEntityIds,
    ).toEqual([BUDESONIDE, BUDESONIDE_FORMOTEROL, FORMOTEROL]);
    expect(
      fixture.queries.find((item) => item.id === 'esklp-nurofen-plus')?.requiredEntityIds,
    ).toEqual([IBUPROFEN_CODEINE]);
    expect(
      fixture.queries.find((item) => item.id === 'esklp-nurofen-intensive')?.requiredEntityIds,
    ).toEqual([IBUPROFEN_PARACETAMOL]);
  });

  it('rejects invalid shape, empty required IDs, duplicate IDs and duplicate query IDs', () => {
    const base: EsklpMedicationFixture = {
      schemaVersion: 1,
      id: 'fixture',
      description: 'fixture',
      trustedDoseData: false,
      queries: [query({ id: 'one' })],
    };
    expect(() => validateEsklpMedicationFixture({ ...base, queries: 'bad' })).toThrow();
    expect(() =>
      validateEsklpMedicationFixture({
        ...base,
        queries: Array.from({ length: 14 }, (_, index) =>
          query({ id: `q-${index}`, requiredEntityIds: [''] }),
        ),
      }),
    ).toThrow();
    expect(() =>
      validateEsklpMedicationFixture({
        ...base,
        queries: Array.from({ length: 14 }, (_, index) =>
          query({ id: index === 13 ? 'q-0' : `q-${index}` }),
        ),
      }),
    ).toThrow();
  });

  it('counts distinct multi-required Turbuhaler entities and does not count duplicate groups twice', () => {
    const fixture = query({
      id: 'turbuhaler',
      query: 'турбухалер',
      requiredEntityIds: [BUDESONIDE, BUDESONIDE_FORMOTEROL, FORMOTEROL],
    });
    const allGroups = [
      group(BUDESONIDE, 'Пульмикорт Турбухалер', 'ПОРОШОК ДЛЯ ИНГАЛЯЦИЙ ДОЗИРОВАННЫЙ'),
      group(BUDESONIDE, 'Пульмикорт Турбухалер', 'ПОРОШОК ДЛЯ ИНГАЛЯЦИЙ ДОЗИРОВАННЫЙ'),
      group(BUDESONIDE_FORMOTEROL, 'Симбикорт Турбухалер', 'ПОРОШОК ДЛЯ ИНГАЛЯЦИЙ ДОЗИРОВАННЫЙ'),
      group(FORMOTEROL, 'Оксис Турбухалер', 'ПОРОШОК ДЛЯ ИНГАЛЯЦИЙ ДОЗИРОВАННЫЙ'),
    ];
    const complete = evaluateEsklpMedicationQuery(fixture, allGroups);
    expect(complete).toMatchObject({
      entityRecallAt5: 1,
      hitAt5: true,
      firstRequiredRank: 1,
      reciprocalRankAt5: 1,
    });
    const missingOne = evaluateEsklpMedicationQuery(fixture, allGroups.slice(0, 3));
    expect(missingOne).toMatchObject({
      entityRecallAt5: 2 / 3,
      hitAt5: true,
    });
    expect(missingOne.foundEntityIds).toEqual([BUDESONIDE, BUDESONIDE_FORMOTEROL]);
  });

  it('requires direct paracetamol identity at Top1 over a fixed-combination collision', () => {
    const fixture = query({
      id: 'paracetamol',
      query: 'парацетамол',
      requiredEntityIds: [PARACETAMOL],
      identityTop1EntityId: PARACETAMOL,
    });
    const combination = group(
      'esklp.mnn.ибупрофен-парацетамол',
      'ИБУПРОФЕН+ПАРАЦЕТАМОЛ',
      'Парацетамол',
    );
    const direct = group(PARACETAMOL, 'ПАРАЦЕТАМОЛ', 'Парацетамол');
    expect(evaluateEsklpMedicationQuery(fixture, [combination, direct])).toMatchObject({
      entityRecallAt5: 1,
      exactSupportedIdentityTop1: false,
    });
    expect(evaluateEsklpMedicationQuery(fixture, [direct, combination])).toMatchObject({
      exactSupportedIdentityTop1: true,
    });
  });

  it('scores compact core pointers by their exact target medication identity', () => {
    const pointerId = 'core.catalog.pointer.medication.paracetamol';
    const result = evaluateEsklpMedicationQuery(
      query({ identityTop1EntityId: PARACETAMOL }),
      [group(pointerId, 'ПАРАЦЕТАМОЛ', 'Парацетамол')],
      0,
      (documentId) => (documentId === pointerId ? PARACETAMOL : documentId),
    );

    expect(result).toMatchObject({
      foundEntityIds: [PARACETAMOL],
      entityRecallAt5: 1,
      hitAt5: true,
      exactSupportedIdentityTop1: true,
      topDocumentIds: [pointerId],
    });
  });

  it('checks route/form/TN evidence only in source result fields', () => {
    const fixture = query({
      id: 'ceftriaxone-im',
      query: 'цефтриаксон внутримышечно',
      requiredEntityIds: [CEFTRIAXONE],
      evidence: [
        {
          entityId: CEFTRIAXONE,
          allOf: ['ПОРОШОК ДЛЯ ПРИГОТОВЛЕНИЯ РАСТВОРА ДЛЯ ВНУТРИМЫШЕЧНОГО ВВЕДЕНИЯ'],
        },
      ],
    });
    const target = group(
      CEFTRIAXONE,
      'ЦЕФТРИАКСОН',
      'ПОРОШОК ДЛЯ ПРИГОТОВЛЕНИЯ РАСТВОРА ДЛЯ ВНУТРИМЫШЕЧНОГО ВВЕДЕНИЯ.',
    );
    expect(evaluateEsklpMedicationQuery(fixture, [target]).evidenceHit).toBe(true);
    const missingSourceEvidence = group(
      CEFTRIAXONE,
      'ЦЕФТРИАКСОН',
      'Цефтриаксон внутримышечно',
      ['Цефтриаксон'],
      ['ПОРОШОК ДЛЯ ПРИГОТОВЛЕНИЯ РАСТВОРА ДЛЯ ВНУТРИМЫШЕЧНОГО ВВЕДЕНИЯ'],
    );
    expect(evaluateEsklpMedicationQuery(fixture, [missingSourceEvidence]).evidenceHit).toBe(false);

    const headingOnly = group(
      CEFTRIAXONE,
      'ЦЕФТРИАКСОН ПОРОШОК ДЛЯ ПРИГОТОВЛЕНИЯ РАСТВОРА ДЛЯ ВНУТРИМЫШЕЧНОГО ВВЕДЕНИЯ',
      'Цефтриаксон внутримышечно',
      ['Цефтриаксон'],
      [],
      'ЦЕФТРИАКСОН',
    );
    expect(headingOnly.title).toContain(
      'ПОРОШОК ДЛЯ ПРИГОТОВЛЕНИЯ РАСТВОРА ДЛЯ ВНУТРИМЫШЕЧНОГО ВВЕДЕНИЯ',
    );
    expect(headingOnly.results[0]?.title).toBe('ЦЕФТРИАКСОН');
    expect(evaluateEsklpMedicationQuery(fixture, [headingOnly]).evidenceHit).toBe(false);
  });

  it('aggregates arithmetic using only applicable identity/evidence denominators', () => {
    const first = evaluateEsklpMedicationQuery(
      query({ id: 'first', identityTop1EntityId: PARACETAMOL }),
      [group(PARACETAMOL, 'ПАРАЦЕТАМОЛ', 'Парацетамол')],
    );
    const second = evaluateEsklpMedicationQuery(
      query({
        id: 'second',
        requiredEntityIds: [PARACETAMOL, IBUPROFEN],
        identityTop1EntityId: PARACETAMOL,
        evidence: [{ entityId: PARACETAMOL, allOf: ['Парацетамол'] }],
      }),
      [group('other', 'Другое', 'Другое'), group(PARACETAMOL, 'ПАРАЦЕТАМОЛ', 'Парацетамол')],
    );
    const aggregate = aggregateEsklpMedicationEvaluations([first, second]);
    expect(aggregate).toMatchObject({
      queryCount: 2,
      entityRecallAt5: 0.75,
      hitAt5: 1,
      mrrAt5: 0.75,
      exactSupportedIdentityTop1: 0.5,
      evidenceHit: 1,
      identityTop1FixtureCount: 2,
      evidenceQueryCount: 1,
    });
  });

  it('aggregates evidenceHit per query, not per evidence entity', () => {
    const partial = evaluateEsklpMedicationQuery(
      query({
        id: 'partial-evidence',
        requiredEntityIds: [PARACETAMOL, IBUPROFEN],
        evidence: [
          { entityId: PARACETAMOL, allOf: ['Парацетамол'] },
          { entityId: IBUPROFEN, allOf: ['Ибупрофен'] },
        ],
      }),
      [group(PARACETAMOL, 'ПАРАЦЕТАМОЛ', 'Парацетамол')],
    );
    const complete = evaluateEsklpMedicationQuery(
      query({
        id: 'complete-evidence',
        evidence: [{ entityId: PARACETAMOL, allOf: ['Парацетамол'] }],
      }),
      [group(PARACETAMOL, 'ПАРАЦЕТАМОЛ', 'Парацетамол')],
    );

    expect(partial.evidenceChecks.map((check) => check.passed)).toEqual([true, false]);
    expect(partial.evidenceHit).toBe(false);
    expect(complete.evidenceHit).toBe(true);
    expect(aggregateEsklpMedicationEvaluations([partial, complete])).toMatchObject({
      evidenceHit: 0.5,
      evidenceQueryCount: 2,
    });
  });
});
