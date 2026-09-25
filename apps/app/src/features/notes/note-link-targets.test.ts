import { describe, expect, it } from 'vitest';

import {
  findNoteLinkTargets,
  isAppRoute,
  type NoteLinkSources,
  noteLinkMarkdown,
} from '@/features/notes/note-link-targets';

const sources: NoteLinkSources = {
  documents: [
    { id: 'kr.bronchiolitis', title: 'Бронхиолит' },
    { id: 'kr.pneumonia', title: 'Пневмония у детей' },
  ],
  priorityDocumentIds: new Set(['kr.pneumonia']),
  calculators: [{ id: 'bmi', slug: 'bmi', title: 'Индекс массы тела', aliases: ['ИМТ'] }],
  assessments: [
    {
      id: 'mmse',
      bankId: 'neurology',
      slug: 'mmse',
      title: 'Краткая шкала оценки психического статуса',
    },
  ],
  notes: [
    {
      id: 'note-1',
      cardId: 'card-1',
      title: '',
      text: '# Приём ребёнка с бронхиолитом\nСатурация 94%',
      updatedAt: '2026-09-24T10:00:00Z',
    },
  ],
  cardTitles: new Map([['card-1', 'Иванов']]),
};

describe('note link targets', () => {
  it('interleaves kinds and keeps priority documents first', () => {
    const targets = findNoteLinkTargets(sources, '', 10);
    expect(targets.map((target) => target.kind)).toEqual([
      'document',
      'calculator',
      'assessment',
      'note',
      'document',
    ]);
    expect(targets[0]?.title).toBe('Пневмония у детей');
    expect(targets.every((target) => isAppRoute(target.route))).toBe(true);
  });

  it('matches aliases, ё/е and note text, and routes a note to its record', () => {
    expect(findNoteLinkTargets(sources, 'имт', 5).map((target) => target.key)).toEqual([
      'calculator:bmi',
    ]);
    const [document, note] = findNoteLinkTargets(sources, 'бронхиолит', 5);
    expect(document?.key).toBe('document:kr.bronchiolitis');
    expect(note).toMatchObject({
      kind: 'note',
      title: 'Приём ребёнка с бронхиолитом',
      detail: 'Иванов',
      route: '#/notes/card-1/records/note-1',
    });
  });

  it('builds mention markdown without breaking link brackets', () => {
    expect(
      noteLinkMarkdown({ kind: 'note', key: 'n', title: 'Анализ [ОАК]', route: '#/notes/a' }),
    ).toBe('[Анализ ОАК](#/notes/a)');
  });
});
