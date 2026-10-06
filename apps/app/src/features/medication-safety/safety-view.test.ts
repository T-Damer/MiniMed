import { describe, expect, it } from 'vitest';

import { formatAgeDays } from './age-limits';
import {
  LIMIT_AGE_BELOW,
  LIMIT_AGE_FROM,
  LIMIT_AGE_RANGE,
  type SafetyDocument,
} from './safety-index';
import type { TypedAge } from './safety-query';
import {
  buildFixtureIndex,
  type FixtureSection,
  fixtureMedicalDocument,
  IBUPROFEN_SECTIONS,
} from './safety-test-fixtures';
import {
  alternativesOf,
  compareAge,
  type DocumentState,
  documentsToRead,
  hasIntentContent,
  intentView,
  NOTHING_SAID_TEXT,
  planDocuments,
  type SafetyCandidate,
  sourceLine,
} from './safety-view';

const YEAR = 365.25;
const years = (count: number) => Math.round(count * YEAR);
const index = buildFixtureIndex();
const ibuprofen: SafetyCandidate = {
  slug: 'ибупрофен',
  card: index.cardBySlug.get('ибупрофен') ?? -1,
  label: 'Ибупрофен',
  ownDocumentId: null,
};
const omeprazole: SafetyCandidate = {
  slug: 'омепразол',
  card: index.cardBySlug.get('омепразол') ?? -1,
  label: 'Омепразол',
  ownDocumentId: null,
};
const installed = new Map<string, DocumentState>([
  [
    'drug.rf.bbbb.instruction',
    { document: fixtureMedicalDocument('drug.rf.bbbb.instruction', IBUPROFEN_SECTIONS) },
  ],
]);
function requireDocument(id: string): SafetyDocument {
  const found = index.asset.documents[id];
  if (!found) throw new Error(`${id} is not in the fixture index`);
  return found;
}
const [contraindicationsSection, pregnancySection] = IBUPROFEN_SECTIONS as readonly [
  FixtureSection,
  FixtureSection,
];
const three: TypedAge = { days: years(3), kind: 'exact', text: '3 года' };

describe('planDocuments', () => {
  it('reads the instruction that has something on the topic first', () => {
    expect(planDocuments(index, ibuprofen, 'pregnancy')[0]).toBe('drug.rf.bbbb.instruction');
    expect(planDocuments(index, ibuprofen, 'age')).toEqual([
      'drug.rf.bbbb.instruction',
      'drug.rf.bbb2.instruction',
    ]);
  });

  it('puts the instruction of the product the doctor typed first', () => {
    const own = { ...ibuprofen, ownDocumentId: 'drug.rf.bbb2.instruction' };
    expect(planDocuments(index, own, 'age')[0]).toBe('drug.rf.bbb2.instruction');
  });

  it('reads only the instruction the doctor picked', () => {
    expect(planDocuments(index, ibuprofen, 'age', 'drug.rf.bbb2.instruction')).toEqual([
      'drug.rf.bbb2.instruction',
    ]);
  });

  it('knows which instructions have content', () => {
    expect(hasIntentContent(requireDocument('drug.rf.bbbb.instruction'), 'lactation')).toBe(true);
    expect(hasIntentContent(requireDocument('drug.rf.bbb2.instruction'), 'pregnancy')).toBe(false);
  });
});

describe('documentsToRead', () => {
  it('asks for the first instruction, then the next when it is not installed', () => {
    const none = new Map<string, DocumentState>();
    expect(documentsToRead(index, ibuprofen, ['age'], none)).toEqual(['drug.rf.bbbb.instruction']);
    const missing = new Map<string, DocumentState>([['drug.rf.bbbb.instruction', 'missing']]);
    expect(documentsToRead(index, ibuprofen, ['age'], missing)).toEqual([
      'drug.rf.bbb2.instruction',
    ]);
    expect(documentsToRead(index, ibuprofen, ['age'], installed)).toEqual([]);
  });
});

