/**
 * Pure geometry for the tour: where the hint card goes so it does not cover the control it
 * explains, and the hand-drawn looking arrow between them. No DOM: rectangles and points in,
 * numbers and SVG path data out.
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Rect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export type CardSide = 'below' | 'above' | 'right' | 'left' | 'center';

export interface CardPlacement {
  readonly left: number;
  readonly top: number;
  readonly side: CardSide;
}

export function rectRight(rect: Rect): number {
  return rect.left + rect.width;
}

export function rectBottom(rect: Rect): number {
  return rect.top + rect.height;
}

export function rectCenter(rect: Rect): Point {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function clamp(value: number, min: number, max: number): number {
  return max < min ? (min + max) / 2 : Math.min(max, Math.max(min, value));
}

/** True when the rectangle has an area and at least partly lies inside the viewport. */
export function rectOnScreen(rect: Rect, viewport: Size): boolean {
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    rectRight(rect) > 0 &&
    rectBottom(rect) > 0 &&
    rect.left < viewport.width &&
    rect.top < viewport.height
  );
}

/** The rectangle grown by `pad` on every side (the highlight ring around a control). */
export function growRect(rect: Rect, pad: number): Rect {
  return {
    left: rect.left - pad,
    top: rect.top - pad,
    width: rect.width + pad * 2,
    height: rect.height + pad * 2,
  };
}

/** A target that covers most of the screen is «the whole screen», not a control to ring. */
export function coversMostOfViewport(rect: Rect, viewport: Size): boolean {
  return (rect.width * rect.height) / (viewport.width * viewport.height) > 0.6;
}

/** The target is not comfortably inside the band left free of the top and bottom chrome. */
export function needsScroll(
  rect: Rect,
  viewport: Size,
  insets: { readonly top: number; readonly bottom: number },
): boolean {
  return rect.top < insets.top || rectBottom(rect) > viewport.height - insets.bottom;
}

export interface PlaceCardOptions {
  /** Free space kept between the card and the screen edge. */
  readonly margin?: number;
  /** Room for the arrow between the card and the target. */
  readonly gap?: number;
}

const DEFAULT_MARGIN = 12;
const DEFAULT_GAP = 76;
/** Side placement needs a screen wide enough for the card next to the target. */
const SIDE_PLACEMENT_MIN_WIDTH = 720;

/**
 * Places the card next to `target` without covering it: below, above, or (on wide screens) to a
 * side, whichever leaves room for the arrow. Without a target the card sits in the centre. If
 * nothing fits, the side with the most room wins and the card is clamped onto the screen.
 */
export function placeCard(
  viewport: Size,
  target: Rect | undefined,
  card: Size,
  options: PlaceCardOptions = {},
): CardPlacement {
  const margin = options.margin ?? DEFAULT_MARGIN;
  const gap = options.gap ?? DEFAULT_GAP;
  const maxLeft = viewport.width - margin - card.width;
  const maxTop = viewport.height - margin - card.height;
  if (!target) {
    return {
      left: clamp((viewport.width - card.width) / 2, margin, maxLeft),
      top: clamp((viewport.height - card.height) / 2, margin, maxTop),
      side: 'center',
    };
  }
  const centre = rectCenter(target);
  const room = {
    below: viewport.height - margin - rectBottom(target) - gap,
    above: target.top - gap - margin,
    right: viewport.width - margin - rectRight(target) - gap,
    left: target.left - gap - margin,
  };
  const wide = viewport.width >= SIDE_PLACEMENT_MIN_WIDTH;
  const fits: CardSide[] = [];
  if (room.below >= card.height) fits.push('below');
  if (room.above >= card.height) fits.push('above');
  if (wide && room.right >= card.width) fits.push('right');
  if (wide && room.left >= card.width) fits.push('left');
  const side: CardSide = fits[0] ?? (room.below >= room.above ? 'below' : 'above');
  const horizontal = clamp(centre.x - card.width / 2, margin, maxLeft);
  const vertical = clamp(centre.y - card.height / 2, margin, maxTop);
  switch (side) {
    case 'below':
      return { left: horizontal, top: clamp(rectBottom(target) + gap, margin, maxTop), side };
    case 'above':
      return {
        left: horizontal,
        top: clamp(target.top - gap - card.height, margin, maxTop),
        side,
      };
    case 'right':
      return { left: clamp(rectRight(target) + gap, margin, maxLeft), top: vertical, side };
    default:
      return {
        left: clamp(target.left - gap - card.width, margin, maxLeft),
        top: vertical,
        side: 'left',
      };
  }
}

