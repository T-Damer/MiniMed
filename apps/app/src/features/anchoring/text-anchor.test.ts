import { describe, expect, it } from 'vitest';

import {
  AnchorDocument,
  type AnchorHint,
  type AnchorUnit,
  createQuoteSelector,
  locateQuote,
  SELECTOR_EXACT_LIMIT,
  segmentText,
  type TextQuoteSelector,
} from '@/features/anchoring/text-anchor';

/** Edition A of a clinical recommendation: one unit per chunk, as the reader renders it. */
const EDITION_A: readonly AnchorUnit[] = [
  {
    id: 'c1',
    text: 'Артериальная гипертензия (АГ) — синдром повышения систолического артериального давления (САД) ≥ 140 мм рт. ст. и/или диастолического артериального давления (ДАД) ≥ 90 мм рт. ст.',
  },
  {
    id: 'c2',
    text: 'Диагноз артериальной гипертензии устанавливается на основании повторных измерений артериального давления в разные дни, в том числе вне медицинской организации.',
  },
  {
    id: 'c3',
    text: 'Пациентам с артериальной гипертензией рекомендуется ограничение потребления поваренной соли до 5 г/сут, так как это снижает артериальное давление и риск сердечно-сосудистых осложнений.',
  },
  {
    id: 'c4',
    text: 'Всем пациентам с АГ рекомендуется отказ от курения, поскольку курение — независимый фактор риска сердечно-сосудистых заболеваний. Уровень убедительности рекомендаций A, уровень достоверности доказательств 1.',
  },
  {
    id: 'c5',
    text: 'Для начальной терапии рекомендуется использовать комбинацию ингибитора АПФ или БРА с блокатором кальциевых каналов либо тиазидоподобным диуретиком у большинства пациентов.',
  },
  {
    id: 'c6',
    text: 'Целевой уровень артериального давления у пациентов моложе 65 лет составляет менее 130/80 мм рт. ст., если препараты хорошо переносятся.',
  },
  {
    id: 'c7',
    text: 'Контроль эффективности лечения проводится через 2–4 недели после начала терапии, затем не реже одного раза в 3–6 месяцев при стабильном течении заболевания.',
  },
];

const text = (units: readonly AnchorUnit[], id: string): string =>
  units.find((unit) => unit.id === id)?.text ?? '';

function select(
  units: readonly AnchorUnit[],
  id: string,
  phrase: string,
): { selector: TextQuoteSelector; hint: AnchorHint } {
  const body = text(units, id);
  const start = body.indexOf(phrase);
  if (start < 0) throw new Error(`phrase not in ${id}: ${phrase}`);
  const index = units.findIndex((unit) => unit.id === id);
  return {
    selector: createQuoteSelector(body, start, start + phrase.length, {
      before: units[index - 1]?.text.slice(-60) ?? '',
      after: units[index + 1]?.text.slice(0, 60) ?? '',
    }),
    hint: { unitId: id, start },
  };
}

function resolve(
  units: readonly AnchorUnit[],
  anchor: { selector: TextQuoteSelector; hint: AnchorHint },
) {
  const document = new AnchorDocument(units);
  const match = locateQuote(document, anchor.selector, anchor.hint);
  return {
    match,
    found: match?.segments.map((segment) => segmentText(document, segment)).join('') ?? null,
  };
}

const SALT = 'ограничение потребления поваренной соли до 5 г/сут';
const SMOKING = 'отказ от курения, поскольку курение — независимый фактор риска';
const TARGET =
  'у пациентов моложе 65 лет составляет менее 130/80 мм рт. ст., если препараты хорошо переносятся';

describe('createQuoteSelector', () => {
  it('stores the quote with the text around it', () => {
    const body = text(EDITION_A, 'c3');
    const start = body.indexOf(SALT);
    const selector = createQuoteSelector(body, start, start + SALT.length);
    expect(selector.exact).toBe(SALT);
    expect(selector.prefix).toBe('Пациентам с артериальной гипертензией рекомендуется ');
    expect(selector.suffix.startsWith(', так как это снижает')).toBe(true);
    expect(selector.tail).toBeUndefined();
  });

  it('extends the context into the neighbouring units at a unit edge', () => {
    const selector = createQuoteSelector('Начало текста', 0, 6, { before: 'Предыдущий абзац. ' });
    expect(selector.prefix).toBe('Предыдущий абзац. ');
  });

  it('keeps the beginning and the end of a very long selection', () => {
    const long = `${'слово '.repeat(600)}конец выделения`;
    const selector = createQuoteSelector(long, 0, long.length);
    expect(selector.exact).toHaveLength(SELECTOR_EXACT_LIMIT);
    expect(selector.tail?.endsWith('конец выделения')).toBe(true);
  });
});