describe('intentView: pregnancy and lactation', () => {
  const base = { index, candidate: ibuprofen, age: null, trimester: null, documents: installed };

  it('quotes the section sentences for the topic and the contraindication list apart', () => {
    const view = intentView({ ...base, intent: 'lactation' });
    expect(view.state).toBe('ready');
    expect(view.groups.map((group) => group.id)).toEqual(['section', 'warnings']);
    const section = view.groups[0]?.quotes.map((quote) =>
      quote.segments.map((segment) => segment.text).join(''),
    );
    expect(section?.some((text) => text.includes('проникает в грудное молоко'))).toBe(true);
    expect(section?.some((text) => text.includes('триместре беременности'))).toBe(false);
    const warning = view.groups[1]?.quotes[0];
    expect(warning?.originLabel).toBe('Противопоказания');
    expect(warning?.segments.some((segment) => segment.hit)).toBe(true);
  });

  it('never words a verdict of its own', () => {
    const view = intentView({ ...base, intent: 'pregnancy' });
    const own = [view.title, NOTHING_SAID_TEXT, ...(view.source ? [sourceLine(view.source)] : [])];
    for (const text of own) expect(text).not.toMatch(/(?:можно|нельзя|разрешен|безопасн)/iu);
  });

  it('puts the sentences that name a trimester first when one is asked about', () => {
    const view = intentView({ ...base, intent: 'pregnancy', trimester: 2 });
    expect(view.groups[0]?.quotes[0]?.namesTrimester).toBe(true);
  });

  it('labels the instruction as one of the substance when the product was not typed', () => {
    const view = intentView({ ...base, intent: 'pregnancy' });
    expect(view.source?.substanceNote).toContain('одного из препаратов с этим веществом');
    expect(view.source?.own).toBe(false);
    const own = intentView({
      ...base,
      candidate: { ...ibuprofen, ownDocumentId: 'drug.rf.bbbb.instruction' },
      intent: 'pregnancy',
    });
    expect(own.source?.own).toBe(true);
    expect(own.source?.substanceNote).toBeNull();
  });

  it('names the instruction that was read', () => {
    const view = intentView({ ...base, intent: 'pregnancy' });
    const line = view.source ? sourceLine(view.source) : '';
    expect(line).toContain('Ибупрофен-тест');
    expect(line).toContain('таблетки');
    expect(line).toContain('ГРЛС');
    expect(line).toContain('Изм. № 1');
  });
});

describe('intentView: states', () => {
  it('says the instruction was read and holds nothing on the topic', () => {
    const omeprazoleDocument = new Map<string, DocumentState>([
      [
        'drug.rf.dddd.instruction',
        {
          document: fixtureMedicalDocument('drug.rf.dddd.instruction', [
            {
              id: 'section.ddddddddddddddd1',
              type: 'indications',
              title: 'Показания к применению',
              text: 'Язвенная болезнь желудка.',
            },
          ]),
        },
      ],
    ]);
    const view = intentView({
      index,
      candidate: omeprazole,
      intent: 'lactation',
      age: null,
      trimester: null,
      documents: omeprazoleDocument,
    });
    expect(view.state).toBe('ready');
    expect(view.nothingSaid).toBe(true);
    expect(view.groups).toEqual([]);
    expect(view.source?.tradeName).toBe('Омепразол-тест');
  });

  it('offers the download when the module is not installed', () => {
    const view = intentView({
      index,
      candidate: ibuprofen,
      intent: 'pregnancy',
      age: null,
      trimester: null,
      documents: new Map([
        ['drug.rf.bbbb.instruction', 'missing'],
        ['drug.rf.bbb2.instruction', 'missing'],
      ]),
    });
    expect(view.state).toBe('not-installed');
    expect(view.moduleToInstall).toBe('minimed.medications.instructions.test.ru');
  });

  it('waits while the instruction is being read', () => {
    const view = intentView({
      index,
      candidate: ibuprofen,
      intent: 'pregnancy',
      age: null,
      trimester: null,
      documents: new Map([['drug.rf.bbbb.instruction', 'loading']]),
    });
    expect(view.state).toBe('loading');
  });

  it('says there is no instruction for a card without one', () => {
    const view = intentView({
      index,
      candidate: { slug: 'x', card: 99, label: 'X', ownDocumentId: null },
      intent: 'pregnancy',
      age: null,
      trimester: null,
      documents: new Map(),
    });
    expect(view.state).toBe('no-instruction');
  });

  it('reports a section whose text changed', () => {
    const changed = fixtureMedicalDocument('drug.rf.bbbb.instruction', [
      { ...pregnancySection, text: `${pregnancySection.text} Новая редакция.` },
      contraindicationsSection,
    ]);
    const view = intentView({
      index,
      candidate: ibuprofen,
      intent: 'pregnancy',
      age: null,
      trimester: null,
      documents: new Map([['drug.rf.bbbb.instruction', { document: changed }]]),
    });
    expect(view.changed).toBeGreaterThan(0);
  });
});

