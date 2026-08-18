import { describe, expect, it } from 'vitest';

import {
  decodeOverlayToken,
  encodeOverlayToken,
  overlayFromLocationSearch,
  stripOverlaySearch,
  writeOverlaySearch,
} from '@/state/overlay-route';

describe('overlay-route', () => {
  it('round-trips document ids with colons and optional sections', () => {
    const token = encodeOverlayToken({
      documentId: 'reference.minimed.assessment.paei:msxhlezw',
      section: 'раздел-1',
    });
    expect(decodeOverlayToken(token)).toEqual({
      documentId: 'reference.minimed.assessment.paei:msxhlezw',
      section: 'раздел-1',
    });
  });

  it('encodes document-only overlays without a trailing newline token', () => {
    const token = encodeOverlayToken({ documentId: 'kr.rf.928_1' });
    expect(token).not.toContain('=');
    expect(decodeOverlayToken(token)).toEqual({ documentId: 'kr.rf.928_1' });
  });

  it('prefers compact o param and falls back to legacy dialog+section', () => {
    const compact = encodeOverlayToken({ documentId: 'kr.rf.928_1', section: 'anchor-a' });
    expect(overlayFromLocationSearch(`?o=${compact}`)).toEqual({
      documentId: 'kr.rf.928_1',
      section: 'anchor-a',
    });
    expect(overlayFromLocationSearch('?dialog=kr.rf.928_1&section=anchor-a')).toEqual({
      documentId: 'kr.rf.928_1',
      section: 'anchor-a',
    });
  });

  it('ignores legacy dialog values that look like overlay titles', () => {
    expect(overlayFromLocationSearch('?dialog=Куда%20вернуться')).toBeNull();
    expect(overlayFromLocationSearch('?dialog=Карта%20связей')).toBeNull();
  });

  it('writes o and removes legacy params', () => {
    const url = new URL('http://127.0.0.1/app?dialog=old&section=legacy#/search');
    writeOverlaySearch(url, { documentId: 'doc-1', section: 's-1' });
    expect(url.search).toMatch(/\?o=[^&]+$/u);
    expect(url.searchParams.has('dialog')).toBe(false);
    expect(url.searchParams.has('section')).toBe(false);
    expect(overlayFromLocationSearch(url.search)).toEqual({
      documentId: 'doc-1',
      section: 's-1',
    });
  });

  it('strips all overlay params', () => {
    const url = new URL('http://127.0.0.1/app?o=abc&dialog=old&section=legacy#/search');
    stripOverlaySearch(url);
    expect(url.search).toBe('');
  });
});