describe('locateQuote — same edition', () => {
  it('reports `exact` for text at the same place', () => {
    const anchor = select(EDITION_A, 'c3', SALT);
    const { match, found } = resolve(EDITION_A, anchor);
    expect(match?.status).toBe('exact');
    expect(match?.method).toBe('exact');
    expect(match?.score).toBeGreaterThan(0.95);
    expect(found).toBe(SALT);
  });
});

describe('locateQuote — edition changes', () => {
  it('follows a moved paragraph into another unit and says `moved`', () => {
    // A rebuilt edition reorders the chapter and numbers its chunks afresh.
    const edition = [0, 1, 4, 2, 5, 3, 6].map((index, position) => ({
      id: `e${String(position)}`,
      text: (EDITION_A[index] as AnchorUnit).text,
    }));
    const anchor = select(EDITION_A, 'c3', SALT);
    const { match, found } = resolve(edition, anchor);
    expect(match?.status).toBe('moved');
    expect(match?.segments).toHaveLength(1);
    expect(match?.segments[0]?.unitId).toBe('e3');
    expect(found).toBe(SALT);
  });

  it('keeps `exact` when only the chunk order changed but the chunk and offsets did not', () => {
    const edition = [0, 1, 4, 2, 5, 3, 6].map((index) => EDITION_A[index] as AnchorUnit);
    const { match } = resolve(edition, select(EDITION_A, 'c3', SALT));
    expect(match?.status).toBe('exact');
  });

  it('follows text that moved into a different unit of a restructured chapter', () => {
    const edition: readonly AnchorUnit[] = [
      { id: 'n1', text: 'Новый вводный абзац о профилактике сердечно-сосудистых заболеваний.' },
      { id: 'n2', text: `Общие меры. ${text(EDITION_A, 'c4')} ${text(EDITION_A, 'c3')}` },
      EDITION_A[0] as AnchorUnit,
    ];
    const anchor = select(EDITION_A, 'c3', SALT);
    const { match, found } = resolve(edition, anchor);
    expect(match?.status).toBe('moved');
    expect(match?.segments[0]?.unitId).toBe('n2');
    expect(found).toBe(SALT);
  });

  it('matches through changed quotes, dashes, ё/е, case and spacing', () => {
    const edition = EDITION_A.map((unit) =>
      unit.id === 'c4'
        ? {
            id: 'c4',
            text: 'Всем пациентам с АГ рекомендуется отказ от курения;  поскольку курение – независимый фактор риска сердечно‑сосудистых заболеваний. Уровень убедительности рекомендаций A, уровень достоверности доказательств 1.',
          }
        : unit,
    );
    const anchor = select(EDITION_A, 'c4', SMOKING);
    const { match, found } = resolve(edition, anchor);
    expect(match?.method).toBe('normalised');
    expect(match?.status).toBe('moved');
    expect(found?.replace(/\s+/g, ' ')).toContain('отказ от курения');
    expect(found).toContain('независимый фактор риска');
  });

  it('is not thrown by «ёлочки» becoming "lapki" or by a missing trailing full stop', () => {
    const quoted: readonly AnchorUnit[] = [
      { id: 'q1', text: 'Термин «артериальная гипертензия» используется в рекомендациях.' },
    ];
    const edition: readonly AnchorUnit[] = [
      { id: 'q1', text: 'Термин "артериальная гипертензия" используется в рекомендациях' },
    ];
    const anchor = select(quoted, 'q1', '«артериальная гипертензия» используется в рекомендациях.');
    const { match, found } = resolve(edition, anchor);
    expect(match).not.toBeNull();
    expect(found).toContain('артериальная гипертензия');
    expect(found).toContain('используется в рекомендациях');
  });

  it('survives sentences inserted before and after the quote', () => {
    const edition = EDITION_A.map((unit) =>
      unit.id === 'c3'
        ? {
            id: 'c3',
            text: `В новой редакции уточнено, что меры немедикаментозной коррекции применяются у всех пациентов. ${unit.text} Дополнительно рекомендуется контролировать массу тела.`,
          }
        : unit,
    );
    const anchor = select(EDITION_A, 'c3', SALT);
    const { match, found } = resolve(edition, anchor);
    expect(match?.status).toBe('moved');
    expect(found).toBe(SALT);
  });

  it('finds a slightly reworded sentence and marks it `approximate`', () => {
    const edition = EDITION_A.map((unit) =>
      unit.id === 'c6'
        ? {
            id: 'c6',
            text: 'Целевой уровень артериального давления у пациентов младше 65 лет составляет менее 130/80 мм рт. ст., при условии хорошей переносимости препаратов.',
          }
        : unit,
    );
    const anchor = select(EDITION_A, 'c6', TARGET);
    const { match, found } = resolve(edition, anchor);
    expect(match?.status).toBe('approximate');
    expect(match?.method).toBe('fuzzy');
    expect(match?.segments[0]?.unitId).toBe('c6');
    expect(found).toContain('менее 130/80 мм рт. ст.');
    expect(match?.score).toBeGreaterThan(0.5);
    expect(match?.score).toBeLessThan(0.95);
  });

  it('finds a reworded quote that moved to another place at the same time', () => {
    const reworded: AnchorUnit = {
      id: 'x9',
      text: 'У пациентов моложе 65 лет целевой уровень артериального давления составляет менее 130/80 мм рт. ст. при хорошей переносимости лечения.',
    };
    const edition = [reworded, ...EDITION_A.filter((unit) => unit.id !== 'c6')];
    const anchor = select(
      EDITION_A,
      'c6',
      'Целевой уровень артериального давления у пациентов моложе 65 лет составляет менее 130/80 мм рт. ст.',
    );
    const { match } = resolve(edition, anchor);
    expect(match?.status).toBe('approximate');
    expect(match?.segments[0]?.unitId).toBe('x9');
  });

  it('keeps a quote whose middle gained a new sentence (head and tail still match)', () => {
    const quote =
      'Диагноз артериальной гипертензии устанавливается на основании повторных измерений артериального давления в разные дни, в том числе вне медицинской организации.';
    const edition = EDITION_A.map((unit) =>
      unit.id === 'c2'
        ? {
            id: 'c2',
            text: 'Диагноз артериальной гипертензии устанавливается на основании повторных измерений артериального давления в разные дни. Измерения проводятся по единой методике с использованием поверенных приборов. В том числе вне медицинской организации.',
          }
        : unit,
    );
    const anchor = select(EDITION_A, 'c2', quote);
    const { match, found } = resolve(edition, anchor);
    expect(match?.status).toBe('approximate');
    expect(found).toContain('Диагноз артериальной гипертензии');
    expect(found?.endsWith('медицинской организации') || found?.endsWith('организации.')).toBe(
      true,
    );
  });

  it('follows a paragraph that was split across two units', () => {
    const phrase =
      'Всем пациентам с АГ рекомендуется отказ от курения, поскольку курение — независимый фактор риска сердечно-сосудистых заболеваний.';
    const edition = EDITION_A.flatMap((unit) =>
      unit.id === 'c4'
        ? [
            { id: 'c4a', text: 'Всем пациентам с АГ рекомендуется отказ от курения, поскольку' },
            {
              id: 'c4b',
              text: 'курение — независимый фактор риска сердечно-сосудистых заболеваний. Уровень убедительности рекомендаций A, уровень достоверности доказательств 1.',
            },
          ]
        : [unit],
    );
    const anchor = select(EDITION_A, 'c4', phrase);
    const { match } = resolve(edition, anchor);
    expect(match).not.toBeNull();
    expect(match?.segments.map((segment) => segment.unitId)).toEqual(['c4a', 'c4b']);
  });

  it('reports nothing when the text is gone', () => {
    const edition = EDITION_A.filter((unit) => unit.id !== 'c3');
    const anchor = select(EDITION_A, 'c3', SALT);
    expect(resolve(edition, anchor).match).toBeNull();
  });

  it('does not invent a match in unrelated text', () => {
    const edition: readonly AnchorUnit[] = [
      {
        id: 'u1',
        text: 'Бронхиальная астма — хроническое воспалительное заболевание дыхательных путей.',
      },
      { id: 'u2', text: 'Базисная терапия включает ингаляционные глюкокортикостероиды.' },
    ];
    const anchor = select(EDITION_A, 'c3', SALT);
    expect(resolve(edition, anchor).match).toBeNull();
  });

  it('does not treat a changed number as the same statement', () => {
    const edition = EDITION_A.map((unit) =>
      unit.id === 'c3'
        ? {
            id: 'c3',
            text: unit.text
              .replace('до 5 г/сут', 'до 2 г/сут')
              .replace('ограничение потребления поваренной соли', 'ограничение соли'),
          }
        : unit,
    );
    const anchor = select(EDITION_A, 'c3', SALT);
    const { match } = resolve(edition, anchor);
    // Either unfound or flagged approximate, never `exact` / `moved`.
    expect(match === null || match.status === 'approximate').toBe(true);
  });
});

