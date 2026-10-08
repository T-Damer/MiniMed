import { describe, expect, it } from 'vitest';

import { listFormSchemas } from '@/features/forms/form-registry';
import { fieldHasRule } from '@/features/forms/form-view-model';

describe('which fields get a «?» for their fill rule', () => {
  it('shows it for a field the order governs and hides it for one it leaves undefined', () => {
    let governed = 0;
    let undefinedFields = 0;
    for (const schema of listFormSchemas()) {
      for (const field of schema.fields) {
        const has = fieldHasRule(schema, field);
        expect(has, `${schema.id} ${field.id}`).toBe(field.rule.status !== 'undefined');
        if (has) governed += 1;
        else undefinedFields += 1;
      }
    }
    expect(governed).toBeGreaterThan(0);
    expect(undefinedFields).toBeGreaterThan(0);
  });
});
