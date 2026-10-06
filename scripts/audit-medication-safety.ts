/**
 * Prints a reproducible random sample of the sentences the pregnancy / lactation / age-limit index
 * points at (SAFE1), with the text read from the decoded instruction modules, for the hand check of
 * extraction precision. The output holds instruction text: keep it local.
 *
 *   SAFE1_DECODED_DIR=<dir of decoded modules> bun scripts/audit-medication-safety.ts <kind> <count> [seed]
 *
 * kind: `missed` (recall: sentences that look like an age limit and gave none, read straight from the
 * modules: every 20th document of each), `age` (numeric age limits), `weight`, `category` (age groups without a number),
 * `pregnancy` (dedicated section sentences), `mention` (pregnancy / lactation words in
 * contraindications and other sections).
 */
import { Database } from 'bun:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  canonicalSectionText,
  spanDisplayText,
} from '../apps/app/src/features/drug-interactions/interaction-text';
import {
  formatAgeDays,
  formatWeightTenths,
} from '../apps/app/src/features/medication-safety/age-limits';
import {
  ageSentences,
  createSafetyIndex,
  flagsOrigin,
  flagsTopic,
  LIMIT_CATEGORY,
  parseSafetyIndex,
  pregnancySentences,
} from '../apps/app/src/features/medication-safety/safety-index';

const ROOT = resolve(import.meta.dirname, '..');
const asset = parseSafetyIndex(
  JSON.parse(
    readFileSync(
      join(ROOT, 'apps/app/src/features/medication-safety/data/safety-index.json'),
      'utf8',
    ),
  ),
);
const index = createSafetyIndex(asset);
const directory = process.env['SAFE1_DECODED_DIR'];
if (!directory) throw new Error('Set SAFE1_DECODED_DIR');
const [kind = 'age', countText = '50', seedText = '1'] = process.argv.slice(2);

