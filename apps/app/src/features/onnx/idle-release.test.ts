import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createIdleRelease } from '@/features/onnx/idle-release';

describe('createIdleRelease', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('releases once the idle time has passed', () => {
    const release = vi.fn();
    const idle = createIdleRelease(release, 1000);
    idle.idle();
    vi.advanceTimersByTime(999);
    expect(release).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('keeps the worker while work keeps arriving', () => {
    const release = vi.fn();
    const idle = createIdleRelease(release, 1000);
    idle.idle();
    vi.advanceTimersByTime(900);
    idle.busy();
    vi.advanceTimersByTime(5000);
    expect(release).not.toHaveBeenCalled();
    idle.idle();
    vi.advanceTimersByTime(1000);
    expect(release).toHaveBeenCalledTimes(1);
  });
});
