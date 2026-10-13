import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CHUNK_RELOAD_GUARD_MS,
  CHUNK_RELOAD_KEY,
  type ChunkRecoveryEnvironment,
  installChunkRecovery,
  isChunkLoadError,
  recoverFromChunkError,
  resetChunkRecoveryForTests,
} from '@/state/chunk-recovery';

function createEnvironment(overrides: Partial<ChunkRecoveryEnvironment> = {}) {
  const values = new Map<string, string>();
  const reload = vi.fn();
  const environment: ChunkRecoveryEnvironment = {
    online: () => true,
    now: () => 1_000_000,
    reload,
    storage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => void values.set(key, value),
    },
    ...overrides,
  };
  return { environment, reload, values };
}

beforeEach(resetChunkRecoveryForTests);

describe('chunk load errors', () => {
  it('recognises the wording of Chromium, Firefox and Safari', () => {
    for (const message of [
      'Failed to fetch dynamically imported module: https://x.test/app/assets/CalculatorsView-abc.js',
      'error loading dynamically imported module: https://x.test/a.js',
      'Importing a module script failed.',
      'Unable to preload CSS for https://x.test/assets/a.css',
    ]) {
      expect(isChunkLoadError(new TypeError(message)), message).toBe(true);
      expect(isChunkLoadError(message), message).toBe(true);
    }
  });

  it('ignores other failures', () => {
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false);
    expect(isChunkLoadError(new SyntaxError('Unexpected token'))).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
    expect(isChunkLoadError({ message: 'Failed to fetch dynamically imported module' })).toBe(
      false,
    );
  });
});

describe('recovering from a missing chunk', () => {
  it('reloads once onto the current build and remembers it for the session', () => {
    const { environment, reload, values } = createEnvironment();
    expect(recoverFromChunkError(environment)).toBe('reloading');
    expect(reload).toHaveBeenCalledTimes(1);
    expect(values.get(CHUNK_RELOAD_KEY)).toBe('1000000');
  });

  it('does not reload in a loop: a second failure right after a reload only reports', () => {
    const { environment, reload, values } = createEnvironment();
    values.set(CHUNK_RELOAD_KEY, '999000');
    expect(recoverFromChunkError(environment)).toBe('guarded');
    expect(reload).not.toHaveBeenCalled();
  });

  it('allows a new reload once the guard window has passed (a later deploy)', () => {
    const { environment, reload, values } = createEnvironment();
    values.set(CHUNK_RELOAD_KEY, String(1_000_000 - CHUNK_RELOAD_GUARD_MS - 1));
    expect(recoverFromChunkError(environment)).toBe('reloading');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload while offline: there is nothing to fetch, the screen shows its error', () => {
    const { environment, reload, values } = createEnvironment({ online: () => false });
    expect(recoverFromChunkError(environment)).toBe('offline');
    expect(reload).not.toHaveBeenCalled();
    expect(values.has(CHUNK_RELOAD_KEY)).toBe(false);
  });

  it('still stops a loop inside one page when session storage is blocked', () => {
    const { environment, reload } = createEnvironment({ storage: undefined });
    expect(recoverFromChunkError(environment)).toBe('reloading');
    expect(recoverFromChunkError(environment)).toBe('guarded');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('keeps going when the guard cannot be written', () => {
    const { environment, reload } = createEnvironment({
      storage: {
        getItem: () => null,
        setItem: () => {
          throw new DOMException('quota', 'QuotaExceededError');
        },
      },
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(recoverFromChunkError(environment)).toBe('reloading');
    expect(reload).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('listening for failed imports', () => {
  function createTarget() {
    const listeners = new Map<string, (event: Event) => void>();
    return {
      listeners,
      target: {
        addEventListener: (type: string, listener: (event: Event) => void) =>
          void listeners.set(type, listener),
        removeEventListener: (type: string) => void listeners.delete(type),
      } as Pick<Window, 'addEventListener' | 'removeEventListener'>,
    };
  }

  it('reloads for Vite preload errors that name a missing module, not for bugs in a module', () => {
    const { environment, reload } = createEnvironment();
    const { listeners, target } = createTarget();
    installChunkRecovery(target, environment);
    const preload = listeners.get('vite:preloadError');

    const bug = Object.assign(new Event('vite:preloadError'), {
      payload: new Error('x is not a function'),
    });
    preload?.(bug);
    expect(reload).not.toHaveBeenCalled();

    const missing = Object.assign(new Event('vite:preloadError'), {
      payload: new TypeError('Failed to fetch dynamically imported module: /assets/a.js'),
    });
    preload?.(missing);
    expect(reload).toHaveBeenCalledTimes(1);
    // The event is not cancelled: the failing import still rejects and the screen shows its error.
    expect(missing.defaultPrevented).toBe(false);
  });

  it('also catches an unhandled rejection of a dynamic import', () => {
    const { environment, reload } = createEnvironment();
    const { listeners, target } = createTarget();
    installChunkRecovery(target, environment);
    const rejection = Object.assign(new Event('unhandledrejection'), {
      reason: new TypeError('Failed to fetch dynamically imported module: /assets/b.js'),
    });
    listeners.get('unhandledrejection')?.(rejection);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('stops listening when asked', () => {
    const { environment } = createEnvironment();
    const { listeners, target } = createTarget();
    installChunkRecovery(target, environment)();
    expect(listeners.size).toBe(0);
  });
});