describe('locateQuote — repeated text', () => {
  const REPEATED: readonly AnchorUnit[] = [
    {
      id: 'r1',
      text: 'Для детей. Рекомендуется наблюдение в течение 6 месяцев после выписки из стационара.',
    },
    {
      id: 'r2',
      text: 'Для взрослых. Рекомендуется наблюдение в течение 6 месяцев после выписки из стационара.',
    },
  ];

  it('picks the occurrence whose surroundings agree with the old context', () => {
    const phrase = 'Рекомендуется наблюдение в течение 6 месяцев после выписки из стационара.';
    const first = select(REPEATED, 'r1', phrase);
    const second = select(REPEATED, 'r2', phrase);
    // Edition B swaps the two paragraphs.
    const swapped = [REPEATED[1], REPEATED[0]] as readonly AnchorUnit[];
    expect(resolve(swapped, first).match?.segments[0]?.unitId).toBe('r1');
    expect(resolve(swapped, second).match?.segments[0]?.unitId).toBe('r2');
  });

  it('is honest when nothing can tell identical candidates apart', () => {
    const bare = {
      selector: { exact: 'Рекомендуется наблюдение в течение 6 месяцев', prefix: '', suffix: '' },
      hint: {},
    };
    const { match } = resolve(REPEATED, bare);
    expect(match?.status).toBe('approximate');
  });
});

