/**
 * Audits what the shipped tool schemas tell the reader about a result. Three groups:
 *
 *  1. missing bands   - no `interpretations` and no declaration why none is needed: the result screen
 *                       shows the score alone, so each is a content task (a new module version);
 *  2. unavailable     - `evaluation.status` is `unavailable` (no declarative rules and no declared
 *                       reason): also a content task, never a UI note;
 *  3. informational   - `not-applicable` (a dose, a volume, a conversion: no published good/bad bands)
 *                       and `missing-context` (the reading depends on age, sex or a laboratory range
 *                       the tool does not ask for). Listed with the declared reason; nothing to fix.
 *
 *   bun scripts/audit-tool-interpretations.ts          # report, exit code 0
 *   bun scripts/audit-tool-interpretations.ts --strict # exit code 1 while group 1 or 2 is not empty
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

interface ToolRecord {
  readonly kind: string;
  readonly id: string;
  readonly definition: {
    readonly title?: string;
    readonly interpretations?: readonly unknown[];
    readonly evaluation?: {
      readonly status?: string;
      readonly reason?: string;
      readonly missingContext?: readonly string[];
    };
  };
}

const root = resolve(import.meta.dirname, '../content/tool-modules');
const missingBands: string[] = [];
const unavailable: string[] = [];
const informational: string[] = [];
for (const file of readdirSync(root)
  .filter((name) => name.endsWith('.json'))
  .sort()) {
  const source = JSON.parse(readFileSync(join(root, file), 'utf8')) as {
    readonly tools: readonly ToolRecord[];
  };
  for (const tool of source.tools) {
    const line = `${file.replace('.json', '')}\t${tool.kind}\t${tool.id}\t${tool.definition.title ?? ''}`;
    const evaluation = tool.definition.evaluation;
    const status = evaluation?.status;
    if (status === 'not-applicable' || status === 'missing-context') {
      const detail =
        status === 'missing-context'
          ? (evaluation?.missingContext ?? []).join(' ')
          : (evaluation?.reason ?? '');
      informational.push(`${line}\t[${status}] ${detail}`.trimEnd());
      continue;
    }
    if (status === 'unavailable') unavailable.push(line);
    if ((tool.definition.interpretations ?? []).length === 0) missingBands.push(line);
  }
}

function print(title: string, lines: readonly string[]): void {
  console.log(`${title} (${lines.length}):`);
  for (const line of lines) console.log(`  ${line}`);
  console.log('');
}

print('Missing interpretation bands where one is expected', missingBands);
print('Evaluation unavailable', unavailable);
print('Informational: not-applicable / missing-context (declared, nothing to fix)', informational);

if (process.argv.includes('--strict') && missingBands.length + unavailable.length > 0) {
  process.exitCode = 1;
}
