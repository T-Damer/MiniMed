import { describe, expect, it } from 'vitest';

import { segmentTextWithExternalUrls } from '@/components/external-url-segments';

describe('segmentTextWithExternalUrls', () => {
  it('turns a Markdown link into one link segment with its own text', () => {
    const text =
      'Шизофрения – полиморфное [психическое расстройство](https://www.krasotaimedicina.ru/diseases/psychiatric), характеризующееся';
    const segments = segmentTextWithExternalUrls(text);
    expect(segments.map((segment) => segment.kind)).toEqual(['text', 'url', 'text']);
    expect(segments[1]).toMatchObject({
      kind: 'url',
      href: 'https://www.krasotaimedicina.ru/diseases/psychiatric',
      label: 'психическое расстройство',
    });
    expect(segments.map((segment) => segment.value).join('')).toBe(text);
  });

  it('keeps a bare address as before', () => {
    const segments = segmentTextWithExternalUrls('см. https://example.org/a (2020)');
    expect(segments[1]).toEqual({
      kind: 'url',
      value: 'https://example.org/a',
      href: 'https://example.org/a',
    });
    expect(segments[2]).toEqual({ kind: 'text', value: ' (2020)' });
  });

  it('does not treat a bracketed text without an address as a link', () => {
    expect(segmentTextWithExternalUrls('[1] и (https://x.ru)')[0]).toEqual({
      kind: 'text',
      value: '[1] и (',
    });
  });
});
