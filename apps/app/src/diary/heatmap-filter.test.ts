import { beforeEach, describe, expect, it } from 'vitest';

import {
  createHeatFilter,
  effectiveHeatParts,
  readHeatFilter,
  saveHeatFilter,
} from '@/diary/heatmap-filter';

const memory = new Map<string, string>();
Object.defineProperty(globalThis, 'window', {
  value: {
    localStorage: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => memory.set(key, value),
      removeItem: (key: string) => memory.delete(key),
    },
  },
  configurable: true,
});

describe('heatmap filter memory', () => {
  beforeEach(() => memory.clear());

  it('restores the saved parts and drops unknown ones', () => {
    saveHeatFilter('k', new Set(['doses', 'vitals']));
    expect([...readHeatFilter('k')]).toEqual(['doses', 'vitals']);
    memory.set('k', JSON.stringify(['doses', 'secret', 3]));
    expect([...readHeatFilter('k')]).toEqual(['doses']);
    memory.set('k', '{not json');
    expect(readHeatFilter('k').size).toBe(0);
  });

  it('keeps a change for the next visit', () => {
    const [, setInclude] = createHeatFilter('k');
    setInclude(new Set(['questionnaires']));
    const [include] = createHeatFilter('k');
    expect([...include()]).toEqual(['questionnaires']);
  });

  it('limits the saved choice to the parts of this plan, everything when none is there', () => {
    expect([...effectiveHeatParts(['doses', 'notes'], new Set(['doses', 'vitals']))]).toEqual([
      'doses',
    ]);
    expect(effectiveHeatParts(['doses', 'notes'], new Set(['questionnaires'])).size).toBe(0);
    expect(effectiveHeatParts(['doses'], new Set()).size).toBe(0);
  });
});
