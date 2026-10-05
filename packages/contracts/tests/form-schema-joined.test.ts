import { describe, expect, it } from 'vitest';

import { FormSegmentSchema } from '../src/form-schema';

describe('form layout: joined segments', () => {
  it('accepts a joined text segment and a joined options segment', () => {
    expect(FormSegmentSchema.parse({ kind: 'text', text: '(', joined: true })).toMatchObject({
      joined: true,
    });
    expect(
      FormSegmentSchema.parse({
        kind: 'options',
        fieldId: 'injuryKind',
        separator: ', ',
        joined: true,
      }),
    ).toMatchObject({ joined: true });
  });

  it('rejects a non-boolean joined flag', () => {
    expect(FormSegmentSchema.safeParse({ kind: 'text', text: '(', joined: 'yes' }).success).toBe(
      false,
    );
  });
});
