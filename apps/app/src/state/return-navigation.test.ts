import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearReturnTo,
  consumeReturnTo,
  peekReturnTo,
  rememberReturnTo,
  restoreReturnTo,
  returnToControlLabel,
  returnToRouteDetail,
} from '@/state/return-navigation';

function installNavigationMocks(): {
  readonly sessionStore: Map<string, string>;
  readonly location: {
    hash: string;
    search: string;
    pathname: string;
    href: string;
    origin: string;
  };
} {
  const sessionStore = new Map<string, string>();
  const location = {
    hash: '',
    search: '',
    pathname: '/app',
    href: 'http://127.0.0.1/app',
    origin: 'http://127.0.0.1',
  };

  const syncHref = (): void => {
    location.href = `${location.origin}${location.pathname}${location.search}${location.hash}`;
  };

  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => sessionStore.get(key) ?? null,
    setItem: (key: string, value: string) => {
      sessionStore.set(key, value);
    },
    removeItem: (key: string) => {
      sessionStore.delete(key);
    },
  });

  vi.stubGlobal(
    'HashChangeEvent',
    class extends Event {
      readonly oldURL: string;
      readonly newURL: string;

      constructor(type: string, init?: { oldURL?: string; newURL?: string }) {
        super(type);
        this.oldURL = init?.oldURL ?? '';
        this.newURL = init?.newURL ?? '';
      }
    },
  );

  vi.stubGlobal('window', {
    location,
    history: {
      replaceState: (_state: unknown, _title: string, url: string) => {
        const parsed = new URL(url, location.href);
        location.pathname = parsed.pathname;
        location.search = parsed.search;
        location.hash = parsed.hash;
        syncHref();
      },
      pushState: (_state: unknown, _title: string, url: string) => {
        const parsed = new URL(url, location.href);
        location.pathname = parsed.pathname;
        location.search = parsed.search;
        location.hash = parsed.hash;
        syncHref();
      },
    },
    dispatchEvent: () => true,
    CustomEvent: globalThis.CustomEvent,
  });

  return { sessionStore, location };
}

describe('return-navigation', () => {
  beforeEach(() => {
    installNavigationMocks();
  });

  afterEach(() => {
    clearReturnTo();
    vi.unstubAllGlobals();
  });

  it('remembers and consumes the current hash and search', () => {
    window.history.replaceState(null, '', '/app?dialog=doc-1#/search');
    rememberReturnTo();
    expect(peekReturnTo()).toEqual({ hash: '#/search', search: '?dialog=doc-1' });
    expect(consumeReturnTo()).toEqual({ hash: '#/search', search: '?dialog=doc-1' });
    expect(peekReturnTo()).toBeNull();
  });

  it('labels document and search returns', () => {
    expect(returnToControlLabel({ hash: '#/search', search: '' })).toBe('К поиску');
    expect(returnToControlLabel({ hash: '#/modules/documents', search: '?dialog=abc' })).toBe(
      'К документу',
    );
    expect(returnToControlLabel({ hash: '#/modules/documents/d/abc', search: '' })).toBe(
      'К документу',
    );
  });

  it('describes return destinations for the back chooser', () => {
    expect(returnToRouteDetail({ hash: '#/search', search: '' })).toBe('Поиск');
    expect(returnToRouteDetail({ hash: '#/search', search: '?dialog=doc-1' })).toBe(
      'Открытый документ',
    );
    expect(returnToRouteDetail({ hash: '#/search', search: '?o=abc' })).toBe('Открытый документ');
    expect(returnToRouteDetail({ hash: '#/modules/documents/d/abc', search: '' })).toBe(
      'Открытый документ',
    );
    expect(returnToRouteDetail({ hash: '#/modules/documents', search: '' })).toBe('База знаний');
    expect(returnToRouteDetail({ hash: '#/assessments/demo', search: '' })).toBe('Тесты');
  });

  it('restores hash and search together', () => {
    window.history.replaceState(null, '', '/app#/assessments/demo');
    restoreReturnTo({ hash: '#/search', search: '?dialog=doc-1' });
    expect(window.location.pathname).toBe('/app');
    expect(window.location.search).toBe('?dialog=doc-1');
    expect(window.location.hash).toBe('#/search');
  });
});
