import { describe, expect, it } from 'vitest';
import {
  ICD11_SOURCE_TYPE,
  icd11Ancestors,
  icd11Children,
  icd11CrosswalkLinks,
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
