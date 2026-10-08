import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDebouncer } from '@/components/debounced-value';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('debouncer', () => {
  it('runs once, with the last arguments, after the calls have stopped', () => {
    const action = vi.fn();
    const debounced = createDebouncer(action, 300);
    debounced.call('a');
    vi.advanceTimersByTime(200);
    debounced.call('ab');
    vi.advanceTimersByTime(200);
    debounced.call('abc');
    vi.advanceTimersByTime(299);
    expect(action).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(action).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledWith('abc');
  });

  it('drops a waiting call when cancelled', () => {
    const action = vi.fn();
    const debounced = createDebouncer(action, 300);
    debounced.call(1);
    debounced.cancel();
    vi.advanceTimersByTime(1000);
    expect(action).not.toHaveBeenCalled();
  });
});
