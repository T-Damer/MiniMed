import { describe, expect, it } from 'vitest';

import { parseDocumentText } from '@/features/library/document-medication-links';
import {
  markWrappedInstructionText,
  repairWrappedInstructionText,
  storedBlockCount,
} from '@/features/library/instruction-text-repair';
import { presentReaderChunkText } from '@/features/library/reader-text-presentation';

// Chunks as the ГРЛС instruction modules store them: one blank line after every PDF line.
const GLIMEPIRIDE_COMPOSITION =
  'Состав на одну таблетку: действующее вещество: глимепирид - 4,0 мг; вспомогательные\n\nвещества: лактозы моногидрат (сахар молочный) - 102,8 мг, целлюлоза микрокристаллическая\n\n- 14,0 мг, крахмал прежелатинизированный - 4,0 мг, натрия лаурилсульфат (натрия додецил\n\nсульфат) - 1,9 мг, магния стеарат - 0,6 мг, индигокармин - 0,1 мг, карбоксиметилкрахмал натрия\n\n(натрия гликолят крахмал) - 2,6 мг.';

describe('repairWrappedInstructionText', () => {
  it('joins the glimepiride composition into one paragraph', () => {
    expect(repairWrappedInstructionText(GLIMEPIRIDE_COMPOSITION)).toBe(
      'Состав на одну таблетку: действующее вещество: глимепирид - 4,0 мг; вспомогательные вещества: лактозы моногидрат (сахар молочный) - 102,8 мг, целлюлоза микрокристаллическая - 14,0 мг, крахмал прежелатинизированный - 4,0 мг, натрия лаурилсульфат (натрия додецил сульфат) - 1,9 мг, магния стеарат - 0,6 мг, индигокармин - 0,1 мг, карбоксиметилкрахмал натрия (натрия гликолят крахмал) - 2,6 мг.',
    );
  });

  it('joins a composition that wraps after every word, a dash-led figure and a trailing dash', () => {
    const raw =
      'Состав\n\n1 таблетка препарата содержит: действующее вещество глимепирид - 1,0 мг;\n\nвспомогательные\n\nвещества:\n\nлактозы\n\nмоногидрат\n\n- 103,625 мг, целлюлоза\n\nмикрокристаллическая (целлюлоза микрокристаллическая 101) - 14,000 мг, крахмал\n\nпрежелатинизированный - 3,900 мг, натрия лаурилсульфат (натрия додецилсульфат) -\n\n1,950 мг, магния стеарат - 0,325 мг.';
    expect(repairWrappedInstructionText(raw)).toBe(
      'Состав\n\n1 таблетка препарата содержит: действующее вещество глимепирид - 1,0 мг;\n\nвспомогательные вещества:\n\nлактозы моногидрат - 103,625 мг, целлюлоза микрокристаллическая (целлюлоза микрокристаллическая 101) - 14,000 мг, крахмал прежелатинизированный - 3,900 мг, натрия лаурилсульфат (натрия додецилсульфат) - 1,950 мг, магния стеарат - 0,325 мг.',
    );
  });

  it('joins an en-dash figure that the PDF pushed onto its own line', () => {
    const raw =
      'краситель солнечный закат желтый (Е110)\n\n– 0,00056 мг, краситель хинолиновый желтый (Е104) – 0,00424 мг.';
    expect(repairWrappedInstructionText(raw)).toBe(
      'краситель солнечный закат желтый (Е110) – 0,00056 мг, краситель хинолиновый желтый (Е104) – 0,00424 мг.',
    );
  });

  it('keeps the dash of a composition row whose name and amount were split', () => {
    expect(repairWrappedInstructionText('Состав\n\nФлуконазол\n\n- 50 мг')).toBe(
      'Состав\n\nФлуконазол - 50 мг',
    );
    expect(
      repairWrappedInstructionText(
        'Натрия пикосульфата моногидрат\n\n- 0,750 г\n\nЖир твердый\n\n- 1167,5 мг',
      ),
    ).toBe('Натрия пикосульфата моногидрат - 0,750 г\n\nЖир твердый - 1167,5 мг');
  });

  it('rejoins a hyphenated word break, also when the rest sits behind a bullet glyph', () => {
    expect(
      repairWrappedInstructionText(
        'время приема амитриптилина запрещается вождение транспортных средств, а также об-\n\n• служивание механизмов и выполнение других работ',
      ),
    ).toBe(
      'время приема амитриптилина запрещается вождение транспортных средств, а также обслуживание механизмов и выполнение других работ',
    );
  });

  it('keeps the hyphen of a compound split at the hyphen', () => {
    expect(
      repairWrappedInstructionText(
        'нарушения со стороны желудочно-\n\nкишечного тракта, бета-\n\nадреноблокаторы',
      ),
    ).toBe('нарушения со стороны желудочно-кишечного тракта, бета-адреноблокаторы');
    expect(
      repairWrappedInstructionText(
        'Если у Вас дефицит сахарозы, глюкозо-\n\nгалактозная мальабсорбция,',
      ),
    ).toBe('Если у Вас дефицит сахарозы, глюкозо-галактозная мальабсорбция,');
    expect(repairWrappedInstructionText('в соответствии с листком-\n\nвкладышем')).toBe(
      'в соответствии с листком-вкладышем',
    );
  });

  it('joins a line cut inside a bracket or after a word that cannot end a line', () => {
    expect(
      repairWrappedInstructionText(
        'сердечной недостаточности (см. раздел 2 «Особые\n\n• указания»),\n\nтакже в сочетании с\n\n• 2 ингаляциями вечером.',
      ),
    ).toBe(
      'сердечной недостаточности (см. раздел 2 «Особые указания»), также в сочетании с 2 ингаляциями вечером.',
    );
  });

  it('joins a frequency inside a running adverse-reaction sentence', () => {
    expect(
      repairWrappedInstructionText(
        'Нарушения кожи: очень редко\n\n– мигрень, нарушение координации; нечасто\n\n– отек суставов',
      ),
    ).toBe('Нарушения кожи: очень редко – мигрень, нарушение координации; нечасто – отек суставов');
  });

  it('keeps genuine lists, headings and sentence boundaries apart', () => {
    const lists = [
      'Противопоказания:\n\n- тиклопидин (препарат, применяемый для профилактики тромбозов)\n\n- амиодарон (применяется при нарушениях ритма сердца) и другие ингибиторы',
      'Часто (могут возникать не более чем у 1 человека из 10)\n\n• бессонница;\n\n• головная боль;',
      'Нечасто\n\n- 1/1000 назначений (20,1%, но <1%)',
      'Нечасто\n\nлейкопения',
      'Режим дозирования для взрослых\n\n- при КК 30-60 мл/мин\n\n- при КК менее 30 мл/мин',
      'Препарат хорошо переносится.\n\nпосле приема пищи\n\n1. Первый шаг',
      'Дети\n\n- Лечение осложнений у детей с муковисцидозом',
      '- 48 бутылок по 100 мл\n\n- 24 бутылки по 200 мл',
      'Состав:\n\n- 1,5 мг\n\n- 3,3 мг',
    ];
    for (const text of lists) expect(repairWrappedInstructionText(text)).toBe(text);
  });

  it('leaves tables and images alone', () => {
    const table = '| Доза | Частота |\n| --- | --- |\n| 5 мг | 2 раза в сутки |';
    expect(repairWrappedInstructionText(table)).toBe(table);
    const withImage = 'для\n\n![схема](https://example.org/a.png)\n\nи далее';
    expect(repairWrappedInstructionText(withImage)).toBe(withImage);
  });

  it('returns the text itself when nothing wraps', () => {
    const plain = 'Назначают амоксициллин по 500 мг.';
    expect(repairWrappedInstructionText(plain)).toBe(plain);
    expect(markWrappedInstructionText(plain)).toBe(plain);
  });
});

