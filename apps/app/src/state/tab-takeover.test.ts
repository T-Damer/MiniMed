import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  installTakeoverListener,
  isStandbyTab,
  requestTakeover,
  resumeFromStandby,
} from '@/state/tab-takeover';

/** Tabs of one browser: a message posted on a channel reaches the other instances of its name. */
const channels = new Set<FakeChannel>();

class FakeChannel {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  constructor(readonly name: string) {
    channels.add(this);
  }
  postMessage(data: unknown): void {
    for (const channel of channels) {
      if (channel !== this && channel.name === this.name) {
        channel.onmessage?.({ data } as MessageEvent<unknown>);
      }
    }
  }
  close(): void {
    channels.delete(this);
  }
}

const session = new Map<string, string>();
const reload = vi.fn();

beforeEach(() => {
  session.clear();
  reload.mockClear();
  vi.stubGlobal('BroadcastChannel', FakeChannel);
  vi.stubGlobal('window', {
    sessionStorage: {
      getItem: (key: string) => session.get(key) ?? null,
      setItem: (key: string, value: string) => session.set(key, value),
      removeItem: (key: string) => session.delete(key),
    },
    location: { reload },
  });
});

afterEach(() => {
  channels.clear();
  vi.unstubAllGlobals();
});

describe('tab takeover', () => {
  it('the owner stands by and reloads when another tab asks for the database', () => {
    const stop = installTakeoverListener({ isWaiting: () => false, reload });
    // The asking tab: another channel instance (a different tab) posts the request.
    const other = new FakeChannel('minimed-tab-takeover');
    other.postMessage({ type: 'takeover', from: 'another-tab' });
    expect(isStandbyTab()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    stop();
  });

  it('a tab that is itself waiting for the database does not yield', () => {
    const stop = installTakeoverListener({ isWaiting: () => true, reload });
    new FakeChannel('minimed-tab-takeover').postMessage({ type: 'takeover', from: 'another-tab' });
    expect(isStandbyTab()).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    stop();
  });

  it('a tab already on standby ignores a second request, and strangers on other channels are ignored', () => {
    const stop = installTakeoverListener({ isWaiting: () => false, reload });
    new FakeChannel('something-else').postMessage({ type: 'takeover', from: 'x' });
    new FakeChannel('minimed-tab-takeover').postMessage({ type: 'nonsense' });
    expect(reload).not.toHaveBeenCalled();
    new FakeChannel('minimed-tab-takeover').postMessage({ type: 'takeover', from: 'a' });
    new FakeChannel('minimed-tab-takeover').postMessage({ type: 'takeover', from: 'b' });
    expect(reload).toHaveBeenCalledTimes(1);
    stop();
  });

  it('asking for the database posts a request the owner tab can read', () => {
    const received: unknown[] = [];
    const listener = new FakeChannel('minimed-tab-takeover');
    listener.onmessage = (event) => received.push(event.data);
    requestTakeover();
    expect(received).toEqual([{ type: 'takeover', from: expect.any(String) }]);
  });

  it('a standby tab that resumes clears its mark, asks the owner to yield and reloads', () => {
    const received: unknown[] = [];
    const listener = new FakeChannel('minimed-tab-takeover');
    listener.onmessage = (event) => received.push(event.data);
    session.set('minimed:standby-tab', '1');
    expect(isStandbyTab()).toBe(true);
    resumeFromStandby();
    expect(isStandbyTab()).toBe(false);
    expect(received).toHaveLength(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
