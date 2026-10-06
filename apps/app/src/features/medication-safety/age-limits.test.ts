import { describe, expect, it } from 'vitest';

import {
  type AmountLimit,
  CHILD_AGE_LIMIT_DAYS,
  extractAmountLimits,
  extractCategoryLimits,
  formatAgeDays,
  isListItem,
  normalizeForLimits,
  parseTypedAge,
} from './age-limits';

const YEAR = 365.25;
const years = (count: number): number => Math.round(count * YEAR);
const months = (count: number): number => Math.round((count * YEAR) / 12);

function limitsOf(
  text: string,
): readonly (readonly [string, string, number | null, number | null])[] {
  return extractAmountLimits(text).map((item) => [
    item.dimension,
    item.operator,
    item.lower,
    item.upper,
  ]);
}

function words(text: string, item: AmountLimit): string {
  return text.slice(item.start, item.end);
}

describe('extractAmountLimits: upper age bounds', () => {
  it.each([
    ['Противопоказано: детский возраст до 12 лет.', years(12)],
    ['Не применяют у детей младше 6 лет.', years(6)],
    ['Препарат противопоказан детям и подросткам в возрасте до 18 лет.', years(18)],
    ['Противопоказан пациентам, не достигшим 18 лет.', years(18)],
    ['Противопоказан детям, не достигшим возраста 12 лет.', years(12)],
    ['Детский возраст (до 2-х лет).', years(2)],
    ['Детский возраст до 3-х лет.', years(3)],
    ['Дети моложе двенадцати лет.', years(12)],
    ['Детский возраст менее 3 лет.', years(3)],
    ['Дети в возрасте до 1 года.', years(1)],
    ['Применение у детей до года не изучалось.', years(1)],
    ['Возраст до 6 месяцев.', months(6)],
    ['Новорожденные в возрасте до 4 недель.', 28],
    ['Детский возраст до 18-летнего возраста.', years(18)],
    ['Каждые 8 ч до достижения возраста 1 мес.', months(1)],
  ])('reads %s', (text, upper) => {
    expect(limitsOf(text)).toEqual([['age', 'below', null, upper]]);
  });
});

describe('extractAmountLimits: lower age bounds', () => {
  it.each([
    ['Детям с 3 лет назначают по 1 таблетке.', years(3)],
    ['Применяют у детей старше 12 лет.', years(12)],
    ['Препарат показан детям от 6 лет.', years(6)],
    ['Дети в возрасте от 6 месяцев и старше.', months(6)],
    ['Взрослым и детям в возрасте 12 лет и старше.', years(12)],
    ['Детям с шести лет.', years(6)],
    ['Детям после 12 лет.', years(12)],
    ['Для детей с года.', years(1)],
    ['Дети старше 3-х лет получают раствор.', years(3)],
    ['У детей с 12-летнего возраста.', years(12)],
    ['Детям в возрасте от 7 дней.', 7],
  ])('reads %s', (text, lower) => {
    expect(limitsOf(text)).toEqual([['age', 'from', lower, null]]);
  });
});

describe('extractAmountLimits: ranges', () => {
  it('reads «от 6 до 12 лет»', () => {
    expect(limitsOf('Дети в возрасте от 6 до 12 лет принимают половину дозы.')).toEqual([
      ['age', 'range', years(6), years(12)],
    ]);
  });

  it('reads a range whose first number has its own unit', () => {
    expect(limitsOf('Дети в возрасте от 6 месяцев до 3 лет.')).toEqual([
      ['age', 'range', months(6), years(3)],
    ]);
  });

  it('reads a dashed range', () => {
    expect(limitsOf('У детей 3-4 лет доза составляет 1 таблетку.')).toEqual([
      ['age', 'range', years(3), years(4)],
    ]);
  });

  it('reads several limits of one sentence in reading order', () => {
    const text = 'Детям до 6 лет противопоказано, детям старше 12 лет — по 1 таблетке.';
    expect(limitsOf(text)).toEqual([
      ['age', 'below', null, years(6)],
      ['age', 'from', years(12), null],
    ]);
  });
});

describe('extractAmountLimits: what is not an age limit', () => {
  it.each([
    'Курс лечения не более 3 месяцев.',
    'Применять в течение до 14 дней.',
    'Лечение у детей продолжается до 3 месяцев.',
    'Срок годности 3 года.',
    'Принимать до 3 раз в сутки.',
    'Не использовать более 2 лет после вскрытия.',
    'Рекомендуется для больных старше 65 лет.',
    'Гестационный возраст менее 38 недель.',
    'Прекратить терапию при костном возрасте 13–14 лет.',
    'Доза 20 мг на 1 кг массы тела.',
    'Если индекс массы тела выше 30 кг/м2.',
    'Если снижение массы тела менее 5 кг в течение 3 месяцев.',
    'Добавляют 2 мл на каждый кг массы тела свыше 10 кг.',
  ])('ignores %s', (text) => {
    expect(extractAmountLimits(text)).toEqual([]);
  });
});

