import type { SearchResultGroup } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import { queryGroupRelevanceBoost, rankSearchGroupsByQuery } from './query-group-ranking';

function group(documentId: string, title: string, bestScore: number): SearchResultGroup {
  return {
    documentId,
    title,
    bestScore,
    categories: ['other'],
    results: [],
  };
}

describe('query-aware group ranking', () => {
  it('gives an explicit legal document number priority over generic wording matches', () => {
    const ranked = rankSearchGroupsByQuery(
      [
        group('preventive', 'Профилактические осмотры детей — приказ № 211н', 0.95),
        group('law', 'Охрана здоровья граждан — Федеральный закон № 323-ФЗ', 0.65),
      ],
      'Кто подписывает согласие ребенку по 323-ФЗ?',
    );

    expect(ranked.map((item) => item.documentId)).toEqual(['law', 'preventive']);
  });

  it('distinguishes a health-group question from a disability question with the same diagnosis', () => {
    const ranked = rankSearchGroupsByQuery(
      [
        group('disability', 'Критерии инвалидности для взрослых и детей', 0.9),
        group('health', 'Группы здоровья взрослого населения — приказ № 404н', 0.72),
      ],
      'Сахарный диабет 2 типа у взрослого. Какая группа здоровья?',
    );

    expect(ranked.map((item) => item.documentId)).toEqual(['health', 'disability']);
  });

  it('preserves the base order when titles have equal query relevance', () => {
    const ranked = rankSearchGroupsByQuery(
      [group('first', 'Первый документ', 0.8), group('second', 'Второй документ', 0.7)],
      'неуточненный вопрос',
    );

    expect(ranked.map((item) => item.documentId)).toEqual(['first', 'second']);
  });

  it('recognizes compact and hyphenated document numbers as the same reference', () => {
    expect(
      queryGroupRelevanceBoost(
        'Что говорит приказ 1122н о календаре прививок?',
        'Национальный календарь профилактических прививок — приказ № 1122н',
      ),
    ).toBeGreaterThanOrEqual(1);
    expect(
      queryGroupRelevanceBoost(
        'Отказ от прививки по 157-ФЗ',
        'Иммунопрофилактика — Федеральный закон № 157-ФЗ',
      ),
    ).toBeGreaterThanOrEqual(1);
  });
});
