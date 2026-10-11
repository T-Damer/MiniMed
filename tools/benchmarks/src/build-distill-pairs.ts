/**
 * Training pairs for the supervised term of the KD1 query encoder (STATE KD1): a complaint or a
 * diagnosis phrase and the clinical recommendations whose registry ICD-10 codes cover its code —
 * the same relation Q1 grades as 3 (`retrieval-benchmark.ts` `bestRelation`). Only records Q1 can
 * never contain, and nothing from the same patient or source document as a Q1 query: RuMedPrime
 * events outside the RuMedTop3 dev/test ids whose patient has no Q1 visit (a patient's other visits
 * repeat its complaints and diagnosis), and RuCCoD train phrases of files without a Q1 dev record
 * that are not present in the test split.
 *
 *   bun tools/benchmarks/src/build-distill-pairs.ts --out=<scratch>/distill-pairs.jsonl
 *
 * Output rows: `{ text, positives: ["kr.rf.…"], source }`. Labels are coarse (the final diagnosis
 * of a visit, not the best document); they are training signal, never evidence.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { bestRelation, normalizeIcdCode } from './retrieval-benchmark';

const ROOT = resolve(import.meta.dirname, '../../..');
const RAW = resolve(ROOT, 'data/raw/query-datasets');
const REGISTRY = resolve(ROOT, 'data/raw/official-clinical-registry/2026-10-02');
const out = process.argv.find((item) => item.startsWith('--out='))?.slice(6);
if (!out) throw new Error('Missing --out=…');

const clean = (text: string) => text.replace(/\s+/gu, ' ').trim();
const key = (text: string) =>
  text
    .toLowerCase()
    .replaceAll('ё', 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
/** As in build-retrieval-benchmark.ts: placeholders and «no complaints» visits. */
const NOT_A_COMPLAINT =
  /\*[А-ЯЁ]+\*|жалоб(?:\s+активн\p{L}*)?\s+нет|жалоб(?:ы|а)?\s+не\s+предъявля|без\s+жалоб/iu;
/** A single adjective cut out of a longer diagnosis is not a query. */
const FRAGMENT = /^[\p{L}]+(?:ый|ий|ой|ая|ое|ые|ым|им|их|ых|ого|ему|ому|ыми)$/iu;

const registryCodes = new Map<string, readonly string[]>();
for (const name of ['catalog-all-statuses.json', 'catalog.json']) {
  const catalog = JSON.parse(readFileSync(resolve(REGISTRY, name), 'utf8')) as {
    records: readonly { id: string; mkb10?: readonly string[] }[];
  };
  for (const record of catalog.records) registryCodes.set(record.id, record.mkb10 ?? []);
}
const catalog = JSON.parse(
  readFileSync(resolve(ROOT, 'apps/app/src/features/modules/catalog.preview.json'), 'utf8'),
) as { modules: readonly { id: string }[] };
const recommendations = catalog.modules
  .filter((module) => module.id.startsWith('minimed.clinical.recommendation.'))
  .map((module) => module.id.replace('minimed.clinical.recommendation.', ''))
  .map((officialId) => ({ id: `kr.rf.${officialId}`, codes: registryCodes.get(officialId) ?? [] }));

const positivesFor = (rawCode: string): string[] => {
  const code = normalizeIcdCode(rawCode);
  if (!code) return [];
  return recommendations
    .filter((recommendation) => bestRelation([code], recommendation.codes) === 'exact')
    .map((recommendation) => recommendation.id);
};

const q1 = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../retrieval-icd-queries.json'), 'utf8'),
) as { queries: readonly { query: string; source: string; sourceRecordId: string }[] };
const blockedText = new Set(q1.queries.map((query) => key(query.query)));
const blockedRecords = new Set(q1.queries.map((query) => query.sourceRecordId));

const rows: { text: string; positives: string[]; source: string }[] = [];
const seen = new Set<string>();
const push = (text: string, rawCode: string, source: string) => {
  const normalized = key(text);
  if (seen.has(normalized) || blockedText.has(normalized)) return;
  const positives = positivesFor(rawCode);
  if (positives.length === 0) return;
  seen.add(normalized);
  rows.push({ text, positives, source });
};