describe('locateQuote — long selections', () => {
  const longText = EDITION_A.map((unit) => unit.text).join(' ');
  const longUnits: readonly AnchorUnit[] = [{ id: 'all', text: longText }];

  it('re-anchors a selection longer than one alignment pass by its two ends', () => {
    const start = longText.indexOf('Диагноз артериальной');
    const end = longText.indexOf('Для начальной терапии');
    const selector = createQuoteSelector(longText, start, end);
    const edition: readonly AnchorUnit[] = [
      {
        id: 'all',
        text: `Введение к новой редакции. ${longText.replace('поваренной соли', 'натрия хлорида')}`,
      },
    ];
    const document = new AnchorDocument(edition);
    const match = locateQuote(document, selector, { unitId: 'all', start });
    expect(match).not.toBeNull();
    const found = match ? segmentText(document, match.segments[0] as never) : '';
    expect(found.startsWith('Диагноз артериальной')).toBe(true);
    expect(found).toContain('отказ от курения');
    expect(match?.status).toBe('approximate');
  });

  it('matches a long selection verbatim when nothing changed', () => {
    const start = longText.indexOf('Пациентам с артериальной');
    const end = longText.indexOf('Контроль эффективности');
    const selector = createQuoteSelector(longText, start, end);
    const document = new AnchorDocument(longUnits);
    const match = locateQuote(document, selector, { unitId: 'all', start });
    expect(match?.status).toBe('exact');
  });
});

