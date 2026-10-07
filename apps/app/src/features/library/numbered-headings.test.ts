import { describe, expect, it } from 'vitest';

import { parseNumberedHeading } from '@/features/library/numbered-headings';

describe('parseNumberedHeading', () => {
  it.each([
    ['1.1 Определение заболевания или состояния (группы заболеваний или состояний)', '1.1', 2],
    ['1.2.2.1 Эпидемиология', '1.2.2.1', 4],
    ['3.2.1. Выбор стратегии лечения пациента с ОКСбпST в стационаре', '3.2.1', 3],
    ['3.1.2.2.3 Медикаментозная кардиоверсия', '3.1.2.2.3', 5],
    ['2.2 Неспецифические осложнения:', '2.2', 2],
    ['1.5.3 Международная классификация стадий (TNM):', '1.5.3', 3],
    ['3.10 Как болезнь может повлиять на половую жизнь, беременность, контрацепцию?', '3.10', 2],
    ['2.2.1 Как диагностируется системный склероз? Каковы основные симптомы?', '2.2.1', 3],
    ['3.5.1.1 Оценка перед проведением катетерного тромболизиса (КТЛ)', '3.5.1.1', 4],
    ['2.11 ВСТАВАНИЕ С ПОСТЕЛИ, СИДЕНИЯ АВТОМОБИЛЯ ИЛИ ГЛУБОКОГО КРЕСЛА', '2.11', 2],
    ['  1.4.8. Диагностика состояния зубочелюстной системы  ', '1.4.8', 3],
  ])('reads %j as a heading of number %s', (line, number, depth) => {
    const heading = parseNumberedHeading(line);
    expect(heading?.number).toBe(number);
    expect(heading?.depth).toBe(depth);
  });

  it('drops the trailing full stop from the title but keeps the rest as printed', () => {
    expect(parseNumberedHeading('3.1.6 Лечение десмоидных опухолей.')?.title).toBe(
      'Лечение десмоидных опухолей',
    );
    expect(parseNumberedHeading('2.2 Неспецифические осложнения:')?.title).toBe(
      'Неспецифические осложнения:',
    );
  });

  it('caps the depth at six', () => {
    expect(parseNumberedHeading('1.2.3.4.5.6 Очень глубокий раздел')?.depth).toBe(6);
  });

  it.each([
    ['one component is a numbered list item', '1. Развитие зуба'],
    ['a dose', '0.5 Мг препарата в сутки'],
    ['a decimal followed by a unit', '2.5 мг два раза в день'],
    ['an ICD code mis-read as a number', '022.1 Варикозное расширение вен половых органов'],
    ['a lowercase list item', '2.3 с травмой околоносовых пазух'],
    ['a list item ending in a semicolon', '2.2 ФЛ с нетипичными цитологическими признаками;'],
    [
      'a list item ending in a comma',
      '3.4.1. Лечение факотопической глаукомы, включая медикаментозное,',
    ],
    [
      'a table-of-contents line with dot leaders',
      '2.5 Иная диагностика ..........................................',
    ],
    ['a table-of-contents line with a page number', '1.1 Определение заболевания 7'],
    ['a line filled with underscores', '1.1. Понимание речи ____________________'],
    ['a dash opening a sub-list', '15.2 – переломы тела ключицы:'],
    ['two sentences', '1.3.1 Паховая грыжа. Косая паховая грыжа встречается у 1% новорожденных'],
    ['a recommendation', '3.2.5 Рекомендуется всем пациентам начинать лечение с небольших доз'],
    [
      'a recommendation without the verb first',
      '5.3.1 Для оценки прогноза рекомендуется учитывать следующие факторы:',
    ],
    ['a present-tense statement', '3.1. Суточная калорийность рациона увеличивается на 25-50%.'],
    [
      'an instruction with an infinitive',
      '3.7. При госпитализации в стационар, начать непрерывную инфузию раствора',
    ],
    [
      'a long sentence ending in a full stop',
      '1.6.1. Пациенты с переломом коронки должны посещать специалиста раз в 3 месяца.',
    ],
    [
      'a clause that runs on',
      '4.1. Для оценки объективного ответа на лечение или последующего прогрессирования заболевания',
    ],
    ['text without a number', 'Определение заболевания'],
    ['an empty line', '   '],
  ])('does not read %s as a heading', (_label, line) => {
    expect(parseNumberedHeading(line)).toBeNull();
  });

  it('rejects multi-line blocks and very long lines', () => {
    expect(parseNumberedHeading('4.1.1. Оцениваемые параметры:\nСпереди: | ð')).toBeNull();
    expect(parseNumberedHeading(`3.1 ${'Очень длинный заголовок '.repeat(12)}`)).toBeNull();
  });
});
