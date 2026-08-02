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

  it('recognizes the colloquial profosmot wording as a preventive-exam request', () => {
    const ranked = rankSearchGroupsByQuery(
      [
        group('follow-up', 'Диспансерное наблюдение несовершеннолетних — приказ № 192н', 1.1),
        group('pediatrics', 'Порядок оказания помощи по профилю «Педиатрия»', 1.05),
        group(
          'preventive',
          'Профилактические медицинские осмотры несовершеннолетних — приказ № 211н',
          0.72,
        ),
      ],
      'Как провести детский профосмотр, если в медицинской организации нет нужного специалиста?',
    );

    expect(ranked.map((item) => item.documentId)).toEqual([
      'preventive',
      'follow-up',
      'pediatrics',
    ]);
  });

  it('demotes a superseded card when the query asks for the current order', () => {
    const ranked = rankSearchGroupsByQuery(
      [
        group(
          'old',
          'Порядок оказания педиатрической помощи — приказ № 366н (утратил силу)',
          1.1,
        ),
        group(
          'current',
          'Порядок оказания медицинской помощи по профилю «Педиатрия» — приказ № 120н',
          0.75,
        ),
      ],
      'Какой действующий приказ устанавливает порядок оказания медицинской помощи по профилю педиатрия?',
    );

    expect(ranked.map((item) => item.documentId)).toEqual(['current', 'old']);
  });

  it('keeps a historical redirect discoverable when the query asks about an obsolete order', () => {
    const ranked = rankSearchGroupsByQuery(
      [
        group('current', 'Экспертиза временной нетрудоспособности — приказ № 195н', 0.95),
        group('old', 'Экспертиза временной нетрудоспособности — приказ № 625н (утратил силу)', 0.5),
      ],
      'Приказ 625н утратил силу?',
    );

    expect(ranked.map((item) => item.documentId)).toEqual(['old', 'current']);
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
