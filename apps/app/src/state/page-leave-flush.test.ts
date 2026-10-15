import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { onPageLeave } from '@/state/page-leave-flush';

describe('flush when the page is left', () => {
  let windowEvents: EventTarget;
  let documentEvents: EventTarget & { visibilityState: string };

  beforeEach(() => {
    windowEvents = new EventTarget();
    documentEvents = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    vi.stubGlobal('window', windowEvents);
    vi.stubGlobal('document', documentEvents);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('flushes on pagehide, beforeunload and freeze', () => {
    const flush = vi.fn();
    onPageLeave(flush);
    for (const name of ['pagehide', 'beforeunload', 'freeze']) {
      windowEvents.dispatchEvent(new Event(name));
    }
    expect(flush).toHaveBeenCalledTimes(3);
  });

  it('flushes when the page becomes hidden, not when it is shown', () => {
    const flush = vi.fn();
    onPageLeave(flush);
    documentEvents.dispatchEvent(new Event('visibilitychange'));
    expect(flush).not.toHaveBeenCalled();
    documentEvents.visibilityState = 'hidden';
    documentEvents.dispatchEvent(new Event('visibilitychange'));
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('stops flushing once unregistered', () => {
    const flush = vi.fn();
    const stop = onPageLeave(flush);
    stop();
    windowEvents.dispatchEvent(new Event('pagehide'));
    documentEvents.visibilityState = 'hidden';
    documentEvents.dispatchEvent(new Event('visibilitychange'));
    expect(flush).not.toHaveBeenCalled();
  });
});
