import { describe, expect, it } from 'vitest';

import { epubAttributeIsActive } from '@/features/printing/epub-sanitize';

describe('epubAttributeIsActive', () => {
  it('catches handlers and script addresses, with whitespace inside the scheme too', () => {
    expect(epubAttributeIsActive('onclick', 'x()')).toBe(true);
    expect(epubAttributeIsActive('href', 'javascript:alert(1)')).toBe(true);
    expect(epubAttributeIsActive('href', 'java\tscript:alert(1)')).toBe(true);
    expect(epubAttributeIsActive('formaction', ' java\nscript:alert(1)')).toBe(true);
    expect(epubAttributeIsActive('xlink:href', 'data:text/html,<b>x</b>')).toBe(true);
  });

  it('keeps ordinary links and text', () => {
    expect(epubAttributeIsActive('href', 'chapter2.xhtml#p3')).toBe(false);
    expect(epubAttributeIsActive('href', 'https://example.org')).toBe(false);
    expect(epubAttributeIsActive('class', 'note javascript')).toBe(false);
  });
});
