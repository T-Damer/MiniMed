import { describe, expect, it } from 'vitest';

import { personalMatchScore, personalQueryStems } from './personal-stem-match';

describe('personalMatchScore', () => {
  it('does not treat a textbook page as a hit from one generic leftover word', () => {
    const queryStems = personalQueryStems('парацетамол детям');
    const genericPage =
      'Педиатрия. Лечение детей: доза в мг/кг, контроль через день, осмотр врача.';
    expect(personalMatchScore(queryStems, genericPage)).toBe(0);
  });

  it('matches when every distinctive query stem is present, including inflected forms', () => {
    const queryStems = personalQueryStems('пневмония ребенок');
    expect(
      personalMatchScore(queryStems, 'Пневмония у ребёнка и контрольный осмотр'),
    ).toBeGreaterThan(0);
  });

  it('matches a single distinctive term without requiring short leftovers', () => {
    const queryStems = personalQueryStems('парацетамол 500 мг');
    expect(personalMatchScore(queryStems, 'Сироп парацетамол, суспензия')).toBeGreaterThan(0);
    expect(personalMatchScore(queryStems, 'Доза 500 мг внутрь')).toBe(0);
  });

  it('requires every short token when the query has no distinctive stem', () => {
    const queryStems = personalQueryStems('500 мг');
    expect(personalMatchScore(queryStems, 'Доза 250 мг')).toBe(0);
    expect(personalMatchScore(queryStems, 'Доза 500 мг внутрь')).toBeGreaterThan(0);
  });
});
