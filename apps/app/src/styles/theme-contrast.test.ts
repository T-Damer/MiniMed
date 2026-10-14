import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The text tokens against the surfaces they are drawn on, WCAG 2.x: 4.5:1 for text. Only plain hex
 * tokens take part (translucent and mixed ones are resolved by the browser; the in-page audit in
 * `e2e/readability.spec.ts` covers what those produce on screen).
 */

const STYLES = import.meta.dirname;

function rootBlock(css: string, afterMarker?: string): string {
  const start = afterMarker ? css.indexOf(afterMarker) : 0;
  const open = css.indexOf(':root {', start);
  let depth = 0;
  for (let index = css.indexOf('{', open); index < css.length; index += 1) {
    if (css[index] === '{') depth += 1;
    if (css[index] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(css.indexOf('{', open) + 1, index);
    }
  }
  throw new Error('Unclosed :root block.');
}

function tokens(block: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const match of block.matchAll(/(--[\w-]+):\s*([^;]+);/gu)) {
    map.set(match[1] ?? '', (match[2] ?? '').trim());
  }
  return map;
}

function resolve(map: ReadonlyMap<string, string>, name: string, depth = 0): string {
  const value = map.get(name);
  if (value === undefined) throw new Error(`Token ${name} is not defined.`);
  const reference = /^var\((--[\w-]+)\)$/u.exec(value);
  if (reference && depth < 8) return resolve(map, reference[1] ?? '', depth + 1);
  return value;
}

function channel(value: number): number {
  const unit = value / 255;
  return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const match = /^#([\da-f]{6})$/iu.exec(hex);
  if (!match) throw new Error(`Not a plain hex colour: ${hex}`);
  const value = Number.parseInt(match[1] ?? '', 16);
  return (
    0.2126 * channel((value >> 16) & 255) +
    0.7152 * channel((value >> 8) & 255) +
    0.0722 * channel(value & 255)
  );
}

function contrast(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const light = tokens(rootBlock(readFileSync(join(STYLES, 'theme.css'), 'utf8')));
const darkCss = readFileSync(join(STYLES, 'theme-dark.css'), 'utf8');
// The dark block overrides the light tokens: everything it does not set stays as in light.
const dark = new Map([
  ...light,
  ...tokens(rootBlock(darkCss, '@media (prefers-color-scheme: dark)')),
]);

/** Surfaces of the tan route desk: the gradient's two ends and the tinted chip over its darker end. */
const DESK = ['#cbb37c', '#b9a06a', '#ab9766'] as const;
/** A paper row sunk into the desk (the ATC list). */
const SUNK_PAPER = '#d2c19c';

const PAPER_TEXT = [
  '--theme-text',
  '--theme-text-muted',
  '--theme-text-faint',
  '--theme-link',
  '--theme-kicker',
  '--theme-accent-text',
  '--theme-danger',
] as const;
const PAPER_SURFACES = [
  '--theme-surface',
  '--theme-surface-raised',
  '--theme-surface-muted',
  '--theme-search-surface',
  '--theme-search-surface-muted',
] as const;
const DESK_TEXT = [
  '--theme-desk-text-muted',
  '--theme-desk-text-faint',
  '--theme-desk-link',
  '--theme-desk-accent-text',
  '--theme-desk-kicker',
] as const;

function failures(
  map: ReadonlyMap<string, string>,
  texts: readonly string[],
  surfaces: readonly string[],
  floor = 4.5,
): string[] {
  const failed: string[] = [];
  for (const text of texts) {
    for (const surface of surfaces) {
      const foreground = resolve(map, text);
      const background = surface.startsWith('#') ? surface : resolve(map, surface);
      const ratio = contrast(foreground, background);
      if (ratio < floor) {
        failed.push(`${text} ${foreground} on ${surface} ${background}: ${ratio.toFixed(2)}`);
      }
    }
  }
  return failed;
}

describe('theme text tokens', () => {
  it('stay at 4.5:1 on every light paper surface', () => {
    expect(failures(light, PAPER_TEXT, PAPER_SURFACES)).toEqual([]);
  });

  it('reach 4.5:1 on paper sunk into the desk, which only desk-level text sits on', () => {
    expect(
      failures(light, ['--theme-text', '--theme-text-muted', '--theme-accent-text'], [SUNK_PAPER]),
    ).toEqual([]);
    expect(failures(light, DESK_TEXT, [SUNK_PAPER])).toEqual([]);
  });

  it('stay at 4.5:1 on every dark surface', () => {
    expect(
      failures(dark, PAPER_TEXT, [
        ...PAPER_SURFACES,
        '--theme-background',
        '--theme-search-surface',
      ]),
    ).toEqual([]);
  });

  it('reach 4.5:1 on the tan route desk through the desk tokens', () => {
    expect(failures(light, DESK_TEXT, DESK)).toEqual([]);
  });

  it('keep the desk tokens readable in dark, where the desk is a dark surface', () => {
    expect(failures(dark, DESK_TEXT, ['--theme-background', '--theme-surface'])).toEqual([]);
  });
});
