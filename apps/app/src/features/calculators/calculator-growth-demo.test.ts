import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CalculatorSchemaSchema, ToolDefinitionRecordSchema } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';
import {
  evaluateCalculatorSchema,
  toStoredCalculationResult,
} from '@/features/calculators/calculator-schema-engine';
import { validateCalculatorSchema } from '@/features/calculators/calculator-schema-validate';

const DEMO_FILE = resolve(process.cwd(), 'content/tool-modules/pediatrics-growth.json');

function loadDemoSchema(): ReturnType<typeof CalculatorSchemaSchema.parse> {
  const module = JSON.parse(readFileSync(DEMO_FILE, 'utf8')) as { tools: unknown[] };
  const record = ToolDefinitionRecordSchema.parse(module.tools[0]);
  return CalculatorSchemaSchema.parse(record.definition);
}

describe('weight-for-age girls WHO demo (visuals)', () => {
  it('passes the schema trust boundary', () => {
    const result = validateCalculatorSchema(loadDemoSchema());
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('renders WHO corridor + child bar chart for a 6-month-old at 7.5 kg', () => {
    const result = evaluateCalculatorSchema(loadDemoSchema(), {
      age_months: 6,
      weight_kg: 7.5,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const visuals = result.outputs.filter((output) => output.kind === 'visual');
    expect(visuals).toHaveLength(2);
    if (visuals[0]?.kind !== 'visual' || visuals[1]?.kind !== 'visual') return;

    // static WHO line curves
    expect(visuals[0].chart.type).toBe('line');
    expect(visuals[0].chart.datasets.map((d) => d.label)).toEqual(['-2 SD', 'медиана', '+2 SD']);

    // child vs corridor bar, evaluated in scope
    const barDataset = visuals[1].chart.datasets[0];
    expect(barDataset).toBeDefined();
    expect(visuals[1].chart.labels).toEqual(['ребёнок', '-2 SD', 'медиана', '+2 SD']);
    const [child, low, median, high] = barDataset?.data ?? [];
    expect([child, low, median, high]).toEqual([7.5, 5.7, 7.3, 9.3]);
    expect(
      child !== undefined && low !== undefined && high !== undefined && child > low && child < high,
    ).toBe(true);

    // stored record keeps charts for print/share re-render
    const stored = toStoredCalculationResult(result);
    expect(stored.ok).toBe(true);
    if (!stored.ok) return;
    expect(stored.visuals).toHaveLength(2);
  });

  it('flags below -2 SD via interpretations', () => {
    const result = evaluateCalculatorSchema(loadDemoSchema(), {
      age_months: 12,
      weight_kg: 6.5,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.some((w) => w.message.includes('-2 SD'))).toBe(true);
  });

  it('fails on out-of-range age instead of extrapolating curves', () => {
    const result = evaluateCalculatorSchema(loadDemoSchema(), {
      age_months: 30,
      weight_kg: 11,
    });
    expect(result.ok).toBe(false);
  });
});
