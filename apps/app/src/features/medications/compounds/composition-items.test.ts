import { describe, expect, it } from 'vitest';
import { splitCompositionItems } from './composition-items';
import { normalizeCompoundName } from './compound-name';

const names = (text: string, role?: 'active' | 'excipient') =>
  splitCompositionItems(text)
    .filter((item) => role === undefined || item.role === role)
    .map((item) => item.text.replace(/\s+/gu, ' '));

describe('splitCompositionItems', () => {
  it('splits a running text with amounts, nested lists and wrapped lines', () => {
    const text =
      'Состав\n\n1 таблетка содержит: действующее вещество эплеренон 25,00 мг/50,00 мг; вспомогательные\n\n' +
      'вещества (ядро): лактозы моногидрат 38,20 мг/76,40 мг, целлюлоза микрокристалличес-\n\nкая (101) 19,60 мг, ' +
      'кросповидон (тип А) 2,55 мг, натрия лаурилсульфат\n\n0,85 мг/1,70 мг, магния стеарат 0,45 мг; вспомогательные\n\n' +
      'вещества (пленочная оболочка): Опадрай II 85F23987 оранжевый 3,00 мг\n\n(поливиниловый спирт 1,20 мг, ' +
      'титана диоксид (Е 171) 0,6522 мг, макрогол-\n\n3350 0,606 мг, тальк 0,444 мг).';
    expect(names(text, 'active')).toEqual(['эплеренон']);
    const excipients = names(text, 'excipient');
    expect(excipients).toContain('лактозы моногидрат');
    expect(excipients).toContain('натрия лаурилсульфат');
    expect(excipients).toContain('магния стеарат');
    expect(excipients).toContain('поливиниловый спирт');
    expect(excipients).toContain('титана диоксид (Е 171)');
    expect(excipients).toContain('тальк');
    const cellulose = splitCompositionItems(text).find((item) => /целлюлоза/u.test(item.text));
    expect(normalizeCompoundName(cellulose?.text ?? '')).toBe(
      normalizeCompoundName('целлюлоза микрокристаллическая'),
    );
  });

  it('reads the table layout where each amount sits in its own block', () => {
    const text =
      'Состав на одну таблетку\n\nДействующее вещество:\n\nИндапамид\n\n1,500 мг\n\nВспомогательные вещества:\n\n' +
      'лактозы моногидрат\n\n124,500 мг\n\nгипромеллоза\n\n64,000 мг\n\nповидон К 30\n\n8,600 мг\n\n' +
      'кремния диоксид коллоидный безводный (аэросил)\n\n0,400 мг';
    expect(names(text, 'active')).toEqual(['Индапамид']);
    expect(names(text, 'excipient')).toEqual([
      'лактозы моногидрат',
      'гипромеллоза',
      'повидон К 30',
      'кремния диоксид коллоидный безводный (аэросил)',
    ]);
  });

  it('stops at the end of the composition and gives offsets into the input', () => {
    const text =
      'Прочими ингредиентами (вспомогательными веществами) являются: лактозы моногидрат (сахар молочный), тальк. ' +
      'Внешний вид препарата: таблетки белого цвета.';
    const items = splitCompositionItems(text);
    expect(items.map((item) => item.text)).toEqual([
      'лактозы моногидрат (сахар молочный)',
      'тальк',
    ]);
    for (const item of items) expect(text.slice(item.start, item.end)).toBe(item.text);
  });

  it('returns nothing for a text without a composition label', () => {
    expect(splitCompositionItems('Показания к применению: артериальная гипертензия.')).toEqual([]);
  });
});
