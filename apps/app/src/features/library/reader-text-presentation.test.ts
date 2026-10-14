import { describe, expect, it } from 'vitest';

import {
  normalizePresentation,
  normalizeStrength,
  presentReaderChunkText,
  presentReaderSectionTitle,
  presentRegistryLine,
  readerChunkFindText,
} from '@/features/library/reader-text-presentation';

describe('one way to write a strength', () => {
  it('drops the empty decimal, spaces the unit and uses a decimal comma', () => {
    expect(normalizeStrength('500.0мг')).toBe('500 мг');
    expect(normalizeStrength('0.25г')).toBe('0,25 г');
    expect(normalizeStrength('125 мг')).toBe('125 мг');
    expect(normalizePresentation('ТАБЛЕТКИ (500 мг)')).toBe('Таблетки, 500 мг');
  });
});

describe('section headings made of a registry code', () => {
  it('say the form and the strength', () => {
    expect(
      presentReaderSectionTitle('21.20.10.191-000003-1-00167-0000000000000 — ТАБЛЕТКИ — 500.0мг'),
    ).toBe('Таблетки, 500 мг');
    expect(presentReaderSectionTitle('Показания к применению')).toBe('Показания к применению');
  });
});

describe('registry lines', () => {
  it('reads a pointer line as the trade name and its form', () => {
    expect(presentRegistryLine('- ТН: Амоксициллин-АКОС; форма/дозировка: ТАБЛЕТКИ (500 мг)')).toBe(
      '- Амоксициллин-АКОС — Таблетки, 500 мг',
    );
  });

  it('leaves the details to the heading above and writes a shouted name in sentence case', () => {
    expect(
      presentRegistryLine(
        '- ТН: АМОКСИЦИЛЛИН; форма/дозировка: ТАБЛЕТКИ (500 мг)',
        'Таблетки, 500 мг',
      ),
    ).toBe('- Амоксициллин');
  });

  it('reads the full trade-name line without codes and repeated strengths', () => {
    const line =
      '- ТН: Амоксициллин. Регистрация: ЛП-001234. СМНН: АМОКСИЦИЛЛИН; smnnCode: 21.20.10.191-000003-1-00167-0000000000000. Лекарственная форма: ТАБЛЕТКИ. Дозировка/концентрация: 500.0мг. Единица: шт. Нормализованные МНН: АМОКСИЦИЛЛИН. Нормализованные формы/дозировки: ТАБЛЕТКИ (500 мг).';
    const text = presentRegistryLine(line) ?? '';
    expect(text).toBe('- Амоксициллин — Таблетки, 500 мг · рег. ЛП-001234');
    expect(text).not.toMatch(/smnn|СМНН|21\.20/u);
  });

  it('reads a packaging line', () => {
    const line =
      '- КЛП: 21.20.10.191-000003-1-00521-0000000000001. ТН: Амоксициллин Экобол. Регистрация: ЛП-1. СМНН: АМОКСИЦИЛЛИН; smnnCode: 21.20.10.191-000003-1-00521-0000000000000. Лекарственная форма: ТАБЛЕТКИ ДИСПЕРГИРУЕМЫЕ. Дозировка/концентрация: 125 мг. Единица: шт. (таблетка). Количество единиц: 20. Первичная упаковка: УПАКОВКА ЯЧЕЙКОВАЯ КОНТУРНАЯ. Вторичная упаковка: КАРТОННАЯ ПАЧКА. Содержимое упаковки: ~. Держатель регистрации: АО АВВА РУС. Производитель: АО АВВА РУС. Жизненно необходимый препарат: Да. Период действия: 46069.0. Цена: 150,81 р.';
    expect(presentRegistryLine(line)).toBe(
      '- Амоксициллин Экобол — Таблетки диспергируемые, 125 мг · 20 шт. · упаковка ячейковая контурная, картонная пачка · АО АВВА РУС · ЖНВЛП · 150,81 ₽',
    );
  });

  it('leaves other lines alone', () => {
    expect(presentRegistryLine('Просто абзац текста.')).toBeNull();
  });
});

describe('a chunk as the reader shows it', () => {
  it('cleans a technical card of a guideline', () => {
    const raw =
      'Название: Внебольничная пневмония у взрослых. Объявленные алиасы: внебольничная пневмония, ВП. Ключевые слова: не указано в каталоге. Официальный идентификатор: 654_2. МКБ-10: J13, J14. Специальности: pulmonology, allergology-immunology. Возрастные категории: Взрослые.\n\nПолные данные находятся в скачиваемом модуле «minimed.clinical.respiratory-allergy.ru» и не дублируются в ядре.';
    const text = presentReaderChunkText(raw, 'Сведения о документе', 'core_catalog_pointer');
    expect(text).not.toMatch(/алиас|не указано|654_2|pulmonology|minimed\.clinical|ядре/iu);
    expect(text).toContain('Другие названия: внебольничная пневмония, ВП.');
    expect(text).toContain('МКБ-10: J13, J14.');
  });

  it('drops the raw link behind a source line', () => {
    const raw = 'Источник: ЕСКЛП — https://esklp.egisz.rosminzdrav.ru/esklp/x';
    expect(presentReaderChunkText(raw, 'Ограничения данных', 'official_registry_summary')).toBe(
      'Источник: ЕСКЛП',
    );
  });

  it('shows no dosage-form code and no machine status of a registry card', () => {
    const identity =
      'Стандартизированное МНН: Умифеновир. МНН записи: умифеновир. Статус записи ЕСКЛП: active.';
    expect(presentReaderChunkText(identity, 'Сведения', 'official_registry_summary')).toBe(
      'Стандартизированное МНН: Умифеновир. МНН записи: умифеновир.',
    );
    const smnn =
      'СМНН: Умифеновир; smnnCode: 21.20.10.194-000001-1-00001-0000000000000. Формы: Таблетки.';
    const shown = presentReaderChunkText(smnn, 'Формы', 'esklp_registry');
    expect(shown).not.toMatch(/mnnCode|21\.20\.10/u);
    expect(shown).toContain('Формы: Таблетки');
  });

  it('keeps ordinary text as it is', () => {
    const text = 'Назначают амоксициллин по 500 мг. ТН: не при чём.';
    expect(presentReaderChunkText(text, 'Дозы', 'official_drug_instruction')).toBe(text);
  });
});

describe('what in-document find searches', () => {
  const raw =
    'Название: Внебольничная пневмония у взрослых. Официальный идентификатор: 654_2. МКБ-10: J13, J14. Специальности: pulmonology.';

  it('has no word the reader hides', () => {
    const text = readerChunkFindText(raw, 'Сведения о документе', 'core_catalog_pointer');
    expect(text.toLocaleLowerCase('ru-RU')).not.toContain('официальный идентификатор');
    expect(text).not.toContain('654_2');
    expect(text).not.toContain('pulmonology');
    expect(text).toContain('J13, J14');
  });

  it('is the stored text when the reader changes nothing', () => {
    const plain = 'Назначают амоксициллин по 500 мг.';
    expect(readerChunkFindText(plain, 'Дозы', 'official_drug_instruction')).toBe(plain);
  });
});
