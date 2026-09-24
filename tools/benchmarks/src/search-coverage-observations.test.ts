import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('search coverage observations', () => {
  it('keeps user-reported observations explicit and free of patient text', () => {
    const path = resolve(import.meta.dirname, '../search-coverage-observations.json');
    const rows = JSON.parse(readFileSync(path, 'utf8')) as {
      id: string;
      query: string;
      origin: string;
      expectedTerms: string[];
    }[];

    expect(rows.some((row) => row.id === 'reported.jaspers' && row.query === 'Ясперс')).toBe(true);
    expect(rows.every((row) => row.query.length <= 32)).toBe(true);
    expect(rows.every((row) => row.expectedTerms.length > 0)).toBe(true);
  });
});
