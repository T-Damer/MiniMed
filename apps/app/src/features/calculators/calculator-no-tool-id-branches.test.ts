import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

// AGENTS.md: calculator behaviour is declared in the tool schema; UI and print code render schema
// data and never branch on a tool's id or slug. This guards the screens that once did.
const FILES = [
  'apps/app/src/features/calculators/CalculatorsView.tsx',
  'apps/app/src/features/calculators/CalculatorHost.tsx',
  'apps/app/src/features/calculators/RecentCalculatorsRow.tsx',
  'apps/app/src/features/calculators/calculator-print.ts',
  'apps/app/src/features/calculators/calculator-packs.ts',
  'apps/app/src/features/assessments/AssessmentsView.tsx',
  'apps/app/src/features/assessments/AssessmentHost.tsx',
  'apps/app/src/features/assessments/assessment-print.ts',
] as const;

const BRANCH_ON_TOOL_ID = [
  /\b(?:definition|record|calculator|schema|assessment|tool)\.(?:id|slug|calculatorId|assessmentId)\s*[!=]==\s*['"A-Z]/u,
  /\b(?:calculatorId|assessmentId|toolId)\s*[!=]==\s*['"A-Z]/u,
  /switch\s*\(\s*[\w.]*\.(?:id|slug|calculatorId)\s*\)/u,
  /case\s+['"](?:unit-conversion|ecg-photo-caliper|obstetric-[a-z-]+|minimed\.(?:calculator|assessment)\.[a-z-]+)['"]/u,
  /_(?:CALCULATOR|PLAN|CALIPER)_ID\b/u,
];

describe('tool screens', () => {
  it.each(FILES)('%s does not branch on a tool id or slug', (relativePath) => {
    const source = readFileSync(resolve(process.cwd(), relativePath), 'utf8');
    const offending = source
      .split('\n')
      .filter((line) => BRANCH_ON_TOOL_ID.some((pattern) => pattern.test(line)));
    expect(offending).toEqual([]);
  });
});
