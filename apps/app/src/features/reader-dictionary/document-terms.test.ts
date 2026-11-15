import type { MedicalSection } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import { findDocumentTerm, parseDocumentTerms } from './document-terms';

function section(title: string, text: string): MedicalSection {
  return {
    id: title,
    title,
    chunks: [{ id: `${title}-1`, anchor: `${title}-a`, originalText: text }],
  } as unknown as MedicalSection;
}

const SECTIONS = [
  section(
    'Список сокращений',
    'МРТ – магнитно-резонансная томография\n\nОФС – операция Фовлера-Стефенса\n\nBAPS / BAUS – British Association Paediatric Surgeons/British Association of Urological Surgeons Limited',
  ),
  section(
    'Термины и определения',
    'Синдром тестикулярной регрессии – отсутствие яичка при наличии слепо заканчивающихся сосудов.\n\nКрипторхизм — неопущение яичка в мошонку.',
  ),
  section('1. Краткая информация', 'Крипторхизм – это не определение из списка, а текст главы.'),
];

describe('document terms', () => {
  const terms = parseDocumentTerms(SECTIONS);

  it('reads the lines of the abbreviation and term sections only', () => {
    expect(terms.map((term) => term.term)).toEqual([
      'МРТ',
      'ОФС',
      'BAPS / BAUS',
      'Синдром тестикулярной регрессии',
      'Крипторхизм',
    ]);
    expect(terms[1]).toMatchObject({
      kind: 'abbreviation',
      meaning: 'операция Фовлера-Стефенса',
      sectionTitle: 'Список сокращений',
    });
  });

  it('finds an abbreviation whatever its case, and one side of a paired one', () => {
    expect(findDocumentTerm(terms, 'офс')?.meaning).toBe('операция Фовлера-Стефенса');
    expect(findDocumentTerm(terms, 'BAUS')?.term).toBe('BAPS / BAUS');
  });

  it('finds a term in another grammatical form, and nothing for a word the document does not define', () => {
    expect(findDocumentTerm(terms, 'синдрома тестикулярной регрессии')?.term).toBe(
      'Синдром тестикулярной регрессии',
    );
    expect(findDocumentTerm(terms, 'крипторхизма')?.meaning).toBe('неопущение яичка в мошонку.');
    expect(findDocumentTerm(terms, 'томография')).toBeUndefined();
    expect(findDocumentTerm(terms, '  ')).toBeUndefined();
  });

  it('does not take a sentence with a dash in an abbreviation list for an abbreviation', () => {
    const noisy = parseDocumentTerms([
      section('Список сокращений', 'В тексте используются следующие сокращения – см. ниже'),
    ]);
    expect(noisy).toEqual([]);
  });
});
