import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

import { colorSchemePlugin, scopeSelector } from './postcss-color-scheme';

async function transform(css: string): Promise<string> {
  const result = await postcss([colorSchemePlugin()]).process(css, { from: undefined });
  return result.css.replace(/\s+/gu, ' ').trim();
}

describe('colorSchemePlugin', () => {
  it('limits the system block and repeats it for the forced theme', async () => {
    const css = await transform(
      '@media (prefers-color-scheme: dark) { :root { --a: 1 } .x, body .y { color: red } }',
    );
    expect(css).toBe(
      "@media (prefers-color-scheme: dark) { :root:where(:not([data-theme='light'])) { --a: 1 } " +
        ":where(:root:not([data-theme='light'])) .x, :where(:root:not([data-theme='light'])) body .y { color: red } } " +
        ":root:where([data-theme='dark']) { --a: 1 } " +
        ":where(:root[data-theme='dark']) .x, :where(:root[data-theme='dark']) body .y { color: red }",
    );
  });

  it('handles light blocks and nested conditions', async () => {
    const css = await transform(
      '@media (prefers-color-scheme: light) { @media (hover: hover) { .a:hover { top: 0 } } }',
    );
    expect(css).toContain(
      "@media (hover: hover) { :where(:root[data-theme='light']) .a:hover { top: 0 } }",
    );
    expect(css).toContain(":where(:root:not([data-theme='dark'])) .a:hover");
  });

  it('leaves other media queries alone', async () => {
    const source = '@media (hover: hover) { .a { top: 0 } }';
    expect(await transform(source)).toBe(source);
  });

  it('rejects combined scheme conditions and keyframes', async () => {
    await expect(
      transform('@media (prefers-color-scheme: dark) and (min-width: 1px) { .a { top: 0 } }'),
    ).rejects.toThrow(/plain/u);
    await expect(
      transform('@media (prefers-color-scheme: dark) { @keyframes k { to { top: 0 } } }'),
    ).rejects.toThrow(/keyframes/u);
  });

  it('keeps the root selector shape', () => {
    expect(scopeSelector('html.is-native', '[data-theme="dark"]')).toBe(
      'html:where([data-theme="dark"]).is-native',
    );
  });
});
