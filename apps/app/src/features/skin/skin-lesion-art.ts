/**
 * Reference pictures of the skin atlas, drawn instead of photographed: photos of one condition
 * differ more than they agree, so each picture is a declared schema — skin, then layers of
 * morphological elements placed in a pattern — that this pure module turns into SVG shapes. The
 * same spec always draws the same picture (seeded), so a schema is reviewable as data.
 */
import type { SkinColor, SkinElement } from '@/features/skin/skin-atlas-terms';

export const LESION_PATTERNS = [
  'single',
  'cluster',
  'scattered',
  'annular',
  'linear',
  'dermatomal',
  'follicular',
] as const;
export const LESION_BORDERS = ['sharp', 'irregular', 'diffuse'] as const;
export const LESION_SURFACES = [
  'scale',
  'crust',
  'telangiectasia',
  'pearly',
  'umbilicated',
  'clearing',
  'halo',
  'rolled',
  'shine',
] as const;

export type LesionPattern = (typeof LESION_PATTERNS)[number];
export type LesionBorder = (typeof LESION_BORDERS)[number];
export type LesionSurface = (typeof LESION_SURFACES)[number];

export interface LesionLayer {
  readonly element: SkinElement;
  readonly pattern?: LesionPattern | undefined;
  readonly count?: number | undefined;
  /** Radius in the 0–100 picture; the element's own default when absent. */
  readonly size?: number | undefined;
  /** One colour, or several for a variegated lesion (the first is the base). */
  readonly colors?: readonly SkinColor[] | undefined;
  readonly border?: LesionBorder | undefined;
  readonly surface?: readonly LesionSurface[] | undefined;
  readonly seed?: number | undefined;
}

export interface LesionArt {
  /** Short Russian caption under the picture: «Типичная», «Узловая». */
  readonly caption: string;
  readonly background?: 'skin' | 'mucosa' | undefined;
  /** 1 light · 2 medium · 3 dark skin. */
  readonly tone?: 1 | 2 | 3 | undefined;
  readonly layers: readonly LesionLayer[];
}

export type ArtFilter = 'soft' | 'blur';

export type ArtShape =
  | {
      readonly kind: 'path';
      readonly d: string;
      readonly fill: string;
      readonly opacity?: number;
      readonly stroke?: string;
      readonly strokeWidth?: number;
      readonly filter?: ArtFilter;
    }
  | {
      readonly kind: 'circle';
      readonly cx: number;
      readonly cy: number;
      readonly r: number;
      readonly fill: string;
      readonly opacity?: number;
      readonly stroke?: string;
      readonly strokeWidth?: number;
      readonly filter?: ArtFilter;
    };

const SKIN_TONES: Record<1 | 2 | 3, { readonly base: string; readonly raised: string }> = {
  1: { base: '#f2d4bf', raised: '#e6bba0' },
  2: { base: '#d6a27c', raised: '#c48b63' },
  3: { base: '#8e5b3c', raised: '#7a4a2f' },
};
const MUCOSA = { base: '#df8c8c', raised: '#cf7474' } as const;

const PALETTE: Record<Exclude<SkinColor, 'skin'>, string> = {
  white: '#f8f1ea',
  pink: '#eba3a0',
  red: '#c8463f',
  brown: '#87573a',
  black: '#2a1c19',
  blue_gray: '#5d6c84',
  yellow: '#efd27b',
  purple: '#8b4a78',
};

/** Element defaults: radius and colour. */
const ELEMENT_DEFAULTS: Record<SkinElement, { readonly size: number; readonly color: SkinColor }> =
  {
    macule: { size: 14, color: 'red' },
    papule: { size: 4.5, color: 'red' },
    plaque: { size: 20, color: 'red' },
    nodule: { size: 12, color: 'pink' },
    vesicle: { size: 2.6, color: 'white' },
    bulla: { size: 9, color: 'white' },
    pustule: { size: 2.8, color: 'yellow' },
    wheal: { size: 13, color: 'pink' },
    erosion: { size: 8, color: 'red' },
    ulcer: { size: 17, color: 'red' },
    crust: { size: 8, color: 'yellow' },
    comedo: { size: 1.2, color: 'black' },
    petechia: { size: 1, color: 'purple' },
    scale: { size: 14, color: 'white' },
  };

const INFLAMED: ReadonlySet<SkinElement> = new Set([
  'pustule',
  'vesicle',
  'erosion',
  'ulcer',
  'papule',
]);

