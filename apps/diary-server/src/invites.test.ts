import { describe, expect, it } from 'bun:test';

import { inviteCandidates, newInviteCode } from './invites';

describe('invite codes', () => {
  it('are grouped capitals without look-alikes', () => {
    const code = newInviteCode();
    expect(code).toMatch(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/u);
  });

  it('match however they are typed, and older mixed-case codes still match exactly', () => {
    expect(inviteCandidates(' k7mp 2qxr-9htn ')).toContain('K7MP-2QXR-9HTN');
    expect(inviteCandidates('vNbk13Yz-gUv')).toContain('vNbk13Yz-gUv');
  });
});
