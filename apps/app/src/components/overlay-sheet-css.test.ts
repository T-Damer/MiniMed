import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(import.meta.dirname, 'overlay-sheet.css'), 'utf8');

/** The body of the first rule whose selector is exactly `selector`. */
function rule(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `rule ${selector}`).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf('}', start));
}

describe('overlay sheet sizing', () => {
  it('bounds the sheet by the backdrop box and dynamic viewport units, never 100vh', () => {
    const sheet = rule('.overlay-dialog.overlay-dialog--sheet');
    expect(sheet).toMatch(/max-height: min\(calc\(100dvh [^;]*\), 100%\)/u);
    expect(css.replace(/\/\*[\s\S]*?\*\//gu, '')).not.toMatch(/100vh/u);
    expect(rule('.overlay-backdrop.overlay-backdrop--sheet')).toMatch(
      /grid-template: minmax\(0, 1fr\) \/ minmax\(0, 1fr\)/u,
    );
  });

  it('keeps room under the last control of a scrolling body, plus the safe area on phones', () => {
    expect(rule('.overlay-dialog-body.overlay-dialog-body--sheet')).toMatch(
      /padding-block-end: 1\.5rem/u,
    );
    expect(css).toMatch(/padding-block-end: calc\(1\.5rem \+ var\(--safe-bottom, 0px\)\)/u);
  });
});
