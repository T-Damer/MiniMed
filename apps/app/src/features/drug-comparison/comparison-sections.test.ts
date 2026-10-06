import { describe, expect, it } from 'vitest';

import {
  extractQuoteBlock,
  extractRow,
  QUOTE_ROWS,
  type QuoteRowSpec,
  rowTypesPresent,
  SECTION_ROWS,
  type SectionRowSpec,
} from './comparison-sections';
import { instruction, section } from './comparison-test-fixtures';

const [indications, contraindications, , , special] = SECTION_ROWS;

describe('extractRow', () => {
  it('collects every section of the row types in reading order, with chunk anchors', () => {
    const document = instruction('d', [
      section('special-instructions', 'Особые указания', ['Первое указание. Второе указание.'], 3),
      section('caution', 'С осторожностью', ['Состояние А; состояние Б.'], 5),
      section('indications', 'Показания', ['Боль.\n\nЛихорадка у взрослых.'], 1),
    ]);
    const row = extractRow(document, special as SectionRowSpec);
    expect(row.parts.map((part) => part.title)).toEqual(['Особые указания', 'С осторожностью']);
    expect(row.units.map((unit) => unit.text)).toEqual([
      'Первое указание.',
      'Второе указание.',
      'Состояние А;',
      'состояние Б.',
    ]);
    expect(row.units[0]?.anchor).toMatch(/-c0$/u);
    expect(row.anchor).toBe(row.parts[0]?.anchor);
    expect(
      extractRow(document, indications as SectionRowSpec).units.map((unit) => unit.text),
    ).toEqual(['Боль.', 'Лихорадка у взрослых.']);
  });

  it('quotes a text printed twice once and skips sections without text', () => {
    const document = instruction('d', [
      section('contraindications', 'Противопоказания', ['Беременность.'], 1),
      section('contraindications', 'Противопоказания', ['Беременность.'], 2),
      section('contraindications', 'Противопоказания', [], 3),
    ]);
    const row = extractRow(document, contraindications as SectionRowSpec);
    expect(row.parts).toHaveLength(1);
    expect(row.units).toHaveLength(1);
  });

  it('returns an empty row for a document without the section', () => {
    const row = extractRow(instruction('d', []), indications as SectionRowSpec);
    expect(row.units).toEqual([]);
    expect(row.anchor).toBeNull();
  });
});

describe('extractQuoteBlock', () => {
  it('quotes the pharmacotherapeutic group line and the dispensing condition without their titles', () => {
    const document = instruction('d', [
      section(
        'pharmacology',
        'Фармакотерапевтическая группа',
        ['Фармакотерапевтическая группа: противовоспалительные\n\nпрепараты. Код АТХ: М01АЕ01'],
        1,
      ),
      section('pharmacology', 'Фармакодинамика', ['Механизм действия.'], 2),
      section('dispensing', 'Условия отпуска', ['Условия отпуска\n\nОтпускают без рецепта.'], 3),
    ]);
    const group = extractQuoteBlock(document, QUOTE_ROWS[0] as QuoteRowSpec);
    expect(group?.text).toBe('противовоспалительные препараты. Код АТХ: М01АЕ01');
    const dispensing = extractQuoteBlock(document, QUOTE_ROWS[1] as QuoteRowSpec);
    expect(dispensing?.text).toBe('Отпускают без рецепта.');
    expect(extractQuoteBlock(instruction('e', []), QUOTE_ROWS[0] as QuoteRowSpec)).toBeNull();
  });

  it('lists which section types have text', () => {
    const present = rowTypesPresent(
      instruction('d', [
        section('dosage', 'Дозы', ['Внутрь.']),
        section('overdose', 'Передозировка', []),
      ]),
    );
    expect(present.has('dosage')).toBe(true);
    expect(present.has('overdose')).toBe(false);
  });
});