function mulberry(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const databases = new Map<string, Database>();
function database(moduleId: string): Database {
  let handle = databases.get(moduleId);
  if (!handle) {
    handle = new Database(join(directory as string, `${moduleId}.db`), { readonly: true });
    databases.set(moduleId, handle);
  }
  return handle;
}

function sectionText(documentId: string, sectionId: string): string {
  const document = asset.documents[documentId];
  if (!document) return '';
  const db = database(asset.modules[document.m] ?? '');
  const chunks = db
    .query<{ original_text: string }, [string]>(
      'select original_text from chunks where section_id = ? order by order_index',
    )
    .all(sectionId)
    .map((row) => row.original_text);
  return canonicalSectionText(chunks).text;
}

interface Row {
  readonly documentId: string;
  readonly section: string;
  readonly start: number;
  readonly end: number;
  readonly note: string;
  readonly words?: readonly [number, number];
  /** Text already read (the `missed` kind). */
  readonly inline?: string;
}
const rows: Row[] = [];
let extractedSentences = 0;
if (kind === 'missed') {
  const { extractAmountLimits } = await import(
    '../apps/app/src/features/medication-safety/age-limits'
  );
  const { splitSentenceSpans } = await import(
    '../apps/app/src/features/drug-interactions/interaction-text'
  );
  const lookalike =
    /\d+(?:[.,]\d+)?\s*(?:лет|года|год|мес|недел)|(?:одного|двух|трех|шести|двенадцати|восемнадцати)\s+лет/iu;
  const childish = /возраст|дет(?:ей|ям|и|ск)|ребен|подрост|новорожд/iu;
  for (const name of readdirSync(directory)) {
    if (!name.endsWith('.db')) continue;
    const db = new Database(join(directory, name), { readonly: true });
    const documents = db
      .query<{ id: string; current_version_id: string }, []>(
        'select id, current_version_id from documents order by id',
      )
      .all();
    documents.forEach((document, at) => {
      if (at % 20 !== 0) return;
      const sections = db
        .query<{ id: string; section_type: string | null }, [string]>(
          "select id, section_type from sections where document_version_id = ? and section_type in ('contraindications','caution','special-instructions','dosage')",
        )
        .all(document.current_version_id);
      for (const section of sections) {
        const chunks = db
          .query<{ original_text: string }, [string]>(
            'select original_text from chunks where section_id = ? order by order_index',
          )
          .all(section.id)
          .map((row) => row.original_text);
        const canonical = canonicalSectionText(chunks);
        for (const span of splitSentenceSpans(canonical.text)) {
          const raw = canonical.text.slice(span.start, span.end);
          if (!lookalike.test(raw) || !childish.test(raw)) continue;
          if (extractAmountLimits(raw).length > 0) {
            extractedSentences += 1;
            continue;
          }
          rows.push({
            documentId: document.id,
            section: '',
            start: 0,
            end: 0,
            note: `${section.section_type} (not in the asset: text printed directly)`,
            inline: spanDisplayText(canonical.text, span),
          });
        }
      }
    });
    db.close();
  }
}
for (const documentId of kind === 'missed' ? [] : Object.keys(asset.documents)) {
  if (kind === 'pregnancy' || kind === 'mention') {
    for (const sentence of pregnancySentences(index, documentId)) {
      const dedicated = flagsOrigin(sentence.flags) === 0;
      if ((kind === 'pregnancy') !== dedicated) continue;
      rows.push({
        documentId,
        section: sentence.section[0],
        start: sentence.start,
        end: sentence.end,
        note: `topic=${flagsTopic(sentence.flags)} origin=${flagsOrigin(sentence.flags)} match=[${sentence.matchStart},${sentence.matchEnd})`,
      });
    }
  } else {
    for (const sentence of ageSentences(index, documentId)) {
      for (const item of sentence.limits) {
        const isCategory = item.code === LIMIT_CATEGORY;
        const isWeight = item.code >= 3 && !isCategory;
        if (kind === 'age' && (isCategory || isWeight)) continue;
        if (kind === 'weight' && !isWeight) continue;
        if (kind === 'category' && !isCategory) continue;
        rows.push({
          documentId,
          section: sentence.section[0],
          start: sentence.start,
          end: sentence.end,
          note: isCategory
            ? `category=${item.lower} origin=${flagsOrigin(sentence.flags)}`
            : `bounds=[${
                item.code % 3 === 0
                  ? ''
                  : isWeight
                    ? formatWeightTenths(item.lower)
                    : formatAgeDays(item.lower, 'genitive')
              }..${
                item.code % 3 === 1
                  ? ''
                  : isWeight
                    ? formatWeightTenths(item.upper)
                    : formatAgeDays(item.upper, 'genitive')
              }] origin=${flagsOrigin(sentence.flags)}`,
          words: [item.matchStart, item.matchEnd],
        });
      }
    }
  }
}
const random = mulberry(Number(seedText));
const sample: Row[] = [];
const pool = [...rows];
for (let at = 0; at < Number(countText) && pool.length > 0; at += 1) {
  const pick = Math.floor(random() * pool.length);
  sample.push(...pool.splice(pick, 1));
}
console.log(
  `# ${kind}: ${rows.length} candidates, sample ${sample.length}${kind === 'missed' ? `; sentences with a limit in the same documents: ${extractedSentences}` : ''}`,
);
sample.forEach((row, position) => {
  if (row.inline !== undefined) {
    console.log(`\n[${position + 1}] ${row.documentId} ${row.note}`);
    console.log(`    ${row.inline.length > 420 ? `${row.inline.slice(0, 420)}…` : row.inline}`);
    return;
  }
  const text = sectionText(row.documentId, row.section);
  const words = row.words ? text.slice(row.words[0], row.words[1]).replace(/\s+/gu, ' ') : '';
  console.log(
    `\n[${position + 1}] ${row.documentId} ${row.note}${words ? ` words=«${words}»` : ''}`,
  );
  const sentence = spanDisplayText(text, { start: row.start, end: row.end });
  if (row.words && sentence.length > 260) {
    // A long sentence: show the window around the matched words, like the card does.
    const before = spanDisplayText(text, {
      start: Math.max(row.start, row.words[0] - 120),
      end: row.words[0],
    });
    const after = spanDisplayText(text, {
      start: row.words[1],
      end: Math.min(row.end, row.words[1] + 120),
    });
    console.log(`    …${before} [[${words}]] ${after}…`);
  } else {
    console.log(`    ${sentence}`);
  }
});
