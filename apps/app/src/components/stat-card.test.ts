import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { STAT_TONES, statCardClass, statGridClass } from '@/components/stat-card';

const read = (name: string): string => readFileSync(resolve(import.meta.dirname, name), 'utf8');
const statCss = read('stat-card.css');
const fabCss = read('floating-action-button.css');

/** Every selector of a stylesheet, comments and at-rules removed. */
function selectors(css: string): string[] {
  return css
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .split('{')
    .slice(0, -1)
    .map((chunk) => chunk.split(/[};]/u).pop()?.trim() ?? '')
    .filter((selector) => selector.length > 0 && !selector.startsWith('@'))
    .filter((selector) => !/^(from|to|\d+%)$/u.test(selector))
    .flatMap((selector) => selector.split(',').map((part) => part.trim()));
}

describe('stat card classes', () => {
  it('defaults to the neutral tone and adds interactive and pressed modifiers', () => {
    expect(statCardClass({ interactive: false })).toBe('ui-stat-card ui-stat-card--default');
    expect(statCardClass({ interactive: false, compact: true })).toBe(
      'ui-stat-card ui-stat-card--default ui-stat-card--compact',
    );
    expect(statCardClass({ tone: 'danger', interactive: true, pressed: true, class: 'x' })).toBe(
      'ui-stat-card ui-stat-card--danger ui-stat-card--interactive ui-stat-card--pressed x',
    );
  });

  it('names the grid by its column count', () => {
    expect(statGridClass()).toBe('ui-stat-grid ui-stat-grid--2');
    expect(statGridClass(3, 'diary-patient__stats')).toBe(
      'ui-stat-grid ui-stat-grid--3 diary-patient__stats',
    );
  });
});

describe('stat card and floating button styles', () => {
  it('styles every non-neutral tone', () => {
    for (const tone of STAT_TONES.filter((name) => name !== 'default')) {
      expect(selectors(statCss), tone).toContain(`.ui-stat-card--${tone}`);
    }
  });

  it('uses single-class selectors only (no descendant or element selectors)', () => {
    for (const selector of [...selectors(statCss), ...selectors(fabCss)]) {
      const compound = selector.replace(/:[a-z-]+(\([^)]*\))?/gu, '');
      expect(compound, selector).toMatch(/^\.[a-z0-9_-]+(\.[a-z0-9_-]+)*$/u);
    }
  });

  it('keeps the entry animation from pinning the pressed transform', () => {
    expect(fabCss).toMatch(/animation: ui-fab-in [^;]*backwards;/u);
    expect(fabCss).toMatch(/\.ui-fab:active \{\s*transform: scale\(0\.96\)/u);
  });

  it('puts the fixed fallback above the bottom navigation and the safe area', () => {
    expect(fabCss).toMatch(/bottom: calc\(4\.375rem \+ var\(--safe-bottom, 0px\)\)/u);
  });
});
