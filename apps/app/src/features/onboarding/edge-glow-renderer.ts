/**
 * The living edge of the tour: light streaks that stream toward the screen edges inside a narrow
 * band, and a few twinkling sparkles. The centre stays clear. The simulation is plain arrays and
 * numbers (testable without a canvas); the drawing needs only the 2D path/stroke API, so the same
 * code runs on a main-thread canvas or an OffscreenCanvas inside a worker.
 */

export interface GlowCanvasContext {
  clearRect(x: number, y: number, width: number, height: number): void;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
  fill(): void;
  arc(x: number, y: number, radius: number, start: number, end: number): void;
  lineWidth: number;
  lineCap: CanvasLineCap;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  fillStyle: string | CanvasGradient | CanvasPattern;
  globalCompositeOperation: GlobalCompositeOperation;
}

/** Edge of the screen a particle flows toward: top, right, bottom, left. */
type Edge = 0 | 1 | 2 | 3;

export interface GlowParticle {
  edge: Edge;
  /** Position along the edge, px. */
  along: number;
  /** Distance from the edge, px: starts at the inner border of the band and falls to 0. */
  depth: number;
  /** Speed toward the edge, px/s. */
  speed: number;
  /** Drift along the edge, px/s. */
  drift: number;
  /** Streak length at full speed, px. */
  length: number;
  width: number;
  /** Brightness 0..1. */
  bright: number;
  /** Depth the particle was born at, to turn depth into life. */
  born: number;
}

export interface GlowSparkle {
  x: number;
  y: number;
  size: number;
  phase: number;
  rate: number;
}

export interface GlowSimulation {
  readonly width: number;
  readonly height: number;
  readonly band: number;
  readonly particles: GlowParticle[];
  readonly sparkles: GlowSparkle[];
}

export interface GlowPalette {
  /** `r, g, b` of the streaks. */
  readonly streak: string;
  /** `r, g, b` of the bright core of streaks and sparkles. */
  readonly core: string;
}

export const LIGHT_PALETTE: GlowPalette = { streak: '34, 186, 96', core: '214, 255, 228' };
export const DARK_PALETTE: GlowPalette = { streak: '82, 226, 138', core: '226, 255, 238' };

export type Random = () => number;

