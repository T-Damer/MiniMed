import type { MedicalDocument } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';
import { checkPair, type DrugItem, itemTargets } from './interaction-check';
import { resolveQuotes, sentenceSectionLabel } from './interaction-quotes';
import { buildFixtureIndex, SECTION_TEXT } from './interaction-test-fixtures';
import { highlightPatterns, highlightSegments } from './mention-highlight';

const index = buildFixtureIndex();
const drug = (slug: string): DrugItem => ({
  id: slug,
  kind: 'drug',
  card: index.cardBySlug.get(slug) ?? -1,
  label: slug,
});

function installed(text: string, chunks: readonly string[] = [text]): MedicalDocument {
  return {
    id: 'drug.rf.aaaa.instruction',
    title: 'Варфарин-тест: инструкция',
    shortTitle: null,
    sourceType: 'official_drug_instruction',
    status: 'active',
    specialties: [],
    metadata: {},
    versionId: 'v',
    versionLabel: 'v',
    effectiveFrom: null,
    sections: [
      {
        id: 'section.1111111111111111',
        documentVersionId: 'v',
        parentSectionId: null,
        title: 'Взаимодействие с другими лекарственными средствами',
        sectionType: 'interactions',
        depth: 1,
        orderIndex: 0,
        pageStart: null,
        pageEnd: null,
        anchor: 'a/section',
        sectionPath: [],
        chunks: chunks.map((chunk, position) => ({
          id: `chunk.${position}`,
          sectionId: 'section.1111111111111111',
          documentVersionId: 'v',
          orderIndex: position,
          originalText: chunk,
          pageStart: null,
          pageEnd: null,
          anchor: `a/chunk-${position}`,
        })),
      },
    ],
  };
}

describe('resolveQuotes', () => {
  const pair = checkPair(index, drug('варфарин'), drug('ибупрофен'));
  const patterns = highlightPatterns(index, itemTargets(index, drug('ибупрофен')), []);
  const mark = (text: string) => highlightSegments(text, patterns);

  it('quotes the indexed sentence word for word from the installed instruction, with marks', () => {
    const resolved = resolveQuotes(
      installed(SECTION_TEXT.warfarinInteractions),
      pair.aReadsB.sentences,
      mark,
    );
    expect(resolved.changed).toBe(0);
    expect(resolved.quotes).toHaveLength(1);
    const [quote] = resolved.quotes;
    expect(quote?.text).toContain(
      'Повышенный риск кровотечений при одновременном приеме с ибупрофеном',
    );
    expect(quote?.segments.filter((segment) => segment.hit).map((segment) => segment.text)).toEqual(
      ['ибупрофеном'],
    );
    expect(quote?.anchor).toBe('a/chunk-0');
    expect(sentenceSectionLabel(quote?.flags ?? 0)).toBe(
      'Взаимодействие с другими лекарственными средствами',
    );
  });

  it('points at the chunk the sentence starts in when the section has several', () => {
    const lines = SECTION_TEXT.warfarinInteractions.split('\n');
    const resolved = resolveQuotes(
      installed(SECTION_TEXT.warfarinInteractions, [
        lines.slice(0, 2).join('\n'),
        lines.slice(2).join('\n'),
      ]),
      pair.aReadsB.sentences,
      mark,
    );
    expect(resolved.quotes).toHaveLength(1);
    expect(resolved.quotes[0]?.anchor).toMatch(/^a\/chunk-[01]$/u);
  });

  it('reports a section whose text is not the text the index was built from', () => {
    const resolved = resolveQuotes(
      installed('Совсем другая редакция текста раздела с ибупрофеном.'),
      pair.aReadsB.sentences,
      mark,
    );
    expect(resolved.quotes).toEqual([]);
    expect(resolved.changed).toBe(pair.aReadsB.sentences.length);
  });
});

describe('highlightSegments', () => {
  it('returns one plain run when there is nothing to mark', () => {
    expect(highlightSegments('Текст', [])).toEqual([{ text: 'Текст', hit: false }]);
  });
});
