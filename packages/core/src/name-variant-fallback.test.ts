import { buildNameVocabulary } from '@localmed/search-lexical';
import { describe, expect, it } from 'vitest';

import { spellingCorrection } from './name-variant-fallback';

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
