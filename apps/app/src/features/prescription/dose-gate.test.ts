import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { DoseRule } from '@localmed/contracts';
import { RULE_CAP, RULE_DOSE, RULE_DURATION } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import { canonicalSectionText } from '@/features/drug-interactions/interaction-text';
import {
  DOSE_SHAPES,
  GATE_ALLOWED,
  GATE_MIN_JUDGED,
  isPlainHeading,
  isRejectedShape,
  mayCompute,
  namesOtherSubstance,
  shapeFamily,
  shapeOf,
  unitFitsForm,
} from './dose-gate';
import { extractDoseRules } from './dose-parse';

function parse(
  text: string,
  options: { readonly dosageForm?: string; readonly subject?: readonly string[] } = {},
) {
  const chunks = text.split('\n');
  const result = extractDoseRules(
    [{ id: 'section.t', type: 'dosage', title: 'Способ применения и дозы', chunks }],
    { subject: options.subject ?? ['Тестовин'], dosageForm: options.dosageForm ?? 'таблетки' },
  );
  const canonical = canonicalSectionText(chunks).text;
  return {
    ...result,
    quote: (rule: DoseRule) => canonical.slice(rule.a, rule.b).replace(/\s+/gu, ' '),
    doses: result.rules.filter((rule) => rule.k === RULE_DOSE),
    caps: result.rules.filter((rule) => rule.k === RULE_CAP),
    durations: result.rules.filter((rule) => rule.k === RULE_DURATION),
  };
}

