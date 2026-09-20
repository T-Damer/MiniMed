import { describe, expect, it } from 'vitest';

import { QueryDocumentIndex } from './query-document-index';

describe('QueryDocumentIndex', () => {
  it('separates strict titles/navigation aliases from broad declared aliases', () => {
    const index = new QueryDocumentIndex([
      {
        id: 'exact-title',
        title: 'D32.0 Оболочек головного мозга, МКБ-10',
        shortTitle: 'D32.0',
        sourceType: 'medical_reference',
        metadata: {
          declaredAliases: ['оболочки головного мозга'],
          navigationAliases: ['D32.0'],
        },
      },
      {
        id: 'broad-alias',
        title: 'Смежный документ',
        shortTitle: null,
        sourceType: 'medical_reference',
        metadata: {
          declaredAliases: ['D32.0'],
        },
      },
    ]);

    expect([...index.exactTitleIds('D32.0 Оболочек головного мозга, МКБ-10')]).toEqual([
      'exact-title',
    ]);
    expect([...index.exactNavigationAliasIds('D32.0')]).toEqual(['exact-title']);
    expect([...index.exactShortTitleIds('D32.0')]).toEqual(['exact-title']);
    expect([...index.exactIdentityIds('D32.0')]).toEqual(['exact-title']);
    expect([...index.exactAliasIds('D32.0')].toSorted()).toEqual([
      'broad-alias',
      'exact-title',
    ]);
  });

  it('normalizes strict identity surfaces consistently with lookup subjects', () => {
    const index = new QueryDocumentIndex([
      {
        id: 'jaspers',
        title: 'Критерии Ясперса',
        shortTitle: null,
        sourceType: 'medical_reference',
        metadata: {
          navigationAliases: ['ЯСПЕРС'],
        },
      },
    ]);

    expect([...index.exactNavigationAliasIds('  Ясперс  ')]).toEqual(['jaspers']);
    expect([...index.exactTitleIds('Критерии Ясперса')]).toEqual(['jaspers']);
  });
});
