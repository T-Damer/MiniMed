import {
  GRAPH_DOCUMENT_RADIUS,
  GRAPH_DOCUMENT_SPACING,
  GRAPH_DOMAIN_RADIUS,
  GRAPH_NODE_GAP,
} from '@/features/library/knowledge-graph-layout';
import {
  GRAPH_KIND_DOCUMENT,
  GRAPH_KIND_DOMAIN,
} from '@/features/library/knowledge-graph-worker-protocol';

/** Layout input shaped like the graph component builds it; domains come first. */
export interface TestGraph {
  readonly positions: Float32Array;
  readonly edges: Uint32Array;
  readonly kinds: Uint8Array;
  readonly radii: Float32Array;
  readonly groups: Int32Array;
  readonly gap: number;
  readonly spacing: number;
}

/** Deterministic PRNG (mulberry32) so generated graphs are identical on every run. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** `areas[d]` lists the domains of document d, primary first. */
export function graphFromAreas(
  domainCount: number,
  areas: readonly (readonly number[])[],
): TestGraph {
  const n = domainCount + areas.length;
  const positions = new Float32Array(n * 2);
  const kinds = new Uint8Array(n).fill(GRAPH_KIND_DOCUMENT);
  const radii = new Float32Array(n).fill(GRAPH_DOCUMENT_RADIUS);
  const groups = new Int32Array(n).fill(-1);
  for (let domain = 0; domain < domainCount; domain += 1) {
    // The component's initial rings: domains close to the centre, documents around them.
    const angle = (domain / Math.max(1, domainCount)) * Math.PI * 2;
    positions[domain * 2] = Math.cos(angle) * 80;
    positions[domain * 2 + 1] = Math.sin(angle) * 70;
    kinds[domain] = GRAPH_KIND_DOMAIN;
    radii[domain] = GRAPH_DOMAIN_RADIUS;
    groups[domain] = domain;
  }
  const edgeList: number[] = [];
  areas.forEach((documentAreas, document) => {
    const node = domainCount + document;
    const angle = (document / areas.length) * Math.PI * 2;
    positions[node * 2] = Math.cos(angle) * 190;
    positions[node * 2 + 1] = Math.sin(angle) * 150;
    groups[node] = documentAreas[0] ?? -1;
    for (const domain of documentAreas) edgeList.push(domain, node);
  });
  return {
    positions,
    edges: Uint32Array.from(edgeList),
    kinds,
    radii,
    groups,
    gap: GRAPH_NODE_GAP,
    spacing: Math.min(
      GRAPH_DOCUMENT_SPACING * 3,
      Math.max(GRAPH_DOCUMENT_SPACING, Math.sqrt((1232 * 640) / n)),
    ),
  };
}

/** One area holding every document, like a single ATC group («Нервная система»). */
export function starGraph(documents: number): TestGraph {
  return graphFromAreas(
    1,
    Array.from({ length: documents }, () => [0]),
  );
}

/**
 * A search neighbourhood: documents spread over many areas with a few large ones (Zipf-like),
 * each in one to five areas, about three on average, as in the «Все источники» sample.
 */
export function neighbourhoodGraph(documents: number, domains = 50, seed = 7): TestGraph {
  const next = random(seed);
  const weights = Array.from({ length: domains }, (_, index) => 1 / (index + 1));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const pick = (): number => {
    let target = next() * total;
    for (let index = 0; index < domains; index += 1) {
      target -= weights[index] ?? 0;
      if (target <= 0) return index;
    }
    return domains - 1;
  };
  const areas = Array.from({ length: documents }, () => {
    const count = 1 + Math.floor(next() * 5);
    const chosen = new Set<number>();
    while (chosen.size < count) chosen.add(pick());
    return [...chosen];
  });
  return graphFromAreas(domains, areas);
}
