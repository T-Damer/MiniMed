/**
 * One download offer per missing module on a screen. Components that would show the same
 * «Скачать» for the same module (a pair card, the comparison header, a drug column) claim it in
 * creation order; only the earliest claimant draws the offer, and the next one takes over when it
 * leaves the screen. Pure bookkeeping, no DOM: the component keeps the result in a signal.
 */
type Listener = (owner: boolean) => void;

interface Claimant {
  readonly listener: Listener;
}

const claimants = new Map<string, Claimant[]>();

function notify(moduleId: string): void {
  const queue = claimants.get(moduleId) ?? [];
  for (const [index, claimant] of queue.entries()) claimant.listener(index === 0);
}

export interface OfferClaim {
  /** Whether this claimant is the one that draws the offer right now. */
  readonly isOwner: () => boolean;
  readonly release: () => void;
}

export function claimOffer(moduleId: string, listener: Listener): OfferClaim {
  const claimant: Claimant = { listener };
  const queue = claimants.get(moduleId) ?? [];
  queue.push(claimant);
  claimants.set(moduleId, queue);
  let released = false;
  return {
    isOwner: () => claimants.get(moduleId)?.[0] === claimant,
    release: () => {
      if (released) return;
      released = true;
      const current = (claimants.get(moduleId) ?? []).filter((item) => item !== claimant);
      if (current.length === 0) claimants.delete(moduleId);
      else claimants.set(moduleId, current);
      notify(moduleId);
    },
  };
}

export function resetOfferClaimsForTests(): void {
  claimants.clear();
}
