/**
 * Builds the ATC name asset of the drug screen from the NSI dictionary fetched by
 * `scripts/fetch-nsi-dictionary.sh`: Russian names of levels 1-4 (level 5 is the substance name
 * the drug data already carries). Output: `apps/app/src/features/medications/atc-names.json`.
 *
 *   bun scripts/build-atc-names.ts [data/raw/nsi/atc]
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const LEVEL_PATTERN = /^[ABCDGHJLMNPRSV](?:\d{2}(?:[A-Z](?:[A-Z])?)?)?$/u;
const EXPECTED_LEVELS = [14, 93, 271, 937] as const;

interface Manifest {
  readonly oid: string;
  readonly version: string;
  readonly publishDate: string;
  readonly rowsCount: number;
  readonly rowsSha256: string;
}

function versionParts(name: string): number[] {
  return name
    .replace(/^v/u, '')
    .split('.')
    .map((part) => Number(part));
}

function latestVersionDir(root: string): string {
  const [latest] = readdirSync(root)
    .filter((name) => /^v\d+(?:\.\d+)*$/u.test(name))
    .sort((a, b) => {
      const left = versionParts(a);
      const right = versionParts(b);
      for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
        const delta = (right[index] ?? 0) - (left[index] ?? 0);
        if (delta !== 0) return delta;
      }
      return 0;
    });
  if (!latest) throw new Error(`no fetched version under ${root}`);
  return join(root, latest);
}

/** «15.07.2025 11:04» → «2025-07-15». */
function isoDate(nsiDate: string): string {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})/u.exec(nsiDate);
  if (!match) throw new Error(`unexpected NSI date: ${nsiDate}`);
  return `${match[3] ?? ''}-${match[2] ?? ''}-${match[1] ?? ''}`;
}

const root = process.argv[2] ?? 'data/raw/nsi/atc';
const dir = latestVersionDir(root);
const manifest = JSON.parse(readFileSync(join(dir, 'MANIFEST.json'), 'utf8')) as Manifest;
const rawRows = JSON.parse(readFileSync(join(dir, 'rows.json'), 'utf8')) as {
  readonly column: string;
  readonly value: string | null;
}[][];

const names: Record<string, string> = {};
const levelCounts = [0, 0, 0, 0];
for (const row of rawRows) {
  const cells = new Map(row.map((cell) => [cell.column, cell.value]));
  const code = cells.get('ATC_CODE')?.trim() ?? '';
  const name = cells.get('ATC_NAME')?.trim() ?? '';
  if (!LEVEL_PATTERN.test(code)) continue;
  if (!name) throw new Error(`${code} has no Russian name`);
  if (code in names) throw new Error(`${code} appears twice`);
  names[code] = name;
  const level = code.length === 1 ? 0 : code.length === 3 ? 1 : code.length === 4 ? 2 : 3;
  levelCounts[level] = (levelCounts[level] ?? 0) + 1;
}
if (levelCounts.join() !== EXPECTED_LEVELS.join()) {
  console.warn(`level counts changed: ${levelCounts.join('/')} (was ${EXPECTED_LEVELS.join('/')})`);
}
for (const code of Object.keys(names)) {
  const parent = code.length === 3 ? code.slice(0, 1) : code.length > 3 ? code.slice(0, -1) : null;
  if (parent && !(parent in names)) throw new Error(`${code} has no parent ${parent}`);
}

const sorted = Object.fromEntries(Object.entries(names).sort(([a], [b]) => a.localeCompare(b)));
const asset = {
  source: 'НСИ Минздрава, справочник АТХ',
  oid: manifest.oid,
  version: manifest.version,
  publishDate: isoDate(manifest.publishDate),
  sourceSha256: manifest.rowsSha256,
  names: sorted,
};
const target = 'apps/app/src/features/medications/atc-names.json';
if (!existsSync('apps/app/src/features/medications')) throw new Error('run from the repo root');
writeFileSync(target, `${JSON.stringify(asset, null, 2)}\n`);
console.log(
  `${target}: ${String(Object.keys(sorted).length)} names, version ${manifest.version}, ${String(JSON.stringify(asset).length)} chars`,
);