describe('intentView: age', () => {
  const base = {
    index,
    candidate: ibuprofen,
    intent: 'age' as const,
    trimester: null,
    documents: installed,
  };

  it('quotes the limits by section, with the weight limit apart', () => {
    const view = intentView({ ...base, age: null });
    expect(view.groups.map((group) => group.id)).toEqual(['restrictions', 'dosage']);
    const list = view.groups[0]?.quotes[0];
    expect(list?.limitWords).toEqual(['до 12 лет']);
    expect(view.groups[0]?.quotes.some((quote) => quote.weightLimits.includes('менее 20 кг'))).toBe(
      true,
    );
    expect(view.groups[1]?.quotes[0]?.forms.length).toBeGreaterThan(0);
    expect(view.ageSummary).toEqual([]);
  });

  it('adds a labelled calculation for the age that was typed', () => {
    const view = intentView({ ...base, age: three });
    expect(view.ageSummary[0]?.text).toBe('Рассчитано: 3 года — меньше верхней границы 12 лет');
    expect(view.ageSummary[0]?.words).toBe('до 12 лет');
    expect(view.ageSummary[0]?.sectionLabel).toBe('Противопоказания');
    const dosage = view.groups[1]?.quotes.flatMap((quote) => quote.calc.map((line) => line.text));
    expect(dosage).toContain('Рассчитано: 3 года — меньше нижней границы 12 лет');
  });
});

describe('compareAge', () => {
  const limit = (code: number, lower: number, upper: number) => ({
    matchStart: 0,
    matchEnd: 1,
    code: code as 0,
    lower,
    upper,
  });
  const exact = (count: number): TypedAge => ({
    days: years(count),
    kind: 'exact',
    text: formatAgeDays(years(count)),
  });

  it('compares with an upper bound', () => {
    const below = limit(LIMIT_AGE_BELOW, 0, years(12));
    expect(compareAge(exact(3), below)).toEqual({
      text: 'Рассчитано: 3 года — меньше верхней границы 12 лет',
      relation: 'below',
    });
    expect(compareAge(exact(12), below)).toEqual({
      text: 'Рассчитано: 12 лет — совпадает с границей 12 лет: смотрите формулировку в предложении',
      relation: 'equal',
    });
    expect(compareAge(exact(15), below)).toEqual({
      text: 'Рассчитано: 15 лет — больше верхней границы 12 лет',
      relation: 'above',
    });
  });

  it('compares with a lower bound', () => {
    const from = limit(LIMIT_AGE_FROM, years(12), 0);
    expect(compareAge(exact(3), from)?.text).toBe(
      'Рассчитано: 3 года — меньше нижней границы 12 лет',
    );
    expect(compareAge(exact(14), from)?.text).toBe(
      'Рассчитано: 14 лет — не ниже нижней границы 12 лет',
    );
    expect(compareAge(exact(12), from)?.relation).toBe('equal');
  });

  it('compares with a range', () => {
    const range = limit(LIMIT_AGE_RANGE, years(6), years(12));
    expect(compareAge(exact(8), range)?.relation).toBe('inside');
    expect(compareAge(exact(3), range)?.relation).toBe('below');
    expect(compareAge(exact(15), range)?.relation).toBe('above');
  });

  it('treats «до 5 лет» as an interval', () => {
    const upTo: TypedAge = { days: years(5), kind: 'upTo', text: '5 лет' };
    expect(compareAge(upTo, limit(LIMIT_AGE_FROM, years(12), 0))).toEqual({
      text: 'Рассчитано: возраст до 5 лет — меньше нижней границы 12 лет',
      relation: 'below',
    });
    expect(compareAge(upTo, limit(LIMIT_AGE_FROM, years(3), 0))?.relation).toBe('spans');
  });

  it('compares months with years', () => {
    const six: TypedAge = { days: Math.round(YEAR / 2), kind: 'exact', text: '6 месяцев' };
    expect(compareAge(six, limit(LIMIT_AGE_BELOW, 0, years(1)))?.text).toBe(
      'Рассчитано: 6 месяцев — меньше верхней границы 1 года',
    );
  });
});

describe('alternativesOf', () => {
  it('lists the other instructions of a card by form and trade name', () => {
    expect(alternativesOf(index, ibuprofen).map((choice) => choice.label)).toEqual([
      'таблетки · Ибупрофен-тест',
      'гель · Ибупрофен-гель',
    ]);
    expect(alternativesOf(index, omeprazole)).toEqual([]);
  });
});
