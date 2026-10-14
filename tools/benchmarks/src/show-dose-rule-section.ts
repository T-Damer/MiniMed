// RX2: prints the whole dosage section around a drawn rule, for a reviewer who needs more than the
// lines next to the sentence.
//
//   DOSE_DECODED_DIR=<dir> bun tools/benchmarks/src/show-dose-rule-section.ts <draw.json> <number>... [--max=6000]
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadIndex, ModuleTexts } from './dose-rule-frame';

const args = process.argv.slice(2);
const decoded = process.env['DOSE_DECODED_DIR'];
const drawFile = args[0];
const maxArg = args.find((arg) => arg.startsWith('--max='));
const max = maxArg ? Number(maxArg.slice(6)) : 6000;
if (!decoded || !drawFile) throw new Error('Usage: DOSE_DECODED_DIR=<dir> show <draw.json> <n>...');
const draw = JSON.parse(readFileSync(resolve(drawFile), 'utf8')) as {
  picks: { key: string; documentId: string }[];
};
const index = loadIndex();
const texts = new ModuleTexts(decoded, index);
for (const argument of args.slice(1).filter((arg) => /^\d+$/u.test(arg))) {
  const pick = draw.picks[Number(argument) - 1];
  if (!pick) throw new Error(`No pick ${argument}`);
  const document = index.asset.documents[pick.documentId];
  const rule = document?.rules.find(
    (item) => `${pick.documentId}#${item.s}:${item.a}:${item.k}` === pick.key,
  );
  if (!document || !rule) throw new Error(`No rule ${pick.key}`);
  const section = texts.section(pick.documentId, rule.s);
  const marked = `${section.text.slice(0, rule.a)}⟦${section.text.slice(rule.a, rule.b)}⟧${section.text.slice(rule.b)}`;
  const from = Math.max(0, rule.a - Math.floor(max / 2));
  console.log(
    `===== #${argument} ${pick.key} (${document.t ?? ''}, form: ${document.f ?? '-'}) section "${section.title}" chars ${from}..`,
  );
  console.log(marked.slice(from, from + max).replace(/\n+/gu, '\n'));
}
texts.close();