/** A small seeded generator (mulberry32): the same seed draws the same picture. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const round = (value: number): number => Math.round(value * 100) / 100;

/** A closed smooth outline around (cx, cy): low-frequency wobble of the radius, Catmull-Rom curve. */
export function blobPath(
  cx: number,
  cy: number,
  radius: number,
  irregularity: number,
  random: () => number,
  stretch = 1,
): string {
  const points = 16;
  const harmonics = [2, 3, 5].map((frequency) => ({
    frequency,
    phase: random() * Math.PI * 2,
    weight: random() * (frequency === 2 ? 1 : 0.6),
  }));
  const tilt = random() * Math.PI;
  const outline = Array.from({ length: points }, (_, index) => {
    const angle = (index / points) * Math.PI * 2;
    const wobble = harmonics.reduce(
      (sum, h) => sum + h.weight * Math.sin(angle * h.frequency + h.phase),
      0,
    );
    const r = radius * (1 + irregularity * wobble * 0.5);
    const x = Math.cos(angle) * r * stretch;
    const y = Math.sin(angle) * r;
    return [
      cx + x * Math.cos(tilt) - y * Math.sin(tilt),
      cy + x * Math.sin(tilt) + y * Math.cos(tilt),
    ] as const;
  });
  const at = (index: number): readonly [number, number] =>
    outline[(index + points) % points] ?? [cx, cy];
  let d = `M${round(at(0)[0])} ${round(at(0)[1])}`;
  for (let index = 0; index < points; index += 1) {
    const [x0, y0] = at(index - 1);
    const [x1, y1] = at(index);
    const [x2, y2] = at(index + 1);
    const [x3, y3] = at(index + 2);
    d += `C${round(x1 + (x2 - x0) / 6)} ${round(y1 + (y2 - y0) / 6)} ${round(x2 - (x3 - x1) / 6)} ${round(y2 - (y3 - y1) / 6)} ${round(x2)} ${round(y2)}`;
  }
  return `${d}Z`;
}

/** Centres of a layer's elements in the 0–100 picture. */
export function lesionPositions(
  pattern: LesionPattern,
  count: number,
  size: number,
  random: () => number,
): readonly (readonly [number, number])[] {
  const n = Math.max(1, Math.min(80, Math.round(count)));
  const jitter = (amount: number): number => (random() - 0.5) * 2 * amount;
  const spread = (picks: () => readonly [number, number]): (readonly [number, number])[] => {
    // Rejection sampling with a minimum gap so elements rarely sit on top of each other.
    const gap = size * 1.6;
    const placed: (readonly [number, number])[] = [];
    for (let attempt = 0; placed.length < n && attempt < n * 30; attempt += 1) {
      const point = picks();
      if (placed.every(([x, y]) => Math.hypot(x - point[0], y - point[1]) >= gap)) {
        placed.push(point);
      }
    }
    return placed;
  };
  switch (pattern) {
    case 'single':
      return [[50 + jitter(2), 50 + jitter(2)]];
    case 'cluster': {
      const reach = Math.max(8, size * Math.sqrt(n) * 1.2);
      return spread(() => {
        const angle = random() * Math.PI * 2;
        const distance = Math.sqrt(random()) * reach;
        return [50 + Math.cos(angle) * distance, 50 + Math.sin(angle) * distance];
      });
    }
    case 'scattered':
      return spread(() => [8 + random() * 84, 8 + random() * 84]);
    case 'annular':
      return Array.from({ length: n }, (_, index) => {
        const angle = (index / n) * Math.PI * 2 + jitter(0.12);
        const radius = 28 + jitter(2.5);
        return [50 + Math.cos(angle) * radius, 50 + Math.sin(angle) * radius] as const;
      });
    case 'linear':
      return Array.from({ length: n }, (_, index) => {
        const t = n === 1 ? 0.5 : index / (n - 1);
        return [14 + t * 72 + jitter(2), 72 - t * 44 + jitter(3)] as const;
      });
    case 'dermatomal':
      return spread(() => {
        const t = random();
        const across = jitter(11);
        return [6 + t * 88 + across * 0.45, 70 - t * 40 + across];
      });
    case 'follicular': {
      const step = 100 / Math.ceil(Math.sqrt(n));
      return spread(() => {
        const column = Math.floor(random() * Math.ceil(100 / step));
        const row = Math.floor(random() * Math.ceil(100 / step));
        return [
          step * (column + 0.5) + jitter(step * 0.15),
          step * (row + 0.5) + jitter(step * 0.15),
        ];
      });
    }
  }
}

