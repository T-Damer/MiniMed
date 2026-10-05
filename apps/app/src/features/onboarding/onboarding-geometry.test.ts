import { describe, expect, it } from 'vitest';
import {
  ARROW_OUTSET,
  arrowAnchors,
  arrowGeometry,
  arrowWorthDrawing,
  coversMostOfViewport,
  growRect,
  needsScroll,
  placeCard,
  type Rect,
  RING_PAD,
  RING_REACH,
  rectBottom,
  rectOnScreen,
  rectRight,
  scrollDeltaToFit,
} from './onboarding-geometry';

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };
const CARD = { width: 340, height: 260 };

function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.left < rectRight(b) && rectRight(a) > b.left && a.top < rectBottom(b) && rectBottom(a) > b.top
  );
}

function asRect(placement: { left: number; top: number }, size = CARD): Rect {
  return { left: placement.left, top: placement.top, ...size };
}

function numbersIn(path: string): number[] {
  return (path.match(/-?\d+(?:\.\d+)?/gu) ?? []).map(Number);
}

describe('placeCard', () => {
  it('centres the card when there is no target', () => {
    const placement = placeCard(PHONE, undefined, CARD);
    expect(placement.side).toBe('center');
    expect(placement.left).toBe((PHONE.width - CARD.width) / 2);
    expect(placement.top).toBe((PHONE.height - CARD.height) / 2);
  });

  it('puts the card below a target near the top without covering it', () => {
    const target: Rect = { left: 20, top: 120, width: 200, height: 44 };
    const placement = placeCard(PHONE, target, CARD);
    expect(placement.side).toBe('below');
    expect(overlaps(asRect(placement), target)).toBe(false);
  });

  it('puts the card above a target at the bottom', () => {
    const target: Rect = { left: 140, top: 770, width: 110, height: 56 };
    const placement = placeCard(PHONE, target, CARD);
    expect(placement.side).toBe('above');
    expect(overlaps(asRect(placement), target)).toBe(false);
    expect(rectBottom(asRect(placement))).toBeLessThanOrEqual(target.top);
  });

  it('keeps the card on the screen', () => {
    const target: Rect = { left: 330, top: 100, width: 50, height: 40 };
    const placement = placeCard(PHONE, target, CARD);
    expect(placement.left).toBeGreaterThanOrEqual(12);
    expect(rectRight(asRect(placement))).toBeLessThanOrEqual(PHONE.width - 12);
  });

  it('uses the side of a tall target on a wide screen', () => {
    const target: Rect = { left: 40, top: 40, width: 400, height: 720 };
    const placement = placeCard(DESKTOP, target, CARD);
    expect(placement.side).toBe('right');
    expect(overlaps(asRect(placement), target)).toBe(false);
  });

  it('falls back to the roomier side when nothing fits', () => {
    const target: Rect = { left: 10, top: 20, width: 370, height: 800 };
    const placement = placeCard(PHONE, target, CARD);
    expect(['below', 'above']).toContain(placement.side);
    expect(placement.top).toBeGreaterThanOrEqual(12);
  });
});

describe('rect helpers', () => {
  it('detects a rectangle on the screen', () => {
    expect(rectOnScreen({ left: 10, top: 10, width: 50, height: 20 }, PHONE)).toBe(true);
    expect(rectOnScreen({ left: 10, top: 10, width: 0, height: 20 }, PHONE)).toBe(false);
    expect(rectOnScreen({ left: 10, top: 900, width: 50, height: 20 }, PHONE)).toBe(false);
  });

  it('grows a rectangle evenly', () => {
    expect(growRect({ left: 10, top: 10, width: 20, height: 10 }, 4)).toEqual({
      left: 6,
      top: 6,
      width: 28,
      height: 18,
    });
  });

  it('tells a whole screen from a control and when to scroll', () => {
    expect(coversMostOfViewport({ left: 0, top: 0, width: 390, height: 800 }, PHONE)).toBe(true);
    expect(coversMostOfViewport({ left: 0, top: 0, width: 200, height: 40 }, PHONE)).toBe(false);
    const insets = { top: 80, bottom: 100 };
    expect(needsScroll({ left: 0, top: 300, width: 10, height: 10 }, PHONE, insets)).toBe(false);
    expect(needsScroll({ left: 0, top: 790, width: 10, height: 10 }, PHONE, insets)).toBe(true);
    expect(needsScroll({ left: 0, top: 20, width: 10, height: 10 }, PHONE, insets)).toBe(true);
  });
});

