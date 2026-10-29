import { describe, expect, it } from 'vitest';

import { nextFrameHealth } from './frame-health';

describe('frame health', () => {
  it('turns worse at once', () => {
    expect(nextFrameHealth('good', { blockedFraction: 0.05 }, 0).health).toBe('strained');
    expect(nextFrameHealth('good', { blockedFraction: 0.2 }, 0).health).toBe('poor');
  });

  it('turns better only after two calm windows', () => {
    const first = nextFrameHealth('poor', { blockedFraction: 0 }, 0);
    expect(first.health).toBe('poor');
    const second = nextFrameHealth(first.health, { blockedFraction: 0 }, first.calmWindows);
    expect(second.health).toBe('good');
  });

  it('a worse window resets the calm count', () => {
    const calm = nextFrameHealth('strained', { blockedFraction: 0 }, 0);
    const again = nextFrameHealth(calm.health, { blockedFraction: 0.06 }, calm.calmWindows);
    expect(again).toEqual({ health: 'strained', calmWindows: 0 });
  });
});
