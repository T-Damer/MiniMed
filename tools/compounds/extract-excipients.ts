/**
 * Counts the component names that the «Состав» sections of the GRLS instruction modules list
 * (excipients, coating and capsule parts included), per instruction document.
 *
 *   bun tools/compounds/extract-excipients.ts [--tmp DIR] [--modules DIR] [--out FILE]
 *
 * Reads `data/build/grls-instruction-modules/zst/*.db.zst` (never modified): each module is
 * decompressed with `zstd` into a temporary directory that is removed afterwards. Output (default
 * `data/raw/compounds/excipient-items.json`, gitignored): normalized key → number of documents,
 * with the most common spellings, so `excipients.curated.json` can be reviewed against real text.
 */
import { Database } from 'bun:sqlite';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type CompositionRole,
  splitCompositionItems,
} from '../../apps/app/src/features/medications/compounds/composition-items';
import { normalizeCompoundName } from '../../apps/app/src/features/medications/compounds/compound-name';

const ROOT = join(import.meta.dirname, '..', '..');

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

interface Tally {
  documents: number;
  roles: Record<CompositionRole, number>;
  spellings: Map<string, number>;
}

const modulesDir = argument('modules', join(ROOT, 'data/build/grls-instruction-modules/zst'));
const outFile = argument('out', join(ROOT, 'data/raw/compounds/excipient-items.json'));
const tmpRoot = mkdtempSync(join(argument('tmp', tmpdir()), 'compounds-extract-'));

const tallies = new Map<string, Tally>();
let documents = 0;
let documentsWithComposition = 0;
let documentsWithItems = 0;

function sectionTexts(db: Database): Map<string, string> {
  const rows = db
    .query<
      {
        document_id: string;
        section_id: string;
        title: string;
        parent: string | null;
        text: string;
      },
      []
    >(
      `SELECT v.document_id AS document_id, s.id AS section_id, s.title AS title,
              s.parent_section_id AS parent, s.normalized_title AS normalized,
              COALESCE((SELECT group_concat(original_text, char(10))
                        FROM (SELECT original_text FROM chunks c WHERE c.section_id = s.id
                              ORDER BY c.order_index)), '') AS text
       FROM sections s JOIN document_versions v ON v.id = s.document_version_id
       ORDER BY v.document_id, s.order_index`,
    )
    .all();
  const wanted = new Set<string>();
  const pick = (title: string, normalized: string) =>
    /^состав/u.test(normalized) || /вспомогательн|ингредиент/u.test(title.toLowerCase());
  const byId = new Map(rows.map((row) => [row.section_id, row]));
  for (const row of rows) {
    const normalized = (row as unknown as { normalized: string }).normalized;
    if (pick(row.title, normalized)) wanted.add(row.section_id);
  }
  for (const row of rows) {
    if (row.parent && wanted.has(row.parent) && !wanted.has(row.section_id)) {
      const parent = byId.get(row.parent);
      if (parent) wanted.add(row.section_id);
    }
  }
  const perDocument = new Map<string, string>();
  for (const row of rows) {
    if (!wanted.has(row.section_id)) continue;
    const previous = perDocument.get(row.document_id) ?? '';
    perDocument.set(row.document_id, `${previous}\n\n${row.title}:\n${row.text}`);
  }
  return perDocument;
}

function tally(text: string): boolean {
  const seen = new Set<string>();
  for (const item of splitCompositionItems(text)) {
    const key = normalizeCompoundName(item.text);
    if (key.length < 3) continue;
    const entry = tallies.get(key) ?? {
      documents: 0,
      roles: { active: 0, excipient: 0, unknown: 0 },
      spellings: new Map<string, number>(),
    };
    entry.roles[item.role] += 1;
    const spelling = item.text.replace(/\s+/gu, ' ');
    entry.spellings.set(spelling, (entry.spellings.get(spelling) ?? 0) + 1);
    if (!seen.has(key)) {
      entry.documents += 1;
      seen.add(key);
    }
    tallies.set(key, entry);
  }
  return seen.size > 0;
}

try {
  const modules = readdirSync(modulesDir)
    .filter((name) => name.endsWith('.db.zst'))
    .sort();
  for (const name of modules) {
    const target = join(tmpRoot, name.replace(/\.zst$/u, ''));
    const unpack = Bun.spawnSync(['zstd', '-dcq', join(modulesDir, name)], {
      stdout: Bun.file(target),
    });
    if (unpack.exitCode !== 0) throw new Error(`zstd failed for ${name}`);
    const db = new Database(target, { readonly: true });
    const texts = sectionTexts(db);
    const total = db.query<{ n: number }, []>('SELECT count(*) AS n FROM documents').get()?.n ?? 0;
    documents += total;
    for (const text of texts.values()) {
      documentsWithComposition += 1;
      if (tally(text)) documentsWithItems += 1;
    }
    db.close();
    rmSync(target);
    console.error(`${name}: ${total} documents, ${texts.size} with a «Состав» section`);
  }
} finally {
  rmSync(tmpRoot, { recursive: true, force: true });
}

const items = [...tallies.entries()]
  .map(([key, entry]) => ({
    key,
    documents: entry.documents,
    roles: entry.roles,
    spellings: [...entry.spellings.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([text, count]) => ({ text, count })),
  }))
  .sort((a, b) => b.documents - a.documents || a.key.localeCompare(b.key, 'ru'));

mkdirSync(join(outFile, '..'), { recursive: true });
const totalOccurrences = items.reduce((sum, item) => sum + item.documents, 0);
writeFileSync(
  outFile,
  `${JSON.stringify({
    documents,
    documentsWithComposition,
    documentsWithItems,
    keys: items.length,
    totalOccurrences,
    items,
  })}\n`,
);
console.error(
  `${documents} documents, ${documentsWithComposition} with composition text, ${documentsWithItems} with items, ${items.length} keys (${items.filter((i) => i.documents >= 2).length} in ≥2 documents)`,
);
