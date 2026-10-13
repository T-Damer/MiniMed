import { ScoreScaleSchema } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import { evaluateCalculatorSchema } from '@/features/calculators/calculator-schema-engine';
import {
  buildScoreScaleSpec,
  type ScoreScaleSpec,
  scaledValueIds,
  scoreScaleBandIndexForValue,
  scoreScaleGeometry,
  scoreScaleSummary,
  warningsBesideScales,
} from '@/features/calculators/score-scale';
import { scoreScalePrintHtml } from '@/features/calculators/score-scale-print';
import { calculatorSchemaFromModules } from '@/features/calculators/tool-module-test-helpers';

function spec(overrides: Partial<ScoreScaleSpec> = {}): ScoreScaleSpec {
  return {
    id: 'scale_score',
    valueId: 'score',
    value: 5,
    precision: 0,
    minimum: 0,
    maximum: 10,
    step: 1,
    layout: 'proportional',
    bands: [
      { from: 0, label: 'Низкий', attentionLevel: 'none' },
      { from: 4, label: 'Средний', attentionLevel: 'moderate' },
      { from: 8, label: 'Высокий', attentionLevel: 'high' },
    ],
    activeBand: 1,
    ...overrides,
  };
}

describe('score scale geometry', () => {
  it('puts a boundary between two whole values, so a value is never on an edge', () => {
    const geometry = scoreScaleGeometry(spec());
    // The track spans -0.5..10.5 (11 cells); the second band starts at 3.5.
    expect(geometry.segments.map((segment) => segment.startPercent)).toEqual([0, 36.364, 72.727]);
    expect(geometry.segments.at(-1)?.endPercent).toBe(100);
    expect(geometry.markerPercent).toBeCloseTo(50, 0);
    expect(
      geometry.segments.map((segment) => segment.widthPercent).reduce((a, b) => a + b),
    ).toBeCloseTo(100, 2);
  });

  it('scales continuous values exactly between minimum and maximum', () => {
    const geometry = scoreScaleGeometry(
      spec({
        value: 2.5,
        minimum: 0,
        maximum: 10,
        step: undefined as never,
        bands: [
          { from: 0, label: 'a' },
          { from: 5, label: 'b' },
        ],
      }),
    );
    expect(geometry.segments.map((segment) => segment.widthPercent)).toEqual([50, 50]);
    expect(geometry.markerPercent).toBe(25);
  });

  it('draws categorical classes as equal segments with the marker inside its own class', () => {
    const classes = spec({
      value: 3,
      minimum: 1,
      maximum: 4,
      layout: 'equal',
      bands: [1, 2, 3, 4].map((from) => ({ from, label: `Класс ${from}` })),
      activeBand: 2,
    });
    const geometry = scoreScaleGeometry(classes);
    expect(geometry.segments.map((segment) => segment.widthPercent)).toEqual([25, 25, 25, 25]);
    expect(geometry.markerPercent).toBe(62.5);
  });

  it('holds a value outside the track at its end and says which side', () => {
    expect(scoreScaleGeometry(spec({ value: 99 }))).toMatchObject({
      markerPercent: 100,
      overflow: 'above',
    });
    expect(scoreScaleGeometry(spec({ value: -3 }))).toMatchObject({
      markerPercent: 0,
      overflow: 'below',
    });
    expect(scoreScaleGeometry(spec({ value: 5 })).overflow).toBeUndefined();
  });

  it('keeps cut-points and drops an end label that would touch one', () => {
    const geometry = scoreScaleGeometry(spec());
    expect(geometry.ticks.map((tick) => tick.text)).toEqual(['0', '4', '8', '10']);
    const crowded = scoreScaleGeometry(
      spec({ maximum: 8, bands: [{ from: 0 }, { from: 4 }, { from: 8 }] }),
    );
    expect(crowded.ticks.map((tick) => tick.text)).toEqual(['0', '4', '8']);
  });

  it('is a single gauge segment without bands', () => {
    const gauge = scoreScaleGeometry(
      spec({ bands: [], activeBand: undefined as never, value: 25, maximum: 100 }),
    );
    expect(gauge.segments).toHaveLength(1);
    expect(gauge.labelsFitInside).toBe(false);
    expect(gauge.markerPercent).toBeCloseTo(25, 0);
  });

  it('writes labels inside only when they all fit', () => {
    expect(scoreScaleGeometry(spec()).labelsFitInside).toBe(true);
    const long = spec({
      bands: [
        { from: 0, label: 'Очень длинное название полосы' },
        { from: 10, label: 'Мало' },
      ],
    });
    expect(scoreScaleGeometry(long).labelsFitInside).toBe(false);
  });
});

