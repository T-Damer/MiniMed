// RX2: turns a drawn sample (draw.json) and the reviewer's judgement lines into a committed
// precision set (tools/benchmarks/dose-rule-precision.json or the gate's development set).
//
//   DOSE_DECODED_DIR=<dir> bun tools/benchmarks/src/build-dose-precision-set.ts \
//     --draw=<draw.json> --judgements=<judgements-*.txt glob dir> --out=<file> --name=<blind|dev> \
//     [--note="..."]
//
// A judgement line is `NNN [field=w|i,...] | reason` (NNN = position in the draw, 1-based). Fields not
// named are `ok` when the rule carries them and `absent` when it does not. `w` = wrong (something the
// rule states contradicts the source, or a qualifier is missing so that the number would be offered
// to a patient it is not for), `i` = incomplete (nothing stated is false; the rule is narrower, or a
// detail such as the frequency is not read). The set never holds instruction text, only a checksum of
// the sentence and the reviewer's short reason.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { DoseRule } from '@localmed/contracts';

import { describeRule } from './dose-rule-describe';
import { frameRule, loadIndex, ModuleTexts } from './dose-rule-frame';

export const FIELDS = [
  'pop',
  'dose',
  'unit',
  'kg',
  'freq',
  'cap',
  'dur',
  'form',
  'route',
  'role',
] as const;
export type Field = (typeof FIELDS)[number];
/** Fields whose error changes a computed number or the patient a number is offered to. */
export const DOSE_RELEVANT: ReadonlySet<Field> = new Set([
  'pop',
  'dose',
  'unit',
  'kg',
  'freq',
  'cap',
  'dur',
  'form',
]);

export type FieldStatus = 'ok' | 'wrong' | 'incomplete' | 'absent';

export function carries(rule: DoseRule, field: Field): boolean {
  switch (field) {
    case 'pop':
      return (
        rule.p0 !== undefined ||
        rule.p1 !== undefined ||
        rule.w0 !== undefined ||
        rule.w1 !== undefined ||
        (rule.g ?? 0) !== 0 ||
        (rule.c ?? 0) !== 0
      );
    case 'dose':
      return rule.k === 0 && (rule.d0 !== undefined || rule.d1 !== undefined);
    case 'unit':
      return rule.d0 !== undefined || rule.d1 !== undefined;
    case 'kg':
      return rule.pk !== undefined;
    case 'freq':
      return rule.f0 !== undefined;
    case 'cap':
      return rule.k === 1;
    case 'dur':
      return rule.t0 !== undefined;
    case 'form':
      return rule.q0 !== undefined || rule.pm !== undefined;
    case 'route':
      return rule.rt !== undefined || rule.fm !== undefined;
    case 'role':
      return rule.ro !== undefined;
  }
}

