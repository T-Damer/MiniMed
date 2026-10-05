import { describe, expect, it } from 'vitest';

import {
  formatFetchDate,
  instructionIndexFromDocuments,
  instructionKindLabel,
  instructionKindOf,
  instructionMatchLevel,
  instructionModuleIdForSubstanceModule,
  instructionRegistrations,
  instructionSourceClassIndex,
  instructionSourceClassOf,
  instructionSourceInfo,
  instructionTextQuality,
} from './instruction-source';

const INSTRUCTION = 'official_drug_instruction';

describe('instructionKindOf / instructionKindLabel', () => {
  it('reads the stored kind and names it for the reader', () => {
    expect(instructionKindLabel(instructionKindOf({ documentKind: 'leaflet' }))).toBe(
      'Листок-вкладыш (для пациента)',
    );
    expect(instructionKindLabel(instructionKindOf({ documentKind: 'national-instruction' }))).toBe(
      'Инструкция по медицинскому применению',
    );
    expect(instructionKindLabel(instructionKindOf({ documentKind: 'ohlp' }))).toContain('ОХЛП');
  });

  it('never invents a kind: anything else is a plain ГРЛС instruction', () => {
    expect(instructionKindOf({ documentKind: 'monograph' })).toBe('unknown');
    expect(instructionKindOf(undefined)).toBe('unknown');
    expect(instructionKindLabel('unknown')).toBe('Инструкция ГРЛС');
  });
});

describe('instructionRegistrations', () => {
  it('lists the primary, requested and merged registration numbers once each', () => {
    expect(
      instructionRegistrations({
        registrationNumber: 'ЛП-№(011241)-(РГ-RU)',
        requestedRegistrationNumbers: ['ЛП-000001', 'ЛП-№(011241)-(РГ-RU)'],
        registrationNumbers: ['ЛП-000001', 'ЛП-№(011241)-(РГ-RU)', '  '],
      }),
    ).toEqual(['ЛП-№(011241)-(РГ-RU)', 'ЛП-000001']);
  });

  it('tolerates missing and malformed fields', () => {
    expect(instructionRegistrations({ requestedRegistrationNumbers: 'ЛП-1' })).toEqual([]);
    expect(instructionRegistrations(undefined)).toEqual([]);
  });
});

describe('instructionIndexFromDocuments', () => {
  it('indexes a PDF under every registration it serves and skips other document types', () => {
    const index = instructionIndexFromDocuments([
      {
        id: 'grls.1',
        sourceType: INSTRUCTION,
        metadata: { registrationNumber: 'ЛП-2', registrationNumbers: ['ЛП-1', 'ЛП-2'] },
      },
      {
        id: 'card.1',
        sourceType: 'official_registry_summary',
        metadata: { registrationNumber: 'ЛП-9' },
      },
      { id: 'grls.3', sourceType: INSTRUCTION },
    ]);
    expect([...index]).toEqual([
      ['ЛП-2', 'grls.1'],
      ['ЛП-1', 'grls.1'],
    ]);
  });

  it('prefers the professional text over the patient leaflet for one registration', () => {
    const entries = (order: readonly string[]) =>
      order.map((kind) => ({
        id: `doc.${kind}`,
        sourceType: INSTRUCTION,
        metadata: { registrationNumber: 'ЛП-1', documentKind: kind },
      }));
    for (const order of [
      ['leaflet', 'national-instruction', 'ohlp'],
      ['ohlp', 'leaflet', 'national-instruction'],
      ['national-instruction', 'ohlp', 'leaflet'],
    ]) {
      expect(instructionIndexFromDocuments(entries(order)).get('ЛП-1')).toBe('doc.ohlp');
    }
    expect(
      instructionIndexFromDocuments(entries(['leaflet', 'national-instruction'])).get('ЛП-1'),
    ).toBe('doc.national-instruction');
    expect(instructionIndexFromDocuments(entries(['leaflet', 'unknown'])).get('ЛП-1')).toBe(
      'doc.unknown',
    );
  });

  it('takes the newer fetch of the same kind, then the smaller id', () => {
    const documents = [
      {
        id: 'doc.b',
        sourceType: INSTRUCTION,
        metadata: {
          registrationNumber: 'ЛП-1',
          documentKind: 'leaflet',
          fetchedAt: '2026-10-02T05:00:00Z',
        },
      },
      {
        id: 'doc.a',
        sourceType: INSTRUCTION,
        metadata: {
          registrationNumber: 'ЛП-1',
          documentKind: 'leaflet',
          fetchedAt: '2026-07-30T05:00:00Z',
        },
      },
      {
        id: 'doc.c',
        sourceType: INSTRUCTION,
        metadata: { registrationNumber: 'ЛП-2', documentKind: 'leaflet' },
      },
      {
        id: 'doc.b2',
        sourceType: INSTRUCTION,
        metadata: { registrationNumber: 'ЛП-2', documentKind: 'leaflet' },
      },
    ];
    const index = instructionIndexFromDocuments(documents);
    expect(index.get('ЛП-1')).toBe('doc.b');
    expect(index.get('ЛП-2')).toBe('doc.b2');
  });
});

