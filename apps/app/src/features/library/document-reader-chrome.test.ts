import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  documentReaderBackTarget,
  navigateDocumentReaderBack,
} from '@/features/library/document-reader-back';
import type { DocumentTrail } from '@/state/document-trail';
import { resetHistoryEntryTrackingForTests, withHistoryEntry } from '@/state/history-entries';

const trailOfTwo: DocumentTrail = {
  origin: {
    hash: '#/search',
    search: '',
    label: 'Поиск',
    view: 'search',
  },
  crumbs: [
    { kind: 'official', id: 'a', title: 'Документ A', href: '#/modules/documents/d/a' },
    { kind: 'official', id: 'b', title: 'Документ B', href: '#/modules/documents/d/b' },
  ],
};

/** A page whose current history entry has `depth` app entries below it. */
function stubPage(depth: number, length = depth + 1) {
  const back = vi.fn();
  const replace = vi.fn();
  vi.stubGlobal('window', {
    history: {
      state: withHistoryEntry(null, { id: 'entry', depth }),
      length,
      back,
      replaceState: vi.fn(),
    },
    location: { hash: '#/modules/documents/d/b', replace },
  });
  return { back, replace };
}

describe('navigateDocumentReaderBack', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetHistoryEntryTrackingForTests();
  });

  it('steps the history back when an entry of the app lies below, and navigates nowhere', () => {
    const { back } = stubPage(2);
    const onNavigate = vi.fn();

    navigateDocumentReaderBack(trailOfTwo, onNavigate);

    expect(back).toHaveBeenCalledTimes(1);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('steps the history back from the first document of a trail as well', () => {
    const { back } = stubPage(1);
    const onNavigate = vi.fn();
    const trail: DocumentTrail = {
      origin: trailOfTwo.origin,
      crumbs: trailOfTwo.crumbs.slice(0, 1),
    };

    navigateDocumentReaderBack(trail, onNavigate);

    expect(back).toHaveBeenCalledTimes(1);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('replaces the entry with the previous document when nothing of the app lies below', () => {
    const { back } = stubPage(0);
    const setItem = vi.fn();
    vi.stubGlobal('sessionStorage', { setItem });
    const onNavigate = vi.fn();

    navigateDocumentReaderBack(trailOfTwo, onNavigate);

    expect(onNavigate).toHaveBeenCalledWith('#/modules/documents/d/a', { replace: true });
    expect(setItem).toHaveBeenCalledWith(
      'minimed:document-trail',
      expect.stringContaining('"id":"a"'),
    );
    expect(back).not.toHaveBeenCalled();
  });

  it('replaces the entry with the trail origin of a deep-linked document', () => {
    const { back } = stubPage(0);
    const onNavigate = vi.fn();
    const trail: DocumentTrail = {
      origin: {
        hash: '#/modules/documents/collection/regulatory',
        search: '',
        label: 'Документы',
        view: 'modules',
      },
      crumbs: [],
    };

    navigateDocumentReaderBack(trail, onNavigate);

    expect(onNavigate).toHaveBeenCalledWith('#/modules/documents/collection/regulatory', {
      replace: true,
    });
    expect(back).not.toHaveBeenCalled();
  });
});

describe('documentReaderBackTarget', () => {
  it('is the previous document, else the origin', () => {
    expect(documentReaderBackTarget(trailOfTwo)).toBe('#/modules/documents/d/a');
    expect(
      documentReaderBackTarget({
        origin: trailOfTwo.origin,
        crumbs: trailOfTwo.crumbs.slice(0, 1),
      }),
    ).toBe('#/search');
    expect(documentReaderBackTarget(null)).toBeNull();
  });
});
