import { describe, expect, it } from 'vitest';

import {
  codeInRange,
  letterLinesFromHtml,
  parseLetterHtml,
  parseLetterLines,
} from '../../../../../scripts/lib/sick-leave-letter';

const WIDTHS_5 = [6, 7, 20, 19, 8] as const;
const WIDTHS_6 = [7, 7, 18, 7, 14, 7] as const;

/** One box-drawing row group: cells[column][line]; a merged group is `[code lines, text lines]`. */
type Group = readonly (readonly string[])[];

function pad(text: string, width: number): string {
  return text.padEnd(width, ' ');
}

function render(widths: readonly number[], groups: readonly Group[]): string[] {
  const rule = (left: string, middle: string, right: string): string =>
    `${left}${widths.map((width) => '─'.repeat(width)).join(middle)}${right}`;
  const lines = [rule('┌', '┬', '┐')];
  const header = ['Код по', 'Номер', 'Наименование', 'Особенности', 'Сроки'];
  lines.push(`│${widths.map((width, index) => pad(header[index] ?? '', width)).join('│')}│`);
  lines.push(rule('├', '┼', '┤'));
  lines.push(`│${widths.map((width, index) => pad(String(index + 1), width)).join('│')}│`);
  for (const group of groups) {
    lines.push(rule('├', '┼', '┤'));
    const merged = group.length === 2;
    const height = Math.max(...group.map((cell) => cell.length));
    for (let line = 0; line < height; line += 1) {
      if (merged) {
        const rest = widths.slice(1).reduce((sum, width) => sum + width, widths.length - 2);
        lines.push(
          `│${pad(group[0]?.[line] ?? '', widths[0] ?? 0)}│${pad(group[1]?.[line] ?? '', rest)}│`,
        );
      } else {
        lines.push(
          `│${widths.map((width, index) => pad(group[index]?.[line] ?? '', width)).join('│')}│`,
        );
      }
    }
  }
  lines.push(rule('└', '┴', '┘'));
  return lines;
}

const PREAMBLE = [
  'ОРИЕНТИРОВОЧНЫЕ СРОКИ',
  'Экспертиза временной нетрудоспособности проводится в соответствии с Инструкцией.',
  'Ориентировочные сроки временной утраты трудоспособности носят рекомендательный характер. Однако значительное увеличение или сокращение (на 30 и более процентов) должно служить поводом для экспертизы.',
];

function letterOf(tables: readonly string[][]): string[] {
  return tables.flatMap((lines, index) => [
    `Таблица ${String(index + 1)}`,
    'Ориентировочные сроки временной нетрудоспособности',
    `(класс ${index === 0 ? 'I' : 'XIX'} по МКБ-10)`,
    ...lines,
  ]);
}

const TABLE_ONE = render(WIDTHS_5, [
  [['A00 -', 'A09'], ['Кишечные инфекции']],
  [['A00'], ['03, 04'], ['Холера'], ['Обезвоживание', 'I - II степени'], ['9 - 11']],
  [[''], [''], [''], ['Обезвоживание', 'III - IV степени'], ['15 - 20']],
  [['A02.0'], ['03, 04'], ['Сальмонеллезный', 'энтерит'], [''], ['10 - 20']],
  [['A05.2'], ['03, 04'], ['Пищевое отравление,', 'вызванное клостриди-', 'ями'], [''], ['8 - 15']],
  [['A15 -', 'A19'], ['Туберкулез']],
  [['A15.0'], ['Туберкулез легких, подтвержденный']],
  [
    ['A15.0'],
    ['05, 06'],
    ['Туберкулез легких', 'фиброзно-кавернозный'],
    ['Фаза инфильтрации'],
    ['4 - 5', 'мес.'],
  ],
  [[''], [''], [''], ['Фаза распада'], ['5 - 6', 'мес.']],
  [['F18.1'], ['05, 06'], ['Туберкулез уретры'], ['Распространенный', 'процесс'], ['3 - 4', '<1>']],
  [['I05.-'], ['33, 34'], ['Митральные болезни'], ['Сердечная недоста-', 'точность'], ['']],
  [[''], [''], [''], ['I ФК <2>'], ['20 - 30', '<1>']],
  [
    ['I21.4'],
    ['37, 38'],
    ['Инфаркт', 'миокарда'],
    ['Без осложнений', '', '', ''],
    ['', '', '', '60 - 70'],
  ],
  [['M42.1.2'], ['69, 70'], ['Остеохондроз'], [''], ['14 - 28']],
  [['I63.'], ['39, 40'], ['Инфаркт мозга'], [''], ['60 - 75']],
  [['F10 -', 'F19'], ['Расстройства']],
  [['F10-19'], ['21, 22'], ['Расстройства, связанные'], [''], ['14 - 30']],
]);

const TABLE_SIXTEEN = render(WIDTHS_6, [
  [['S00 -', 'S09'], ['Травмы головы']],
  [
    ['S12.2.0'],
    ['83, 84'],
    ['Перелом шейных', 'позвонков'],
    ['Тела', 'позвон-', 'ка'],
    ['Со смещением', '', '', 'Без смещения'],
    ['125 -', '140,', 'МСЭ', '90 - 100'],
  ],
  [
    ['S62.1.0'],
    ['89, 90'],
    ['Перелом кости'],
    ['Полу-', 'лунной', 'Голов-', 'чатой'],
    [''],
    ['60 - 80', '', '30 - 35'],
  ],
]);

const FOOTNOTES_ONE = [
  '--------------------------------',
  '<1> Возможно направление на МСЭ с учетом условий труда.',
  '<2> ФК - функциональный класс.',
];

const LETTER = [...PREAMBLE, ...letterOf([[...TABLE_ONE, ...FOOTNOTES_ONE], TABLE_SIXTEEN])];

