import { describe, expect, it } from 'vitest';
import { TOPIC_LACTATION, TOPIC_PREGNANCY } from './pregnancy-words';
import { extractSafety, type SafetySectionInput, titlePrefixLength } from './safety-extract';
import {
  flagsForms,
  flagsOrigin,
  flagsTopic,
  LIMIT_AGE_BELOW,
  LIMIT_AGE_FROM,
  LIMIT_AGE_RANGE,
  LIMIT_CATEGORY,
  LIMIT_WEIGHT_BELOW,
  ORIGIN_CONTRAINDICATIONS,
  ORIGIN_DOSAGE,
  ORIGIN_OTHER,
  ORIGIN_PREGNANCY_SECTION,
} from './safety-index';
import { CONTRAINDICATIONS_TEXT, DOSAGE_TEXT, PREGNANCY_TEXT } from './safety-test-fixtures';

function section(
  type: string,
  title: string,
  text: string,
  id = `section.${type}`,
): SafetySectionInput {
  return { id, type, title, chunks: [text] };
}

function sentenceText(text: string, entry: readonly number[]): string {
  return text.slice(entry[1], entry[2]);
}

describe('extractSafety: the pregnancy section', () => {
  const text = PREGNANCY_TEXT;
  const result = extractSafety([
    section('pregnancy', 'Применение при беременности и в период грудного вскармливания', text),
  ]);

  it('is found and marked', () => {
    expect(result.hasPregnancySection).toBe(true);
    expect(result.pl.length).toBeGreaterThan(0);
    expect(
      result.pl.every((entry) => flagsOrigin(entry[3] ?? 0) === ORIGIN_PREGNANCY_SECTION),
    ).toBe(true);
  });

  it('gives each sentence the topic of its words', () => {
    const byText = new Map(
      result.pl.map((entry) => [sentenceText(text, entry), flagsTopic(entry[3] ?? 0)]),
    );
    expect(
      byText.get('Беременность\nПрименение препарата в I триместре беременности противопоказано.'),
    ).toBe(TOPIC_PREGNANCY);
    const lactation = [...byText].find(([sentence]) =>
      sentence.includes('проникает в грудное молоко'),
    );
    expect(lactation?.[1]).toBe(TOPIC_LACTATION);
  });

  it('stops where another section begins', () => {
    const quoted = result.pl.map((entry) => sentenceText(text, entry)).join('|');
    expect(quoted).not.toContain('фертильность');
    expect(quoted).not.toContain('Фертильность');
  });

  it('points the match range at the words that name the topic', () => {
    const entry = result.pl[0];
    expect(entry && text.slice(entry[4], entry[5])).toMatch(/Беременность/u);
  });
});

describe('extractSafety: neutral sentences take the topic before them', () => {
  const text =
    'Грудное вскармливание. Препарат применять не рекомендуется. Требуется консультация врача.';
  const result = extractSafety([section('pregnancy', 'Применение при беременности', text)]);

  it('gives them the lactation topic and keeps them in the section', () => {
    // «Грудное вскармливание.» is a sub-heading: it gives the topic, it is not quoted itself.
    expect(result.pl.map((entry) => flagsTopic(entry[3] ?? 0))).toEqual([
      TOPIC_LACTATION,
      TOPIC_LACTATION,
    ]);
    expect(result.pl.map((entry) => text.slice(entry[1], entry[2]))).toEqual([
      'Препарат применять не рекомендуется.',
      'Требуется консультация врача.',
    ]);
  });
});

describe('extractSafety: a heading without a body', () => {
  it('keeps the neutral sentences of a section whose title names the topic', () => {
    const result = extractSafety([
      section(
        'pregnancy',
        'Применение при беременности и в период грудного вскармливания',
        'Не применимо.',
      ),
    ]);
    expect(result.pl).toHaveLength(1);
    expect(flagsTopic(result.pl[0]?.[3] ?? 0)).toBe(TOPIC_PREGNANCY | TOPIC_LACTATION);
  });
});

