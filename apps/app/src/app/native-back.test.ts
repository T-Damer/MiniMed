import { describe, expect, it } from 'vitest';

import { hierarchicalParentHash, nativeBackTargets } from '@/app/native-back';

const parent = (hash: string) => ({ parentHash: hash, homeHash: null });
const home = { parentHash: null, homeHash: '#/search' };

describe('nativeBackTargets (used only when the history has no app entry below)', () => {
  it('returns parent hashes for nested document routes', () => {
    expect(nativeBackTargets('modules/documents/collection/regulatory')).toEqual(
      parent('#/modules/documents'),
    );
    expect(nativeBackTargets('modules/documents')).toEqual(home);
  });

  it('returns parent hashes for the user library catalog and open user documents', () => {
    expect(nativeBackTargets('modules/documents/user')).toEqual(parent('#/modules/documents'));
    expect(nativeBackTargets('modules/documents/user/user-doc-1')).toEqual(
      parent('#/modules/documents/user'),
    );
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
    expect(nativeBackTargets('assessments/psychology')).toEqual(parent('#/assessments'));
    expect(nativeBackTargets('assessments/psychology/braverman-behavioral-profile')).toEqual(
      parent('#/assessments/psychology/self-reflection'),
    );
  });

  it('returns parent hashes for nested calculator routes', () => {
    expect(nativeBackTargets('calculators/section/anthropometry')).toEqual(parent('#/calculators'));
    expect(nativeBackTargets('calculators/body-surface-area-mosteller')).toEqual(
      parent('#/calculators/section/anthropometry'),
    );
    expect(hierarchicalParentHash('calculators/body-surface-area-mosteller')).toBe(
      '#/calculators/section/anthropometry',
    );
  });

  it('returns compact tool pages to search but keeps result-to-questionnaire navigation', () => {
    expect(nativeBackTargets('assessments/psychology/braverman-behavioral-profile', false)).toEqual(
      parent('#/search'),
    );
    expect(nativeBackTargets('assessments/mine/new', false)).toEqual(parent('#/search'));
    expect(nativeBackTargets('calculators/body-surface-area-mosteller', false)).toEqual(
      parent('#/search'),
    );
    expect(
      nativeBackTargets(
        'assessments/psychology/braverman-behavioral-profile/results/record',
        false,
      ),
    ).toEqual(parent('#/assessments/psychology/braverman-behavioral-profile'));
  });

  it('goes to the home tab from another tab root and exits only from the home tab', () => {
    expect(nativeBackTargets('notes')).toEqual(home);
    expect(nativeBackTargets('settings')).toEqual(home);
    expect(nativeBackTargets('settings/downloads')).toEqual(parent('#/settings'));
    expect(nativeBackTargets('settings/images/reference')).toEqual(parent('#/settings/images'));
    expect(nativeBackTargets('search')).toEqual({ parentHash: null, homeHash: null });
  });

  it('returns news sub-routes to the list and the list to search', () => {
    expect(nativeBackTargets('news/item/i-1')).toEqual(parent('#/news'));
    expect(nativeBackTargets('news/site/s-1')).toEqual(parent('#/news'));
    expect(nativeBackTargets('news/add')).toEqual(parent('#/news'));
    expect(nativeBackTargets('news/sources')).toEqual(parent('#/news'));
    expect(nativeBackTargets('news')).toEqual(home);
  });

  it('sends a deep-linked document, with no history below, to the home tab', () => {
    expect(nativeBackTargets('modules/documents/d/abc-token')).toEqual(home);
    expect(nativeBackTargets('read/abc-token')).toEqual(home);
  });
});