describe('instructionTextQuality / instructionSourceInfo', () => {
  it('has no note for a native text layer', () => {
    expect(instructionTextQuality({ ocr: false, unknownWordRatio: 0.5 })).toBe('native');
    expect(instructionTextQuality(undefined)).toBe('native');
  });

  it('flags OCR text and, past the thresholds, low-quality OCR text', () => {
    expect(instructionTextQuality({ ocr: true, unknownWordRatio: 0.05 })).toBe('ocr');
    expect(instructionTextQuality({ ocr: true, unknownWordRatio: 0.12 })).toBe('ocr-low');
    expect(instructionTextQuality({ ocr: true, ocrLowConfidenceRatio: 0.3 })).toBe('ocr-low');
    expect(instructionTextQuality({ ocr: true })).toBe('ocr');
  });

  it('collects kind, edition, source, fetch date and quality of an instruction', () => {
    const info = instructionSourceInfo({
      sourceType: INSTRUCTION,
      metadata: {
        documentKind: 'leaflet',
        instructionLabel: 'Изм. № 0, ЛП-008472, 2022',
        officialSourceUrl: 'https://grls.rosminzdrav.ru/InstrImg/2023/05/16/1/a.pdf',
        fetchedAt: '2026-07-30T07:56:33Z',
        ocr: true,
        unknownWordRatio: 0.02,
      },
    });
    expect(info).toMatchObject({
      kind: 'leaflet',
      kindLabel: 'Листок-вкладыш (для пациента)',
      edition: 'Изм. № 0, ЛП-008472, 2022',
      sourceUrl: 'https://grls.rosminzdrav.ru/InstrImg/2023/05/16/1/a.pdf',
      fetchedOn: '30.07.2026',
      quality: 'ocr',
    });
    expect(info?.qualityNote).toContain('OCR');
  });

  it('shows no source for other documents and refuses a non-https link', () => {
    expect(
      instructionSourceInfo({ sourceType: 'official_registry_summary', metadata: {} }),
    ).toBeNull();
    expect(instructionSourceInfo(undefined)).toBeNull();
    expect(
      instructionSourceInfo({
        sourceType: INSTRUCTION,
        metadata: { officialSourceUrl: 'javascript:alert(1)' },
      })?.sourceUrl,
    ).toBeNull();
  });
});

