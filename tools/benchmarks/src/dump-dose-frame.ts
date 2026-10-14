// RX2: writes every rule of the indexed documents of the ЖНВЛП cards, with its sentence, to a JSONL
// file for searching with grep (reviewing parser defects). Not part of any gate.
//
//   DOSE_DECODED_DIR=<dir> bun tools/benchmarks/src/dump-dose-frame.ts <out.jsonl> [--all]
import { createWriteStream } from 'node:fs';

import { describeRule } from './dose-rule-describe';
import { essentialRuleRefs, frameRule, loadIndex, ModuleTexts } from './dose-rule-frame';

const out = process.argv[2];
const decoded = process.env['DOSE_DECODED_DIR'];
if (!out || !decoded) throw new Error('Usage: DOSE_DECODED_DIR=<dir> dump-dose-frame <out.jsonl>');
const index = loadIndex();
const texts = new ModuleTexts(decoded, index);
const stream = createWriteStream(out);
let count = 0;
for (const ref of essentialRuleRefs(index)) {
  const item = frameRule(index, texts, ref.documentId, ref.rule, ref.cardSlug, true);
  stream.write(
    `${JSON.stringify({
      key: item.key,
      card: item.cardSlug,
      module: item.module,
      population: item.population,
      parsed: describeRule(ref.rule),
      sentence: item.sentence,
      heading: item.headingText,
      window: item.window,
    })}\n`,
  );
  count += 1;
}
stream.end();
texts.close();
console.log(`${count} rules written`);
