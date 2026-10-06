import { describe, expect, it } from 'vitest';
import { TOPIC_LACTATION, TOPIC_PREGNANCY } from './pregnancy-words';
import {
  ageSentences,
  compareSafetyDocuments,
  flagsOrigin,
  flagsTopic,
  LIMIT_AGE_BELOW,
  packFlags,
  parseSafetyIndex,
  pregnancySentences,
} from './safety-index';
import { buildFixtureIndex } from './safety-test-fixtures';

const index = buildFixtureIndex();

describe('the fixture index', () => {
  it('lists the instructions of a card, the common form and the one with a pregnancy section first', () => {
    const card = index.cardBySlug.get('ибупрофен') ?? -1;
    expect(index.documentsOfCard.get(card)).toEqual([
      'drug.rf.bbbb.instruction',
      'drug.rf.bbb2.instruction',
    ]);
  });

  it('keeps no instruction text', () => {
    const json = JSON.stringify(index.asset);
    expect(json).not.toContain('Применение препарата в I триместре');
    expect(json).not.toContain('Детский возраст');
  });

  it('records the module, the trade name and the dosage form', () => {
    const document = index.asset.documents['drug.rf.bbbb.instruction'];
    expect(index.asset.modules[document?.m ?? -1]).toBe('minimed.medications.instructions.test.ru');
    expect(document?.t).toBe('Ибупрофен-тест');
    expect(document?.f).toBe('таблетки');
    expect(document?.p).toBe(1);
    expect(document?.a).toBe(1);
  });
});

describe('pregnancySentences and ageSentences', () => {
  it('give the sentences of an instruction with full section ids and offsets', () => {
    const pregnancy = pregnancySentences(index, 'drug.rf.bbbb.instruction');
    expect(pregnancy.length).toBeGreaterThan(3);
    expect(pregnancy.every((sentence) => sentence.section[0].startsWith('section.'))).toBe(true);
    expect(pregnancy.map((sentence) => flagsTopic(sentence.flags))).toContain(TOPIC_LACTATION);
    expect(pregnancy.map((sentence) => flagsTopic(sentence.flags))).toContain(TOPIC_PREGNANCY);
    expect(pregnancy.some((sentence) => flagsOrigin(sentence.flags) === 1)).toBe(true);
  });

  it('give the limits with their code and bounds', () => {
    const [first] = ageSentences(index, 'drug.rf.bbb2.instruction');
    expect(first?.limits[0]?.code).toBe(LIMIT_AGE_BELOW);
    expect(first?.limits[0]?.upper).toBe(Math.round(14 * 365.25));
  });

  it('answer an unknown instruction with nothing', () => {
    expect(pregnancySentences(index, 'nope')).toEqual([]);
    expect(ageSentences(index, 'nope')).toEqual([]);
  });
});

describe('parseSafetyIndex', () => {
  const valid = JSON.parse(JSON.stringify(index.asset)) as Record<string, unknown>;

  it('accepts what the builder wrote', () => {
    expect(() => parseSafetyIndex(valid)).not.toThrow();
  });

  it('refuses another schema version, a bad range and an unknown limit code', () => {
    expect(() => parseSafetyIndex({ ...valid, schemaVersion: 2 })).toThrow(/schema version/u);
    const documents = valid['documents'] as Record<string, Record<string, unknown>>;
    const broken = (patch: Record<string, unknown>) => ({
      ...valid,
      documents: {
        ...documents,
        'drug.rf.bbbb.instruction': { ...documents['drug.rf.bbbb.instruction'], ...patch },
      },
    });
    expect(() => parseSafetyIndex(broken({ pl: [[0, 5, 5, 0, 0, 0]] }))).toThrow(/range/u);
    expect(() => parseSafetyIndex(broken({ ag: [[0, 1, 9, 0, 0, 3, 99, 0, 0]] }))).toThrow(
      /limit code/u,
    );
    expect(() => parseSafetyIndex(broken({ m: 9 }))).toThrow(/module/u);
  });
});

describe('compareSafetyDocuments', () => {
  const base = { p: 1, a: 1, s: 0, k: 1, n: 1 } as const;
  it('puts a pregnancy section first, then the common form', () => {
    expect(
      compareSafetyDocuments({ id: 'a', ...base, p: 0 }, { id: 'b', ...base }),
    ).toBeGreaterThan(0);
    expect(
      compareSafetyDocuments({ id: 'a', ...base, n: 1 }, { id: 'b', ...base, n: 7 }),
    ).toBeGreaterThan(0);
  });
});

describe('packFlags', () => {
  it('round-trips topic, origin and forms', () => {
    const flags = packFlags(3, 5, 0b1010_0101);
    expect(flagsTopic(flags)).toBe(3);
    expect(flagsOrigin(flags)).toBe(5);
    expect(flags >> 5).toBe(0b1010_0101);
  });
});
