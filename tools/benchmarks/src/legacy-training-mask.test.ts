import { describe, expect, it } from 'vitest';

import {
  maskLegacyTrainingQuery,
  remainingLegacyAnswerMarker,
  remainingLeakagePhrase,
} from './legacy-training-mask';

describe('legacy reranker training masking', () => {
  it.each([
    [
      'kr.rf.714_2.pneumonia',
      'Диагностика пневмонии: нужна ли повторная рентгенография',
    ],
    ['kr.rf.381_3.bronchitis', 'Маршрутизация при бронхите: нарастает одышка'],
    ['kr.rf.563_2.measles', 'Диагностика кори после контакта'],
    [
      'kr.rf.58_2.meningococcal',
      'Лечение генерализованной менингококковой инфекции без задержки',
    ],
    ['kr.rf.281_3.uti', 'Ребенок 4 месяцев с фебрильной ИМП'],
  ])('masks inflected answer markers for %s', (documentId, query) => {
    const masked = maskLegacyTrainingQuery(query, [documentId], []);
    expect(masked).toContain('[диагноз]');
    expect(remainingLegacyAnswerMarker(masked, [documentId])).toBeUndefined();
  });

  it('masks inflected urinary diagnosis phrases', () => {
    const query = 'Лечение фебрильной инфекции мочевых путей: нужен ли антибиотик';
    const masked = maskLegacyTrainingQuery(query, ['kr.rf.281_3.uti'], []);
    expect(masked).toContain('[диагноз]');
    expect(masked).not.toContain('инфекции мочевых путей');
  });

  it('masks challenge leakage phrases in addition to target stems', () => {
    const masked = maskLegacyTrainingQuery(
      'Нужна помощь при инфекции мочевых путей у ребенка',
      ['kr.rf.281_3.uti'],
      ['инфекция мочевых путей'],
    );
    expect(masked).toContain('[диагноз]');
    expect(remainingLeakagePhrase(masked, ['инфекция мочевых путей'])).toBeUndefined();
  });

  it('does not erase symptom-only training language', () => {
    const query = 'Грудничок после насморка кашляет, свистит и втягивает межреберья';
    expect(maskLegacyTrainingQuery(query, ['kr.rf.360_3.bronchiolitis'], [])).toBe(query);
  });
});
