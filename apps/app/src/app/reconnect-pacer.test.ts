import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createReconnectPacer } from '@/app/reconnect-pacer';

describe('createReconnectPacer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = () => {
    let pending = true;
    const reconnect = vi.fn();
    const pacer = createReconnectPacer({
      reconnect,
      hasPendingInstalls: () => pending,
      minGapMs: 1000,
      now: () => Date.now(),
    });
    return { pacer, reconnect, setPending: (value: boolean) => (pending = value) };
  };

  it('rebuilds at once when nothing else is installing', () => {
    const { pacer, reconnect, setPending } = setup();
    setPending(false);
    pacer.request();
    pacer.request();
    expect(reconnect).toHaveBeenCalledTimes(2);
  });

  it('rebuilds once per gap while a queue is running', () => {
    const { pacer, reconnect } = setup();
    pacer.request();
    expect(reconnect).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(300);
    pacer.request();
    pacer.request();
    expect(reconnect).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(700);
    expect(reconnect).toHaveBeenCalledTimes(2);
  });

  it('connects the last module of a queue without waiting, and drops the pending timer', () => {
    const { pacer, reconnect, setPending } = setup();
    pacer.request();
    vi.advanceTimersByTime(100);
    pacer.request();
    setPending(false);
    pacer.request();
    expect(reconnect).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(5000);
    expect(reconnect).toHaveBeenCalledTimes(2);
  });

  it('does nothing after dispose', () => {
    const { pacer, reconnect } = setup();
    pacer.request();
    pacer.request();
    pacer.dispose();
    vi.advanceTimersByTime(5000);
    expect(reconnect).toHaveBeenCalledTimes(1);
  });
});