function colorOf(color: SkinColor, raised: string): string {
  return color === 'skin' ? raised : PALETTE[color];
}

function background(art: LesionArt, random: () => number): ArtShape[] {
  const tone = art.background === 'mucosa' ? MUCOSA : SKIN_TONES[art.tone ?? 1];
  const shapes: ArtShape[] = [
    { kind: 'path', d: 'M0 0H100V100H0Z', fill: tone.base },
    // A soft lighter centre, as under a ring light.
    { kind: 'circle', cx: 46, cy: 42, r: 46, fill: '#ffffff', opacity: 0.12, filter: 'blur' },
  ];
  if (art.background === 'mucosa') {
    for (let index = 0; index < 4; index += 1) {
      const y = 15 + random() * 70;
      shapes.push({
        kind: 'path',
        d: `M${round(random() * 20)} ${round(y)}Q50 ${round(y + (random() - 0.5) * 20)} ${round(80 + random() * 20)} ${round(y + (random() - 0.5) * 10)}`,
        fill: 'none',
        stroke: '#b55a62',
        strokeWidth: 0.5,
        opacity: 0.45,
      });
    }
    shapes.push({
      kind: 'circle',
      cx: 30,
      cy: 28,
      r: 9,
      fill: '#ffffff',
      opacity: 0.18,
      filter: 'blur',
    });
  } else {
    for (let index = 0; index < 46; index += 1) {
      shapes.push({
        kind: 'circle',
        cx: round(random() * 100),
        cy: round(random() * 100),
        r: 0.35,
        fill: tone.raised,
        opacity: 0.7,
      });
    }
    for (let index = 0; index < 3; index += 1) {
      const y = 20 + index * 28 + random() * 8;
      shapes.push({
        kind: 'path',
        d: `M0 ${round(y)}Q50 ${round(y - 6 + random() * 12)} 100 ${round(y + random() * 6)}`,
        fill: 'none',
        stroke: tone.raised,
        strokeWidth: 0.4,
        opacity: 0.6,
      });
    }
  }
  return shapes;
}

function irregularityOf(border: LesionBorder | undefined, element: SkinElement): number {
  if (border === 'irregular') return 0.55;
  if (border === 'sharp') return 0.12;
  return element === 'plaque' || element === 'wheal' || element === 'macule' ? 0.3 : 0.16;
}

function dome(cx: number, cy: number, r: number, strength: number): ArtShape[] {
  return [
    {
      kind: 'circle',
      cx: round(cx + r * 0.22),
      cy: round(cy + r * 0.28),
      r: round(r * 0.95),
      fill: '#3b1f17',
      opacity: 0.18 * strength,
      filter: 'soft',
    },
    {
      kind: 'circle',
      cx: round(cx - r * 0.3),
      cy: round(cy - r * 0.32),
      r: round(r * 0.42),
      fill: '#ffffff',
      opacity: 0.32 * strength,
      filter: 'soft',
    },
  ];
}

