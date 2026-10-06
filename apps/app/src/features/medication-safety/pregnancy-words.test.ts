import { describe, expect, it } from 'vitest';

import {
  isPregnancyHeading,
  opensOtherSection,
  TOPIC_LACTATION,
  TOPIC_PREGNANCY,
  topicsOf,
} from './pregnancy-words';

describe('topicsOf', () => {
  it.each([
    ['Применение при беременности запрещено.', TOPIC_PREGNANCY],
    ['Препарат противопоказан в III триместре.', TOPIC_PREGNANCY],
    ['Опасен для плода.', TOPIC_PREGNANCY],
    ['Тератогенное действие у животных.', TOPIC_PREGNANCY],
    ['Не применять при лактации.', TOPIC_LACTATION],
    ['Выделяется с грудным молоком.', TOPIC_LACTATION],
    ['Кормящим женщинам не назначают.', TOPIC_LACTATION],
    ['Если Вы кормите ребенка грудью, сообщите врачу.', TOPIC_LACTATION],
    ['При беременности и грудном вскармливании.', TOPIC_PREGNANCY | TOPIC_LACTATION],
    ['Проникает в женское молоко.', TOPIC_LACTATION],
  ])('%s', (text, topic) => {
    expect(topicsOf(text)).toBe(topic);
  });

  it.each([
    'Настой плодов шиповника. Плоды цельные.',
    'Не наносить на кожу под грудью.',
    'Запивать молоком не следует.',
    'Применяют у взрослых и детей.',
  ])('finds nothing in %s', (text) => {
    expect(topicsOf(text)).toBe(0);
  });
});

describe('isPregnancyHeading', () => {
  it.each([
    'Применение при беременности и в период грудного вскармливания',
    'ПРИМЕНЕНИЕ ПРИ БЕРЕМЕННОСТИ И В ПЕРИОД ЛАКТАЦИИ',
    'Беременность и грудное вскармливание',
    'Беременность, грудное вскармливание и фертильность',
    '3. Беременность',
    'Грудное вскармливание',
    'Лактация',
  ])('accepts %s', (title) => {
    expect(isPregnancyHeading(title)).toBe(true);
  });

  it.each([
    'Способ применения и дозы',
    'Состав',
    'Особые указания',
    'Если Вы забеременели во время приема препарата, немедленно обратитесь к врачу. Врач может подобрать другое лечение.',
  ])('refuses %s', (title) => {
    expect(isPregnancyHeading(title)).toBe(false);
  });
});

describe('a pointer to another section', () => {
  it('is not a mention of the topic', () => {
    expect(
      topicsOf('См. раздел «Применение при беременности и в период грудного вскармливания».'),
    ).toBe(0);
    expect(topicsOf('Подробнее в разделе «Беременность».')).toBe(0);
    expect(
      topicsOf('Применение при беременности противопоказано (см. раздел «Противопоказания»).'),
    ).toBe(TOPIC_PREGNANCY);
  });
});

describe('opensOtherSection', () => {
  it('reads a heading the OCR spelled with Latin letters', () => {
    expect(opensOtherSection('Cпособ применения и дозы.')).toBe(true);
  });

  it('knows the standard headings of the other sections', () => {
    expect(opensOtherSection('Фертильность Нет данных.')).toBe(true);
    expect(opensOtherSection('Влияние на способность управлять транспортными средствами.')).toBe(
      true,
    );
    expect(opensOtherSection('Препарат противопоказан.')).toBe(false);
  });
});
