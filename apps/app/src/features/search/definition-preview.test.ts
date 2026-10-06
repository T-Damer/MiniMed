import type { CoreIdentityHit, SearchResultGroup } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';
import {
  definitionFromResults,
  definitionHitHasText,
  definitionPreviewText,
  selectDefinitionPreview,
  splitLeadingTerm,
} from '@/features/search/definition-preview';

function hit(title: string, coverage: string, entityId: string): CoreIdentityHit {
  return {
    name: title,
    title,
    kind: 'term',
    coverage,
    target: {
      type: 'definition',
      moduleId: 'minimed.definition.reference.ru',
      moduleVersion: '2026.9.30',
      entityId,
      editionId: 'minimed.definition.reference.2026.9.30',
    },
  };
}

describe('selectDefinitionPreview', () => {
  it('folds the same name from several dictionaries into one preview, best definition first', () => {
    const selection = selectDefinitionPreview(
      [
        hit('Эпилепсия', 'needs-definition', 'ruwiki.definition.41205'),
        hit('эпилепсия', 'gloss', 'ruwikt.ddc19fa4'),
        hit('Эпилепсия', 'explicit-definition', 'prepared.definition.4bea'),
        hit('Эпилепсия', 'explicit-definition', 'prepared.definition.a7ab'),
      ],
      'Эпилепсия',
    );
    expect(selection?.main.title).toBe('Эпилепсия');
    expect(selection?.main.primary.target).toMatchObject({ entityId: 'prepared.definition.4bea' });
    expect(selection?.main.others.map((entry) => entry.coverage)).toEqual([
      'explicit-definition',
      'gloss',
      'needs-definition',
    ]);
    expect(selection?.also).toEqual([]);
  });

  it('leads with the name the query asks for and offers the others separately', () => {
    const selection = selectDefinitionPreview(
      [hit('Эпилептический статус', 'explicit-definition', 'a'), hit('Статус', 'gloss', 'b')],
      'статус',
    );
    expect(selection?.main.title).toBe('Статус');
    expect(selection?.also.map((group) => group.title)).toEqual(['Эпилептический статус']);
  });

  it('returns nothing without hits', () => {
    expect(selectDefinitionPreview([], 'x')).toBeUndefined();
  });

  it('knows which entries have no text of their own', () => {
    expect(definitionHitHasText(hit('A', 'needs-definition', 'a'))).toBe(false);
    expect(definitionHitHasText(hit('A', 'gloss', 'a'))).toBe(true);
  });
});

describe('definitionPreviewText', () => {
  it('keeps a short definition as it is, whitespace collapsed', () => {
    expect(definitionPreviewText('Эпилепсия —  хроническое\nзаболевание.')).toBe(
      'Эпилепсия — хроническое заболевание.',
    );
  });

  it('keeps whole sentences up to the limit', () => {
    const text = `${'Первое предложение определения. '.repeat(3)}Последнее очень длинное предложение ${'слово '.repeat(40)}.`;
    const preview = definitionPreviewText(text, 120);
    expect(preview.endsWith('определения.')).toBe(true);
    expect(preview.length).toBeLessThanOrEqual(120);
  });

  it('cuts one long sentence at a word with an ellipsis', () => {
    const preview = definitionPreviewText(`Состояние ${'очень '.repeat(80)}длинное`, 100);
    expect(preview.endsWith('…')).toBe(true);
    expect(preview.length).toBeLessThanOrEqual(101);
    expect(preview).not.toMatch(/\s…$/u);
  });
});

describe('definitionFromResults', () => {
  const group = (title: string, section: string, snippet: string): SearchResultGroup =>
    ({
      documentId: `doc:${title}`,
      title,
      bestScore: 1,
      categories: [],
      results: [{ sectionPath: [section], snippet, anchor: 'a' }],
    }) as unknown as SearchResultGroup;

  it('quotes the definition section of a document named like the term', () => {
    const found = definitionFromResults(
      [
        group(
          'Эпилепсия и эпилептический статус',
          'Определение',
          'Другое заболевание и его описание.',
        ),
        group(
          'Эпилепсия',
          'Краткое описание',
          'Эпилепсия — это состояние с повторными приступами.',
        ),
      ],
      'эпилепсия',
    );
    expect(found).toMatchObject({
      documentId: 'doc:Эпилепсия',
      text: 'Эпилепсия — это состояние с повторными приступами.',
    });
  });

  it('accepts a numbered recommendation section and ignores other sections', () => {
    expect(
      definitionFromResults(
        [
          group(
            'Мигрень',
            '1.1 Определение заболевания или состояния',
            'Мигрень — первичная форма головной боли.',
          ),
        ],
        'Мигрень',
      )?.documentId,
    ).toBe('doc:Мигрень');
    expect(
      definitionFromResults(
        [group('Мигрень', 'Лечение', 'Длинный текст о лечении мигрени.')],
        'Мигрень',
      ),
    ).toBeUndefined();
  });
});

describe('splitLeadingTerm', () => {
  it('takes the text’s own opening term and keeps the rest verbatim', () => {
    expect(splitLeadingTerm('Эпилепсия— это состояние.', 'эпилепсия')).toEqual({
      lead: 'Эпилепсия',
      rest: '— это состояние.',
    });
  });

  it('does not split a longer word or another opening', () => {
    expect(splitLeadingTerm('Эпилепсиями называют…', 'Эпилепсия')).toBeUndefined();
    expect(splitLeadingTerm('Хроническое заболевание.', 'Эпилепсия')).toBeUndefined();
  });
});