describe('the reader shows repaired instruction text', () => {
  it('leaves the stored blocks countable so PDF geometry still lines up', () => {
    const marked = markWrappedInstructionText(GLIMEPIRIDE_COMPOSITION);
    expect(marked).not.toBe(GLIMEPIRIDE_COMPOSITION);
    expect(storedBlockCount(marked)).toBe(storedBlockCount(GLIMEPIRIDE_COMPOSITION));
  });

  it('parses the glimepiride composition without list items', () => {
    const blocks = parseDocumentText(markWrappedInstructionText(GLIMEPIRIDE_COMPOSITION));
    expect(blocks.map((block) => block.kind)).toEqual(['paragraph']);
    expect(blocks[0]).toMatchObject({
      text: expect.stringContaining('целлюлоза микрокристаллическая - 14,0 мг, крахмал'),
    });
  });

  it('shows the same blocks as in-document find searches', () => {
    const shown = presentReaderChunkText(
      GLIMEPIRIDE_COMPOSITION,
      'Состав',
      'official_drug_instruction',
    );
    expect(parseDocumentText(shown).some((block) => block.kind === 'bullet')).toBe(false);
    expect(presentReaderChunkText(GLIMEPIRIDE_COMPOSITION, 'Состав', 'medical_reference')).toBe(
      GLIMEPIRIDE_COMPOSITION,
    );
  });

  it('keeps the list indentation of a paragraph that follows joined lines', () => {
    const raw = '• Пункт начинается с\n\nи продолжается\n\nСледующий раздел';
    const spans = [{ bbox: [100, 0, 0, 0] }, { bbox: [120, 0, 0, 0] }, { bbox: [80, 0, 0, 0] }];
    expect(parseDocumentText(markWrappedInstructionText(raw), spans)).toEqual([
      { kind: 'bullet', text: 'Пункт начинается с и продолжается' },
      { kind: 'paragraph', text: 'Следующий раздел' },
    ]);
  });
});
