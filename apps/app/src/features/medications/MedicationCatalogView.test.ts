import { describe, expect, it } from 'vitest';

import { shouldHideMedicationCatalog, shouldPreserveMedicationCatalog } from './medication-loading';

describe('shouldPreserveMedicationCatalog', () => {
  it('keeps an already visited catalog mounted while a detail route is active', () => {
    expect(shouldPreserveMedicationCatalog(true, 'allmed:1078')).toBe(true);
  });

  it('does not mount the catalog for a direct detail route before the list was visited', () => {
    expect(shouldPreserveMedicationCatalog(false, 'allmed:1078')).toBe(false);
  });

  it('mounts the catalog when the list route is active', () => {
    expect(shouldPreserveMedicationCatalog(false, null)).toBe(true);
  });
});

describe('shouldHideMedicationCatalog', () => {
  it('hides the preserved catalog while a detail route is active', () => {
    expect(shouldHideMedicationCatalog('allmed:2595')).toBe(true);
  });

  it('shows the catalog on the catalog route', () => {
    expect(shouldHideMedicationCatalog(null)).toBe(false);
  });
});