/**
 * Where the arrow starts (on the card) and ends (just outside the target): the card edge and the
 * target edge that face each other, kept clear of corners so the line leaves from a flat part.
 */
export function arrowAnchors(
  card: Rect,
  target: Rect,
  outset = 8,
): { readonly from: Point; readonly to: Point } {
  const cardCentre = rectCenter(card);
  const targetCentre = rectCenter(target);
  const dx = targetCentre.x - cardCentre.x;
  const dy = targetCentre.y - cardCentre.y;
  // Which pair of edges face each other: compare the offset with the half sizes involved.
  const horizontalGap = Math.abs(dx) - (card.width + target.width) / 2;
  const verticalGap = Math.abs(dy) - (card.height + target.height) / 2;
  const vertical = verticalGap >= horizontalGap;
  if (vertical) {
    const down = dy >= 0;
    const fromX = clamp(
      clamp(targetCentre.x, card.left + 28, rectRight(card) - 28),
      card.left,
      rectRight(card),
    );
    const toX = clamp(
      fromX,
      target.left + Math.min(16, target.width / 2),
      rectRight(target) - Math.min(16, target.width / 2),
    );
    return {
      from: { x: fromX, y: down ? rectBottom(card) : card.top },
      to: { x: toX, y: down ? target.top - outset : rectBottom(target) + outset },
    };
  }
  const right = dx >= 0;
  const fromY = clamp(
    clamp(targetCentre.y, card.top + 28, rectBottom(card) - 28),
    card.top,
    rectBottom(card),
  );
  const toY = clamp(
    fromY,
    target.top + Math.min(16, target.height / 2),
    rectBottom(target) - Math.min(16, target.height / 2),
  );
  return {
    from: { x: right ? rectRight(card) : card.left, y: fromY },
    to: { x: right ? target.left - outset : rectRight(target) + outset, y: toY },
  };
}

/** An arrow between points this close together would be a smudge: the ring alone is enough. */
export const ARROW_MIN_DISTANCE = 28;

export function arrowWorthDrawing(from: Point, to: Point): boolean {
  return Math.hypot(to.x - from.x, to.y - from.y) >= ARROW_MIN_DISTANCE;
}

export interface ArrowGeometry {
  /** The shaft: a smooth curve with a small curl in the middle. */
  readonly d: string;
  /** The arrowhead: two short strokes meeting at the tip. */
  readonly head: string;
  /** Rough length of the shaft in pixels. */
  readonly length: number;
}

/** Small deterministic generator, so the same arrow is drawn the same way every time. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const SAMPLES = 40;
/** Arrows shorter than this are drawn without the curl: there is no room for a flourish. */
const CURL_MIN_LENGTH = 70;
/** Head strokes: length and spread from the shaft's direction, a little uneven on purpose. */
const HEAD_LENGTHS = [14, 11] as const;
const HEAD_SPREAD = (28 * Math.PI) / 180;

function fixed(value: number): string {
  return (Math.round(value * 10) / 10).toString();
}

function cubicAt(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
}

