import {
  COND_RENAL,
  DOSE_UNITS,
  type DoseRule,
  GROUP_ADULT,
  GROUP_CHILD,
  PIECE_KINDS,
  ROUTE_IV,
  ROUTE_ORAL,
  RULE_CAP,
  RULE_DOSE,
  RULE_DURATION,
} from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import { canonicalSectionText } from '@/features/drug-interactions/interaction-text';
import { extractDoseRules, joinHyphenation } from './dose-parse';

const YEAR = 365.25;

/** Parses one dosage section whose lines are the given text's lines (as the PDF chunks are). */
function parse(text: string) {
  const chunks = text.split('\n');
  const result = extractDoseRules([
    { id: 'section.t', type: 'dosage', title: 'Способ применения и дозы', chunks },
  ]);
  const canonical = canonicalSectionText(chunks).text;
  return {
    ...result,
    quote: (rule: DoseRule) => canonical.slice(rule.a, rule.b).replace(/\s+/gu, ' '),
    doses: result.rules.filter((rule) => rule.k === RULE_DOSE),
    caps: result.rules.filter((rule) => rule.k === RULE_CAP),
    durations: result.rules.filter((rule) => rule.k === RULE_DURATION),
  };
}

function unit(rule: DoseRule): string | undefined {
  return rule.u === undefined ? undefined : DOSE_UNITS[rule.u];
}