describe('the shape of a rule', () => {
  it('lets a plain statement with its own population compute', () => {
    const { doses } = parse('Взрослые и дети старше 12 лет – по 250 мг 2 раза в сутки.');
    expect(doses).toHaveLength(1);
    expect(shapeOf(doses[0] as DoseRule)).toBe('dose.local.abs.freq');
    expect(mayCompute(doses[0] as DoseRule)).toBe(true);
  });

  it('lets a dose under a plain heading line compute, and a bare cap', () => {
    const { doses, caps } = parse(
      'Взрослые\nПо 5 мл суспензии 3 раза в сутки.\nМаксимальная суточная доза составляет 15 мл.',
      { dosageForm: 'суспензия для приема внутрь' },
    );
    // The heading line is part of the first clause, so the dose is local; the cap borrows the heading.
    expect(shapeOf(doses[0] as DoseRule)).toBe('dose.local.abs.freq');
    expect(mayCompute(doses[0] as DoseRule)).toBe(true);
    expect(caps[0] && shapeOf(caps[0])).toBe('cap.heading');
    expect(caps[0] && mayCompute(caps[0])).toBe(true);
  });

  it('only quotes a titration step, an alternative, a table row and a prohibition', () => {
    const rejected: [string, string][] = [
      ['Взрослым по 500 мг 2 раза в сутки, затем по 250 мг 1 раз в сутки.', 'rejected.stage'],
      ['Взрослым по 250 мг 3 раза в сутки или по 500 мг 2 раза в сутки.', 'rejected.alternative'],
      ['Взрослым 500 мг 1 раз в сутки (≤ 50 кг – 250 мг).', 'rejected.table'],
      ['Взрослым не принимайте больше 2 таблеток по 500 мг в сутки.', 'rejected.table'],
      ['Взрослым после начального введения 200 мг дозу повышают на 100 мг.', 'rejected.stage'],
    ];
    for (const [text, shape] of rejected) {
      const rules = parse(text).rules;
      for (const rule of rules) expect(isRejectedShape(shapeOf(rule)), text).toBe(true);
      if (rules[0]) expect(shapeOf(rules[0]), text).toBe(shape);
    }
  });

  it('keeps a table row after «Таблица N» from being read without the band of its row', () => {
    // ceftolozane: the cell with the clearance band is a line of its own
    const text = [
      'Таблица 7. Режим дозирования у пациентов с клиренсом креатинина ≤50 мл/мин',
      'Расчетный Clcr, мл/мин',
      '30–50 750 мг (500 мг цефтолозана и 250 мг тазобактама) внутривенно каждые 8 часов',
      '1,5 г (1 г цефтолозана и 0,5 г тазобактама) внутривенно каждые 8 часов',
    ].join('\n');
    expect(parse(text).doses).toHaveLength(0);
  });

  it('does not take the population of an equivalence remark in the next sentence (azithromycin)', () => {
    const text =
      '12,5 мл (500 мг азитромицина) - 2,5 ложечек\n(соответствует дозе для взрослых пациентов)\nПри фарингите/тонзиллите азитромицин применяют в\nдозе 20 мг/кг/сут в течение 3 дней (курсовая доза 60 мг/кг).';
    const { doses } = parse(text, { subject: ['Азитромицин'] });
    for (const dose of doses) {
      expect((dose.g ?? 0) & 1, parse(text).quote(dose)).toBe(0);
      expect(mayCompute(dose)).toBe(false);
    }
  });

  it('keeps a duration of one clause out of the next (apixaban)', () => {
    const text =
      'Рекомендуемая доза составляет 10 мг 2 раза в сутки в течение 7 дней, затем 5 мг 2 раза в сутки.\nДалее, начиная с 8-го дня, доза составляет 5 мг два раза в сутки.';
    const { doses } = parse(text);
    const second = doses.find(
      (dose) => dose.d0 === 5 && parse(text).quote(dose).startsWith('затем'),
    );
    expect(second?.t0).toBeUndefined();
    const later = doses.find((dose) => parse(text).quote(dose).startsWith('Далее'));
    expect(later?.ro).toBeUndefined();
    for (const dose of doses) expect(mayCompute(dose)).toBe(false);
  });

  it('does not accept an amount in a different unit of the form, or a flattened part of another drug', () => {
    const solid = parse('Взрослым по 5 мл 3 раза в сутки.', { dosageForm: 'таблетки' }).doses;
    expect(solid[0] && mayCompute(solid[0])).toBeFalsy();
    const gel = parse('Взрослым 500 мг геля 2 раза в сутки.', {
      dosageForm: 'гель для наружного применения',
    }).doses;
    expect(gel[0] && mayCompute(gel[0])).toBeFalsy();
    expect(unitFitsForm({ k: 0, s: 0, a: 0, b: 1, u: 0 }, 'мазь для наружного применения')).toBe(
      false,
    );
    expect(unitFitsForm({ k: 0, s: 0, a: 0, b: 1, u: 1 }, 'раствор для инфузий')).toBe(true);
  });

  it('keeps a population-less sentence out of a section about children', () => {
    const title = 'В зависимости от массы тела ребенка рекомендуется следующий режим дозирования:';
    const result = extractDoseRules(
      [
        {
          id: 'section.t',
          type: 'dosage',
          title,
          chunks: ['Максимальная суточная доза составляет 500 мг.'],
        },
      ],
      { subject: ['Азитромицин'], dosageForm: 'таблетки' },
    );
    expect(result.rules.length).toBeGreaterThan(0);
    for (const rule of result.rules) expect(mayCompute(rule)).toBe(false);
  });

  it('plain headings are short lines that name a group, not a sentence', () => {
    expect(isPlainHeading('взрослые (в том числе пожилые)')).toBe(true);
    expect(isPlainHeading('дети старше 12 лет')).toBe(true);
    expect(
      isPlainHeading('в некоторых случаях врач уменьшит вам дозу, если вы пожилого возраста.'),
    ).toBe(false);
    expect(
      isPlainHeading('соблюдайте рекомендации врача перед введением препарата вашему ребенку.'),
    ).toBe(false);
  });

  it('names another substance after «доза»', () => {
    expect(
      namesOtherSubstance('рекомендуемая доза дексаметазона составляет 40 мг', ['иксаз']),
    ).toBe(true);
    expect(namesOtherSubstance('рекомендуемая доза препарата составляет 40 мг', ['иксаз'])).toBe(
      false,
    );
    expect(namesOtherSubstance('преднизон или преднизолон принимают по 5 мг', ['доцет'])).toBe(
      true,
    );
    expect(
      namesOtherSubstance('доза сульбактама составляет 4000 мг', ['цефоп', 'сульб'], true),
    ).toBe(true);
  });
});

describe('what the gate lets compute', () => {
  it('lists only shapes that exist, and every family has development evidence with no wrong rule', () => {
    for (const shape of GATE_ALLOWED) expect(DOSE_SHAPES).toContain(shape);
    const dev = JSON.parse(
      readFileSync(
        resolve(__dirname, '../../../../../tools/benchmarks/dose-rule-gate-dev.json'),
        'utf8',
      ),
    ) as {
      items: { shape: string; verdict: string; rejudged?: { verdict: string } }[];
    };
    const families = new Set([...GATE_ALLOWED].map(shapeFamily));
    for (const family of families) {
      const own = dev.items.filter(
        (item) =>
          GATE_ALLOWED.has(item.shape as never) && shapeFamily(item.shape as never) === family,
      );
      const wrong = own.filter((item) => (item.rejudged?.verdict ?? item.verdict) === 'wrong');
      expect(own.length, family).toBeGreaterThanOrEqual(GATE_MIN_JUDGED);
      expect(wrong.length, family).toBe(0);
    }
  });

  it('never lets a rule without a shape compute', () => {
    expect(mayCompute({})).toBe(false);
    expect(mayCompute({ gc: DOSE_SHAPES.indexOf('rejected.stage') })).toBe(false);
  });
});

