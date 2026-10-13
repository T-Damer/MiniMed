import { describe, expect, it } from 'vitest';

import { earlierEditionDocumentIds } from '@/features/library/edition-predecessors';
import { buildClinicalEditionIndex } from '@/features/modules/clinical-editions';

const index = buildClinicalEditionIndex({
  codes: [
    {
      code: 507,
      title: 'Тестовая рекомендация',
      editions: [
        {
          id: '507_2',
          version: 2,
          status: 'superseded',
          publishedAt: '2023-01-01',
          replacedBy: '507_3',
          moduleId: null,
        },
        {
          id: '507_3',
          version: 3,
          status: 'superseded',
          publishedAt: '2024-01-01',
          replacedBy: '507_4',
          moduleId: 'minimed.clinical.recommendation.507_3',
        },
        {
          id: '507_4',
          version: 4,
          status: 'active',
          publishedAt: '2026-08-14',
          replacedBy: null,
          moduleId: 'minimed.clinical.recommendation.507_4',
        },
      ],
    },
  ],
});

describe('earlierEditionDocumentIds', () => {
  it('lists the earlier editions of a clinical recommendation, nearest first', () => {
    expect(earlierEditionDocumentIds({ id: 'kr.rf.507_4' }, () => index)).toEqual([
      'kr.rf.507_3',
      'kr.rf.507_2',
    ]);
    expect(earlierEditionDocumentIds({ id: 'kr.rf.507_3' }, () => index)).toEqual(['kr.rf.507_2']);
  });

  it('has none for the first edition or an unknown document', () => {
    expect(earlierEditionDocumentIds({ id: 'kr.rf.507_2' }, () => index)).toEqual([]);
    expect(earlierEditionDocumentIds({ id: 'regulatory.rf.minzdrav.1n' }, () => index)).toEqual([]);
  });

  it('adds what a document declares it supersedes, without duplicates', () => {
    expect(
      earlierEditionDocumentIds(
        {
          id: 'regulatory.rf.minzdrav.192n-2025',
          metadata: {
            supersedesDocumentIds: [
              'regulatory.rf.minzdrav.302n',
              7,
              'regulatory.rf.minzdrav.302n',
            ],
          },
        },
        () => index,
      ),
    ).toEqual(['regulatory.rf.minzdrav.302n']);
    expect(
      earlierEditionDocumentIds(
        { id: 'kr.rf.507_4', metadata: { supersedesDocumentIds: ['kr.rf.507_3'] } },
        () => index,
      ),
    ).toEqual(['kr.rf.507_3', 'kr.rf.507_2']);
  });
});