describe('dose rules from real instruction sentences', () => {
  it('reads a tablet dose with its mass, the interval and the cap', () => {
    const parsed = parse(
      'Внутрь.\nВзрослые\nПо 1–2 таблетки (500–1000 мг) каждые 4–6 часов, по мере необходимости.\nМаксимальная суточная доза  4000 мг (8 таблеток).',
    );
    const [dose] = parsed.doses;
    expect(dose).toMatchObject({ d0: 500, d1: 1000, q0: 1, q1: 2, pm: 500, f0: 4, f1: 6 });
    expect(unit(dose as DoseRule)).toBe('mg');
    expect(dose?.p0).toBe(Math.round(18 * YEAR));
    expect((dose?.rt ?? 0) & ROUTE_ORAL).toBe(ROUTE_ORAL);
    expect(parsed.quote(dose as DoseRule)).toContain('По 1–2 таблетки (500–1000 мг)');
    expect(parsed.caps).toHaveLength(1);
    expect(parsed.caps[0]).toMatchObject({ d1: 4000, bs: 1 });
  });

  it('takes the population of a heading line and its limits from the sentence', () => {
    const parsed = parse(
      'Дети от 6 до 12 лет\nПо 200 мг (по 1 таблетке) до 3-4 раз в день; ибупрофен можно принимать только в случае массы тела ребенка более 20 кг.',
    );
    const [dose] = parsed.doses;
    expect(dose).toMatchObject({ d0: 200, f0: 3, f1: 4, pm: 200, w0: 200 });
    expect(dose?.p0).toBe(Math.round(6 * YEAR));
    expect(dose?.p1).toBe(Math.round(12 * YEAR));
    expect((dose?.g ?? 0) & GROUP_CHILD).toBe(GROUP_CHILD);
  });

  it('reads adults and children older than 10 years with a body-mass bound', () => {
    const parsed = parse(
      'Взрослым и детям старше 10 лет (с массой тела более 40 кг) назначают по 0.5 г 3 раза в сутки',
    );
    const [dose] = parsed.doses;
    expect(dose).toMatchObject({ d0: 500, f0: 3, f1: 3, w0: 400 });
    expect(dose?.p0).toBe(Math.round(10 * YEAR));
    expect((dose?.g ?? 0) & (GROUP_ADULT | GROUP_CHILD)).toBe(GROUP_ADULT | GROUP_CHILD);
  });

  it('reads an indication, a range in grams, the frequency and the length of treatment', () => {
    const parsed = parse(
      'При лептоспирозе взрослым - 0.5-0.75 г 4 раза в сутки в течение 6-12 дней.',
    );
    expect(parsed.doses).toHaveLength(1);
    expect(parsed.doses[0]).toMatchObject({ d0: 500, d1: 750, f0: 4, f1: 4, t0: 6, t1: 12 });
  });

  it('reads a dose per kilogram of body mass', () => {
    const parsed = parse(
      'Дети в возрасте от 3 месяцев до 12 лет Разовая доза препарата – 10–15 мг/кг массы тела.',
    );
    expect(parsed.doses[0]).toMatchObject({ d0: 10, d1: 15, pk: 1 });
    expect(parsed.doses[0]?.bs).toBeUndefined();
    expect(parsed.doses[0]?.p0).toBe(Math.round((3 * YEAR) / 12));
  });

  it('reads a daily dose per kilogram written with words and a split into intakes', () => {
    const parsed = parse(
      'Обычная доза составляет от 20 до 90 мг на килограмм массы тела в день, которую делят на два или три приема.',
    );
    expect(parsed.doses[0]).toMatchObject({ d0: 20, d1: 90, pk: 1, bs: 1, f0: 2, f1: 3 });
  });

  it('reads «на каждый килограмм массы тела в сутки» and refuses an unread per-kilogram wording', () => {
    const parsed = parse(
      'Рекомендуемая доза составляет 20–90 мг на каждый килограмм массы тела в сутки, разделенная на 2–3 приема.',
    );
    expect(parsed.doses[0]).toMatchObject({ d0: 20, d1: 90, pk: 1, bs: 1, f0: 2, f1: 3 });
    expect(
      parse('Назначают по 50 мг на вторую часть кг массы тела 3 раза в сутки.').doses,
    ).toHaveLength(0);
  });

  it('reads a dose per square metre of body surface and the route', () => {
    const parsed = parse(
      'Децитабин применяют в дозе 15 мг/м2 поверхности тела путем непрерывной 3-часовой внутривенной инфузии каждые 8 часов в течение 3 дней.',
    );
    expect(parsed.doses[0]).toMatchObject({ d0: 15, pk: 2, f0: 3, f1: 3, t0: 3, t1: 3 });
    expect((parsed.doses[0]?.rt ?? 0) & ROUTE_IV).toBe(ROUTE_IV);
  });

  it('reads two caps of one sentence and restricts them to the weight it names', () => {
    const parsed = parse(
      'Максимальная суточная доза не должна превышать 60 мг/кг (не более 2 г/сутки) в следующих случаях: у взрослых с весом менее 50 кг.',
    );
    expect(parsed.caps).toHaveLength(2);
    expect(parsed.caps[0]).toMatchObject({ d1: 60, pk: 1, bs: 1, w1: 500 });
    expect(parsed.caps[1]).toMatchObject({ d1: 2000, bs: 1 });
  });

  it('reads counted drops and a spoon in millilitres', () => {
    const drop = parse(
      'Рекомендуемая доза - одна капля в пораженный(ые) глаз(а) один раз в день вечером.',
    );
    expect(drop.doses[0]).toMatchObject({ d0: 1, f0: 1 });
    expect(unit(drop.doses[0] as DoseRule)).toBe('drop');
    const spoon = parse(
      'Взрослые и дети старше 12 лет: по 1 десертной ложке (10 мл) 3-5 раз в день.',
    );
    expect(spoon.doses[0]).toMatchObject({ d0: 10, f0: 3, f1: 5 });
    expect(unit(spoon.doses[0] as DoseRule)).toBe('ml');
  });

  it('reads pieces that each hold a mass', () => {
    const parsed = parse('Принимайте по 2 таблетки по 500 мг 3 раза в сутки.');
    expect(parsed.doses[0]).toMatchObject({ d0: 1000, q0: 2, pm: 500, f0: 3 });
    expect(PIECE_KINDS[parsed.doses[0]?.qu ?? 9]).toBe('tablet');
  });

  it('merges a range that writes its unit twice', () => {
    const parsed = parse(
      'Обычная доза составляет от 250 мг до 500 мг три раза в день или от 750 мг до 1 г каждые 12 часов.',
    );
    expect(parsed.doses[0]).toMatchObject({ d0: 250, d1: 500, f0: 3 });
  });

  it('keeps the condition of a rule and reads no population into it', () => {
    const parsed = parse(
      'При клиренсе креатинина ниже 10 мл/мин максимальная суточная доза составляет 2 г.',
    );
    expect(parsed.caps[0]).toMatchObject({ d1: 2000, bs: 1, c: COND_RENAL });
  });

  it('joins words broken by the PDF hyphenation before reading them', () => {
    const joined = joinHyphenation('де-\nтям до 60 мг/кг');
    expect(joined.text).toBe('детям до 60 мг/кг');
    const parsed = parse(
      'Взрослым 500 мг 3 раза в сутки;\nде-\nтям до 60 мг/кг в сутки разделенные на 3 приема.',
    );
    const child = parsed.doses.find((rule) => (rule.g ?? 0) & GROUP_CHILD);
    expect(child).toMatchObject({ d0: 60, pk: 1, bs: 1, up: 1, f0: 3 });
    expect(parsed.quote(child as DoseRule)).toContain('де-');
  });

  it('does not take the interval of a review for the frequency of the dose', () => {
    const parsed = parse(
      'Дозу следует подбирать индивидуально и оценивать актуальность дозы каждые 4 недели с возможным повышением до 40 мг в сутки.',
    );
    expect(parsed.doses[0]?.f0).toBeUndefined();
    expect(parsed.doses[0]).toMatchObject({ d0: 40, up: 1, bs: 1 });
  });

  it('reads age and body mass as alternatives when the sentence says «и/или»', () => {
    const parsed = parse(
      'Взрослые и дети старше 13 лет и/или массой тела более 40 кг Обычно назначают 250-500 мг 3 раза в сутки.',
    );
    expect(parsed.doses[0]).toMatchObject({ d0: 250, d1: 500, or: 1, w0: 400 });
  });

  it('carries the population of a line that states no dose, and only of such a line', () => {
    const carried = parse(
      'Применение у детей и подростков\nДозу рассчитывают в зависимости от массы тела:\nМасса тела 50 кг или более: рекомендуемая доза составляет 1 таблетку 20 мг один раз в сутки.',
    );
    expect(carried.doses).toHaveLength(1);
    expect(carried.doses[0]).toMatchObject({ w0: 500, q0: 1 });
    expect(carried.doses[0]?.g).toBeDefined();
    // The population of an earlier dose sentence is not taken over by the sentence after it.
    const apart = parse(
      'Дети от 5 до 13 лет Обычно рекомендуют 250 мг 3 раза в сутки.\nПри тяжелых инфекциях рекомендуется назначать 500-1000 мг 3 раза в сутки.',
    );
    expect(apart.doses).toHaveLength(2);
    expect(apart.doses[1]?.p0).toBeUndefined();
    expect(apart.doses[1]?.g).toBeUndefined();
  });

  it('reads the length of treatment alone', () => {
    const parsed = parse(
      'Продолжительность лечения зависит от показаний и составляет обычно 5-7 дней.',
    );
    expect(parsed.doses).toHaveLength(0);
    expect(parsed.durations[0]).toMatchObject({ t0: 5, t1: 7 });
  });
});

