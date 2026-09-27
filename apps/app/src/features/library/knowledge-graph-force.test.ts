import { describe, expect, it } from 'vitest';

import {
  createForceLayout,
  graphOverlap,
  MAX_FORCE_ITERATIONS,
  settleForceLayout,
} from '@/features/library/knowledge-graph-force';
import {
  graphFromAreas,
  neighbourhoodGraph,
  starGraph,
} from '@/features/library/knowledge-graph-test-helpers';

const distance = (positions: Float32Array, a: number, b: number): number =>
  Math.hypot(
    (positions[a * 2] ?? 0) - (positions[b * 2] ?? 0),
    (positions[a * 2 + 1] ?? 0) - (positions[b * 2 + 1] ?? 0),
  );

describe('Barnes–Hut force layout', () => {
  it('stops by convergence or its iteration budget, losing most of its energy', () => {
    const small = createForceLayout(starGraph(30));
    expect(settleForceLayout(small)).toBeLessThan(MAX_FORCE_ITERATIONS);
    expect(small.settled()).toBe(true);

    const large = createForceLayout(starGraph(400));
    const initial = large.step();
    expect(settleForceLayout(large)).toBeLessThan(MAX_FORCE_ITERATIONS);
    expect(large.settled()).toBe(true);
    expect(large.step()).toBeLessThan(initial / 5);
    expect([...large.positions].every(Number.isFinite)).toBe(true);
  });

  it('keeps every circle clear of the others by the gap, around a hub and between areas', () => {
    for (const graph of [starGraph(300), neighbourhoodGraph(300)]) {
      const layout = createForceLayout(graph);
      settleForceLayout(layout);
      // Share of intersecting circles after convergence: the acceptance target is below 1%.
      const overlap = graphOverlap(layout.positions, graph.radii);
      expect(overlap.pairs).toBeLessThan(0.01);
      expect(overlap.nodes).toBeLessThan(0.01);
    }
  });

  it('fills a disc around a large hub instead of one crowded ring', () => {
    const graph = starGraph(300);
    const layout = createForceLayout(graph);
    settleForceLayout(layout);
    const distances = Array.from({ length: 300 }, (_, index) =>
      distance(layout.positions, 0, index + 1),
    ).toSorted((a, b) => a - b);
    // Documents sit at many radii: the inner tenth is far closer than the outer tenth.
    expect(distances[30] ?? 0).toBeLessThan((distances[270] ?? 0) / 2);
    expect(distances[0] ?? 0).toBeGreaterThanOrEqual(17 + 26 + 12 - 0.5);
  });

  it('keeps separate areas in separate clusters', () => {
    // Two areas of 60 documents each, sharing none.
    const areas = Array.from({ length: 120 }, (_, index) => [index < 60 ? 0 : 1]);
    const layout = createForceLayout(graphFromAreas(2, areas));
    settleForceLayout(layout);
    const centroid = (area: number) => {
      let x = 0;
      let y = 0;
      for (let index = 0; index < 60; index += 1) {
        const node = 2 + area * 60 + index;
        x += layout.positions[node * 2] ?? 0;
        y += layout.positions[node * 2 + 1] ?? 0;
      }
      return { x: x / 60, y: y / 60 };
    };
    const first = centroid(0);
    const second = centroid(1);
    // Each cluster's disc has radius spacing·√(60/π) ≈ 200; their centres stay farther apart.
    expect(Math.hypot(first.x - second.x, first.y - second.y)).toBeGreaterThan(400);
  });

  it('keeps a pinned node exactly where the pointer put it', () => {
    const layout = createForceLayout(starGraph(20));
    layout.pin(3, 500, -400);
    for (let step = 0; step < 50; step += 1) layout.step();
    expect([layout.positions[6], layout.positions[7]]).toEqual([500, -400]);
    layout.unpin(3);
    layout.step();
    expect(layout.positions[6]).not.toBe(500);
  });

  it('handles coincident nodes without NaN', () => {
    const layout = createForceLayout({
      positions: new Float32Array(20),
      edges: new Uint32Array(0),
      radii: new Float32Array(10).fill(17),
      groups: new Int32Array(10).fill(-1),
      gap: 12,
      spacing: 46,
    });
    for (let step = 0; step < 20; step += 1) layout.step();
    layout.resolveCollisions();
    expect([...layout.positions].every(Number.isFinite)).toBe(true);
    expect(graphOverlap(layout.positions, new Float32Array(10).fill(17)).nodes).toBe(0);
  });
});