export function mulberry32(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Width of the lit band: a slice of the short side, never a wide frame around the content. */
export function glowBand(width: number, height: number): number {
  return Math.min(120, Math.max(40, Math.min(width, height) * 0.13));
}

function spawnParticle(sim: GlowSimulation, random: Random, scatter: boolean): GlowParticle {
  const { width, height, band } = sim;
  // Edges are chosen in proportion to their length, so the light is even around the frame.
  const pick = random() * (width + height);
  const edge: Edge = pick < width / 2 ? 0 : pick < width ? 2 : pick < width + height / 2 ? 3 : 1;
  const horizontal = edge === 0 || edge === 2;
  const born = band * (0.55 + random() * 0.45);
  return {
    edge,
    along: random() * (horizontal ? width : height),
    depth: scatter ? born * random() : born,
    speed: 14 + random() * 40,
    drift: (random() - 0.5) * 26,
    length: 10 + random() * 26,
    width: 0.7 + random() * 1.5,
    bright: 0.45 + random() * 0.55,
    born,
  };
}

function spawnSparkle(sim: GlowSimulation, random: Random): GlowSparkle {
  const { width, height, band } = sim;
  const edge = Math.floor(random() * 4);
  const depth = random() * band * 0.8;
  const along = random();
  return {
    x: edge === 0 || edge === 2 ? along * width : edge === 1 ? width - depth : depth,
    y: edge === 1 || edge === 3 ? along * height : edge === 0 ? depth : height - depth,
    size: 2 + random() * 3.5,
    phase: random() * Math.PI * 2,
    rate: 1.4 + random() * 2.4,
  };
}

export function createSimulation(
  width: number,
  height: number,
  count: number,
  random: Random,
): GlowSimulation {
  const sim: GlowSimulation = {
    width,
    height,
    band: glowBand(width, height),
    particles: [],
    sparkles: [],
  };
  for (let index = 0; index < count; index += 1)
    sim.particles.push(spawnParticle(sim, random, true));
  const sparkleCount = Math.max(6, Math.round(count / 9));
  for (let index = 0; index < sparkleCount; index += 1)
    sim.sparkles.push(spawnSparkle(sim, random));
  return sim;
}

/** Moves every particle by `seconds`; one that reaches the edge is reborn at the band's border. */
export function stepSimulation(sim: GlowSimulation, seconds: number, random: Random): void {
  const { width, height } = sim;
  for (let index = 0; index < sim.particles.length; index += 1) {
    const particle = sim.particles[index] as GlowParticle;
    // The streak accelerates as it nears the edge: the «zoom» of light rushing outward.
    const life = 1 - particle.depth / particle.born;
    particle.depth -= particle.speed * (0.4 + life * 1.6) * seconds;
    particle.along += particle.drift * seconds;
    const span = particle.edge === 0 || particle.edge === 2 ? width : height;
    if (particle.along < 0) particle.along += span;
    else if (particle.along > span) particle.along -= span;
    if (particle.depth <= 0) sim.particles[index] = spawnParticle(sim, random, false);
  }
}

/** Opacity of a particle: it rises out of the dark, peaks mid-flight and goes out at the edge. */
export function particleAlpha(particle: GlowParticle, intensity: number): number {
  const life = Math.min(1, Math.max(0, 1 - particle.depth / particle.born));
  return Math.min(1, particle.bright * Math.sin(life * Math.PI) ** 0.7 * intensity);
}

function position(particle: GlowParticle, width: number, height: number): [number, number] {
  switch (particle.edge) {
    case 0:
      return [particle.along, particle.depth];
    case 1:
      return [width - particle.depth, particle.along];
    case 2:
      return [particle.along, height - particle.depth];
    default:
      return [particle.depth, particle.along];
  }
}

/** Unit step pointing from the edge into the screen, as a pair [dx, dy]. */
function inward(edge: Edge): [number, number] {
  return edge === 0 ? [0, 1] : edge === 1 ? [-1, 0] : edge === 2 ? [0, -1] : [1, 0];
}

export function drawSimulation(
  context: GlowCanvasContext,
  sim: GlowSimulation,
  palette: GlowPalette,
  intensity: number,
  seconds: number,
): void {
  context.clearRect(0, 0, sim.width, sim.height);
  context.globalCompositeOperation = 'lighter';
  context.lineCap = 'round';
  for (const particle of sim.particles) {
    const alpha = particleAlpha(particle, intensity);
    if (alpha < 0.02) continue;
    const [x, y] = position(particle, sim.width, sim.height);
    const [dx, dy] = inward(particle.edge);
    const life = 1 - particle.depth / particle.born;
    const length = particle.length * (0.5 + life);
    context.lineWidth = particle.width * 2.4;
    context.strokeStyle = `rgba(${palette.streak}, ${(alpha * 0.35).toFixed(3)})`;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + dx * length, y + dy * length);
    context.stroke();
    context.lineWidth = particle.width;
    context.strokeStyle = `rgba(${palette.core}, ${alpha.toFixed(3)})`;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + dx * length * 0.55, y + dy * length * 0.55);
    context.stroke();
  }
  for (const sparkle of sim.sparkles) {
    sparkle.phase += seconds * sparkle.rate;
    const twinkle = Math.max(0, Math.sin(sparkle.phase)) ** 3 * Math.min(1, intensity);
    if (twinkle < 0.03) continue;
    const arm = sparkle.size * (0.6 + twinkle);
    context.lineWidth = 1;
    context.strokeStyle = `rgba(${palette.core}, ${twinkle.toFixed(3)})`;
    context.beginPath();
    context.moveTo(sparkle.x - arm, sparkle.y);
    context.lineTo(sparkle.x + arm, sparkle.y);
    context.moveTo(sparkle.x, sparkle.y - arm);
    context.lineTo(sparkle.x, sparkle.y + arm);
    context.stroke();
    context.fillStyle = `rgba(${palette.streak}, ${(twinkle * 0.5).toFixed(3)})`;
    context.beginPath();
    context.arc(sparkle.x, sparkle.y, sparkle.size * 0.45, 0, Math.PI * 2);
    context.fill();
  }
}

/** Frames of a pulse: intensity decays from the peak back to the resting level. */
export function pulseIntensity(
  resting: number,
  peak: number,
  elapsedMs: number,
  durationMs: number,
): number {
  if (elapsedMs >= durationMs) return resting;
  const progress = Math.max(0, elapsedMs / durationMs);
  return resting + (peak - resting) * (1 - progress) ** 2;
}

export const RESTING_INTENSITY = 1;
export const PULSE_INTENSITY = 1.9;
export const PULSE_MS = 1800;
/** Particles for a screen: enough to feel alive, few enough for a mid-range phone. */
export function particleCount(width: number, height: number): number {
  return Math.round(Math.min(120, Math.max(60, (width + height) / 14)));
}