/** Catmull-Rom through the points, written as cubic Bézier segments. */
function smoothPath(points: readonly Point[]): string {
  const first = points[0];
  if (!first) return '';
  let path = `M${fixed(first.x)} ${fixed(first.y)}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const before = points[Math.max(0, index - 1)] as Point;
    const from = points[index] as Point;
    const to = points[index + 1] as Point;
    const after = points[Math.min(points.length - 1, index + 2)] as Point;
    const c1 = { x: from.x + (to.x - before.x) / 6, y: from.y + (to.y - before.y) / 6 };
    const c2 = { x: to.x - (after.x - from.x) / 6, y: to.y - (after.y - from.y) / 6 };
    path += `C${fixed(c1.x)} ${fixed(c1.y)} ${fixed(c2.x)} ${fixed(c2.y)} ${fixed(to.x)} ${fixed(to.y)}`;
  }
  return path;
}

/**
 * A hand-drawn looking arrow from `from` to `to`: an S-shaped bow, a small loop a third of the
 * way along, a hair of wobble, and a two-stroke head. `seed` varies the bow side and the wobble
 * between steps; the same inputs always give the same drawing.
 */
export function arrowGeometry(from: Point, to: Point, seed: number): ArrowGeometry {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length < 6) {
    return {
      d: `M${fixed(from.x)} ${fixed(from.y)}L${fixed(to.x)} ${fixed(to.y)}`,
      head: '',
      length,
    };
  }
  const random = seededRandom(seed * 7919 + 13);
  const tangent = { x: dx / length, y: dy / length };
  const normal = { x: -tangent.y, y: tangent.x };
  const side = random() < 0.5 ? -1 : 1;
  const bow = side * Math.min(length * 0.26, 64);
  const control1 = {
    x: from.x + tangent.x * length * 0.28 + normal.x * bow,
    y: from.y + tangent.y * length * 0.28 + normal.y * bow,
  };
  const control2 = {
    x: from.x + tangent.x * length * 0.74 - normal.x * bow * 0.45,
    y: from.y + tangent.y * length * 0.74 - normal.y * bow * 0.45,
  };
  const curl = length >= CURL_MIN_LENGTH;
  const curlStart = 0.34;
  const curlEnd = 0.58;
  // The loop must run backwards faster than the line runs forwards, or it is only a wiggle.
  const span = length * (curlEnd - curlStart);
  const loop = Math.max(Math.min(length * 0.05, 18), (span / (2 * Math.PI)) * 1.25, 8);
  const loopSide = -side;
  const points: Point[] = [];
  for (let index = 0; index <= SAMPLES; index += 1) {
    const t = index / SAMPLES;
    const base = cubicAt(from, control1, control2, to, t);
    let offsetAlong = 0;
    let offsetAcross = 0;
    if (curl && t > curlStart && t < curlEnd) {
      const angle = ((t - curlStart) / (curlEnd - curlStart)) * 2 * Math.PI;
      offsetAlong = -loop * Math.sin(angle);
      offsetAcross = loopSide * loop * (1 - Math.cos(angle));
    }
    const interior = index > 0 && index < SAMPLES;
    const wobble = interior ? (random() - 0.5) * 1.6 : 0;
    points.push({
      x: base.x + tangent.x * offsetAlong + normal.x * (offsetAcross + wobble),
      y: base.y + tangent.y * offsetAlong + normal.y * (offsetAcross + wobble),
    });
  }
  let shaft = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1] as Point;
    const current = points[index] as Point;
    shaft += Math.hypot(current.x - previous.x, current.y - previous.y);
  }
  const tip = points[points.length - 1] as Point;
  const back = points[points.length - 4] as Point;
  const heading = Math.atan2(tip.y - back.y, tip.x - back.x);
  const [leftLength, rightLength] = HEAD_LENGTHS;
  const left = {
    x: tip.x - Math.cos(heading - HEAD_SPREAD) * leftLength,
    y: tip.y - Math.sin(heading - HEAD_SPREAD) * leftLength,
  };
  const right = {
    x: tip.x - Math.cos(heading + HEAD_SPREAD) * rightLength,
    y: tip.y - Math.sin(heading + HEAD_SPREAD) * rightLength,
  };
  return {
    d: smoothPath(points),
    head: `M${fixed(left.x)} ${fixed(left.y)}L${fixed(tip.x)} ${fixed(tip.y)}L${fixed(right.x)} ${fixed(right.y)}`,
    length: shaft,
  };
}
