import { describe, expect, it } from 'vitest';

import { spanDisplayText } from '@/features/drug-interactions/interaction-text';
import { splitComparisonItems } from './comparison-units';

const units = (text: string, title = ''): readonly string[] =>
  splitComparisonItems(text, title).map((span) => spanDisplayText(text, span));

describe('splitComparisonItems', () => {
  it('splits a bulleted list printed over wrapped lines, dropping the bullet glyph', () => {
    const text =
      ' Гиперчувствительность к ибупрофену или любому из компонентов,\n\nвходящих в состав препарата.\n\n Воспалительные заболевания кишечника (болезнь Крона, язвенный\n\nколит).\n\n Беременность (III триместр).';
    expect(units(text)).toEqual([
      'Гиперчувствительность к ибупрофену или любому из компонентов, входящих в состав препарата.',
      'Воспалительные заболевания кишечника (болезнь Крона, язвенный колит).',
      'Беременность (III триместр).',
    ]);
  });

  it('splits sentences at a full stop and a capital letter, not inside an abbreviation or a number', () => {
    const text =
      'Препарат применяют внутрь, т. е. через рот. Разовая доза 1.5 г для взрослых. Детям до 12 лет не назначают.';
    expect(units(text)).toEqual([
      'Препарат применяют внутрь, т. е. через рот.',
      'Разовая доза 1.5 г для взрослых.',
      'Детям до 12 лет не назначают.',
    ]);
  });

  it('splits «;» items outside brackets and keeps bracketed «;» together', () => {
    const text =
      'Тошнота; рвота (в т. ч. неукротимая; редко); диарея; головная боль, головокружение.';
    expect(units(text)).toEqual([
      'Тошнота;',
      'рвота (в т. ч. неукротимая; редко);',
      'диарея;',
      'головная боль, головокружение.',
    ]);
  });

  it('keeps a wrapped sentence together when the next line starts in lower case', () => {
    const text =
      'Препарат принимают внутрь после еды,\n\nзапивая водой.\n\nКурс лечения не более 5 дней.';
    expect(units(text)).toEqual([
      'Препарат принимают внутрь после еды, запивая водой.',
      'Курс лечения не более 5 дней.',
    ]);
  });

  it('keeps a heading with the unit that follows it', () => {
    const text =
      'Нарушения со стороны сердца\n\nчастота неизвестна: сердечная недостаточность, периферические отеки.\n\nСимптомы:\n\nТошнота, рвота, боль в эпигастральной области.';
    expect(units(text)).toEqual([
      'Нарушения со стороны сердца частота неизвестна: сердечная недостаточность, периферические отеки.',
      'Симптомы: Тошнота, рвота, боль в эпигастральной области.',
    ]);
  });

  it("drops the section's own title repeated at the start", () => {
    const text =
      'Передозировка\n\nУ детей симптомы могут возникать после приема дозы более 400 мг/кг.';
    expect(units(text, 'Передозировка')).toEqual([
      'У детей симптомы могут возникать после приема дозы более 400 мг/кг.',
    ]);
  });

  it('splits numbered items and inline bullets', () => {
    const text =
      '1. Первое состояние.\n\n2) Второе состояние.\n\nСписок • первый пункт • второй пункт';
    expect(units(text)).toEqual([
      'Первое состояние.',
      'Второе состояние.',
      'Список',
      'первый пункт',
      'второй пункт',
    ]);
  });

  it('returns spans that are plain substrings of the text', () => {
    const text = ' Первый пункт списка;\n\n второй пункт списка.';
    for (const span of splitComparisonItems(text)) {
      expect(span.start).toBeGreaterThanOrEqual(0);
      expect(span.end).toBeLessThanOrEqual(text.length);
      expect(text.slice(span.start, span.end)).toBe(text.slice(span.start, span.end).trim());
    }
  });

  it('gives nothing for an empty text or one without letters', () => {
    expect(units('')).toEqual([]);
    expect(units('\n\n 12 \n')).toEqual([]);
  });
});
