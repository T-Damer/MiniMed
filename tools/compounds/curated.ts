/** Readers of the reviewed lists in this directory. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface CuratedExcipient {
  id: string;
  ru: string;
  en: string;
  aliases: string[];
  functions: string[];
}

export interface ExtraActive {
  ru: string;
  en: string;
  aliases: string[];
}

function rows(file: string): string[][] {
  const path = join(import.meta.dirname, file);
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() && !line.startsWith('#'))
    .map((line) => line.split('|').map((cell) => cell.trim()));
}

const list = (cell: string | undefined) =>
  (cell ?? '')
    .split(/[;,]/u)
    .map((part) => part.trim())
    .filter(Boolean);

export function readCuratedExcipients(): CuratedExcipient[] {
  return rows('excipients.curated.tsv').map((cells) => {
    const [id, ru, en, aliases, functions] = cells;
    if (!id || !ru || !en)
      throw new Error(`excipients.curated.tsv: incomplete row ${cells.join('|')}`);
    return {
      id,
      ru,
      en,
      aliases: (aliases ?? '')
        .split(';')
        .map((alias) => alias.trim())
        .filter(Boolean),
      functions: list(functions),
    };
  });
}

/** Active substances whose Russian name has no ATC route to Wikidata: `ru | en | aliases`. */
export function readExtraActives(): ExtraActive[] {
  return rows('actives-extra.tsv').map(([ru, en, aliases]) => {
    if (!ru || !en) throw new Error('actives-extra.tsv: incomplete row');
    return {
      ru,
      en,
      aliases: (aliases ?? '')
        .split(';')
        .map((alias) => alias.trim())
        .filter(Boolean),
    };
  });
}
