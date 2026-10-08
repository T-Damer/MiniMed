import type { DefinitionReferenceReply, DefinitionReferenceRequest } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';
import { loadTermArticle } from './term-article';

const scope = { moduleId: 'minimed.definition.reference.ru', editionId: 'e' };
const card = {
  id: 'krterm.1',
  title: 'Депрессия',
  kind: 'term',
  coverage: 'explicit-definition',
  textKind: 'source-excerpt' as const,
  reviewStatus: 'requires-review' as const,
  identityStatus: 'source-local-proposed' as const,
  blockCount: 3,
  match: 'name' as const,
};
const block = (chunkId: string, role: 'definition' | 'item' | 'annotation' | 'context') => ({
  linkId: `krterm.1.reference.${chunkId}`,
  chunkId,
  sourceId: 'reference.source.a',
  role,
  characters: 10,
});

function reader(calls: DefinitionReferenceRequest[] = []) {
  const texts: Record<string, readonly string[]> = {
    c1: ['Депрессия – процесс формирования перелома.'],
    c2: ['Депрессия – процесс формирования перелома.'],
    c3: ['{"note":"pipeline"}'],
    c4: ['Первая часть длинного пункта, ', 'продолжение.'],
  };
  const documents: Record<string, string> = { c1: '904_1', c2: '905_1', c4: '904_1' };
  return async (request: DefinitionReferenceRequest): Promise<DefinitionReferenceReply> => {
    calls.push(request);
    if (request.op === 'card') return { op: 'card', card };
    if (request.op === 'blocks')
      return {
        op: 'blocks',
        page: {
          blocks: [
            block('c1', 'definition'),
            block('c2', 'definition'),
            block('c3', 'annotation'),
            block('c4', 'item'),
          ],
          next: null,
        },
      };
    if (request.op === 'source')
      return {
        op: 'source',
        source: { source: { title: 'Клинические рекомендации', authority: 'official' } },
      };
    if (request.op !== 'text') throw new Error('unexpected');
    const parts = texts[request.chunkId] ?? [];
    const index = request.offset ? 1 : 0;
    return {
      op: 'text',
      block: {
        text: parts[index] ?? '',
        nextOffset: index + 1 < parts.length ? 100 : null,
        totalCharacters: 100,
        sourceId: 'reference.source.a',
        provenance: {
          documentId: `kr.rf.${documents[request.chunkId]}`,
          documentTitle: `КР ${documents[request.chunkId]}`,
          anchor: `a-${request.chunkId}`,
        },
      },
    };
  };
}

describe('loadTermArticle', () => {
  it('returns the source paragraphs in order, continues long blocks and skips pipeline notes', async () => {
    const article = await loadTermArticle(reader(), scope, 'krterm.1');
    expect(article.paragraphs.map((paragraph) => paragraph.role)).toEqual([
      'definition',
      'definition',
      'item',
    ]);
    expect(article.paragraphs[2]?.text).toBe('Первая часть длинного пункта, продолжение.');
    expect(JSON.stringify(article)).not.toContain('pipeline');
  });

  it('lists each citing document once, with its exact anchor', async () => {
    const calls: DefinitionReferenceRequest[] = [];
    const article = await loadTermArticle(reader(calls), scope, 'krterm.1');
    expect(article.sources.map((source) => source.label)).toEqual(['КР: КР 904_1', 'КР: КР 905_1']);
    expect(article.sources[0]?.link).toEqual({
      kind: 'document',
      documentId: 'kr.rf.904_1',
      anchor: 'a-c1',
    });
    // The source descriptor is read once for all blocks of the same source.
    expect(calls.filter((call) => call.op === 'source')).toHaveLength(1);
  });
});
