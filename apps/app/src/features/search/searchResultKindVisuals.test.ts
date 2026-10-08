import { describe, expect, it } from 'vitest';
import { RESULT_TYPE_VISUALS, resultTypeVisual } from '@/features/search/searchResultKindVisuals';

describe('resultTypeVisual', () => {
  it('labels a card by the document type, not by the coarse kind', () => {
    expect(resultTypeVisual({ documentKind: 'reference', documentType: 'icd10' }).label).toBe(
      'МКБ-10',
    );
    expect(
      resultTypeVisual({
        documentKind: 'clinical-recommendation',
        documentType: 'clinical-recommendation',
      }).label,
    ).toBe('Клинические рекомендации');
  });

  it('reads a term found as itself as its definition', () => {
    expect(
      resultTypeVisual({
        documentKind: 'reference',
        documentType: 'reference',
        terminologyMatch: 'term',
      }),
    ).toBe(RESULT_TYPE_VISUALS.definition);
  });

  it('falls back on the kind for a saved search without a type, never on «Норма / справочник»', () => {
    expect(resultTypeVisual({ documentKind: 'medication' }).label).toBe('Препарат');
    expect(resultTypeVisual({}).label).toBe('Справочник');
  });
});
