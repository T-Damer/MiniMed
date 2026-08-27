import { describe, expect, it } from 'vitest';

import { normalizeUserLibraryName, USER_LIBRARY_NAME_MAX_LENGTH } from '@/state/user-library';

describe('user library names', () => {
  it('accepts 256 characters and rejects longer or path-like names', () => {
    const valid = 'я'.repeat(USER_LIBRARY_NAME_MAX_LENGTH);
    expect(normalizeUserLibraryName(valid, 'folder')).toBe(valid);
    expect(() => normalizeUserLibraryName(`${valid}я`, 'file')).toThrow('256');
    expect(() => normalizeUserLibraryName('folder/name', 'folder')).toThrow('недопустимый');
  });
});
