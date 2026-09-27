/// <reference lib="webworker" />
import {
  createForceLayout,
  type ForceLayout,
  MAX_FORCE_ITERATIONS,
} from '@/features/library/knowledge-graph-force';
import { layoutLargeKnowledgeGraph } from '@/features/library/knowledge-graph-layout';
import {
  GRAPH_KIND_DOMAIN,
  type GraphLayoutRequest,
  type GraphLayoutResponse,
} from '@/features/library/knowledge-graph-worker-protocol';

/** Main-thread work is drawing only; the layout runs here in bounded time slices. */
const SLICE_MS = 12;
const REHEAT_ITERATIONS = 150;

let current = 0;
let layout: ForceLayout | null = null;
let budget = 0;
let iterations = 0;
let running = false;

function post(id: number, positions: Float32Array, settled: boolean): void {
  const copy = positions.slice();
  const message: GraphLayoutResponse = {
    type: 'positions',
    id,
    positions: copy,
    settled,
    iterations,
  };
  self.postMessage(message, [copy.buffer]);
}

function run(id: number): void {
  if (id !== current || !layout) return;
  const started = performance.now();
  let settled = false;
  while (performance.now() - started < SLICE_MS) {
    iterations += 1;
    budget -= 1;
    layout.step();
    if (layout.settled() || budget <= 0) {
      settled = true;
      break;
    }
  }
  if (settled) layout.resolveCollisions();
  post(id, layout.positions, settled);
  running = !settled;
  if (running) setTimeout(() => run(id), 0);
}

function reheat(id: number): void {
  layout?.reheat();
  budget = Math.max(budget, REHEAT_ITERATIONS);
  if (!running) {
    running = true;
    setTimeout(() => run(id), 0);
  }
}

self.onmessage = (event: MessageEvent<GraphLayoutRequest>) => {
  const message = event.data;
  if (message.type === 'start') {
    current = message.id;
    layout = null;
    running = false;
    iterations = 0;
    if (message.mode === 'grid') {
      const count = message.kinds.length;
      const nodes = Array.from({ length: count }, (_, index) => ({
        id: String(index),
        kind:
          message.kinds[index] === GRAPH_KIND_DOMAIN ? ('domain' as const) : ('document' as const),
        documentId: null,
        x: 0,
        y: 0,
      }));
      const edges = Array.from({ length: message.edges.length / 2 }, (_, index) => ({
        from: String(message.edges[index * 2]),
        to: String(message.edges[index * 2 + 1]),
      }));
      layoutLargeKnowledgeGraph(nodes, edges);
      const positions = new Float32Array(count * 2);
      nodes.forEach((node, index) => {
        positions[index * 2] = node.x;
        positions[index * 2 + 1] = node.y;
      });
      post(message.id, positions, true);
      return;
    }
    layout = createForceLayout({
      positions: message.positions,
      edges: message.edges,
      radii: message.radii,
      groups: message.groups,
      gap: message.gap,
      spacing: message.spacing,
    });
    budget = MAX_FORCE_ITERATIONS;
    running = true;
    run(message.id);
    return;
  }
  if (message.id !== current || !layout) return;
  if (message.type === 'pin') {
    layout.pin(message.index, message.x, message.y);
    reheat(message.id);
  } else if (message.type === 'unpin') {
    layout.unpin(message.index);
    reheat(message.id);
  } else if (message.type === 'stop') {
    running = false;
    layout = null;
  }
};
