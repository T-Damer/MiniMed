/**
 * Name agreement between a substance of the drug data and an ATC code or a Wikidata item. ЕСКЛП
 * cards carry stale or neighbouring ATC codes, and a wrong match would show another molecule's
 * structure, so a code or an item is used only when a name confirms it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  dropSalt,
  normalizeCompoundName,
} from '../../apps/app/src/features/medications/compounds/compound-name';

const ROOT = join(import.meta.dirname, '..', '..');

export interface NsiName {
  ru: string;
  en: string;
}

export function loadNsiNames(): Map<string, NsiName> {
  const universe = JSON.parse(
    readFileSync(join(ROOT, 'data/raw/compounds/actives-universe.json'), 'utf8'),
  ) as { atcSource: string };
  const rows = JSON.parse(readFileSync(universe.atcSource, 'utf8')) as {
    column: string;
    value: string | null;
  }[][];
  const names = new Map<string, NsiName>();
  for (const row of rows) {
    const get = (column: string) => row.find((cell) => cell.column === column)?.value ?? '';
    const code = get('ATC_CODE');
    if (code.length === 7) {
      names.set(code, {
        ru: get('ATC_NAME').toLowerCase().replaceAll('ё', 'е'),
        en: get('ATC_NAME_ENG').toLowerCase(),
      });
    }
  }
  return names;
}

function distance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) {
      row[j] = Math.min(
        (previous[j] as number) + 1,
        (row[j - 1] as number) + 1,
        (previous[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = row;
  }
  return previous[b.length] as number;
}

/** The same substance up to salt/hydration words, token order and one slip of spelling. */
export function agrees(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const left = dropSalt(normalizeCompoundName(a));
  const right = dropSalt(normalizeCompoundName(b));
  if (!left || !right) return false;
  if (left === right) return true;
  const longer = Math.max(left.length, right.length);
  return longer >= 8 && distance(left, right) <= (longer >= 14 ? 2 : 1);
}
