import { describe, expect, it } from 'vitest';

import {
  isSectionTitleEcho,
  normalizeReaderText,
  withoutSectionTitleEcho,
} from '@/features/library/reader-text-normalization';

describe('normalizeReaderText (FMT-AUDIT)', () => {
  it('shows codes typed with Cyrillic look-alikes in Latin', () => {
    expect(normalizeReaderText('Е75.2 — сфинголипидозы; К71; С09АА01; Н02АВ; А16.10.003')).toBe(
      'E75.2 — сфинголипидозы; K71; C09AA01; H02AB; A16.10.003',
    );
    expect(normalizeReaderText('изофермент СYP2D6, CYPЗA4 и цитохром Р450')).toBe(
      'изофермент CYP2D6, CYP3A4 и цитохром P450',
    );
    // Russian words and a Latin code stay as they are.
    expect(normalizeReaderText('Витамин В12 и K76.0 при АД 140')).toBe(
      'Витамин B12 и K76.0 при АД 140',
    );
  });

  it('writes a word in one alphabet', () => {
    expect(normalizeReaderText('активноcти c целью (c использованием')).toBe(
      'активности с целью (с использованием',
    );
    expect(normalizeReaderText('СDS – шкала, (PГ-RU), СОVID')).toBe('CDS – шкала, (РГ-RU), COVID');
    expect(normalizeReaderText('IgG, pH, NaCl, мкмоль')).toBe('IgG, pH, NaCl, мкмоль');
  });

  it('reads symbol-font characters and caret superscripts', () => {
    const pua = (code: number) => String.fromCharCode(code);
    expect(
      normalizeReaderText(
        `9.6 ${pua(0xf0b1)} 4.4 мкг/мл, ${pua(0xf061)}1-кислотный, мг${pua(0xf0b7)}час, Никогда ${pua(0xf0a3)} КК ${pua(0xf0a3)} 30`,
      ),
    ).toBe('9.6 ± 4.4 мкг/мл, α1-кислотный, мг·час, Никогда □ КК ≤ 30');
    expect(normalizeReaderText('7,5 Вт/см^(2), 10^9/л')).toBe('7,5 Вт/см², 10⁹/л');
  });

  it('closes a hyphen the source followed by a space, keeping suspended hyphens', () => {
    expect(
      normalizeReaderText(
        'сердечно- сосудистой, листок- вкладыш, что- либо, включен- ная, двух- или трёхкратно, гипер- и гипо-',
      ),
    ).toBe(
      'сердечно-сосудистой, листок-вкладыш, что-либо, включенная, двух- или трёхкратно, гипер- и гипо-',
    );
    expect(normalizeReaderText('доза - 5 мг; Т- и В-лимфоциты')).toBe(
      'доза - 5 мг; Т- и В-лимфоциты',
    );
  });

  it('drops converter markup but keeps footnote stars', () => {
    expect(normalizeReaderText('проведение \\дифференциально-диагностических')).toBe(
      'проведение дифференциально-диагностических',
    );
    expect(normalizeReaderText('*Построение зрительного образа*. Чтобы избежать')).toBe(
      'Построение зрительного образа. Чтобы избежать',
    );
    expect(normalizeReaderText('Ксарелто* и Эликвис*; * — состав смеси 1; ** — молоко')).toBe(
      'Ксарелто* и Эликвис*; * — состав смеси 1; ** — молоко',
    );
  });
});

describe('withoutSectionTitleEcho', () => {
  it('drops a first line that repeats the heading and keeps the line break', () => {
    expect(withoutSectionTitleEcho('Состав:\n\nДействующее вещество', 'Состав')).toBe(
      '\n\nДействующее вещество',
    );
    expect(withoutSectionTitleEcho('4. Побочное действие\nТекст', 'Побочное действие')).toBe(
      '\nТекст',
    );
    expect(withoutSectionTitleEcho('Состав препарата включает', 'Состав')).toBe(
      'Состав препарата включает',
    );
    expect(
      withoutSectionTitleEcho(
        'Режим дозирования\n\nРежим дозирования:\nПо 1 таблетке',
        'Режим дозирования',
      ),
    ).toBe('\n\n\nПо 1 таблетке');
    expect(isSectionTitleEcho('  СОСТАВ.  ', 'Состав')).toBe(true);
    expect(isSectionTitleEcho('Состав\n\nтекст', 'Состав')).toBe(false);
  });
});
