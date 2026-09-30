import { describe, expect, it } from 'vitest';

import { sheetDragOffset, sheetDragShouldClose } from '@/components/sheet-drag';

describe('sheet drag', () => {
  it('follows the finger downwards only', () => {
    expect(sheetDragOffset(100, 160)).toBe(60);
    expect(sheetDragOffset(100, 40)).toBe(0);
  });

  it('closes on a long pull or a quick flick, springs back otherwise', () => {
    expect(sheetDragShouldClose(120, 900)).toBe(true);
    expect(sheetDragShouldClose(60, 60)).toBe(true);
    expect(sheetDragShouldClose(60, 400)).toBe(false);
    expect(sheetDragShouldClose(8, 4)).toBe(false);
  });
});