function surfaceShapes(
  surface: readonly LesionSurface[],
  cx: number,
  cy: number,
  r: number,
  base: string,
  random: () => number,
): ArtShape[] {
  const shapes: ArtShape[] = [];
  for (const kind of surface) {
    if (kind === 'scale') {
      // Fine silvery flakes; on a ring (central clearing) only over the ring itself.
      const ring = surface.includes('clearing');
      for (let index = 0; index < Math.max(4, Math.round(r * 2.2)); index += 1) {
        const angle = random() * Math.PI * 2;
        const distance = ring ? r * (0.68 + random() * 0.24) : Math.sqrt(random()) * r * 0.8;
        shapes.push({
          kind: 'path',
          d: blobPath(
            cx + Math.cos(angle) * distance,
            cy + Math.sin(angle) * distance,
            Math.max(0.35, r * (0.035 + random() * 0.05)),
            0.6,
            random,
            1.8,
          ),
          fill: '#f7f3ee',
          opacity: 0.8,
        });
      }
    } else if (kind === 'crust') {
      shapes.push({
        kind: 'path',
        d: blobPath(cx + r * 0.1, cy, r * 0.6, 0.6, random),
        fill: '#d49a3c',
        opacity: 0.9,
      });
      shapes.push({
        kind: 'path',
        d: blobPath(cx + r * 0.15, cy + r * 0.1, r * 0.3, 0.7, random),
        fill: '#9a5b25',
        opacity: 0.7,
      });
    } else if (kind === 'telangiectasia') {
      for (let index = 0; index < 3; index += 1) {
        const angle = random() * Math.PI * 2;
        const x0 = cx + Math.cos(angle) * r * 0.7;
        const y0 = cy + Math.sin(angle) * r * 0.7;
        const x1 = cx - Math.cos(angle + 0.5) * r * 0.5;
        const y1 = cy - Math.sin(angle + 0.5) * r * 0.5;
        shapes.push({
          kind: 'path',
          d: `M${round(x0)} ${round(y0)}Q${round(cx + (random() - 0.5) * r)} ${round(cy + (random() - 0.5) * r)} ${round(x1)} ${round(y1)}`,
          fill: 'none',
          stroke: '#b3242a',
          strokeWidth: Math.max(0.25, r * 0.035),
          opacity: 0.85,
        });
      }
    } else if (kind === 'pearly') {
      shapes.push({
        kind: 'path',
        d: blobPath(cx, cy, r * 0.96, 0.12, random),
        fill: 'none',
        stroke: '#fff8f2',
        strokeWidth: Math.max(0.6, r * 0.14),
        opacity: 0.55,
        filter: 'soft',
      });
    } else if (kind === 'umbilicated') {
      shapes.push({ kind: 'circle', cx, cy, r: round(r * 0.22), fill: '#5a3426', opacity: 0.45 });
    } else if (kind === 'clearing') {
      shapes.push({
        kind: 'path',
        d: blobPath(cx, cy, r * 0.62, 0.25, random),
        fill: base,
        opacity: 0.92,
        filter: 'soft',
      });
    } else if (kind === 'rolled') {
      shapes.push({
        kind: 'path',
        d: blobPath(cx, cy, r * 0.92, 0.18, random),
        fill: 'none',
        stroke: '#f2c2b8',
        strokeWidth: Math.max(0.8, r * 0.16),
        opacity: 0.75,
      });
    } else if (kind === 'shine') {
      shapes.push({
        kind: 'path',
        d: blobPath(cx - r * 0.25, cy - r * 0.3, r * 0.28, 0.3, random, 2),
        fill: '#ffffff',
        opacity: 0.45,
        filter: 'soft',
      });
    }
  }
  return shapes;
}

