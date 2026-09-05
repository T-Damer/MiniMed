import { describe, expect, it } from 'vitest';

import {
  conditionCatalogHash,
  isConditionCatalogRoute,
  parseConditionCatalogRoute,
} from './condition-routing';

describe('condition catalog routing', () => {
  it('recognizes the catalog, tabs, and entries', () => {
    expect(isConditionCatalogRoute('#/modules/documents/conditions')).toBe(true);
    expect(parseConditionCatalogRoute('#/modules/documents/conditions')).toEqual({
      section: 'diseases',
      entryId: null,
    });
    expect(parseConditionCatalogRoute(conditionCatalogHash('symptoms', 'code:R51'))).toEqual({
      section: 'symptoms',
      entryId: 'code:R51',
    });
    expect(parseConditionCatalogRoute(conditionCatalogHash('syndromes', 'code:E80.4'))).toEqual({
      section: 'syndromes',
      entryId: 'code:E80.4',
    });
    expect(isConditionCatalogRoute('#/modules/documents/medications')).toBe(false);
  });
});