describe('letterLinesFromHtml', () => {
  it('keeps <pre> tables verbatim, turns paragraphs into lines and drops the page chrome', () => {
    const html = `<html><nav>menu</nav><h1>Письмо</h1><p class="a">Таблица 1</p><p>Сроки <b>ВН</b> &amp; т.д.</p><pre>${TABLE_ONE.join('\n')}</pre><div class="h2">Другие документы по теме</div><p>footer</p></html>`;
    const lines = letterLinesFromHtml(html);
    expect(lines).toContain('Таблица 1');
    expect(lines).toContain('Сроки ВН & т.д.');
    expect(lines.filter((line) => line.startsWith('│'))).toHaveLength(
      TABLE_ONE.filter((line) => line.startsWith('│')).length,
    );
    expect(lines).not.toContain('menu');
    expect(lines).not.toContain('footer');
    expect(lines[lines.findIndex((line) => line.startsWith('┌'))]).toBe(TABLE_ONE[0]);
  });
});

describe('parseLetterLines', () => {
  const letter = parseLetterLines(LETTER);
  const entry = (code: string, title?: string) =>
    letter.entries.find(
      (item) => item.code === code && (title === undefined || item.title.startsWith(title)),
    );

  it('reads tables, blocks and the preamble', () => {
    expect(letter.tables.map((table) => table.classRoman)).toEqual(['I', 'XIX']);
    expect(letter.blocks.map((block) => block.range)).toEqual([
      'A00-A09',
      'A15-A19',
      'F10-F19',
      'S00-S09',
    ]);
    expect(letter.blocks[0]?.title).toBe('Кишечные инфекции');
    expect(letter.preamble.at(-1)).toContain('рекомендательный характер');
    expect(letter.warnings).toEqual([]);
  });

  it('splits a row with several periods and keeps the form-16 line numbers', () => {
    expect(entry('A00')?.formLines).toBe('03, 04');
    expect(entry('A00')?.periods).toEqual([
      { features: 'Обезвоживание I - II степени', period: '9 - 11', notes: [] },
      { features: 'Обезвоживание III - IV степени', period: '15 - 20', notes: [] },
    ]);
  });

  it('undoes line-end hyphens but keeps compounds that occur whole elsewhere', () => {
    expect(entry('A05.2')?.title).toBe('Пищевое отравление, вызванное клостридиями');
    expect(entry('A15.0', 'Туберкулез легких фиброзно')?.title).toBe(
      'Туберкулез легких фиброзно-кавернозный',
    );
    expect(entry('I05.-')?.periods[0]?.features).toBe('Сердечная недостаточность');
  });

  it('joins period fragments «4 - 5» + «мес.» and attaches footnote marks to their row', () => {
    const periods = entry('A15.0', 'Туберкулез легких фиброзно')?.periods;
    expect(periods?.map((item) => item.period)).toEqual(['4 - 5 мес.', '5 - 6 мес.']);
    expect(entry('F18.1')?.periods[0]).toEqual({
      features: 'Распространенный процесс',
      period: '3 - 4',
      notes: [1],
    });
    expect(entry('I05.-')?.periods[1]).toEqual({
      features: 'I ФК',
      period: '20 - 30',
      notes: [2, 1],
    });
    expect(letter.tables[0]?.footnotes[1]).toBe(
      'Возможно направление на МСЭ с учетом условий труда.',
    );
  });

  it('keeps a feature without its own period as a heading row', () => {
    expect(entry('I05.-')?.periods[0]).toEqual({
      features: 'Сердечная недостаточность',
      period: '',
      notes: [],
    });
  });

  it('assigns a bottom-aligned period to the feature above it', () => {
    expect(entry('I21.4')?.periods).toEqual([
      { features: 'Без осложнений', period: '60 - 70', notes: [] },
    ]);
  });

  it('files a single-code heading inside its block as a group of the rows below', () => {
    expect(entry('A15.0', 'Туберкулез легких фиброзно')?.group).toBe(
      'Туберкулез легких, подтвержденный',
    );
    expect(entry('A00')?.group).toBeNull();
  });

  it('keeps the printed code when it is cleaned up', () => {
    expect(entry('I63')?.printedCode).toBe('I63.');
    expect(entry('F10-F19')?.printedCode).toBe('F10-19');
    expect(entry('A00')?.printedCode).toBeNull();
  });

  it('reads a row whose code cell is wider than its column', () => {
    expect(entry('M42.1.2')?.title).toBe('Остеохондроз');
    expect(entry('M42.1.2')?.periods[0]?.period).toBe('14 - 28');
  });

  it('shares the injury level over the rows under it and rejoins wrapped periods', () => {
    expect(entry('S12.2.0')?.periods).toEqual([
      { features: 'Тела позвонка, со смещением', period: '125 - 140, МСЭ', notes: [] },
      { features: 'Тела позвонка, без смещения', period: '90 - 100', notes: [] },
    ]);
  });

  it('lists the level column itself when the kind column is empty', () => {
    expect(entry('S62.1.0')?.periods.map((item) => `${item.features}=${item.period}`)).toEqual([
      'Полулунной=60 - 80',
      'Головчатой=30 - 35',
    ]);
  });
});

describe('codeInRange', () => {
  it('compares three-character categories', () => {
    expect(codeInRange('A03.1', 'A00-A09')).toBe(true);
    expect(codeInRange('A10', 'A00-A09')).toBe(false);
    expect(codeInRange('N99.1', 'N99')).toBe(true);
    expect(codeInRange('N98', 'N99')).toBe(false);
  });
});

describe('parseLetterHtml', () => {
  it('fails loudly when the page is not the letter', () => {
    expect(() => parseLetterHtml('<html></html>')).toThrow('letter boundaries not found');
  });
});