describe('match rate over realistic edition changes', () => {
  interface Case {
    readonly name: string;
    readonly unit: string;
    readonly phrase: string;
    readonly edit: (units: readonly AnchorUnit[]) => readonly AnchorUnit[];
    readonly expectFound: boolean;
  }

  const replaceIn =
    (id: string, transform: (value: string) => string) =>
    (units: readonly AnchorUnit[]): readonly AnchorUnit[] =>
      units.map((unit) => (unit.id === id ? { id, text: transform(unit.text) } : unit));

  const cases: readonly Case[] = [
    { name: 'unchanged', unit: 'c3', phrase: SALT, edit: (units) => units, expectFound: true },
    {
      name: 'paragraph moved to the end',
      unit: 'c5',
      phrase: 'использовать комбинацию ингибитора АПФ или БРА с блокатором кальциевых каналов',
      edit: (units) => [
        ...units.filter((unit) => unit.id !== 'c5'),
        units.find((u) => u.id === 'c5') as AnchorUnit,
      ],
      expectFound: true,
    },
    {
      name: 'punctuation: dash and quotes',
      unit: 'c4',
      phrase: SMOKING,
      edit: replaceIn('c4', (value) => value.replace(' — ', ' – ').replace('курения,', 'курения;')),
      expectFound: true,
    },
    {
      name: 'ё and capitals',
      unit: 'c1',
      phrase: 'синдром повышения систолического артериального давления',
      edit: replaceIn('c1', (value) =>
        value.replace('синдром', 'СИНДРОМ').replace('систолического', 'Систолического'),
      ),
      expectFound: true,
    },
    {
      name: 'sentence inserted before',
      unit: 'c6',
      phrase: TARGET,
      edit: replaceIn('c6', (value) => `Для пожилых пациентов цели отличаются. ${value}`),
      expectFound: true,
    },
    {
      name: 'sentence inserted after',
      unit: 'c7',
      phrase: 'Контроль эффективности лечения проводится через 2–4 недели после начала терапии',
      edit: replaceIn('c7', (value) => `${value} Рекомендуется вести дневник измерений.`),
      expectFound: true,
    },
    {
      name: 'synonym replaced (one word)',
      unit: 'c2',
      phrase:
        'устанавливается на основании повторных измерений артериального давления в разные дни',
      edit: replaceIn('c2', (value) => value.replace('устанавливается', 'ставится')),
      expectFound: true,
    },
    {
      name: 'reworded clause',
      unit: 'c6',
      phrase: 'составляет менее 130/80 мм рт. ст., если препараты хорошо переносятся',
      edit: replaceIn('c6', (value) =>
        value.replace('если препараты хорошо переносятся', 'при хорошей переносимости терапии'),
      ),
      expectFound: true,
    },
    {
      name: 'two words swapped and one removed',
      unit: 'c3',
      phrase: 'снижает артериальное давление и риск сердечно-сосудистых осложнений',
      edit: replaceIn('c3', (value) =>
        value.replace('снижает артериальное давление и риск', 'уменьшает риск и снижает давление'),
      ),
      expectFound: true,
    },
    {
      name: 'paragraph deleted',
      unit: 'c7',
      phrase: 'затем не реже одного раза в 3–6 месяцев при стабильном течении заболевания',
      edit: (units) => units.filter((unit) => unit.id !== 'c7'),
      expectFound: false,
    },
    {
      name: 'sentence replaced by a different statement',
      unit: 'c5',
      phrase: 'тиазидоподобным диуретиком у большинства пациентов',
      edit: replaceIn('c5', (value) =>
        value.replace(
          /Для начальной терапии.*$/u,
          'Монотерапия показана только при АГ 1 степени низкого риска.',
        ),
      ),
      expectFound: false,
    },
  ];

  it('anchors every case that still has the text and refuses the ones that do not', () => {
    const outcomes = cases.map((entry) => {
      const anchor = select(EDITION_A, entry.unit, entry.phrase);
      const { match } = resolve(entry.edit(EDITION_A), anchor);
      return { entry, found: match !== null };
    });
    const wrong = outcomes.filter(({ entry, found }) => found !== entry.expectFound);
    expect(wrong.map(({ entry }) => entry.name)).toEqual([]);
    const present = outcomes.filter(({ entry }) => entry.expectFound);
    expect(present.length / present.length).toBe(1);
  });
});