describe('extractSafety: leaflets', () => {
  it('reads a section titled «Беременность и грудное вскармливание» of any type', () => {
    const result = extractSafety([
      section(
        'other',
        'Беременность и грудное вскармливание',
        'Если Вы беременны или кормите грудью, проконсультируйтесь с врачом.',
      ),
    ]);
    expect(result.hasPregnancySection).toBe(true);
    expect(flagsTopic(result.pl[0]?.[3] ?? 0)).toBe(TOPIC_PREGNANCY | TOPIC_LACTATION);
  });

  it.each([
    'Беременность, грудное вскармливание и фертильность',
    '3. Беременность и период лактации',
    'ПРИМЕНЕНИЕ ПРИ БЕРЕМЕННОСТИ И В ПЕРИОД ГРУДНОГО ВСКАРМЛИВАНИЯ',
    'Применение препарата во время беременности',
  ])('knows the heading «%s»', (title) => {
    expect(
      extractSafety([section('other', title, 'Препарат противопоказан при беременности.')])
        .hasPregnancySection,
    ).toBe(true);
  });

  it('does not take any other heading for it', () => {
    expect(
      extractSafety([section('other', 'Состав', 'Беременность не влияет.')]).hasPregnancySection,
    ).toBe(false);
  });
});

describe('extractSafety: mentions in lists of contraindications', () => {
  const text = CONTRAINDICATIONS_TEXT;
  const result = extractSafety([section('contraindications', 'Противопоказания', text)]);

  it('marks them as coming from the contraindications, not from a pregnancy section', () => {
    expect(result.hasPregnancySection).toBe(false);
    const entry = result.pl[0];
    expect(entry && flagsOrigin(entry[3] ?? 0)).toBe(ORIGIN_CONTRAINDICATIONS);
    expect(entry && flagsTopic(entry[3] ?? 0)).toBe(TOPIC_PREGNANCY | TOPIC_LACTATION);
  });

  it('finds the age and weight limits of the same list', () => {
    const codes = result.ag.flatMap((entry) => {
      const found: number[] = [];
      for (let at = 4; at < entry.length; at += 5) found.push(entry[at + 2] ?? -1);
      return found;
    });
    expect(codes).toEqual([LIMIT_AGE_BELOW, LIMIT_WEIGHT_BELOW]);
  });
});

describe('extractSafety: dosage', () => {
  const text = DOSAGE_TEXT;
  const result = extractSafety([section('dosage', 'Способ применения и дозы', text)]);

  it('reads the age groups of the dosing sentences and the forms they name', () => {
    expect(result.ag).toHaveLength(2);
    const [first, second] = result.ag;
    expect(first && flagsOrigin(first[3] ?? 0)).toBe(ORIGIN_DOSAGE);
    expect(first?.[6]).toBe(LIMIT_AGE_FROM);
    expect(second?.[6]).toBe(LIMIT_AGE_RANGE);
    expect(first && flagsForms(first[3] ?? 0)).not.toBe(0);
    expect(second && flagsForms(second[3] ?? 0)).not.toBe(0);
  });

  it('points at the limit words', () => {
    const [first] = result.ag;
    expect(first && text.slice(first[4], first[5])).toBe('старше 12 лет');
  });
});

describe('extractSafety: age groups without a number', () => {
  it('keeps a restricting sentence about newborns', () => {
    const result = extractSafety([
      section('special-instructions', 'Особые указания', 'Препарат противопоказан новорожденным.'),
    ]);
    expect(result.ag[0]?.[6]).toBe(LIMIT_CATEGORY);
  });

  it('keeps none when the sentence has a numeric age', () => {
    const result = extractSafety([
      section('contraindications', 'Противопоказания', 'Противопоказан детям до 6 лет.'),
    ]);
    expect(result.ag).toHaveLength(1);
    expect(result.ag[0]?.[6]).toBe(LIMIT_AGE_BELOW);
  });
});

