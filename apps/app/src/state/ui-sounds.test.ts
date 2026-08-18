import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockPlayer = {
  unlock: vi.fn(async () => true),
  play: vi.fn(() => ({ stop: vi.fn(), ended: Promise.resolve() })),
  preload: vi.fn(async () => undefined),
  setPack: vi.fn(),
  getPack: vi.fn(() => 'zen'),
  setVolume: vi.fn(),
  getVolume: vi.fn(() => 0.2),
  setEnabled: vi.fn(),
  isEnabled: vi.fn(() => true),
  stopAll: vi.fn(),
  destroy: vi.fn(async () => undefined),
};

vi.mock('uisfx', () => ({
  createUISFX: vi.fn(() => mockPlayer),
}));

function installLocalStorageMock(finePointer = true): void {
  const store = new Map<string, string>();
  const listeners = new Map<string, Set<EventListener>>();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    },
    matchMedia: (query: string) => ({
      matches: finePointer && query.includes('hover: hover') && query.includes('pointer: fine'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
    dispatchEvent: (event: Event) => {
      for (const listener of listeners.get(event.type) ?? []) {
        listener(event);
      }
      return true;
    },
    addEventListener: (type: string, listener: EventListener) => {
      const bucket = listeners.get(type) ?? new Set<EventListener>();
      bucket.add(listener);
      listeners.set(type, bucket);
    },
    removeEventListener: (type: string, listener: EventListener) => {
      listeners.get(type)?.delete(listener);
    },
  });
}

describe('UiSoundController', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    installLocalStorageMock();
    const { resetUiSoundsForTests } = await import('@/state/ui-sounds');
    resetUiSoundsForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates the zen player with default volume', async () => {
    const { createUISFX } = await import('uisfx');
    await import('@/state/ui-sounds');
    expect(createUISFX).toHaveBeenCalledWith({
      pack: 'zen',
      volume: 0.2,
      enabled: true,
    });
  });

  it('disables and stops playback at volume zero', async () => {
    const { setSoundVolume } = await import('@/state/app-preferences');
    const { uiSounds } = await import('@/state/ui-sounds');
    uiSounds.ensurePreferences();
    mockPlayer.setEnabled.mockClear();
    setSoundVolume(0);
    uiSounds.play('press');
    expect(mockPlayer.setEnabled).toHaveBeenCalledWith(false);
    expect(mockPlayer.stopAll).toHaveBeenCalled();
    expect(mockPlayer.play).not.toHaveBeenCalled();
  });

  it('unlocks and preloads common cues after the first play', async () => {
    const { uiSounds } = await import('@/state/ui-sounds');
    uiSounds.play('select');
    expect(mockPlayer.unlock).toHaveBeenCalled();
    await Promise.resolve();
    expect(mockPlayer.preload).toHaveBeenCalledWith([
      'hover',
      'press',
      'select',
      'open',
      'forward',
      'back',
      'delete',
      'send',
      'start',
      'close',
      'check',
      'info',
      'warning',
      'snap',
      'swipe',
      'volume-change',
      'toggle-on',
      'toggle-off',
    ]);
  });

  it('plays hover once per control on a fine pointer', async () => {
    const { uiSounds } = await import('@/state/ui-sounds');
    const button = { id: 'save' } as unknown as Element;
    uiSounds.hover(button, 'mouse');
    uiSounds.hover(button, 'mouse');
    expect(mockPlayer.play).toHaveBeenCalledTimes(1);
    expect(mockPlayer.play).toHaveBeenCalledWith('hover');
  });

  it('skips hover for touch pointers', async () => {
    const { uiSounds } = await import('@/state/ui-sounds');
    uiSounds.hover({} as Element, 'touch');
    expect(mockPlayer.play).not.toHaveBeenCalled();
  });

  it('skips hover when the device has no fine pointer', async () => {
    vi.resetModules();
    vi.clearAllMocks();
    installLocalStorageMock(false);
    const { uiSounds } = await import('@/state/ui-sounds');
    uiSounds.hover({} as Element, 'mouse');
    expect(mockPlayer.play).not.toHaveBeenCalled();
  });
});