describe('arrowAnchors', () => {
  it('leaves the card edge that faces the target and stops short of it', () => {
    const card: Rect = { left: 25, top: 400, width: 340, height: 260 };
    const target: Rect = { left: 140, top: 770, width: 110, height: 56 };
    const { from, to } = arrowAnchors(card, target);
    expect(from.y).toBe(rectBottom(card));
    expect(to.y).toBe(target.top - 8);
    expect(from.x).toBeGreaterThanOrEqual(card.left);
    expect(from.x).toBeLessThanOrEqual(rectRight(card));
  });

  it('points upwards when the target is above the card', () => {
    const card: Rect = { left: 25, top: 400, width: 340, height: 260 };
    const target: Rect = { left: 20, top: 100, width: 300, height: 44 };
    const { from, to } = arrowAnchors(card, target);
    expect(from.y).toBe(card.top);
    expect(to.y).toBe(rectBottom(target) + 8);
  });

  it('ends clear of the highlight ring: its box, border and widest halo', () => {
    const card: Rect = { left: 25, top: 400, width: 340, height: 260 };
    const target: Rect = { left: 140, top: 770, width: 110, height: 56 };
    const { to } = arrowAnchors(card, target, ARROW_OUTSET);
    const halo = target.top - RING_PAD - RING_REACH;
    expect(to.y).toBeLessThan(halo);
    expect(halo - to.y).toBeGreaterThanOrEqual(6);
  });

  it('uses the facing sides when the card is beside the target', () => {
    const target: Rect = { left: 40, top: 40, width: 400, height: 720 };
    const card: Rect = { left: 500, top: 300, width: 340, height: 260 };
    const { from, to } = arrowAnchors(card, target);
    expect(from.x).toBe(card.left);
    expect(to.x).toBe(rectRight(target) + 8);
  });
});

describe('arrowGeometry', () => {
  const from = { x: 100, y: 400 };
  const to = { x: 220, y: 760 };

  it('starts at the card and ends at the target', () => {
    const arrow = arrowGeometry(from, to, 3);
    const values = numbersIn(arrow.d);
    expect(arrow.d.startsWith(`M${from.x} ${from.y}`)).toBe(true);
    expect(values.slice(-2)).toEqual([to.x, to.y]);
  });

  it('is deterministic per seed and differs between seeds', () => {
    expect(arrowGeometry(from, to, 5)).toEqual(arrowGeometry(from, to, 5));
    expect(arrowGeometry(from, to, 5).d).not.toBe(arrowGeometry(from, to, 6).d);
  });

  it('draws the head as two curved strokes meeting at the tip', () => {
    const { head } = arrowGeometry(from, to, 1);
    expect(head.match(/M/gu)).toHaveLength(1);
    expect(head.match(/Q/gu)).toHaveLength(2);
    expect(head).toContain(`${to.x} ${to.y}`);
  });

  it('builds the shaft from a few smooth cubic Béziers, never from many short lines', () => {
    for (const seed of [1, 2, 3, 4]) {
      const { d } = arrowGeometry(from, to, seed);
      expect(d.match(/M/gu)).toHaveLength(1);
      expect(d).not.toMatch(/[LQ]/u);
      const segments = d.match(/C/gu)?.length ?? 0;
      expect(segments).toBeGreaterThanOrEqual(1);
      expect(segments).toBeLessThanOrEqual(8);
    }
  });

  it('turns the head to the last direction of the shaft', () => {
    const { d, head } = arrowGeometry(from, to, 2);
    const values = numbersIn(d);
    const tip = { x: values.at(-2) ?? 0, y: values.at(-1) ?? 0 };
    const control = { x: values.at(-4) ?? 0, y: values.at(-3) ?? 0 };
    const heading = Math.atan2(tip.y - control.y, tip.x - control.x);
    const [ax, ay] = numbersIn(head);
    const wing = Math.atan2((ay ?? 0) - tip.y, (ax ?? 0) - tip.x);
    // The wing points back along the shaft, within the head's spread.
    let difference = Math.abs(wing - (heading + Math.PI));
    if (difference > Math.PI) difference = 2 * Math.PI - difference;
    expect(difference).toBeLessThan(0.6);
  });

  it('adds a curl to a long arrow, so it is longer than the straight line', () => {
    const straight = Math.hypot(to.x - from.x, to.y - from.y);
    expect(arrowGeometry(from, to, 2).length).toBeGreaterThan(straight * 1.1);
  });

  it('keeps short arrows simple and survives a zero length', () => {
    const short = arrowGeometry({ x: 0, y: 0 }, { x: 0, y: 50 }, 1);
    expect(short.length).toBeLessThan(80);
    expect(arrowGeometry({ x: 5, y: 5 }, { x: 5, y: 5 }, 1).head).toBe('');
  });

  it('stays finite and near the two ends', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const { d, head } = arrowGeometry(from, to, seed);
      const values = [...numbersIn(d), ...numbersIn(head)];
      expect(values.every(Number.isFinite)).toBe(true);
      const xs = values.filter((_, index) => index % 2 === 0);
      const ys = values.filter((_, index) => index % 2 === 1);
      expect(Math.min(...xs)).toBeGreaterThan(Math.min(from.x, to.x) - 140);
      expect(Math.max(...xs)).toBeLessThan(Math.max(from.x, to.x) + 140);
      expect(Math.min(...ys)).toBeGreaterThan(Math.min(from.y, to.y) - 140);
      expect(Math.max(...ys)).toBeLessThan(Math.max(from.y, to.y) + 140);
    }
  });
});

