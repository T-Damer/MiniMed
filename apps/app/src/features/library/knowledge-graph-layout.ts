export type KnowledgeGraphNodeKind = 'domain' | 'document';

export interface KnowledgeGraphLayoutNode {
  readonly id: string;
  readonly kind: KnowledgeGraphNodeKind;
  readonly documentId: string | null;
  x: number;
  y: number;
}

export interface KnowledgeGraphLayoutEdge {
  readonly from: string;
  readonly to: string;
}

export interface KnowledgeGraphBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly width: number;
  readonly height: number;
}

export const LARGE_GRAPH_NODE_LIMIT = 500;

/** Drawn node radii and the clear gap kept between any two node circles, in world units. */
export const GRAPH_DOCUMENT_RADIUS = 17;
export const GRAPH_DOMAIN_RADIUS = 26;
export const GRAPH_NODE_GAP = 12;
/** Closest centre distance of two documents: one diameter plus the gap. */
export const GRAPH_DOCUMENT_SPACING = GRAPH_DOCUMENT_RADIUS * 2 + GRAPH_NODE_GAP;

/** Height reserved under an area node for its label. */
const DOMAIN_LABEL_ROOM = 16;

export function graphNodeRadius(kind: KnowledgeGraphNodeKind): number {
  return kind === 'domain' ? GRAPH_DOMAIN_RADIUS : GRAPH_DOCUMENT_RADIUS;
}

export function shouldUseStaticKnowledgeGraphLayout(nodeCount: number): boolean {
  return nodeCount > LARGE_GRAPH_NODE_LIMIT;
}

/**
 * Place each domain and its documents in a compact deterministic grid. The
 * layout is linear in nodes plus edges and does not need a running simulation.
 */
export function layoutLargeKnowledgeGraph(
  nodes: KnowledgeGraphLayoutNode[],
  edges: readonly KnowledgeGraphLayoutEdge[],
): KnowledgeGraphBounds {
  const domains = nodes.filter((node) => node.kind === 'domain');
  const documents = nodes.filter((node) => node.kind === 'document');
  const domainIds = new Set(domains.map((node) => node.id));
  const documentDomains = new Map<string, string>();
  for (const edge of edges) {
    if (domainIds.has(edge.from) && !documentDomains.has(edge.to)) {
      documentDomains.set(edge.to, edge.from);
    }
  }

  const groups = new Map<string, KnowledgeGraphLayoutNode[]>();
  for (const document of documents) {
    const groupId = documentDomains.get(document.id) ?? '__unassigned__';
    const group = groups.get(groupId);
    if (group) group.push(document);
    else groups.set(groupId, [document]);
  }

  // One document diameter plus the gap between neighbours; blocks of areas two steps apart.
  const spacing = GRAPH_DOCUMENT_SPACING;
  const blockGap = spacing * 2;
  // The area node, room for its label, then the first row of documents.
  const firstRowOffset =
    GRAPH_DOMAIN_RADIUS * 2 + GRAPH_NODE_GAP + DOMAIN_LABEL_ROOM + GRAPH_DOCUMENT_RADIUS;
  const targetWidth = Math.max(900, Math.ceil(Math.sqrt(Math.max(1, documents.length))) * spacing);
  let cursorX = 0;
  let cursorY = 0;
  let rowHeight = 0;
  const groupEntries = [
    ...domains.map((domain) => ({ id: domain.id, domain, documents: groups.get(domain.id) ?? [] })),
    ...(groups.has('__unassigned__')
      ? [{ id: '__unassigned__', domain: undefined, documents: groups.get('__unassigned__') ?? [] }]
      : []),
  ];

  for (const group of groupEntries) {
    const columns = Math.max(1, Math.ceil(Math.sqrt(group.documents.length)));
    const rows = Math.max(1, Math.ceil(group.documents.length / columns));
    const groupWidth = Math.max(120, columns * spacing);
    const groupHeight = firstRowOffset + rows * spacing;
    if (cursorX > 0 && cursorX + groupWidth > targetWidth) {
      cursorX = 0;
      cursorY += rowHeight + blockGap;
      rowHeight = 0;
    }

    const centerX = cursorX + groupWidth / 2;
    if (group.domain) {
      group.domain.x = centerX;
      group.domain.y = cursorY + GRAPH_DOMAIN_RADIUS;
    }
    group.documents.forEach((document, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      document.x = cursorX + (column + 0.5) * spacing;
      document.y = cursorY + firstRowOffset + row * spacing;
    });
    cursorX += groupWidth + blockGap;
    rowHeight = Math.max(rowHeight, groupHeight);
  }

  return knowledgeGraphBounds(nodes);
}

export function knowledgeGraphBounds(
  nodes: readonly KnowledgeGraphLayoutNode[],
): KnowledgeGraphBounds {
  if (nodes.length === 0) {
    return { minX: -1, maxX: 1, minY: -1, maxY: 1, width: 2, height: 2 };
  }
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const node of nodes) {
    minX = Math.min(minX, node.x);
    maxX = Math.max(maxX, node.x);
    minY = Math.min(minY, node.y);
    maxY = Math.max(maxY, node.y);
  }
  const padding = 40;
  minX -= padding;
  maxX += padding;
  minY -= padding;
  maxY += padding;
  return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}
