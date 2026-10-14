import { afterEach, describe, expect, it } from 'vitest';

import { claimOffer, resetOfferClaimsForTests } from './offer-claim';

afterEach(resetOfferClaimsForTests);

describe('offer claims', () => {
  it('lets only the first claimant of a module draw the offer', () => {
    const first = claimOffer('m1', () => undefined);
    const second = claimOffer('m1', () => undefined);
    const third = claimOffer('m1', () => undefined);
    expect([first.isOwner(), second.isOwner(), third.isOwner()]).toEqual([true, false, false]);
  });

  it('keeps offers of different modules independent', () => {
    const a = claimOffer('m1', () => undefined);
    const b = claimOffer('m2', () => undefined);
    expect([a.isOwner(), b.isOwner()]).toEqual([true, true]);
  });

  it('hands the offer to the next claimant when the owner leaves', () => {
    const seen: boolean[] = [];
    const first = claimOffer('m1', () => undefined);
    const second = claimOffer('m1', (owner) => seen.push(owner));
    expect(second.isOwner()).toBe(false);
    first.release();
    expect(second.isOwner()).toBe(true);
    expect(seen).toEqual([true]);
  });

  it('ignores a repeated release and a release of a waiting claimant', () => {
    const first = claimOffer('m1', () => undefined);
    const second = claimOffer('m1', () => undefined);
    second.release();
    second.release();
    expect(first.isOwner()).toBe(true);
    first.release();
    const third = claimOffer('m1', () => undefined);
    expect(third.isOwner()).toBe(true);
  });
});
