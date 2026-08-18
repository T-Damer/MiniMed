import { describe, expect, it } from 'vitest';

import { hierarchicalParentHash, nativeBackAction } from '@/app/native-back';

describe('nativeBackAction', () => {
  it('returns parent hashes for nested document routes', () => {
    expect(nativeBackAction('modules/documents/collection/regulatory', 'modules', true)).toEqual({
      type: 'parent',
      hash: '#/modules/documents',
    });
    expect(nativeBackAction('modules/documents', 'modules', true)).toEqual({
      type: 'search',
    });
  });

  it('returns parent hashes for the user library catalog and open user documents', () => {
    expect(nativeBackAction('modules/documents/user', 'modules', true)).toEqual({
      type: 'parent',
      hash: '#/modules/documents',
    });
    expect(nativeBackAction('modules/documents/user/user-doc-1', 'modules', true)).toEqual({
      type: 'parent',
      hash: '#/modules/documents/user',
    });
    expect(hierarchicalParentHash('modules/documents/user/user-doc-1')).toBe(
      '#/modules/documents/user',
    );
    expect(hierarchicalParentHash('modules/documents/user/user-doc-1/p/1')).toBe(
      '#/modules/documents/user',
    );
    expect(hierarchicalParentHash('modules/documents/d/token')).toBeNull();
    expect(hierarchicalParentHash('modules/documents/user')).toBe('#/modules/documents');
  });

  it('returns parent hashes for nested assessment routes', () => {
    expect(nativeBackAction('assessments/psychology', 'assessments', false)).toEqual({
      type: 'parent',
      hash: '#/assessments',
    });
    expect(
      nativeBackAction('assessments/psychology/braverman-behavioral-profile', 'assessments', false),
    ).toEqual({
      type: 'parent',
      hash: '#/assessments',
    });
  });

  it('returns parent hashes for nested calculator routes', () => {
    expect(nativeBackAction('calculators/section/anthropometry', 'calculators', false)).toEqual({
      type: 'parent',
      hash: '#/calculators',
    });
    expect(
      nativeBackAction('calculators/body-surface-area-mosteller', 'calculators', false),
    ).toEqual({
      type: 'parent',
      hash: '#/calculators',
    });
    expect(hierarchicalParentHash('calculators/body-surface-area-mosteller')).toBe('#/calculators');
  });

  it('returns through nested routes before minimizing the search root', () => {
    expect(nativeBackAction('notes/card/records/note', 'notes', true)).toEqual({ type: 'history' });
    expect(nativeBackAction('notes', 'notes', false)).toEqual({ type: 'search' });
    expect(nativeBackAction('settings', 'settings', false)).toEqual({ type: 'search' });
    expect(nativeBackAction('settings/downloads', 'settings', false)).toEqual({
      type: 'parent',
      hash: '#/settings',
    });
    expect(nativeBackAction('search', 'search', false)).toEqual({ type: 'minimize' });
  });

  it('uses history for document read pages', () => {
    expect(nativeBackAction('modules/documents/d/abc-token', 'search', true)).toEqual({
      type: 'history',
    });
    expect(nativeBackAction('read/abc-token', 'search', true)).toEqual({ type: 'history' });
    expect(nativeBackAction('read/user/user-doc-1', 'modules', true)).toEqual({ type: 'history' });
  });
});