/** One element at (cx, cy): its own body, then the surface marks declared for it. */
function elementShapes(
  layer: LesionLayer,
  cx: number,
  cy: number,
  r: number,
  base: string,
  raised: string,
  random: () => number,
): ArtShape[] {
  const colors = layer.colors?.length ? layer.colors : [ELEMENT_DEFAULTS[layer.element].color];
  const main = colorOf(colors[0] ?? 'red', raised);
  const irregularity = irregularityOf(layer.border, layer.element);
  const diffuse = layer.border === 'diffuse';
  const body = blobPath(cx, cy, r, irregularity, random);
  const shapes: ArtShape[] = [];
  const surface = layer.surface ?? [];
  if (surface.includes('halo')) {
    shapes.push({
      kind: 'circle',
      cx,
      cy,
      r: round(r * 1.55),
      // Inflamed elements have a red rim; a pigmented one (halo nevus) a white one.
      fill: INFLAMED.has(layer.element) ? PALETTE.red : PALETTE.white,
      opacity: 0.45,
      filter: 'soft',
    });
  }
  switch (layer.element) {
    case 'vesicle':
    case 'bulla':
      shapes.push(
        {
          kind: 'circle',
          cx,
          cy,
          r: round(r * 1.25),
          fill: PALETTE.red,
          opacity: 0.3,
          filter: 'soft',
        },
        {
          kind: 'path',
          d: body,
          fill: '#fff6e6',
          opacity: 0.78,
          stroke: '#e7b9a8',
          strokeWidth: 0.3,
        },
        {
          kind: 'circle',
          cx: round(cx - r * 0.35),
          cy: round(cy - r * 0.35),
          r: round(r * 0.25),
          fill: '#ffffff',
          opacity: 0.9,
        },
      );
      break;
    case 'pustule':
      shapes.push(
        {
          kind: 'circle',
          cx,
          cy,
          r: round(r * 1.7),
          fill: PALETTE.red,
          opacity: 0.4,
          filter: 'soft',
        },
        { kind: 'path', d: body, fill: main },
        ...dome(cx, cy, r, 0.8),
      );
      break;
    case 'wheal':
      shapes.push(
        {
          kind: 'path',
          d: blobPath(cx, cy, r * 1.12, irregularity, random),
          fill: PALETTE.red,
          opacity: 0.35,
          filter: 'soft',
        },
        { kind: 'path', d: body, fill: main, opacity: 0.95 },
        {
          kind: 'path',
          d: blobPath(cx, cy, r * 0.6, 0.3, random),
          fill: '#fbe4dc',
          opacity: 0.7,
          filter: 'soft',
        },
      );
      break;
    case 'ulcer':
      shapes.push(
        {
          kind: 'path',
          d: blobPath(cx, cy, r * 1.08, irregularity, random),
          fill: PALETTE.red,
          opacity: 0.5,
          filter: 'soft',
        },
        { kind: 'path', d: body, fill: '#8e2b2b' },
        {
          kind: 'path',
          d: blobPath(cx + r * 0.1, cy + r * 0.05, r * 0.5, 0.5, random),
          fill: '#e6cf7a',
          opacity: 0.85,
        },
        {
          kind: 'path',
          d: blobPath(cx - r * 0.3, cy - r * 0.2, r * 0.25, 0.5, random),
          fill: '#e6cf7a',
          opacity: 0.7,
        },
      );
      break;
    case 'erosion':
      shapes.push(
        { kind: 'path', d: body, fill: layer.colors?.length ? main : '#d8564e', opacity: 0.92 },
        {
          kind: 'path',
          d: blobPath(cx - r * 0.2, cy - r * 0.25, r * 0.3, 0.3, random, 2),
          fill: '#ffffff',
          opacity: 0.4,
          filter: 'soft',
        },
      );
      break;
    case 'crust':
      shapes.push(
        {
          kind: 'path',
          d: blobPath(cx, cy, r * 1.15, 0.4, random),
          fill: PALETTE.red,
          opacity: 0.35,
          filter: 'soft',
        },
        { kind: 'path', d: body, fill: '#d6a043' },
        {
          kind: 'path',
          d: blobPath(cx + r * 0.2, cy + r * 0.1, r * 0.45, 0.6, random),
          fill: '#a8672a',
          opacity: 0.75,
        },
      );
      break;
    case 'comedo':
    case 'petechia':
      shapes.push({ kind: 'circle', cx, cy, r: round(r), fill: main, opacity: 0.92 });
      break;
    case 'scale':
      shapes.push({ kind: 'path', d: body, fill: raised, opacity: 0.5 });
      break;
    default: {
      // macule, papule, plaque, nodule: a coloured body; raised ones get a dome of light.
      shapes.push({
        kind: 'path',
        d: body,
        fill: main,
        opacity: layer.element === 'macule' ? 0.88 : 1,
        ...(diffuse ? { filter: 'blur' as const } : {}),
      });
      // Variegation: patches of the other colours inside the body (melanoma, nevus).
      colors.slice(1).forEach((color, index) => {
        const angle = random() * Math.PI * 2;
        const distance = r * (0.15 + random() * 0.3);
        shapes.push({
          kind: 'path',
          d: blobPath(
            cx + Math.cos(angle) * distance,
            cy + Math.sin(angle) * distance,
            r * (0.45 - index * 0.08),
            0.5,
            random,
          ),
          fill: colorOf(color, raised),
          opacity: 0.85,
          filter: 'soft',
        });
      });
      if (layer.element !== 'macule') {
        shapes.push(...dome(cx, cy, r, layer.element === 'nodule' ? 1.2 : 0.8));
      }
    }
  }
  shapes.push(...surfaceShapes(surface, cx, cy, r, base, random));
  return shapes;
}

/** The whole picture of one spec, background first. */
export function lesionArtShapes(art: LesionArt): readonly ArtShape[] {
  const random = seededRandom(art.layers.reduce((sum, layer) => sum + (layer.seed ?? 7), 11));
  const tone = art.background === 'mucosa' ? MUCOSA : SKIN_TONES[art.tone ?? 1];
  const shapes = background(art, random);
  for (const layer of art.layers) {
    const layerRandom = seededRandom(layer.seed ?? 7);
    const size = layer.size ?? ELEMENT_DEFAULTS[layer.element].size;
    const positions = lesionPositions(
      layer.pattern ?? 'single',
      layer.count ?? 1,
      size,
      layerRandom,
    );
    for (const [x, y] of positions) {
      const r = size * (0.8 + layerRandom() * 0.4);
      shapes.push(...elementShapes(layer, x, y, r, tone.base, tone.raised, layerRandom));
    }
  }
  return shapes;
}
