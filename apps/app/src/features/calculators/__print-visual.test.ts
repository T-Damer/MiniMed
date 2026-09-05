import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CalculatorSchemaSchema, ToolDefinitionRecordSchema } from '@localmed/contracts';
import { expect, test } from 'vitest';

import { evaluateCalculatorSchema } from './calculator-schema-engine';

test('print chart', () => {
  const mod = JSON.parse(
    readFileSync(resolve(process.cwd(), 'content/tool-modules/pediatrics-growth.json'), 'utf8'),
  );
  const schema = CalculatorSchemaSchema.parse(
    ToolDefinitionRecordSchema.parse(mod.tools[0]).definition,
  );
  const r = evaluateCalculatorSchema(schema, {
    date_of_birth: '2025-01-01',
    measurement_date: '2025-07-01',
    biological_sex: 'female',
    measure_position: 'auto',
    length_height_cm: 65,
    weight_g: 7_500,
  });
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  const lines = r.outputs.map((o) =>
    o.kind === 'visual'
      ? `VISUAL ${o.label} [${o.chart.type}] ${JSON.stringify(o.chart)}`
      : `OUT ${o.label}: ${o.kind === 'text' ? o.text : `${o.value} ${o.unit}`}`,
  );
  console.log(lines.join('\n'));
});
