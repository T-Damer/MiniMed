import type { MedicalDocument } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import {
  pairSeverity,
  parseSeverityText,
  readSeverityProvenance,
  SEVERITY_DOCUMENT_PREFIX,
  SEVERITY_SOURCE_NOTE,
  type SeverityLookup,
  severityAttribution,
  severityDocumentId,
  severityDocumentText,
  severityLabelText,
} from './interaction-severity';

function document(
  metadata: Record<string, unknown>,
  ...chunks: readonly string[]
): MedicalDocument {
  return {
    id: 'ddinter.severity.x',
    title: 'x',
    shortTitle: null,
    sourceType: 'drug_interaction_severity',
    status: 'active',
    specialties: [],
    metadata,
    versionId: 'v',
    versionLabel: 'v',
    effectiveFrom: null,
    sections: [
      {
        id: 's',
        documentVersionId: 'v',
        parentSectionId: null,
        title: 'Пары',
        sectionType: 'data',
        depth: 1,
        orderIndex: 0,
        pageStart: null,
        pageEnd: null,
        anchor: 'a',
        sectionPath: [],
        chunks: chunks.map((originalText, orderIndex) => ({
          id: `c${orderIndex}`,
          sectionId: 's',
          documentVersionId: 'v',
          orderIndex,
          originalText,
          pageStart: null,
          pageEnd: null,
          anchor: `a/c${orderIndex}`,
        })),
      },
    ],
  };
}

describe('severityDocumentId', () => {
  it('stores a pair in the document of the smaller slug, whichever order it is asked in', () => {
    expect(severityDocumentId('ибупрофен', 'варфарин')).toEqual({
      documentId: `${SEVERITY_DOCUMENT_PREFIX}варфарин`,
      partner: 'ибупрофен',
    });
    expect(severityDocumentId('варфарин', 'ибупрофен')).toEqual(
      severityDocumentId('ибупрофен', 'варфарин'),
    );
  });
});

describe('parseSeverityText', () => {
  it('reads the preparer format and skips what it does not know', () => {
    const levels = parseSeverityText('а\t3\nб\t2\nв\t1\nг\t0\nд\t9\nбез табуляции\n\t3');
    expect([...levels]).toEqual([
      ['а', 'major'],
      ['б', 'moderate'],
      ['в', 'minor'],
      ['г', 'unknown'],
    ]);
  });

  it('joins the chunks of a document in reading order', () => {
    expect(severityDocumentText(document({}, 'а\t3', 'б\t2'))).toBe('а\t3\nб\t2');
  });
});

describe('labels', () => {
  const lookup: SeverityLookup = {
    provenance: {
      source: 'DDInter 2.0',
      retrievedOn: '2026-10-06',
      license: 'CC BY-NC-SA 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by-nc-sa/4.0/',
      siteUrl: 'https://ddinter2.scbdd.com/',
      labelledPairs: 1,
    },
    levelOf: (first, second) => (first === 'a' && second === 'b' ? 'major' : null),
  };

  it('names the source in every label', () => {
    expect(severityLabelText('major')).toBe('Серьёзное по DDInter');
    expect(severityLabelText('moderate')).toBe('Умеренное по DDInter');
    expect(severityLabelText('minor')).toBe('Слабое по DDInter');
    expect(severityLabelText('unknown')).toBe('Степень не определена по DDInter');
  });

  it('labels a pair that has a quotable instruction sentence and a level', () => {
    expect(pairSeverity(lookup, { firstId: 'a', secondId: 'b', quotable: 1 })).toEqual({
      level: 'major',
      label: 'Серьёзное по DDInter',
      note: SEVERITY_SOURCE_NOTE,
    });
    expect(SEVERITY_SOURCE_NOTE).toContain('не из инструкции');
  });

  it('never shows a label without a quotable instruction sentence', () => {
    expect(pairSeverity(lookup, { firstId: 'a', secondId: 'b', quotable: 0 })).toBeNull();
  });

  it('shows nothing without the module or without a level for the pair', () => {
    expect(pairSeverity(null, { firstId: 'a', secondId: 'b', quotable: 3 })).toBeNull();
    expect(pairSeverity(lookup, { firstId: 'a', secondId: 'c', quotable: 3 })).toBeNull();
  });
});

describe('provenance', () => {
  it('reads source, date and licence from the manifest document', () => {
    const provenance = readSeverityProvenance(
      document({
        source: 'DDInter 2.0',
        sourceUrl: 'https://ddinter2.scbdd.com/',
        retrievedOn: '2026-10-06',
        license: 'CC-BY-NC-SA-4.0',
        licenseUrl: 'https://creativecommons.org/licenses/by-nc-sa/4.0/',
        labelledPairs: 79884,
      }),
    );
    expect(provenance?.license).toBe('CC BY-NC-SA 4.0');
    expect(provenance?.labelledPairs).toBe(79884);
    expect(severityAttribution(provenance as NonNullable<typeof provenance>)).toContain(
      'CC BY-NC-SA 4.0',
    );
  });

  it('is null for a document that is not the manifest', () => {
    expect(readSeverityProvenance(document({}))).toBeNull();
  });
});