describe('extractSafety: leaflet sections about children', () => {
  it('reads the limits of a section headed «Дети и подростки»', () => {
    const result = extractSafety([
      section('other', 'Дети и подростки', 'Не давайте препарат детям младше 3 лет.'),
    ]);
    expect(result.ag).toHaveLength(1);
    expect(flagsOrigin(result.ag[0]?.[3] ?? 0)).toBe(ORIGIN_OTHER);
  });

  it('ignores other sections', () => {
    expect(
      extractSafety([section('adverse-effects', 'Побочное действие', 'У детей до 3 лет редко.')])
        .ag,
    ).toHaveLength(0);
  });
});

describe('extractSafety: checksums', () => {
  it('records a checksum of each section that holds an entry, and none for the others', () => {
    const result = extractSafety([
      section('composition', 'Состав', 'Ибупрофен 200 мг.', 'section.c'),
      section('contraindications', 'Противопоказания', 'Детский возраст до 12 лет.', 'section.k'),
    ]);
    expect(result.sections.map((entry) => entry.id)).toEqual(['section.k']);
    expect(result.sections[0]?.checksum).toMatch(/^[0-9a-f]{8}$/u);
  });
});

describe('the section title repeated at the start of its text', () => {
  const title = 'Применение при беременности и в период грудного вскармливания';

  it('is not part of the first sentence', () => {
    const text = `${title}\nБеременность Не следует применять препарат в первом триместре беременности.`;
    const result = extractSafety([section('pregnancy', title, text)]);
    const first = result.pl[0];
    expect(first && text.slice(first[1], first[2])).toBe(
      'Беременность Не следует применять препарат в первом триместре беременности.',
    );
    expect(first && flagsTopic(first[3] ?? 0)).toBe(TOPIC_PREGNANCY);
  });

  it('finds its length through line breaks and case', () => {
    expect(
      titlePrefixLength(
        `ПРИМЕНЕНИЕ ПРИ БЕРЕМЕННОСТИ\nИ В ПЕРИОД ГРУДНОГО ВСКАРМЛИВАНИЯ. Текст`,
        title,
      ),
    ).toBe('ПРИМЕНЕНИЕ ПРИ БЕРЕМЕННОСТИ\nИ В ПЕРИОД ГРУДНОГО ВСКАРМЛИВАНИЯ'.length);
    expect(titlePrefixLength('Другой заголовок, совсем другой', title)).toBe(0);
  });

  it('leaves a section with only its title without a sentence', () => {
    expect(extractSafety([section('pregnancy', title, `${title}.`)]).pl).toEqual([]);
  });
});

describe('age groups named next to pregnancy or lactation', () => {
  it('drops the child of the mother, keeps an item of a list of contraindications', () => {
    const risk = extractSafety([
      section(
        'special-instructions',
        'Особые указания',
        'При грудном вскармливании нельзя исключить риск для новорожденных.',
      ),
    ]);
    expect(risk.ag).toEqual([]);
    const list = extractSafety([
      section(
        'contraindications',
        'Противопоказания',
        'Противопоказано: беременность; период лактации; детский возраст.',
      ),
    ]);
    expect(list.ag[0]?.[6]).toBe(LIMIT_CATEGORY);
  });

  it('reads no unnumbered group from an indication', () => {
    expect(
      extractSafety([
        section('indications', 'Показания', 'Препарат показан взрослым и детям, с осторожностью.'),
      ]).ag,
    ).toEqual([]);
  });
});

describe('the end of a pregnancy section: fertility', () => {
  it('stops at a sentence about conception', () => {
    const text = 'Беременность противопоказана. У женщин с проблемами зачатия препарат отменяют.';
    const result = extractSafety([section('pregnancy', 'Применение при беременности', text)]);
    expect(result.pl).toHaveLength(1);
  });
});

describe('the end of a pregnancy section', () => {
  it('stops at a sentence about fertility', () => {
    const text =
      'Беременность противопоказана. Препарат не влияет на фертильность у животных. Беременность.';
    const result = extractSafety([section('pregnancy', 'Применение при беременности', text)]);
    expect(result.pl.map((entry) => text.slice(entry[1], entry[2]))).toEqual([
      'Беременность противопоказана.',
    ]);
  });
});
