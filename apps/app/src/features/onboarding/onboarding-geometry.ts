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
  /** The shaft: a few smooth cubic Béziers with a small loop (curl) in the middle. */
  readonly d: string;
  /** The arrowhead: two short curved strokes meeting at the tip, aligned with the shaft's end. */
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

/** Arrows shorter than this are drawn without the curl: there is no room for a flourish. */
const CURL_MIN_LENGTH = 110;
/** Circle approximation by four cubic Béziers. */
const KAPPA = 0.5522847498;
const HEAD_LENGTH = 17;
const HEAD_SPREAD = (30 * Math.PI) / 180;

function fixed(value: number): string {
  return (Math.round(value * 100) / 100).toString();
}

type Cubic = readonly [Point, Point, Point, Point];

/** Local frame: `u` along the arrow, `v` across it (positive toward `side`). */
function frame(from: Point, tangent: Point, normal: Point, side: number) {
  return (u: number, v: number): Point => ({
    x: from.x + tangent.x * u + normal.x * v * side,
    y: from.y + tangent.y * u + normal.y * v * side,
  });
}

function pathOf(segments: readonly Cubic[]): string {
  const start = segments[0]?.[0];
  if (!start) return '';
  let path = `M${fixed(start.x)} ${fixed(start.y)}`;
  for (const [, c1, c2, end] of segments) {
    path += `C${fixed(c1.x)} ${fixed(c1.y)} ${fixed(c2.x)} ${fixed(c2.y)} ${fixed(end.x)} ${fixed(end.y)}`;
  }
  return path;
}

function cubicLength(segment: Cubic): number {
  let length = 0;
  let previous = segment[0];
  for (let step = 1; step <= 12; step += 1) {
    const t = step / 12;
    const u = 1 - t;
    const point = {
      x:
        u * u * u * segment[0].x +
        3 * u * u * t * segment[1].x +
        3 * u * t * t * segment[2].x +
        t * t * t * segment[3].x,
      y:
        u * u * u * segment[0].y +
        3 * u * u * t * segment[1].y +
        3 * u * t * t * segment[2].y +
        t * t * t * segment[3].y,
    };
    length += Math.hypot(point.x - previous.x, point.y - previous.y);
    previous = point;
  }
  return length;
}

/**
 * A hand-drawn looking arrow from `from` to `to`, built only from cubic Béziers that join with the
 * same tangent: a gentle S-bow with one small loop in the middle, then a two-stroke head turned to
 * the shaft's last direction. `seed` varies the bow side and the proportions between steps; the
 * same inputs always give the same drawing.
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
  const at = frame(from, tangent, normal, side);
  const bow = Math.min(length * (0.16 + random() * 0.06), 46);
  const landing = Math.min(length * 0.12, 22);
  const segments: Cubic[] = [];
  const end = at(length, 0);
  if (length < CURL_MIN_LENGTH) {
    segments.push([
      at(0, 0),
      at(length * 0.3, bow),
      at(length * 0.7, -bow * 0.4 - landing * 0.2),
      end,
    ]);
  } else {
    // The loop sits on the line at `centre`; the line enters and leaves it heading along `u`.
    const radius = Math.min(Math.max(length * 0.045, 8), 15);
    const centre = length * (0.42 + random() * 0.1);
    const rx = radius * 1.2;
    const ry = radius;
    const entry = at(centre - rx * 0.2, 0);
    const exit = at(centre + rx * 0.2, 0);
    const lead = Math.max(centre * 0.45, 12);
    segments.push([
      at(0, 0),
      at(centre * 0.28, bow),
      at(centre - rx * 0.2 - lead, bow * 0.15),
      entry,
    ]);
    // Counter-clockwise ellipse from the entry point round to the exit point.
    const cu = centre;
    const bottomLeft = at(cu - rx * 0.2, 0);
    const right = at(cu + rx, ry);
    const top = at(cu, ry * 2);
    const left = at(cu - rx, ry);
    segments.push([
      bottomLeft,
      at(cu - rx * 0.2 + rx * KAPPA * 1.2, 0),
      at(cu + rx, ry - ry * KAPPA),
      right,
    ]);
    segments.push([right, at(cu + rx, ry + ry * KAPPA), at(cu + rx * KAPPA, ry * 2), top]);
    segments.push([top, at(cu - rx * KAPPA, ry * 2), at(cu - rx, ry + ry * KAPPA), left]);
    segments.push([
      left,
      at(cu - rx, ry - ry * KAPPA),
      at(cu - rx * 0.2 - rx * KAPPA * 0.6, 0),
      exit,
    ]);
    const run = length - (centre + rx * 0.2);
    segments.push([
      exit,
      at(centre + rx * 0.2 + run * 0.35, -bow * 0.1),
      at(length - run * 0.3, -landing),
      end,
    ]);
  }
  const last = segments[segments.length - 1] as Cubic;
  const heading = Math.atan2(last[3].y - last[2].y, last[3].x - last[2].x);
  const wing = (turn: number, size: number): Point => ({
    x: end.x - Math.cos(heading + turn) * size,
    y: end.y - Math.sin(heading + turn) * size,
  });
  const left = wing(-HEAD_SPREAD, HEAD_LENGTH);
  const right = wing(HEAD_SPREAD, HEAD_LENGTH * 0.88);
  // Each wing bows slightly outward, so the head reads as drawn by hand rather than ruled.
  const bend = (wingEnd: Point, sign: number): Point => ({
    x: (wingEnd.x + end.x) / 2 + Math.sin(heading) * sign * 1.6,
    y: (wingEnd.y + end.y) / 2 - Math.cos(heading) * sign * 1.6,
  });
  const leftBend = bend(left, 1);
  const rightBend = bend(right, -1);
  return {
    d: pathOf(segments),
    head: `M${fixed(left.x)} ${fixed(left.y)}Q${fixed(leftBend.x)} ${fixed(leftBend.y)} ${fixed(end.x)} ${fixed(end.y)}Q${fixed(rightBend.x)} ${fixed(rightBend.y)} ${fixed(right.x)} ${fixed(right.y)}`,
    length: segments.reduce((sum, segment) => sum + cubicLength(segment), 0),
  };
}