describe('score scale band lookup', () => {
  it('finds the band by the last start at or below the value', () => {
    const s = spec();
    expect(scoreScaleBandIndexForValue(s, 0)).toBe(0);
    expect(scoreScaleBandIndexForValue(s, 3)).toBe(0);
    expect(scoreScaleBandIndexForValue(s, 4)).toBe(1);
    expect(scoreScaleBandIndexForValue(s, 9)).toBe(2);
    expect(scoreScaleBandIndexForValue({ bands: [] }, 3)).toBeUndefined();
  });

  it('prefers the interpretation the engine matched over the position', () => {
    const definition = ScoreScaleSchema.parse({
      id: 'scale_score',
      valueId: 'score',
      minimum: 0,
      maximum: 10,
      step: 1,
      bands: [
        { from: 0, label: 'Низкий', interpretation: 1 },
        { from: 4, label: 'Высокий', interpretation: 0 },
      ],
    });
    const texts = ['высокий текст', 'низкий текст'];
    const byValue = buildScoreScaleSpec(definition, {
      value: 2,
      precision: 0,
      interpretationText: (index) => texts[index],
    });
    expect(byValue.activeBand).toBe(0);
    expect(byValue.text).toBe('низкий текст');
    const matched = buildScoreScaleSpec(definition, {
      value: 2,
      precision: 0,
      matchedInterpretation: 0,
      interpretationText: (index) => texts[index],
    });
    expect(matched.activeBand).toBe(1);
    expect(matched.text).toBe('высокий текст');
  });

  it('summarises the value and band for assistive technology', () => {
    expect(scoreScaleSummary(spec({ value: 5.5, precision: 1, unit: 'балла' }))).toBe(
      '5,5 балла — Средний',
    );
  });
});

describe('score scale contract', () => {
  const base = { id: 'scale_score', valueId: 'score', minimum: 0, maximum: 10 };
  it('requires ascending bands from the minimum', () => {
    expect(ScoreScaleSchema.safeParse({ ...base, bands: [{ from: 0 }, { from: 4 }] }).success).toBe(
      true,
    );
    expect(ScoreScaleSchema.safeParse({ ...base, bands: [{ from: 1 }, { from: 4 }] }).success).toBe(
      false,
    );
    expect(ScoreScaleSchema.safeParse({ ...base, bands: [{ from: 0 }, { from: 0 }] }).success).toBe(
      false,
    );
    expect(
      ScoreScaleSchema.safeParse({ ...base, bands: [{ from: 0 }, { from: 11 }] }).success,
    ).toBe(false);
    expect(ScoreScaleSchema.safeParse({ ...base, maximum: 0 }).success).toBe(false);
    expect(
      ScoreScaleSchema.safeParse({ ...base, layout: 'equal', bands: [{ from: 0 }] }).success,
    ).toBe(false);
  });
});

describe('score scales in a calculation result', () => {
  const schema = calculatorSchemaFromModules('minimed.calculator.nyha-class');

  it('places the result on the scale and writes the band text once', () => {
    const result = evaluateCalculatorSchema(schema, { nyhaClass: 3 });
    if (!result.ok) throw new Error(result.error);
    expect(result.scales).toHaveLength(1);
    const scale = result.scales[0];
    expect(scale?.value).toBe(3);
    expect(scale?.activeBand).toBe(2);
    expect(scale?.layout).toBe('equal');
    expect(scale?.text).toBe(
      result.warnings.find((warning) => warning.code === 'interpretation')?.message,
    );
    expect(scaledValueIds(result.scales).has('classValue')).toBe(true);
    expect(
      warningsBesideScales(result.warnings, result.scales).some((w) => w.code === 'interpretation'),
    ).toBe(false);
  });

  it('gives no scale for a partial stage', () => {
    const result = evaluateCalculatorSchema(schema, { nyhaClass: 3 }, { maxStep: 0 });
    if (!result.ok) throw new Error(result.error);
    expect(result.scales).toEqual([]);
  });
});

describe('score scale print block', () => {
  it('draws every band, the marker and the legend with fixed colours', () => {
    const html = scoreScalePrintHtml(spec({ text: 'Текст <b>полосы</b>' }));
    expect(html).toContain('score-scale__marker');
    expect(html.match(/score-scale__segment"|score-scale__segment /g)?.length).toBe(3);
    expect(html).toContain('score-scale__segment--active');
    expect(html).toContain('Средний');
    expect(html).toContain('&lt;b&gt;полосы');
    expect(scoreScalePrintHtml(spec({ text: 'скрыт' }), { text: false })).not.toContain('скрыт');
  });
});
