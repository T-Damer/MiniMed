import { describe, expect, it } from 'vitest';

import { epubThemeCss } from '@/features/library/epub-theme';

describe('epubThemeCss', () => {
  it('forces the app text and page colours in the dark theme, down to inner elements', () => {
    const css = epubThemeCss({
      dark: true,
      text: '#eee5d4',
      background: 'rgb(55, 46, 38)',
      link: '#9bc7a7',
    });
    expect(css).toContain('color-scheme: dark');
    expect(css).toContain(
      'body { background: rgb(55, 46, 38) !important; color: #eee5d4 !important; }',
    );
    expect(css).toContain(
      'body * { color: inherit !important; background-color: transparent !important;',
    );
    expect(css).toContain('a, a * { color: #9bc7a7 !important; }');
  });

  it('leaves the colours of inner elements to the book in the light theme', () => {
    const css = epubThemeCss({
      dark: false,
      text: '#2b2823',
      background: '#fbf7ea',
      link: '#2f5f55',
    });
    expect(css).toContain('color-scheme: light');
    expect(css).toContain('background: #fbf7ea !important');
    expect(css).not.toContain('body *');
  });

  it('falls back to theme colours when the page gives none or something unsafe', () => {
    const css = epubThemeCss({
      dark: true,
      text: '',
      background: 'red; } body { display: none',
      link: 'javascript:alert(1)',
    });
    expect(css).not.toContain('display: none');
    expect(css).not.toContain('javascript');
    expect(css).toContain('#eee5d4');
    expect(css).toContain('#372e26');
    expect(css).toContain('#9bc7a7');
  });
});
