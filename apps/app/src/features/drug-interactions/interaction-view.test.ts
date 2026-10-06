import type { MedicalDocument } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import { checkPair, type DrugItem } from './interaction-check';
import {
  SPAN_FLAG_CAUTION,
  SPAN_FLAG_CONTRAINDICATIONS,
  SPAN_FLAG_INTERACTIONS,
  SPAN_FLAG_LEAFLET_BODY,
  SPAN_FLAG_SPECIAL,
} from './interaction-extract';
import { interactionShareText, renderInteractionPrintHtml } from './interaction-print';
import type { SeverityLookup } from './interaction-severity';
import { buildFixtureIndex, SECTION_TEXT } from './interaction-test-fixtures';
import {
  type DocumentState,
  otherSectionsLabel,
  pairStatusText,
  pairView,
  printPairs,
  sideNote,
  splitQuotes,
} from './interaction-view';

const index = buildFixtureIndex();
const drug = (slug: string, label = slug): DrugItem => ({
  id: slug,
  kind: 'drug',
  card: index.cardBySlug.get(slug) ?? -1,
  label,
});

function document(id: string, sectionId: string, text: string): MedicalDocument {
  return {
    id,
    title: `${id}: инструкция`,
    shortTitle: null,
    sourceType: 'official_drug_instruction',
    status: 'active',
    specialties: [],
    metadata: { documentKind: 'national-instruction', instructionLabel: 'Изм. № 1' },
    versionId: 'v',
    versionLabel: 'v',
    effectiveFrom: null,
    sections: [
      {
        id: sectionId,
        documentVersionId: 'v',
        parentSectionId: null,
        title: 'Взаимодействие с другими лекарственными средствами',
        sectionType: 'interactions',
        depth: 1,
        orderIndex: 0,
        pageStart: null,
        pageEnd: null,
        anchor: 'x',
        sectionPath: [],
        chunks: [
          {
            id: 'c',
            sectionId,
            documentVersionId: 'v',
            orderIndex: 0,
            originalText: text,
            pageStart: null,
            pageEnd: null,
            anchor: 'x/chunk',
          },
        ],
      },
    ],
  };
}

const warfarin = drug('варфарин', 'Варфарин');
const ibuprofen = drug('ибупрофен', 'Ибупрофен');
const omeprazole = drug('омепразол', 'Омепразол');

