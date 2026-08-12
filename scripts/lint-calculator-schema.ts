#!/usr/bin/env bun
import { readFile } from 'node:fs/promises';

import { validateCalculatorSchema } from '../apps/app/src/features/calculators/calculator-schema-validate';

async function main(): Promise<void> {
  const path = process.argv[2];
  if (!path) {
    throw new Error('Usage: bun scripts/lint-calculator-schema.ts <calculator.json>');
  }
  const raw = await readFile(path, 'utf8');
  let candidate: unknown;
  try {
    candidate = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${path} is not valid JSON: ${error instanceof Error ? error.message : error}`);
  }
  const result = validateCalculatorSchema(candidate);
  if (!result.ok) {
    console.error(`${path}: invalid calculator schema`);
    for (const error of result.errors) console.error(`  - ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`${path}: ok (${result.schema?.id})`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
