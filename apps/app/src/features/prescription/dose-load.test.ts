import { describe, expect, it } from 'vitest';

import doseRulesJson from '@/features/prescription/data/dose-rules-index.json';
import { parseDoseRuleIndex, trustBundledDoseRuleIndex } from '@/features/prescription/dose-index';

/**
 * The app reads the bundled dose-rule index without the schema pass. This is what makes that safe:
 * the schema accepts the file and returns it unchanged.
 */
describe('bundled dose-rule index', () => {
  it('passes the schema and comes back unchanged', () => {
    expect(parseDoseRuleIndex(doseRulesJson)).toEqual(doseRulesJson);
  });

  it('is the same object through the trusted path, and a broken file is still refused', () => {
    expect(trustBundledDoseRuleIndex(doseRulesJson)).toBe(doseRulesJson);
    expect(() => trustBundledDoseRuleIndex({ modules: [] })).toThrow();
    expect(() =>
      trustBundledDoseRuleIndex({
        modules: [],
        cards: [],
        documents: { broken: { rules: [], sec: [], m: 3, c: [] } },
      }),
    ).toThrow(/no module/u);
  });
});
