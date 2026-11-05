import { describe, expect, it } from 'bun:test';

import { newInviteCode } from './invites';

describe('invite codes', () => {
  it('are grouped capitals without look-alikes', () => {
    const code = newInviteCode();
    expect(code).toMatch(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/u);
  });
});
