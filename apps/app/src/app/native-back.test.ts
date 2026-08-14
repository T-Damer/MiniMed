import { describe, expect, it } from 'vitest';

import { nativeBackAction } from '@/app/native-back';

describe('nativeBackAction', () => {
  it('returns through nested routes before minimizing the search root', () => {
    expect(nativeBackAction('notes/card/records/note', 'notes', true)).toBe('history');
    expect(nativeBackAction('modules/documents', 'modules', true)).toBe('history');
    expect(nativeBackAction('assessments/braverman', 'assessments', false)).toBe('history');
    expect(nativeBackAction('notes', 'notes', false)).toBe('search');
    expect(nativeBackAction('search', 'search', false)).toBe('minimize');
  });
});
