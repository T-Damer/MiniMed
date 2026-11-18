import { afterEach, describe, expect, it, vi } from 'vitest';
import { setRestoreLastPage, setShowPageRestoreNotice } from '@/state/app-preferences';
import { buildOfficialDocumentHash } from '@/state/document-route';
import { readHistoryEntry, saveReaderPosition, withHistoryEntry } from '@/state/history-entries';
import { restoreLastPage, trackLastPage } from '@/state/last-page';

function launch() {
  const state = { value: null as unknown };
  const address = new URL('https://localhost/');
  const storage = new Map<string, string>();
  const browser = Object.assign(new EventTarget(), {
    location: address,
    history: {
      get state() {
        return state.value;
      },
      replaceState(value: unknown, _title: string, hash?: string) {
        state.value = value;
        if (hash !== undefined) address.hash = hash;
      },
    },
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  });
  vi.stubGlobal('window', browser);
  return browser;
}

afterEach(() => vi.unstubAllGlobals());

describe('last page', () => {
  it('restores the reader position into a fresh history entry', () => {
    const browser = launch();
    const hash = buildOfficialDocumentHash('kr.rf.11_2');
    browser.location.hash = hash;
    const stop = trackLastPage();
    const position = { anchor: 'section-2', offset: 42 };
    browser.history.replaceState(withHistoryEntry(null, { id: 'old', depth: 3 }), '', hash);
    expect(saveReaderPosition('old', position)).toBe(true);
    stop();

    browser.history.replaceState(null, '', '');
    expect(restoreLastPage()).toBe(hash);
    expect(readHistoryEntry(browser.history.state)).toMatchObject({ depth: 0, position });
  });

  it('preserves an explicit route and keeps the saved page when notices are hidden', () => {
    const browser = launch();
    browser.location.hash = '#/settings/general';
    const stop = trackLastPage();
    setShowPageRestoreNotice(false);
    stop();

    browser.location.hash = '#/news';
    expect(restoreLastPage()).toBeUndefined();
    browser.location.hash = '';
    expect(restoreLastPage()).toBe('#/settings/general');
  });

  it('clears the checkpoint when restoration is turned off', () => {
    const browser = launch();
    browser.location.hash = '#/news';
    const stop = trackLastPage();
    setRestoreLastPage(false);
    stop();
    browser.location.hash = '';
    setRestoreLastPage(true);
    expect(restoreLastPage()).toBeUndefined();
  });

  it('keeps the search location without persisting URL parameters or query text', () => {
    const browser = launch();
    browser.location.search = '?external=example';
    browser.location.hash = '#/search/medications?q=example';
    const stop = trackLastPage();
    stop();
    expect(browser.localStorage.getItem('minimed.last-page.v1:main')).toBe(
      JSON.stringify({ hash: '#/search/medications' }),
    );
  });
});
