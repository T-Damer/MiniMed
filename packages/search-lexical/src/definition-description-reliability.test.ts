import { describe, expect, it } from 'vitest';
import { planDefinitionDescription, rankDefinitionDescriptions } from './definition-description';

function plan(query: string) {
  const result = planDefinitionDescription(query);
  if (!result) throw new Error('Expected description plan');
  return result;
}
const candidate = (id: string, text: string) => ({ id, text, retrievalRank: 0 });

describe('definition evidence reliability', () => {
  it('rejects the opposite polarity for a positive query too', () => {
    const result = rankDefinitionDescriptions(plan('запахи ощущаются'), [
      candidate('absent', 'Запахи не ощущаются.'),
      candidate('present', 'Запахи ощущаются.'),
    ]);
    expect(result.map((row) => row.id)).toEqual(['present']);
  });
  it('does not interpret the additive construction не только as absence', () => {
    const query = plan('не только зрительное восприятие, но и слуховое восприятие');
    expect(query.terms.every((term) => !term.absent)).toBe(true);
  });
  it('bounds absence by additional explicit contrast conjunctions', () => {
    const query = plan('боль отсутствует однако движение сохранено');
    expect(query.terms.find((term) => term.stem === 'боль')?.absent).toBe(true);
    expect(query.terms.find((term) => term.stem === 'движ')?.absent).toBe(false);
  });
  it('does not increase rarity weights when a source repeats the same evidence', () => {
    const query = plan('короткое движение мышцы');
    const repeated = candidate('a', 'Короткое движение мышцы.');
    const rows = [
      repeated,
      candidate('b', 'Короткое движение.'),
      candidate('c', 'Изменение длины мышцы.'),
    ];
    expect(rankDefinitionDescriptions(query, [...rows, repeated, repeated])).toEqual(
      rankDefinitionDescriptions(query, rows),
    );
  });
  it('retains a later complete passage from the same source identity', () => {
    const result = rankDefinitionDescriptions(plan('короткое движение мышцы'), [
      candidate('a', 'Измеряется длина мышцы.'),
      candidate('a', 'Короткое движение мышцы.'),
    ]);
    expect(result[0]).toMatchObject({ id: 'a', matched: 3, total: 3 });
  });
  it('does not fabricate complete coverage by joining unrelated evidence rows', () => {
    expect(
      rankDefinitionDescriptions(plan('красный длинный круглый объект'), [
        candidate('a', 'Красный объект.'),
        candidate('a', 'Длинный круглый.'),
      ]),
    ).toEqual([]);
  });
  it('repairs a single adjacent transposition in a long word inside retrieved evidence', () => {
    const result = rankDefinitionDescriptions(plan('кратковременные сокращнеия мышцы'), [
      candidate('a', 'Кратковременные сокращения мышцы.'),
    ]);
    expect(result[0]).toMatchObject({ id: 'a', matched: 3 });
  });
  it('never treats different numerical values as a spelling error', () => {
    const result = rankDefinitionDescriptions(plan('число 12345678'), [
      candidate('a', 'Число 12346578.'),
    ]);
    expect(result).toEqual([]);
  });
  it('never repairs a short clinically meaningful token by fuzzy matching', () => {
    expect(rankDefinitionDescriptions(plan('боль тела'), [candidate('a', 'Моль тела.')])).toEqual(
      [],
    );
  });
});