describe('what is not a rule', () => {
  it('rejects a flattened table of ages and doses', () => {
    const parsed = parse(
      'Возраст ребенка Суточная доза 4–5 лет 200–400 мг 6–10 лет 400–600 мг 11–15 лет 600–1000 мг >15 лет 800–1200 мг',
    );
    expect(parsed.rules).toHaveLength(0);
    expect(parsed.stats.skippedAmounts).toBeGreaterThan(0);
  });

  it('rejects an infusion rate and a concentration', () => {
    expect(
      parse('Максимальная скорость введения препарата составляет 0,67 мл на кг массы тела в час.')
        .rules,
    ).toHaveLength(0);
    expect(parse('Раствор с концентрацией 5 мг/мл вводят медленно.').doses).toHaveLength(0);
  });

  it('rejects a restriction that names an amount', () => {
    expect(parse('Препарат противопоказан детям до 6 лет в дозе 5 мг.').doses).toHaveLength(0);
  });

  it('rejects a change of a dose that carries no frequency', () => {
    expect(
      parse(
        'Лечение можно возобновить в дозе, сниженной на 25 % (дозу 1,3 мг/м2 снижают до 1,0 мг/м2).',
      ).doses,
    ).toHaveLength(0);
  });

  it('rejects a diluent volume', () => {
    expect(parse('Содержимое ампулы разводят в 100 мл воды для инъекций.').doses).toHaveLength(0);
  });

  it('records every dosage section it read, with the checksum, even without a rule', () => {
    const parsed = parse('Доза определяется врачом индивидуально.');
    expect(parsed.rules).toHaveLength(0);
    expect(parsed.sections).toHaveLength(1);
    expect(parsed.sections[0]?.checksum).toMatch(/^[0-9a-f]{8}$/u);
  });

  it('notes a tablet that may be divided', () => {
    expect(
      parse('Таблетку можно разделить на 2 равные части.\nПо 1 таблетке 2 раза в день.').divisible,
    ).toBe(true);
    expect(parse('По 1 таблетке 2 раза в день.').divisible).toBe(false);
  });

  it('reads a daily dose that names the drug or the group between the words and the amount', () => {
    const drug = parse(
      'У детей с массой тела менее 40 кг суточная доза ампициллина составляет 25–50 мг на каждый килограмм массы тела пациента.',
    ).doses[0];
    expect(drug).toMatchObject({ d0: 25, d1: 50, pk: 1, bs: 1 });
    const adults = parse(
      'Средняя суточная доза для взрослых - 1-4 г; кратность введения - 3-4 раза в сутки.',
    ).doses[0];
    expect(adults).toMatchObject({ d0: 1000, d1: 4000, bs: 1, f0: 3, f1: 4 });
  });

  it('keeps a dose per intake that follows a daily dose split into intakes', () => {
    const split = parse('Суточную дозу делят на 3 приема, по 200 мг.').doses[0];
    expect(split?.bs ?? 0).toBe(0);
  });
});
