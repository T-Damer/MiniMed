import { buildNameVocabulary } from '@localmed/search-lexical';
import { describe, expect, it } from 'vitest';

import { spellingCorrection, spellingCorrectionWithCost } from './name-variant-fallback';

const vocabulary = buildNameVocabulary(['деструкция стекловидного тела', 'ибупрофен', 'метформин']);

describe('spellingCorrection qualifier words', () => {
  it('does not turn «инструкция» into «деструкция»', () => {
    expect(spellingCorrection('ибупрофен инструкция', vocabulary)).toBeNull();
    expect(spellingCorrection('Ибупрофен: официальная инструкция', vocabulary)).toBeNull();
  });

  it('still repairs a misspelt subject word next to a qualifier', () => {
    expect(spellingCorrection('мтеформин инструкция', vocabulary)?.correctedQuery).toBe(
      'метформин инструкция',
    );
  });
});

describe('spellingCorrectionWithCost (roadmap item 24)', () => {
  const names = buildNameVocabulary(['депрессия', 'метформин']);

  it('marks a correction of more than one edit as stretched', () => {
    const two = spellingCorrectionWithCost('дшпресшия', names);
    expect(two?.correction.correctedQuery).toBe('депрессия');
    expect(two?.stretched).toBe(true);
  });

  it('trusts a correction of one full edit or two cheap slips', () => {
    expect(spellingCorrectionWithCost('мтеформин', names)?.stretched).toBe(false);
    expect(spellingCorrectionWithCost('дипрессея', names)?.stretched).toBe(false);
  });
});
