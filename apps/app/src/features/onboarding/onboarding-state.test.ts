import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HAND_OFF_WAIT_MS,
  handOffToOnboarding,
  onboardingRestartRequests,
  registerOnboardingHandOff,
  restartOnboarding,
} from './onboarding-state';

describe('restartOnboarding', () => {
  it('raises the request counter the app shell watches, once per call', () => {
    const before = onboardingRestartRequests();
    restartOnboarding();
    expect(onboardingRestartRequests()).toBe(before + 1);
    restartOnboarding();
    expect(onboardingRestartRequests()).toBe(before + 2);
  });
});

describe('hand-off from the splash', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('delegates to the registered hand-off and passes the surface remover on', async () => {
    const remove = vi.fn();
    const unregister = registerOnboardingHandOff(async (removeSurface) => {
      removeSurface();
      return true;
    });
    expect(await handOffToOnboarding(remove)).toBe(true);
    expect(remove).toHaveBeenCalledOnce();
    unregister();
  });

  it('waits for a late registration', async () => {
    vi.useFakeTimers();
    const pending = handOffToOnboarding(() => undefined);
    await vi.advanceTimersByTimeAsync(300);
    const unregister = registerOnboardingHandOff(async () => true);
    await expect(pending).resolves.toBe(true);
    unregister();
  });

  it('gives up after the wait so the shell can fade the surface out', async () => {
    vi.useFakeTimers();
    const pending = handOffToOnboarding(() => undefined);
    await vi.advanceTimersByTimeAsync(HAND_OFF_WAIT_MS + 10);
    await expect(pending).resolves.toBe(false);
  });
});
