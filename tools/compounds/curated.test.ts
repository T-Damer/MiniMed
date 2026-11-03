import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { normalizeCompoundName } from '../../apps/app/src/features/medications/compounds/compound-name';
import { readCuratedExcipients, readExtraActives } from './curated';

const functions = JSON.parse(
  readFileSync(join(import.meta.dirname, 'excipient-functions.json'), 'utf8'),
) as Record<string, string>;

describe('excipients.curated.tsv', () => {
  const entries = readCuratedExcipients();

  it('has unique ids and complete rows', () => {
    expect(entries.length).toBeGreaterThan(200);
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(entries.length);
    for (const entry of entries) {
      expect(entry.id, entry.id).toMatch(/^[a-z0-9-]+$/u);
      expect(entry.functions.length, entry.id).toBeGreaterThan(0);
    }
  });

  it('uses only declared function ids', () => {
    for (const entry of entries) {
      for (const id of entry.functions) expect(functions[id], `${entry.id}: ${id}`).toBeTruthy();
    }
  });

  it('never gives two entries the same normalized name', () => {
    const owner = new Map<string, string>();
    const clashes: string[] = [];
    for (const entry of entries) {
      for (const name of [entry.ru, ...entry.aliases]) {
        const key = normalizeCompoundName(name);
        expect(key, `${entry.id}: «${name}» normalizes to nothing`).not.toBe('');
        const known = owner.get(key);
        if (known !== undefined && known !== entry.id)
          clashes.push(`${key}: ${known} / ${entry.id}`);
        owner.set(key, entry.id);
      }
    }
    expect(clashes).toEqual([]);
  });
});

describe('actives-extra.tsv', () => {
  it('names each substance with an English alternative for Wikidata', () => {
    for (const entry of readExtraActives())
      expect(entry.en, entry.ru).toMatch(/^[\p{L}\d ()/,'-]+$/u);
  });
});