export interface PrecisionItem {
  readonly id: string;
  readonly documentId: string;
  readonly card: string;
  readonly module: string;
  readonly stratum: string;
  readonly sentenceSha256: string;
  readonly rule: DoseRule;
  readonly fields: Readonly<Record<Field, FieldStatus>>;
  readonly verdict: 'correct' | 'incomplete' | 'wrong';
  readonly doseRelevantWrong: boolean;
  readonly reason: string;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const argument = (name: string): string | undefined =>
    args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const drawFile = argument('draw');
  const judgementsDirectory = argument('judgements');
  const out = argument('out');
  const name = argument('name') ?? 'blind';
  const note = argument('note') ?? '';
  const decoded = process.env['DOSE_DECODED_DIR'];
  if (!drawFile || !judgementsDirectory || !out || !decoded) {
    throw new Error('Usage: see the header of build-dose-precision-set.ts');
  }
  const draw = JSON.parse(readFileSync(resolve(drawFile), 'utf8')) as {
    seed: string;
    quotas: Record<string, number>;
    frameSizes: Record<string, number>;
    indexBasis: unknown;
    picks: { key: string; stratum: string; documentId: string; cardSlug: string }[];
  };
  const index = loadIndex();
  const texts = new ModuleTexts(decoded, index);
  const judgements = new Map<number, { fields: Map<Field, 'w' | 'i'>; reason: string }>();
  for (const file of readdirSync(judgementsDirectory).filter((item) =>
    /^judgements-.*\.txt$/u.test(item),
  )) {
    for (const line of readFileSync(join(judgementsDirectory, file), 'utf8').split('\n')) {
      if (line.trim() === '') continue;
      const match = /^(\d{3})\s*([^|]*)\|\s*(.*)$/u.exec(line);
      if (!match) throw new Error(`Unreadable judgement line: ${line}`);
      const fields = new Map<Field, 'w' | 'i'>();
      for (const part of (match[2] ?? '').split(',').map((item) => item.trim())) {
        if (part === '') continue;
        const pair = /^([a-z]+)=([wi])$/u.exec(part);
        if (!pair || !(FIELDS as readonly string[]).includes(pair[1] ?? '')) {
          throw new Error(`Unreadable field "${part}" in: ${line}`);
        }
        fields.set(pair[1] as Field, pair[2] as 'w' | 'i');
      }
      judgements.set(Number(match[1]), { fields, reason: (match[3] ?? '').trim() });
    }
  }
  // The rules as the reviewer saw them (RULE: lines of the review files), not as the index holds them
  // now: a parser fix after the review must not silently change what was judged.
  const judgedRules = new Map<number, DoseRule>();
  const reviewDirectory = argument('rules-from') ?? judgementsDirectory;
  for (const file of readdirSync(reviewDirectory).filter((item) =>
    /^review-.*\.txt$/u.test(item),
  )) {
    let number = 0;
    for (const line of readFileSync(join(reviewDirectory, file), 'utf8').split('\n')) {
      const header = /^#(\d{3})\s/u.exec(line);
      if (header) number = Number(header[1]);
      const rule = /^\s+RULE:\s+(\{.*\})\s*$/u.exec(line);
      if (rule && number > 0) judgedRules.set(number, JSON.parse(rule[1] as string) as DoseRule);
    }
  }
  const items: PrecisionItem[] = [];
  draw.picks.forEach((pick, position) => {
    const judgement = judgements.get(position + 1);
    if (!judgement) throw new Error(`Rule #${position + 1} (${pick.key}) has no judgement`);
    const document = index.asset.documents[pick.documentId];
    const rule = document?.rules.find(
      (item) => `${pick.documentId}#${item.s}:${item.a}:${item.k}` === pick.key,
    );
    if (!document || !rule) throw new Error(`Rule ${pick.key} is not in the index`);
    const judged = judgedRules.get(position + 1) ?? rule;
    const framed = frameRule(index, texts, pick.documentId, rule, pick.cardSlug, true);
    const fields = {} as Record<Field, FieldStatus>;
    for (const field of FIELDS) {
      const mark = judgement.fields.get(field);
      fields[field] =
        mark === 'w'
          ? 'wrong'
          : mark === 'i'
            ? 'incomplete'
            : carries(judged, field)
              ? 'ok'
              : 'absent';
    }
    const wrongFields = FIELDS.filter((field) => fields[field] === 'wrong');
    const incompleteFields = FIELDS.filter((field) => fields[field] === 'incomplete');
    items.push({
      id: pick.key,
      documentId: pick.documentId,
      card: pick.cardSlug,
      module: framed.module,
      stratum: pick.stratum,
      sentenceSha256: framed.sentenceSha256,
      rule: judged,
      fields,
      verdict:
        wrongFields.length > 0 ? 'wrong' : incompleteFields.length > 0 ? 'incomplete' : 'correct',
      doseRelevantWrong: wrongFields.some((field) => DOSE_RELEVANT.has(field)),
      reason: judgement.reason,
    });
    void describeRule;
  });
  texts.close();
  const result = {
    name,
    note,
    seed: draw.seed,
    drawnFrom: { frameSizes: draw.frameSizes, quotas: draw.quotas, indexBasis: draw.indexBasis },
    items,
  };
  writeFileSync(resolve(out), `${JSON.stringify(result, null, 1)}\n`);
  const count = (verdict: string): number =>
    items.filter((item) => item.verdict === verdict).length;
  console.log(
    `${items.length} items: correct ${count('correct')}, incomplete ${count('incomplete')}, wrong ${count('wrong')} (dose-relevant wrong ${items.filter((item) => item.doseRelevantWrong).length})`,
  );
}
