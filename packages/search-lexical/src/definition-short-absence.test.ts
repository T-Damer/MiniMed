import { describe, expect, it } from 'vitest';
import { planDefinitionDescription } from './definition-description';

describe('short descriptions with explicit absence', () => {
  it.each(['запахи не ощущаются', 'зрительное восприятие отсутствует', 'боли в животе нет'])(
    'requires evidence even with a one-result limit: %s',
    (query) => {
      const plan = planDefinitionDescription(query);
      expect(plan?.terms).toHaveLength(2);
      expect(plan?.descriptive).toBe(true);
      expect(plan?.terms.some((term) => term.absent)).toBe(true);
    },
  );
});