describe('fixes at the cause (RX2)', () => {
  it('reads «однократно» as a single dose, not as once a day', () => {
    const { doses } = parse('Взрослым назначается однократно одна таблетка 150 мг.');
    expect(doses[0]?.f0).toBeUndefined();
    const daily = parse('Взрослым одна таблетка 25 мг однократно в сутки.').doses;
    expect(daily[0]?.f0).toBe(1);
  });

  it('reads «не должна превышать» in a duration as a maximum, and «в течение N» after «максимальная»', () => {
    expect(
      parse('Продолжительность лечения не должна превышать 4 недель.').durations[0],
    ).toMatchObject({
      t0: 28,
      tm: 1,
    });
    expect(parse('Максимальная длительность лечения – 3 дня.').durations[0]).toMatchObject({
      t0: 3,
      tm: 1,
    });
  });

  it('keeps micrograms per kilogram exact', () => {
    const { doses } = parse('Взрослым назначают в суточной дозе 1,6–1,8 мкг на 1 кг массы тела.');
    expect(doses[0]).toMatchObject({ d0: 0.0016, d1: 0.0018, pk: 1 });
  });

  it('reads «на каждый килограмм» and «на каждый квадратный метр» as per body size', () => {
    expect(
      parse('Взрослым 3 мг ниволумаба на килограмм массы тела каждые 2 недели.').doses[0],
    ).toMatchObject({
      pk: 1,
    });
    expect(
      parse(
        'Взрослым по 500 миллиграммов на каждый квадратный метр поверхности тела 1 раз в неделю.',
      ).doses[0],
    ).toMatchObject({
      pk: 2,
    });
  });

  it('reads «не меньше 40 кг» as at least and a frequency every N weeks', () => {
    const { doses } = parse('Для пациентов с массой тела не меньше 40 кг 5 мг два раза в сутки.');
    expect(doses[0]?.w0).toBe(400);
    expect(doses[0]?.w1).toBeUndefined();
    expect(parse('Взрослым 300 мг каждые 4 недели.').doses[0]).toMatchObject({ f0: 1, fp: 28 });
  });

  it("takes a divided amount («10 мг/кг в 2–3 приема») for a day's amount", () => {
    expect(parse('Дети от 3 до 13 лет: 10 мг/кг массы тела в 2–3 приема.').doses[0]).toMatchObject({
      bs: 1,
    });
  });

  it('does not turn the tablets of a split day into a piece strength', () => {
    const { doses } = parse(
      'Взрослым: 400 мг/сутки (2 таблетки утром, 2 таблетки вечером); курс лечения 3 дня.',
    );
    expect(doses[0]).toMatchObject({ d0: 400, bs: 1 });
    expect(doses[0]?.pm).toBeUndefined();
    expect(doses[0]?.q0).toBeUndefined();
  });

  it('does not take the first weeks of a cycle for the length of treatment', () => {
    const { doses } = parse(
      'Рекомендуемая доза: 1 капсула (4 мг) внутрь 1 раз в неделю в течение первых 3 недель курса.',
    );
    expect(doses[0]?.t0).toBeUndefined();
  });

  it('does not take the route of the earlier therapy', () => {
    const { doses } = parse(
      'По 40 мг один раз в сутки в течение 4-х недель после окончания внутривенной терапии препаратами.',
    );
    expect((doses[0]?.rt ?? 0) & 2).toBe(0);
    expect(doses[0]?.fm).toBeUndefined();
  });

  it('keeps an open lower age bound without a group word out of the computed doses', () => {
    const { doses } = parse('старше 2 лет: 2-3 пакета в сутки.');
    expect(doses.length).toBeGreaterThan(0);
    for (const dose of doses) expect(mayCompute(dose)).toBe(false);
  });

  it('takes the route from plain lead lines, not from words of prose', () => {
    const text = 'Внутрь.\nВзрослым по 100 мг 2 раза в сутки.';
    expect((parse(text).doses[0]?.rt ?? 0) & 1).toBe(1);
    const prose =
      'Препарат применяют при местнораспространенном раке, ингаляционные анестетики не нужны.\nВзрослым по 100 мг 2 раза в сутки.';
    expect(parse(prose).doses[0]?.rt).toBeUndefined();
  });
});
