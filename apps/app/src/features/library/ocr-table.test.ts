import { describe, expect, it } from 'vitest';

import { isOcrTableChunk, parseOcrTable } from './ocr-table';

const TABLE = `Таблица 6. Влияние других препаратов на глюкуронизацию ламотриджина

Препараты, | Препараты, | Препараты, оказывающие
увеличивающие | уменьшающие | незначительное влияние

ламотриджина`;

describe('ocr table', () => {
  it('is only a chunk the preparer marked as a table candidate', () => {
    expect(isOcrTableChunk(TABLE, { review: ['table-candidate'] })).toBe(true);
    expect(isOcrTableChunk(TABLE, {})).toBe(false);
    expect(isOcrTableChunk('Текст без ячеек', { review: ['table-candidate'] })).toBe(false);
  });

  it('keeps the caption, splits cells and keeps a stray line as its own row', () => {
    expect(parseOcrTable(TABLE)).toEqual({
      caption: ['Таблица 6. Влияние других препаратов на глюкуронизацию ламотриджина'],
      rows: [
        ['Препараты,', 'Препараты,', 'Препараты, оказывающие'],
        ['увеличивающие', 'уменьшающие', 'незначительное влияние'],
        ['ламотриджина'],
      ],
      columns: 3,
    });
  });

  it('reads a doubled separator as one', () => {
    expect(parseOcrTable('А || Б || В').rows).toEqual([['А', 'Б', 'В']]);
  });
});