describe('manufacturer-site documents (M1, ADR-0023)', () => {
  const holderSite = {
    sourceClass: 'manufacturer-site',
    publisher: 'АО «ВЕРТЕКС»',
    documentKind: 'national-instruction',
    officialSourceUrl: 'https://vertex.spb.ru/upload/a.pdf',
    registrationNumber: 'ЛП-№(003754)-(РГ-RU)',
    matchLevel: 'label-unique',
    registrationMatches: [
      { registrationNumber: 'ЛП-№(003754)-(РГ-RU)', matchLevel: 'text-number' },
      { registrationNumber: 'ЛП-№(003755)-(РГ-RU)', matchLevel: 'label-unique' },
    ],
  };

  it('knows the source class and defaults to a ГРЛС file', () => {
    expect(instructionSourceClassOf(holderSite)).toBe('manufacturer-site');
    expect(instructionSourceClassOf({ documentKind: 'leaflet' })).toBe('grls');
    expect(instructionSourceClassOf(undefined)).toBe('grls');
  });

  it('reads the match of the registration shown, else the weakest level of the document', () => {
    expect(instructionMatchLevel(holderSite, 'ЛП-№(003754)-(РГ-RU)')).toBe('text-number');
    expect(instructionMatchLevel(holderSite, 'ЛП-№(003755)-(РГ-RU)')).toBe('label-unique');
    expect(instructionMatchLevel(holderSite, 'ЛП-другое')).toBe('label-unique');
    expect(instructionMatchLevel({ matchLevel: 'invented' })).toBeNull();
  });

  it('puts the holder and the match method in the source block', () => {
    const info = instructionSourceInfo(
      { sourceType: INSTRUCTION, metadata: holderSite },
      'ЛП-№(003755)-(РГ-RU)',
    );
    expect(info).toMatchObject({
      sourceClass: 'manufacturer-site',
      publisher: 'АО «ВЕРТЕКС»',
      matchLevel: 'label-unique',
      kindLabel: 'Инструкция по медицинскому применению',
    });
    expect(info?.matchNote).toContain('номер регистрации в документе не напечатан');
    const strict = instructionSourceInfo(
      { sourceType: INSTRUCTION, metadata: holderSite },
      'ЛП-№(003754)-(РГ-RU)',
    );
    expect(strict?.matchNote).toContain('напечатанному в самом документе');
  });

  it('shows no holder or match for a ГРЛС file', () => {
    const info = instructionSourceInfo({
      sourceType: INSTRUCTION,
      metadata: {
        documentKind: 'leaflet',
        publisher: 'не должно показаться',
        matchLevel: 'text-number',
      },
    });
    expect(info).toMatchObject({ sourceClass: 'grls', publisher: null, matchLevel: null });
    expect(info?.matchNote).toBeNull();
  });

  it('a ГРЛС file outranks a holder site for the same registration, whatever the kind', () => {
    const documents = [
      {
        id: 'site.ohlp',
        sourceType: INSTRUCTION,
        metadata: {
          registrationNumber: 'ЛП-1',
          sourceClass: 'manufacturer-site',
          documentKind: 'ohlp',
        },
      },
      {
        id: 'grls.leaflet',
        sourceType: INSTRUCTION,
        metadata: { registrationNumber: 'ЛП-1', documentKind: 'leaflet' },
      },
      {
        id: 'site.only',
        sourceType: INSTRUCTION,
        metadata: { registrationNumber: 'ЛП-2', sourceClass: 'manufacturer-site' },
      },
    ];
    expect(instructionIndexFromDocuments(documents).get('ЛП-1')).toBe('grls.leaflet');
    expect(instructionIndexFromDocuments(documents).get('ЛП-2')).toBe('site.only');
    const classes = instructionSourceClassIndex(documents);
    expect(classes.get('ЛП-1')).toBe('grls');
    expect(classes.get('ЛП-2')).toBe('manufacturer-site');
  });

  it("names an unclassified holder document as the holder's instruction", () => {
    expect(
      instructionSourceInfo({
        sourceType: INSTRUCTION,
        metadata: { sourceClass: 'manufacturer-site' },
      })?.kindLabel,
    ).toBe('Инструкция производителя');
  });
});

describe('formatFetchDate', () => {
  it('formats ISO dates and rejects anything else', () => {
    expect(formatFetchDate('2026-10-02T05:09:00Z')).toBe('02.10.2026');
    expect(formatFetchDate('вчера')).toBeNull();
    expect(formatFetchDate(null)).toBeNull();
  });
});

describe('instructionModuleIdForSubstanceModule', () => {
  it('maps an ЕСКЛП group module to the module of its instructions', () => {
    expect(instructionModuleIdForSubstanceModule('minimed.medications.cardiovascular.ru')).toBe(
      'minimed.medications.instructions.cardiovascular.ru',
    );
    expect(
      instructionModuleIdForSubstanceModule(
        'minimed.medications.antineoplastic-immunomodulating.ru',
      ),
    ).toBe('minimed.medications.instructions.antineoplastic-immunomodulating.ru');
  });

  it('has no instructions module for Allmed, an instructions module or a foreign id', () => {
    expect(instructionModuleIdForSubstanceModule('minimed.medications.ru')).toBeNull();
    expect(
      instructionModuleIdForSubstanceModule('minimed.medications.instructions.blood.ru'),
    ).toBeNull();
    expect(instructionModuleIdForSubstanceModule('minimed.clinical.x')).toBeNull();
  });
});
