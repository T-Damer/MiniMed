import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { ToolDefinitionRecordSchema } from '@localmed/contracts';
import { describe, expect, it, afterEach } from 'vitest';

import {
  clearDownloadedCalculators,
  getCalculatorRegistry,
  registerDownloadedCalculator,
} from '@/features/calculators/calculator-registry';

describe('downloaded calculator modules', () => {
  afterEach(() => clearDownloadedCalculators());

  it('validates and registers every calculator in the core clinical package', () => {
    const source = JSON.parse(
      readFileSync(resolve(process.cwd(), 'content/tool-modules/core-clinical.json'), 'utf8'),
    ) as { tools: readonly unknown[] };

    for (const rawTool of source.tools) {
      const record = ToolDefinitionRecordSchema.parse(rawTool);
      registerDownloadedCalculator(record);
    }

    const downloaded = getCalculatorRegistry().filter((calculator) =>
      calculator.id.startsWith('minimed.calculator.'),
    );
    expect(downloaded).toHaveLength(17);
    expect(downloaded.map((calculator) => calculator.id)).toContain(
      'minimed.calculator.cha2ds2-vasc',
    );
    expect(downloaded.map((calculator) => calculator.id)).toContain(
      'minimed.calculator.parkland-burn-resuscitation',
    );
  });
});