describe('extractAmountLimits: weight', () => {
  it('keeps weight limits apart from age', () => {
    expect(limitsOf('Детям с массой тела менее 20 кг не применять.')).toEqual([
      ['weight', 'below', null, 200],
    ]);
    expect(limitsOf('Дети с массой тела более 25 кг получают 400 мг.')).toEqual([
      ['weight', 'from', 250, null],
    ]);
    expect(limitsOf('Дети с массой тела от 11 до 20 кг.')).toEqual([['weight', 'range', 110, 200]]);
  });

  it('reads age and weight in one sentence', () => {
    expect(limitsOf('Не давать детям до 6 лет и с массой тела менее 20 кг.')).toEqual([
      ['age', 'below', null, years(6)],
      ['weight', 'below', null, 200],
    ]);
  });

  it('does not read a dose per kilogram', () => {
    expect(extractAmountLimits('Дети: не более 5 мг/кг массы тела.')).toEqual([]);
  });
});

describe('extractAmountLimits: a word of treatment before the age word', () => {
  it('does not make the age a duration', () => {
    expect(
      limitsOf('Дополнительная терапия для детей в возрасте от 1 месяца до 6 месяцев.'),
    ).toEqual([['age', 'range', months(1), months(6)]]);
  });
});

describe('extractAmountLimits: ranges with a note in brackets', () => {
  it('reads «от 1,5 лет (18 месяцев) до 6 лет»', () => {
    expect(limitsOf('Детям от 1,5 лет (18 месяцев) до 6 лет таблетку растворяют.')).toEqual([
      ['age', 'range', years(1.5), years(6)],
    ]);
  });

  it('reads a weight range with «включительно»', () => {
    expect(limitsOf('Дети с массой тела от 30 кг (включительно) до 50 кг.')).toEqual([
      ['weight', 'range', 300, 500],
    ]);
  });

  it('reads «от 10 кг и более до 20 кг»', () => {
    expect(limitsOf('Дети весом от 10 кг и более до 20 кг получают 1 мг/кг.')).toEqual([
      ['weight', 'range', 100, 200],
    ]);
  });
});

describe('extractAmountLimits: offsets', () => {
  it('points at the words of the limit in the original text, with its case and line breaks', () => {
    const text = 'Детский\nвозраст ДО 12 ЛЕТ.\nДругое.';
    const [item] = extractAmountLimits(text);
    expect(item && words(text, item)).toBe('ДО 12 ЛЕТ');
  });

  it('keeps the length of the text', () => {
    const text = 'Дети — с 3 лет. Ёж';
    expect(normalizeForLimits(text)).toHaveLength(text.length);
  });
});

describe('extractCategoryLimits', () => {
  it('finds age groups that the sentence restricts', () => {
    const text = 'Препарат противопоказан новорожденным и недоношенным детям.';
    expect(extractCategoryLimits(text).map((item) => item.category)).toEqual([
      'newborn',
      'premature',
      'children',
    ]);
  });

  it('needs a restricting word in the sentence', () => {
    expect(extractCategoryLimits('Новорожденным вводят по 5 мг.')).toEqual([]);
  });

  it('finds the general statement about children', () => {
    expect(
      extractCategoryLimits('Безопасность и эффективность у детей не установлены.').map(
        (item) => item.category,
      ),
    ).toEqual(['children']);
  });

  it('does not take the child in the womb for a patient', () => {
    expect(
      extractCategoryLimits('Не применять при беременности: препарат вреден для ребенка.'),
    ).toEqual([]);
  });
});

describe('isListItem', () => {
  it('knows an item of a list from a word inside a sentence', () => {
    const list = 'беременность; детский возраст; пожилой возраст.';
    const start = list.indexOf('детский');
    expect(isListItem(list, start, start + 'детский возраст'.length)).toBe(true);
    const sentence = 'Риск для новорожденных, матери которых принимали препарат.';
    expect(isListItem(sentence, 9, 21)).toBe(false);
  });
});

describe('formatAgeDays and parseTypedAge', () => {
  it('writes ages in the nominative and after «до»', () => {
    expect(formatAgeDays(years(3))).toBe('3 года');
    expect(formatAgeDays(years(12), 'genitive')).toBe('12 лет');
    expect(formatAgeDays(years(1), 'genitive')).toBe('1 года');
    expect(formatAgeDays(years(21), 'genitive')).toBe('21 года');
    expect(formatAgeDays(years(2), 'genitive')).toBe('2 лет');
    expect(formatAgeDays(months(6), 'genitive')).toBe('6 месяцев');
    expect(formatAgeDays(months(1), 'genitive')).toBe('1 месяца');
    expect(formatAgeDays(28, 'genitive')).toBe('4 недель');
    expect(formatAgeDays(0, 'genitive')).toBe('рождения');
  });

  it('reads an age typed by the doctor', () => {
    expect(parseTypedAge('3 года')).toBe(years(3));
    expect(parseTypedAge('3')).toBeNull();
    expect(parseTypedAge('6 мес')).toBe(months(6));
    expect(parseTypedAge('трех лет')).toBe(years(3));
    expect(parseTypedAge('20 кг')).toBeNull();
  });

  it('keeps the child range at 18 years', () => {
    expect(CHILD_AGE_LIMIT_DAYS).toBe(years(18));
  });
});
