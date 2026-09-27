import { afterEach, describe, expect, it, vi } from 'vitest';

import { graphOverlap } from '@/features/library/knowledge-graph-force';
import {
  neighbourhoodGraph,
  starGraph,
  type TestGraph,
} from '@/features/library/knowledge-graph-test-helpers';
import type {
  GraphLayoutRequest,
  GraphLayoutResponse,
} from '@/features/library/knowledge-graph-worker-protocol';

async function loadWorker() {
  const posted: GraphLayoutResponse[] = [];
  const scope: { onmessage: ((event: MessageEvent<GraphLayoutRequest>) => void) | null } & {
    postMessage: (message: GraphLayoutResponse) => void;
  } = { onmessage: null, postMessage: (message) => posted.push(message) };
  vi.stubGlobal('self', scope);
  vi.resetModules();
  await import('@/features/library/knowledge-graph.worker');
  const send = (data: GraphLayoutRequest) =>
    scope.onmessage?.({ data } as MessageEvent<GraphLayoutRequest>);
  return { posted, send };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('knowledge graph layout worker', () => {
  it('returns the static grid for large graphs in one settled message', async () => {
    const { posted, send } = await loadWorker();
    send({ type: 'start', id: 1, mode: 'grid', ...starGraph(600) });
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ id: 1, settled: true });
    expect(posted[0]?.positions).toHaveLength(601 * 2);
  });

  it('streams force-layout positions in time slices until it settles', async () => {
    vi.useFakeTimers();
    const { posted, send } = await loadWorker();
    send({ type: 'start', id: 7, mode: 'force', ...starGraph(120) });
    for (let tick = 0; tick < 200 && !posted.at(-1)?.settled; tick += 1)
      await vi.advanceTimersByTimeAsync(1);
    expect(posted.length).toBeGreaterThan(0);
    expect(posted.at(-1)).toMatchObject({ id: 7, settled: true });
    expect(posted.every((message) => message.id === 7)).toBe(true);
  });

  it('settles with under 1% of node circles intersecting', async () => {
    vi.useFakeTimers();
    for (const [id, input] of [
      [11, starGraph(300)],
      [12, neighbourhoodGraph(300)],
    ] as const satisfies readonly (readonly [number, TestGraph])[]) {
      const { posted, send } = await loadWorker();
      send({ type: 'start', id, mode: 'force', ...input });
      for (let tick = 0; tick < 2000 && !posted.at(-1)?.settled; tick += 1)
        await vi.advanceTimersByTimeAsync(1);
      const last = posted.at(-1);
      expect(last).toMatchObject({ id, settled: true });
      const overlap = graphOverlap(last?.positions ?? new Float32Array(0), input.radii);
      expect(overlap.pairs).toBeLessThan(0.01);
      expect(overlap.nodes).toBeLessThan(0.01);
    }
  });

  it('ignores pins for a superseded layout', async () => {
    vi.useFakeTimers();
    const { posted, send } = await loadWorker();
    send({ type: 'start', id: 1, mode: 'grid', ...starGraph(10) });
    send({ type: 'pin', id: 99, index: 0, x: 1, y: 1 });
    await vi.advanceTimersByTimeAsync(10);
    expect(posted.every((message) => message.id === 1)).toBe(true);
  });
});