describe('pairView', () => {
  const states = new Map<string, DocumentState>([
    [
      'drug.rf.aaaa.instruction',
      {
        document: document(
          'drug.rf.aaaa.instruction',
          'section.1111111111111111',
          SECTION_TEXT.warfarinInteractions,
        ),
      },
    ],
    [
      'drug.rf.bbbb.instruction',
      {
        document: document(
          'drug.rf.bbbb.instruction',
          'section.2222222222222222',
          SECTION_TEXT.ibuprofenInteractions,
        ),
      },
    ],
  ]);

  it('shows the quoted sentences of both instructions when a mention is found', () => {
    const view = pairView(index, checkPair(index, warfarin, ibuprofen), states, []);
    expect(view.status).toBe('found');
    expect(pairStatusText(view)).toBe('Упоминание найдено: 2 предложения');
    expect(view.sides.map((side) => side.state)).toEqual(['ready', 'ready']);
    expect(view.sides[0]?.quotes[0]?.text).toContain('ибупрофеном');
    expect(view.sides[1]?.source?.edition).toBe('Изм. № 1');
    expect(sideNote(view.sides[0] as NonNullable<(typeof view.sides)[0]>)).toContain(
      'Тексты инструкций других производителей могут отличаться',
    );
  });

  it('offers the module when the instruction is not installed, and still counts the sentences', () => {
    const none = new Map<string, DocumentState>([
      ['drug.rf.aaaa.instruction', 'missing'],
      ['drug.rf.bbbb.instruction', 'missing'],
    ]);
    const view = pairView(index, checkPair(index, warfarin, ibuprofen), none, []);
    expect(view.sides.map((side) => side.state)).toEqual(['not-installed', 'not-installed']);
    expect(view.sides[0]?.count).toBe(1);
    expect(view.sides[0]?.moduleId).toBe('minimed.medications.instructions.test.ru');
    expect(view.status).toBe('found');
  });

  it('never calls a pair without mentions safe', () => {
    const ready = new Map(states);
    const view = pairView(index, checkPair(index, ibuprofen, omeprazole), ready, []);
    expect(view.status).toBe('incomplete');
    const text = pairStatusText(view);
    expect(text).toContain('упоминаний не найдено');
    expect(text).not.toMatch(/безопасн/iu);
    expect(view.sides.find((side) => side.state === 'no-instruction')?.from.label).toBe(
      'Омепразол',
    );
  });

  it('drops the side that would read an instruction of alcohol', () => {
    const alcohol: DrugItem = { id: 'alcohol', kind: 'alcohol', card: null, label: 'Алкоголь' };
    const view = pairView(index, checkPair(index, warfarin, alcohol), states, []);
    expect(view.sides).toHaveLength(1);
    expect(view.sides[0]?.from.label).toBe('Варфарин');
  });

  it('feeds the print and the share text from the same view', () => {
    const view = pairView(index, checkPair(index, warfarin, ibuprofen), states, []);
    const pairs = printPairs([view]);
    const html = renderInteractionPrintHtml(pairs, '06.10.2026');
    expect(html).toContain('Варфарин + Ибупрофен');
    expect(html).toContain('поиск по текстам официальных инструкций');
    expect(html).not.toContain('<script');
    const text = interactionShareText(pairs);
    expect(text).toContain('Упоминание найдено: 2 предложения');
    expect(text).toContain('ибупрофеном');
  });

  describe('severity label (INT2)', () => {
    const lookup = (level: 'major' | null): SeverityLookup => ({
      provenance: {
        source: 'DDInter 2.0',
        retrievedOn: '2026-10-06',
        license: 'CC BY-NC-SA 4.0',
        licenseUrl: 'https://creativecommons.org/licenses/by-nc-sa/4.0/',
        siteUrl: 'https://ddinter2.scbdd.com/',
        labelledPairs: 1,
      },
      levelOf: (first, second) =>
        level && [first, second].sort().join('|') === 'варфарин|ибупрофен' ? level : null,
    });

    it('labels a pair with quotable sentences, naming the source', () => {
      const view = pairView(
        index,
        checkPair(index, warfarin, ibuprofen),
        states,
        [],
        lookup('major'),
      );
      expect(view.severity?.label).toBe('Серьёзное по DDInter');
      expect(view.severity?.note).toContain('не из инструкции');
    });

    it('does not label a pair whose instructions are not installed (nothing to quote)', () => {
      const none = new Map<string, DocumentState>([
        ['drug.rf.aaaa.instruction', 'missing'],
        ['drug.rf.bbbb.instruction', 'missing'],
      ]);
      const view = pairView(
        index,
        checkPair(index, warfarin, ibuprofen),
        none,
        [],
        lookup('major'),
      );
      expect(view.status).toBe('found');
      expect(view.severity).toBeNull();
    });

    it('does not label a pair without an instruction sentence, even when DDInter knows it', () => {
      const view = pairView(index, checkPair(index, ibuprofen, omeprazole), states, [], {
        ...lookup('major'),
        levelOf: () => 'major',
      });
      expect(view.found).toBe(0);
      expect(view.severity).toBeNull();
    });

    it('shows no label without the module, and none for alcohol', () => {
      expect(
        pairView(index, checkPair(index, warfarin, ibuprofen), states, [], null).severity,
      ).toBeNull();
      const alcohol: DrugItem = { id: 'alcohol', kind: 'alcohol', card: null, label: 'Алкоголь' };
      const view = pairView(index, checkPair(index, warfarin, alcohol), states, [], {
        ...lookup('major'),
        levelOf: () => 'major',
      });
      expect(view.severity).toBeNull();
    });

    it('prints and shares the label with its source', () => {
      const view = pairView(
        index,
        checkPair(index, warfarin, ibuprofen),
        states,
        [],
        lookup('major'),
      );
      const pairs = printPairs([view]);
      expect(pairs[0]?.severity).toContain('Серьёзное по DDInter');
      expect(renderInteractionPrintHtml(pairs, '06.10.2026')).toContain('CC BY-NC-SA 4.0');
      expect(interactionShareText(pairs)).toContain('Серьёзное по DDInter');
      const plain = printPairs([
        pairView(index, checkPair(index, warfarin, ibuprofen), states, []),
      ]);
      expect(interactionShareText(plain)).not.toContain('DDInter');
    });
  });
});

describe('splitQuotes (INT2)', () => {
  const quote = (flags: number) => ({
    key: String(flags),
    text: '',
    segments: [],
    anchor: null,
    flags,
    sectionTitle: '',
  });

  it('keeps the interaction section and leaflet text in view and folds the other sections', () => {
    const { main, other } = splitQuotes([
      quote(SPAN_FLAG_SPECIAL),
      quote(SPAN_FLAG_INTERACTIONS),
      quote(SPAN_FLAG_CONTRAINDICATIONS),
      quote(SPAN_FLAG_LEAFLET_BODY),
      quote(SPAN_FLAG_CAUTION),
    ]);
    expect(main.map((entry) => entry.flags)).toEqual([
      SPAN_FLAG_INTERACTIONS,
      SPAN_FLAG_LEAFLET_BODY,
    ]);
    expect(other.map((entry) => entry.flags)).toEqual([
      SPAN_FLAG_SPECIAL,
      SPAN_FLAG_CONTRAINDICATIONS,
      SPAN_FLAG_CAUTION,
    ]);
  });

  it('words the fold with the count', () => {
    expect(otherSectionsLabel(3)).toBe('ещё из других разделов (3)');
  });
});