describe('arrowWorthDrawing', () => {
  it('skips an arrow that would be a smudge', () => {
    expect(arrowWorthDrawing({ x: 0, y: 0 }, { x: 4, y: 3 })).toBe(false);
    expect(arrowWorthDrawing({ x: 0, y: 0 }, { x: 0, y: 60 })).toBe(true);
  });
});

describe('placeCard with a tight gap', () => {
  it('shortens the arrow room before it lets the card cover the target', () => {
    const phone = { width: 360, height: 712 };
    const card = { width: 340, height: 355 };
    // Room for the card either side only at the tight gap: 265 + 355 + 56 + 24 = 700 ≤ 712.
    const target: Rect = { left: 10, top: 20, width: 340, height: 265 };
    const placement = placeCard(phone, target, card);
    expect(placement.side).toBe('below');
    expect(overlaps(asRect(placement, card), target)).toBe(false);
    expect(placement.top - rectBottom(target)).toBe(56);
  });
});

describe('scrollDeltaToFit', () => {
  const phone = { width: 360, height: 756 };
  const card = { width: 340, height: 300 };

  it('leaves the page alone when the card fits below, above or beside', () => {
    expect(scrollDeltaToFit(phone, { left: 10, top: 40, width: 340, height: 60 }, card)).toBe(0);
    expect(scrollDeltaToFit(phone, { left: 10, top: 600, width: 340, height: 60 }, card)).toBe(0);
    expect(scrollDeltaToFit(DESKTOP, { left: 40, top: 300, width: 300, height: 200 }, CARD)).toBe(
      0,
    );
  });

  it('scrolls the content up so the card fits below a target stuck in the middle', () => {
    const target: Rect = { left: 10, top: 270, width: 340, height: 215 };
    const delta = scrollDeltaToFit(phone, target, card);
    expect(delta).toBeGreaterThan(0);
    const moved: Rect = { ...target, top: target.top - delta };
    expect(placeCard(phone, moved, card).side).toBe('below');
    expect(overlaps(asRect(placeCard(phone, moved, card), card), moved)).toBe(false);
  });

  it('takes the shorter way: content down when the card then fits above', () => {
    const target: Rect = { left: 10, top: 330, width: 340, height: 215 };
    const delta = scrollDeltaToFit(phone, target, card);
    expect(delta).toBeLessThan(0);
    const moved: Rect = { ...target, top: target.top - delta };
    expect(placeCard(phone, moved, card).side).toBe('above');
  });

  it('gives up when the target is too tall for any card beside it', () => {
    expect(scrollDeltaToFit(phone, { left: 10, top: 20, width: 340, height: 700 }, card)).toBe(0);
  });
});
