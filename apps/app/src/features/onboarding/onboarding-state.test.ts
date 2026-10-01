import { describe, expect, it } from 'vitest';
import { onboardingRestartRequests, restartOnboarding } from './onboarding-state';

describe('restartOnboarding', () => {
  it('raises the request counter the app shell watches, once per call', () => {
    const before = onboardingRestartRequests();
    restartOnboarding();
    expect(onboardingRestartRequests()).toBe(before + 1);
    restartOnboarding();
    expect(onboardingRestartRequests()).toBe(before + 2);
  });
});
