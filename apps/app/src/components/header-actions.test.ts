import { describe, expect, it } from 'vitest';

import {
  type HeaderActionPriority,
  type HeaderActionSize,
  layoutHeaderActions,
  sameHeaderLayout,
} from '@/components/header-actions';

const W = 44;
const GAP = 8;

function action(id: string, priority: HeaderActionPriority, width = W): HeaderActionSize {
  return { id, priority, width };
}

/** phone p1, help p1, edit p2, export p2, share p2, curators p3 */
const page: readonly HeaderActionSize[] = [
  action('phone', 1),
  action('help', 1),
  action('edit', 2),
  action('export', 2),
  action('share', 2),
  action('curators', 3),
];

function row(count: number): number {
  return count * W + (count - 1) * GAP;
}

function layout(available: number, actions = page) {
  return layoutHeaderActions({ actions, available, menuWidth: W, gap: GAP });
}

describe('layoutHeaderActions', () => {
  it('shows every button and no menu when all fit', () => {
    const result = layout(row(6));
    expect(result.inline).toEqual(['phone', 'help', 'edit', 'export', 'share', 'curators']);
    expect(result.menu).toEqual([]);
  });

  it('shows nothing and no menu for an empty list', () => {
    expect(layout(0, [])).toEqual({ inline: [], menu: [] });
  });

  it('folds priority 3 first, but never a single button', () => {
    // Five buttons fit, six do not: folding only «curators» would still need the «⋯» slot.
    const result = layout(row(5));
    expect(result.menu).toEqual(['share', 'curators']);
    expect(result.inline).toEqual(['phone', 'help', 'edit', 'export']);
  });

  it('keeps the inline buttons plus «⋯» inside the available width', () => {
    const result = layout(row(5));
    expect(row(result.inline.length + 1)).toBeLessThanOrEqual(row(5));
  });

  it('folds priority 2 before priority 1', () => {
    const result = layout(row(3));
    expect(result.inline).toEqual(['phone', 'help']);
    expect(result.menu).toEqual(['edit', 'export', 'share', 'curators']);
  });

  it('folds later buttons of the same priority first', () => {
    const result = layout(row(4));
    // 4 slots: 3 buttons + «⋯» → fold curators, share, export.
    expect(result.menu).toEqual(['export', 'share', 'curators']);
    expect(result.inline).toEqual(['phone', 'help', 'edit']);
  });

  it('folds priority 1 last', () => {
    const result = layout(row(2));
    expect(result.inline).toEqual(['phone']);
    expect(result.menu).toEqual(['help', 'edit', 'export', 'share', 'curators']);
  });

  it('keeps only «⋯» when nothing fits, even with negative space', () => {
    const result = layout(-30);
    expect(result.inline).toEqual([]);
    expect(result.menu).toHaveLength(6);
  });

  it('never folds a lone action', () => {
    expect(layout(0, [action('only', 1)])).toEqual({ inline: ['only'], menu: [] });
  });

  it('folds both of two actions when they do not fit', () => {
    const two = [action('a', 1), action('b', 3)];
    expect(layout(row(2) - 1, two)).toEqual({ inline: [], menu: ['a', 'b'] });
    expect(layout(row(2), two)).toEqual({ inline: ['a', 'b'], menu: [] });
  });

  it('folds three actions down to two when only the menu and one button fit', () => {
    const three = [action('a', 1), action('b', 2), action('c', 3)];
    // Needs «⋯» + 1 button = 2 slots; folding only «c» keeps a, b + «⋯» = 3 slots.
    const result = layout(row(2), three);
    expect(result.menu).toEqual(['b', 'c']);
    expect(result.inline).toEqual(['a']);
  });

  it('honours different button widths', () => {
    const mixed = [action('a', 1, 100), action('b', 2, 20), action('c', 3, 20)];
    // All: 100+20+20+16 = 156 > 155. Fold c: 100+20+44(menu)+16 = 180 > 155, so b folds too:
    // 100+44+8 = 152 fits.
    const result = layout(155, mixed);
    expect(result.inline).toEqual(['a']);
    expect(result.menu).toEqual(['b', 'c']);
  });

  it('keeps display order inside both groups', () => {
    const result = layout(row(4));
    expect(result.inline).toEqual(['phone', 'help', 'edit']);
    expect(result.menu).toEqual(['export', 'share', 'curators']);
  });
});

describe('menu-only actions', () => {
  it('always sit in «⋯» and let a single other button join them', () => {
    const actions = [action('add', 1), action('help', 1), { ...action('out', 3), menuOnly: true }];
    expect(layout(row(6), actions)).toEqual({ inline: ['add', 'help'], menu: ['out'] });
    expect(layout(row(2), actions)).toEqual({ inline: ['add'], menu: ['help', 'out'] });
  });
});

describe('sameHeaderLayout', () => {
  it('compares folded ids', () => {
    expect(sameHeaderLayout(layout(row(6)), layout(row(6)))).toBe(true);
    expect(sameHeaderLayout(layout(row(6)), layout(row(3)))).toBe(false);
  });
});
