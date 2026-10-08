import { describe, expect, it } from 'vitest';

import { isActiveUrl, PAGE_FRAME_CSP } from '@/features/news/page-frame';

describe('isActiveUrl', () => {
  it('flags script-bearing addresses, however they are spelled', () => {
    expect(isActiveUrl('javascript:alert(1)')).toBe(true);
    expect(isActiveUrl('  JaVaScRiPt:alert(1)')).toBe(true);
    expect(isActiveUrl('java\nscript:alert(1)')).toBe(true);
    expect(isActiveUrl('java\tscript:alert(1)')).toBe(true);
    expect(isActiveUrl('vbscript:msgbox(1)')).toBe(true);
    expect(isActiveUrl('data:text/html;base64,PHNjcmlwdD4=')).toBe(true);
  });

  it('lets ordinary addresses through', () => {
    expect(isActiveUrl('https://news.test/a?x=javascript:1')).toBe(false);
    expect(isActiveUrl('/relative/path.html')).toBe(false);
    expect(isActiveUrl('mailto:a@b.test')).toBe(false);
    expect(isActiveUrl('data:image/png;base64,iVBORw0KGgo=')).toBe(false);
    // An SVG in an <img> cannot run script; <object> and <embed> are removed outright.
    expect(isActiveUrl('data:image/svg+xml;base64,PHN2Zz4=')).toBe(false);
    expect(isActiveUrl('#anchor')).toBe(false);
  });
});

describe('frame CSP', () => {
  it('forbids scripts, plug-ins, nested frames and form posts', () => {
    expect(PAGE_FRAME_CSP).toContain("script-src 'none'");
    expect(PAGE_FRAME_CSP).toContain("object-src 'none'");
    expect(PAGE_FRAME_CSP).toContain("frame-src 'none'");
    expect(PAGE_FRAME_CSP).toContain("form-action 'none'");
  });
});
