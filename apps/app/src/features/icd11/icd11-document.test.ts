import { describe, expect, it } from 'vitest';
import {
  ICD11_SOURCE_TYPE,
  icd11Ancestors,
  icd11BareTitle,
  icd11ChapterDocuments,
  icd11Children,
  icd11CrosswalkLinks,
  icd11TitleCode,
  isIcd11Document,
  isIcd11DocumentId,
} from '@/features/icd11/icd11-document';

describe('ICD-11 document metadata', () => {
  it('recognises ICD-11 only by its own source type and id prefix', () => {
    expect(isIcd11Document({ sourceType: ICD11_SOURCE_TYPE })).toBe(true);
    expect(isIcd11Document({ sourceType: 'rls_mkb_reference' })).toBe(false);
    expect(isIcd11DocumentId('who.icd11.mms.257068234')).toBe(true);
    expect(isIcd11DocumentId('rls.mkb.node.a00')).toBe(false);
  });

  it('keeps crosswalk rows and links an ICD-10 card only by an rls.mkb id', () => {
    const links = icd11CrosswalkLinks({
      metadata: {
        crosswalkIcd10: [
          {
            relation: 'closest',
            icd10Code: 'A00.9',
            icd10TitleEn: 'Cholera, unspecified',
            icd10DocumentId: 'rls.mkb.node.a00-9',
          },
          {
            relation: 'mapped-into-this',
            icd10Code: 'A00.0',
            icd10DocumentId: 'javascript:alert(1)',
            icd11Cluster: '1A00&XN8P1',
          },
          { relation: 'other', icd10Code: 'A01' },
          { relation: 'closest' },
          null,
        ],
      },
    });

    expect(links).toEqual([
      {
        relation: 'closest',
        icd10Code: 'A00.9',
        icd10TitleEn: 'Cholera, unspecified',
        icd10DocumentId: 'rls.mkb.node.a00-9',
        cluster: null,
      },
      {
        relation: 'mapped-into-this',
        icd10Code: 'A00.0',
        icd10TitleEn: '',
        icd10DocumentId: null,
        cluster: '1A00&XN8P1',
      },
    ]);
  });

  it('reads ancestors and children, dropping foreign document ids', () => {
    const metadata = {
      classificationPath: [
        {
          code: 'BlockL2-1A0',
          title: 'Бактериальные кишечные инфекции',
          documentId: 'who.icd11.mms.1',
        },
        { title: 'Чужая', documentId: 'rls.mkb.node.a00' },
      ],
      childDocuments: [
        { documentId: 'who.icd11.mms.2', label: '1A00 Холера' },
        { documentId: 'who.icd11.mms.3' },
      ],
    };

    expect(icd11Ancestors({ metadata })).toEqual([
      { documentId: 'who.icd11.mms.1', label: 'Бактериальные кишечные инфекции' },
    ]);
    expect(icd11Children({ metadata })).toEqual([
      { documentId: 'who.icd11.mms.2', label: '1A00 Холера' },
    ]);
  });
});

describe('ICD-11 card titles', () => {
  it('splits the WHO code and the name from a card title', () => {
    expect(
      icd11TitleCode('BA41.0 Острый инфаркт миокарда с подъемом сегмента ST, МКБ-11 (ВОЗ)'),
    ).toBe('BA41.0');
    expect(icd11TitleCode('XM85F8 Меркаптамин, МКБ-11 (ВОЗ)')).toBe('XM85F8');
    expect(icd11TitleCode('8A6Z Эпилепсия, неуточнённые, МКБ-11 (ВОЗ)')).toBe('8A6Z');
    expect(icd11BareTitle('CA23 Астма, МКБ-11 (ВОЗ)')).toBe('Астма');
    expect(icd11BareTitle('RA01 COVID-19, МКБ-11 (ВОЗ)')).toBe('COVID-19');
  });

  it('reads blocks and chapters, which have no code, as nameless of a code', () => {
    expect(
      icd11TitleCode('Блок «Эпилепсия или эпилептические приступы», МКБ-11 (ВОЗ)'),
    ).toBeUndefined();
    expect(icd11TitleCode('Глава 10. Болезни уха, МКБ-11 (ВОЗ)')).toBeUndefined();
    expect(icd11BareTitle('Глава 10. Болезни уха, МКБ-11 (ВОЗ)')).toBe('Глава 10. Болезни уха');
  });

  it('lists the chapters in their own order, V and X last, and nothing else', () => {
    const card = (id: string, title: string, sourceType = ICD11_SOURCE_TYPE) => ({
      id,
      title,
      sourceType,
    });
    const chapters = icd11ChapterDocuments([
      card('x', 'Глава X. Коды расширения, МКБ-11 (ВОЗ)'),
      card('c10', 'Глава 10. Болезни уха, МКБ-11 (ВОЗ)'),
      card('a', 'BA41 Острый инфаркт миокарда, МКБ-11 (ВОЗ)'),
      card('c2', 'Глава 02. Новообразования, МКБ-11 (ВОЗ)'),
      card('v', 'Глава V. Дополнительный раздел, МКБ-11 (ВОЗ)'),
      card('other', 'Глава 3. Не МКБ-11', 'clinical_recommendation'),
    ]);
    expect(chapters.map((entry) => entry.id)).toEqual(['c2', 'c10', 'x', 'v']);
  });
});
