import { describe, expect, it } from 'vitest';

import type { SearchScope } from '@/features/search/ScopedMedicalCore';
import { searchSectionFromHash, searchSectionHash } from '@/features/search/search-section-route';

const known = new Set(['all', 'guidelines', 'medications', 'diagnosis', 'icd11']);
const isSection = (value: string): value is SearchScope => known.has(value);

describe('search section route', () => {
  it('writes and reads a section hash', () => {
    expect(searchSectionHash('guidelines')).toBe('#/search/section/guidelines');
    expect(searchSectionFromHash('#/search/section/guidelines', isSection)).toBe('guidelines');
    expect(searchSectionFromHash('#/search/section/medications/', isSection)).toBe('medications');
  });

  it('reads an id with digits and keeps the typed query beside it', () => {
    expect(searchSectionHash('icd11')).toBe('#/search/section/icd11');
    expect(searchSectionFromHash('#/search/section/icd11', isSection)).toBe('icd11');
    expect(searchSectionFromHash('#/search/section/icd11?q=BA41', isSection)).toBe('icd11');
  });

  it('treats the list, the analysis switch, unknown ids and other routes as no section', () => {
    expect(searchSectionFromHash('#/search/section/all', isSection)).toBeUndefined();
    expect(searchSectionFromHash('#/search/section/diagnosis', isSection)).toBeUndefined();
    expect(searchSectionFromHash('#/search/section/nope', isSection)).toBeUndefined();
    expect(searchSectionFromHash('#/search', isSection)).toBeUndefined();
    expect(searchSectionFromHash('', isSection)).toBeUndefined();
  });
});