// RuMedPrimeData: events outside the RuMedTop3 dev/test ids (Q1 samples only from those).
const heldOut = new Set<string>();
for (const file of ['top3-dev_v1.jsonl', 'top3-test_v1.jsonl']) {
  for (const line of readFileSync(resolve(RAW, 'rumedprime', file), 'utf8').split('\n')) {
    if (line.trim()) heldOut.add((JSON.parse(line) as { idx: string }).idx);
  }
}
const tsv = readFileSync(resolve(RAW, 'rumedprime/RuMedPrimeData.tsv'), 'utf8').split('\n');
const patientOf = new Map(
  tsv.slice(1).map((line) => {
    const parts = line.split('\t');
    return [parts[4] ?? '', parts[3] ?? ''] as const;
  }),
);
const blockedPatients = new Set(
  [...blockedRecords].map((record) => patientOf.get(record)).filter(Boolean),
);
for (const line of tsv.slice(1)) {
  const [symptoms = '', , icd = '', patientId = '', eventId = ''] = line.split('\t');
  if (!eventId || heldOut.has(eventId) || blockedPatients.has(patientId)) continue;
  const text = clean(symptoms);
  if (text.length < 25 || text.length > 400 || NOT_A_COMPLAINT.test(text)) continue;
  push(text, icd, 'rumedprime');
}

// RuCCoD: train phrases with one code; a phrase also present in the test split is left out.
const phrases = new Map<
  string,
  { split: string; codes: Set<string>; text: string; record: string }
>();
for (const [directory, split] of [
  ['ruccod_train', 'train'],
  ['ruccod_test', 'test'],
] as const) {
  const base = resolve(RAW, 'ruccod/data', directory);
  for (const file of readdirSync(base).filter((name) => name.endsWith('.ann'))) {
    const entities = new Map<string, { text: string; start: string }>();
    for (const line of readFileSync(resolve(base, file), 'utf8').split('\n')) {
      const parts = line.split('\t');
      if (line.startsWith('T') && parts[0] && parts[1] && parts[2]) {
        entities.set(parts[0], { text: parts[2], start: parts[1].split(' ')[1] ?? '0' });
      }
      if (line.startsWith('N') && parts[1] && parts[2]) {
        const entity = entities.get(parts[1].split(' ')[1] ?? '');
        const text = clean(entity?.text ?? '');
        if (!entity || text.length < 5 || FRAGMENT.test(text)) continue;
        const entryKey = `${split}:${key(text)}`;
        const entry = phrases.get(entryKey) ?? {
          split,
          codes: new Set<string>(),
          text,
          record: `${split}-${basename(file, '.ann')}-${entity.start}`,
        };
        entry.codes.add(parts[2]);
        phrases.set(entryKey, entry);
      }
    }
  }
}
const testPhrases = new Set(
  [...phrases.values()].filter((entry) => entry.split === 'test').map((entry) => key(entry.text)),
);
/** `train-<file>-<offset>` → `train-<file>`: a file holding a Q1 dev record is left out whole. */
const fileOf = (record: string) => record.replace(/-\d+$/u, '');
const blockedFiles = new Set([...blockedRecords].filter((r) => r.startsWith('train-')).map(fileOf));
for (const entry of phrases.values()) {
  if (entry.split !== 'train' || entry.codes.size !== 1) continue;
  if (testPhrases.has(key(entry.text)) || blockedFiles.has(fileOf(entry.record))) continue;
  push(entry.text, [...entry.codes][0] ?? '', 'ruccod');
}

writeFileSync(out, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
const bySource = new Map<string, number>();
for (const row of rows) bySource.set(row.source, (bySource.get(row.source) ?? 0) + 1);
const sources = [...bySource].map(([source, count]) => `${source} ${count}`).join(', ');
const covered = new Set(rows.flatMap((row) => row.positives)).size;
console.log(`pairs: ${rows.length} (${sources}), recommendations with a pair: ${covered}`);
