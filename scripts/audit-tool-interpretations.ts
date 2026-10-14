/**
 * Lists the shipped tools whose schema declares no interpretation bands and those whose evaluation
 * is `unavailable` (no declarative rules): the result screen shows their score alone, so a tool
 * listed here is a content task (a new module version), never a UI note.
 *
 *   bun scripts/audit-tool-interpretations.ts
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

interface ToolRecord {
  readonly kind: string;
  readonly id: string;
  readonly definition: {
    readonly title?: string;
    readonly interpretations?: readonly unknown[];
    readonly evaluation?: { readonly status?: string };
  };
}

const root = resolve(import.meta.dirname, '../content/tool-modules');
const noInterpretation: string[] = [];
const noEvaluation: string[] = [];
for (const file of readdirSync(root)
  .filter((name) => name.endsWith('.json'))
  .sort()) {
  const source = JSON.parse(readFileSync(join(root, file), 'utf8')) as {
    readonly tools: readonly ToolRecord[];
  };
  for (const tool of source.tools) {
    const line = `${file.replace('.json', '')}\t${tool.kind}\t${tool.id}\t${tool.definition.title ?? ''}`;
    if ((tool.definition.interpretations ?? []).length === 0) noInterpretation.push(line);
    if (tool.definition.evaluation?.status === 'unavailable') noEvaluation.push(line);
  }
}

console.log(`Without interpretation bands (${noInterpretation.length}):`);
for (const line of noInterpretation) console.log(`  ${line}`);
console.log(`\nEvaluation unavailable (${noEvaluation.length}):`);
for (const line of noEvaluation) console.log(`  ${line}`);
