import { describe, expect, it } from 'vitest';
import {
  createSimulation,
  drawSimulation,
  type GlowCanvasContext,
  glowBand,
  LIGHT_PALETTE,
  mulberry32,
  particleAlpha,
  particleCount,
  pulseIntensity,
  stepSimulation,
} from './edge-glow-renderer';

function recorder(): { context: GlowCanvasContext; strokes: number } {
  const state = { strokes: 0 };
  const noop = (): void => undefined;
  const context: GlowCanvasContext = {
    clearRect: noop,
    setTransform: noop,
    beginPath: noop,
    moveTo: noop,
    lineTo: noop,
    stroke: () => {
      state.strokes += 1;
    },
    fill: noop,
    arc: noop,
    lineWidth: 1,
    lineCap: 'butt',
    strokeStyle: '',
    fillStyle: '',
    globalCompositeOperation: 'source-over',
  };
  return {
    context,
    get strokes() {
      return state.strokes;
    },
  };
}

describe('edge glow simulation', () => {
  it('keeps the band narrow and the centre clear', () => {
    expect(glowBand(390, 844)).toBeLessThanOrEqual(120);
    expect(glowBand(390, 844)).toBeGreaterThanOrEqual(40);
    expect(glowBand(1280, 800)).toBeLessThan(800 / 4);
  });

  it('starts with the requested number of particles inside the band', () => {
    const sim = createSimulation(390, 844, 80, mulberry32(1));
    expect(sim.particles).toHaveLength(80);
    for (const particle of sim.particles) {
      expect(particle.depth).toBeGreaterThanOrEqual(0);
      expect(particle.depth).toBeLessThanOrEqual(sim.band);
    }
  });

  it('is deterministic for a seed', () => {
    const a = createSimulation(390, 844, 30, mulberry32(7));
    const b = createSimulation(390, 844, 30, mulberry32(7));
    expect(a.particles).toEqual(b.particles);
  });

  it('keeps the particle count and never lets one wander out of the band', () => {
    const random = mulberry32(3);
    const sim = createSimulation(390, 844, 90, random);
    for (let frame = 0; frame < 600; frame += 1) {
      stepSimulation(sim, 1 / 60, random);
      expect(sim.particles).toHaveLength(90);
      for (const particle of sim.particles) {
        expect(particle.depth).toBeGreaterThan(0);
        expect(particle.depth).toBeLessThanOrEqual(sim.band);
        const span = particle.edge === 0 || particle.edge === 2 ? sim.width : sim.height;
        expect(particle.along).toBeGreaterThanOrEqual(0);
        expect(particle.along).toBeLessThanOrEqual(span);
      }
    }
  });

  it('fades particles in at the band border and out at the edge', () => {
    const [first] = createSimulation(390, 844, 1, mulberry32(9)).particles;
    if (!first) throw new Error('no particle');
    const base = { ...first, born: 100, bright: 1 };
    expect(particleAlpha({ ...base, depth: 100 }, 1)).toBeCloseTo(0, 5);
    expect(particleAlpha({ ...base, depth: 50 }, 1)).toBeGreaterThan(0.9);
    expect(particleAlpha({ ...base, depth: 0 }, 1)).toBeCloseTo(0, 5);
    expect(particleAlpha({ ...base, depth: 50 }, 5)).toBeLessThanOrEqual(1);
  });

  it('draws strokes for visible particles', () => {
    const sim = createSimulation(390, 844, 60, mulberry32(5));
    const recorded = recorder();
    drawSimulation(recorded.context, sim, LIGHT_PALETTE, 1, 0.016);
    expect(recorded.strokes).toBeGreaterThan(20);
  });

  it('decays a pulse back to the resting level', () => {
    expect(pulseIntensity(1, 2, 0, 1000)).toBe(2);
    expect(pulseIntensity(1, 2, 500, 1000)).toBeCloseTo(1.25, 5);
    expect(pulseIntensity(1, 2, 1000, 1000)).toBe(1);
    expect(pulseIntensity(1, 2, 5000, 1000)).toBe(1);
  });

  it('scales the particle count with the screen within sane limits', () => {
    expect(particleCount(360, 640)).toBeGreaterThanOrEqual(60);
    expect(particleCount(1920, 1080)).toBeLessThanOrEqual(120);
  });
});
