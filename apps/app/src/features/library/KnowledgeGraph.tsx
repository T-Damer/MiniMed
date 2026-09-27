import type { MedicalDocumentSummary } from '@localmed/contracts';
import { createEffect, createSignal, type JSX, onCleanup, onMount, Show } from 'solid-js';

import { Button } from '@/components/Button';

import {
  type GraphTone,
  graphDomainColor,
  graphToneForSourceType,
  graphTonesForTheme,
  readGraphThemeColors,
} from '@/features/library/graph-tones';
import {
  GRAPH_DOCUMENT_SPACING,
  GRAPH_NODE_GAP,
  graphNodeRadius,
  type KnowledgeGraphBounds,
  knowledgeGraphBounds,
  shouldUseStaticKnowledgeGraphLayout,
} from '@/features/library/knowledge-graph-layout';
import { graphDomains, OTHER_DOCUMENTS_DOMAIN } from '@/features/library/knowledge-graph-model';
import {
  GRAPH_KIND_DOCUMENT,
  GRAPH_KIND_DOMAIN,
  type GraphLayoutRequest,
  type GraphLayoutResponse,
} from '@/features/library/knowledge-graph-worker-protocol';
import { browserI18n, getPluralMessage } from '@/i18n/browser-i18n';
import { documentCountLabel, specialtyLabel } from '@/i18n/labels';

interface KnowledgeGraphProps {
  readonly documents: readonly MedicalDocumentSummary[];
  readonly selectedId: string | undefined;
  readonly onSelect: (id: string) => void;
  readonly variant?: 'standalone' | 'dialog';
  /** Documents in the whole scope when only a neighbourhood is shown. */
  readonly total?: number;
  /** Explicit action that replaces the neighbourhood with the whole scope. */
  readonly onShowAll?: () => void;
}

type GraphNodeKind = 'domain' | 'document';

interface GraphNode {
  readonly id: string;
  readonly kind: GraphNodeKind;
  readonly label: string;
  readonly documentId: string | null;
  readonly tone: GraphTone;
  /** Fill colors of the areas this node belongs to; several areas render as equal pie slices. */
  readonly areaColors: readonly string[];
  /** Number of edges; orders which labels win when they would overlap. */
  degree: number;
  x: number;
  y: number;
}

interface GraphEdge {
  readonly from: string;
  readonly to: string;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

interface WorldRect {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/** Fill paths per colour and outline paths per width for the nodes inside `region`. */
interface NodeBatches {
  readonly key: string;
  readonly region: WorldRect;
  /** No node was left out, so the paths stay valid for any viewport. */
  readonly complete: boolean;
  readonly fills: Map<string, Path2D>;
  readonly outlines: Map<number, Path2D>;
}

const rectArea = (rect: WorldRect): number =>
  Math.max(0, rect.right - rect.left) * Math.max(0, rect.bottom - rect.top);

/** World-space cell of the hit-test index; larger than the biggest node radius. */
const HIT_CELL = 64;
/** Screen-space cell of the label-collision index. */
const LABEL_CELL = 96;

interface GraphTheme {
  readonly text: string;
  readonly graphStroke: string;
  readonly danger: string;
  readonly canvasFill: string;
  readonly dark: boolean;
}

function buildGraph(
  documents: readonly MedicalDocumentSummary[],
  dark: boolean,
): {
  readonly nodes: GraphNode[];
  readonly edges: GraphEdge[];
} {
  const domains = new Map<string, GraphNode>();
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const count = Math.max(1, documents.length);

  documents.forEach((document, index) => {
    const angle = (index / count) * Math.PI * 2;
    const specialties = graphDomains(document);
    const documentNode: GraphNode = {
      id: `document:${document.id}`,
      kind: 'document',
      label: document.shortTitle ?? document.title,
      documentId: document.id,
      tone: graphToneForSourceType(document.sourceType),
      areaColors: specialties.map((specialty) => graphDomainColor(specialty, dark)),
      degree: specialties.length,
      x: Math.cos(angle) * 190,
      y: Math.sin(angle) * 150,
    };
    nodes.push(documentNode);

    specialties.forEach((specialty, specialtyIndex) => {
      let domain = domains.get(specialty);
      if (!domain) {
        const domainAngle =
          ((domains.size + specialtyIndex) / Math.max(1, count / 2)) * Math.PI * 2;
        domain = {
          id: `domain:${specialty}`,
          kind: 'domain',
          label:
            specialty === OTHER_DOCUMENTS_DOMAIN
              ? browserI18n.getMessage('specialty_other_documents')
              : specialtyLabel(specialty),
          documentId: null,
          tone: 'other',
          areaColors: [graphDomainColor(specialty, dark)],
          degree: 0,
          x: Math.cos(domainAngle) * 80,
          y: Math.sin(domainAngle) * 70,
        };
        domains.set(specialty, domain);
        nodes.push(domain);
      }
      domain.degree += 1;
      edges.push({ from: domain.id, to: documentNode.id });
    });
  });

  return { nodes, edges };
}

function shortLabel(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

export function KnowledgeGraph(props: KnowledgeGraphProps): JSX.Element {
  let canvas: HTMLCanvasElement | undefined;
  let drawFrame: number | undefined;
  let observer: ResizeObserver | undefined;
  let worker: Worker | undefined;
  let layoutId = 0;
  let nodes: GraphNode[] = [];
  let edges: GraphEdge[] = [];
  let nodesById = new Map<string, GraphNode>();
  let nodeIndex = new Map<GraphNode, number>();
  let width = 900;
  let height = 540;
  let scale = 1;
  let panX = 0;
  let panY = 0;
  let pointerStart: Point | null = null;
  let pointerLast: Point | null = null;
  const activePointers = new Map<number, Point>();
  let pinchStartDistance: number | null = null;
  let pinchStartCenter: Point | null = null;
  let pinchStartWorld: Point | null = null;
  let pinchStartScale = 1;
  let draggedNode: GraphNode | null = null;
  let hoveredNodeId: string | null = null;
  let moved = false;
  let viewInteracted = false;
  let staticLayout = false;
  let layoutBounds: KnowledgeGraphBounds | null = null;
  let hitIndex = new Map<string, GraphNode[]>();
  let hitIndexDirty = true;
  /** Bumped whenever a node moves; keys the cached node paths of static layouts. */
  let layoutVersion = 0;
  let nodeBatchCache: NodeBatches | null = null;
  let graphTheme: GraphTheme = readGraphThemeColors(document.documentElement);
  let themeObserver: MutationObserver | undefined;
  const [layoutState, setLayoutState] = createSignal<'pending' | 'running' | 'settled'>('pending');

  /** Scale at which the whole laid-out graph fits the canvas. */
  const fittingScale = (): number =>
    layoutBounds
      ? Math.min((width - 48) / layoutBounds.width, (height - 48) / layoutBounds.height)
      : Number.POSITIVE_INFINITY;

  const clampScale = (value: number): number => {
    // Zooming out stops at the usual minimum, or where the whole graph fits if that is smaller.
    const minimum = Math.max(0.001, Math.min(staticLayout ? 0.08 : 0.55, fittingScale()));
    return Math.max(minimum, Math.min(2.4, value));
  };

  /** Fits the laid-out graph to the canvas until the user pans or zooms; never enlarges it. */
  const fitLayout = (): void => {
    if (!layoutBounds) return;
    scale = clampScale(Math.min(1, fittingScale()));
    panX = -((layoutBounds.minX + layoutBounds.maxX) / 2) * scale;
    panY = -((layoutBounds.minY + layoutBounds.maxY) / 2) * scale;
  };

  /** At most one redraw per frame, however many pointer or layout events arrive. */
  const scheduleDraw = (): void => {
    if (drawFrame !== undefined) return;
    drawFrame = requestAnimationFrame(() => {
      drawFrame = undefined;
      draw();
    });
  };

  const resize = (): void => {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = Math.max(320, rect.width);
    height = Math.max(380, rect.height);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const context = canvas.getContext('2d');
    context?.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!viewInteracted) fitLayout();
    draw();
  };

  const screenToWorld = (point: Point): Point => ({
    x: (point.x - width / 2 - panX) / scale,
    y: (point.y - height / 2 - panY) / scale,
  });

  const cellKey = (x: number, y: number): string =>
    `${Math.floor(x / HIT_CELL)}:${Math.floor(y / HIT_CELL)}`;

  /** Spatial hash rebuilt lazily after the layout moves, so hit tests stay O(1). */
  const rebuildHitIndex = (): void => {
    hitIndex = new Map();
    for (const node of nodes) {
      const key = cellKey(node.x, node.y);
      const cell = hitIndex.get(key);
      if (cell) cell.push(node);
      else hitIndex.set(key, [node]);
    }
    hitIndexDirty = false;
  };

  const hitTest = (point: Point): GraphNode | null => {
    if (hitIndexDirty) rebuildHitIndex();
    const world = screenToWorld(point);
    const column = Math.floor(world.x / HIT_CELL);
    const row = Math.floor(world.y / HIT_CELL);
    let nearest: GraphNode | null = null;
    let distance = Number.POSITIVE_INFINITY;
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (const node of hitIndex.get(`${column + dx}:${row + dy}`) ?? []) {
          // A few pixels of slack around the drawn circle.
          const radius = graphNodeRadius(node.kind) + 5;
          const candidate = Math.hypot(world.x - node.x, world.y - node.y);
          if (candidate <= radius && candidate < distance) {
            nearest = node;
            distance = candidate;
          }
        }
      }
    }
    return nearest;
  };

  const draw = (): void => {
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const theme = graphTheme;
    const tones = graphTonesForTheme(theme.dark);
    context.fillStyle = theme.canvasFill;
    context.fillRect(0, 0, width, height);
    if (layoutState() === 'pending') {
      // Initial ring positions would draw every node in one clump; wait for the worker's layout.
      context.fillStyle = theme.text;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.font = '500 14px Arial';
      context.fillText('Раскладываем граф…', width / 2, height / 2);
      return;
    }
    context.save();
    context.translate(width / 2 + panX, height / 2 + panY);
    context.scale(scale, scale);

    const viewport = {
      left: (-width / 2 - panX) / scale - 80,
      right: (width / 2 - panX) / scale + 80,
      top: (-height / 2 - panY) / scale - 80,
      bottom: (height / 2 - panY) / scale + 80,
    };
    const isVisible = (x: number, y: number, radius: number): boolean =>
      x + radius >= viewport.left &&
      x - radius <= viewport.right &&
      y + radius >= viewport.top &&
      y - radius <= viewport.bottom;
    const focusedNodeIds = new Set<string>();
    if (staticLayout) {
      if (hoveredNodeId) focusedNodeIds.add(hoveredNodeId);
      if (props.selectedId) focusedNodeIds.add(`document:${props.selectedId}`);
    }
    const showAllEdges = !staticLayout || scale >= 0.35;

    context.lineWidth = 1 / scale;
    context.strokeStyle = theme.graphStroke;
    context.globalAlpha = 0.35;
    context.beginPath();
    if (showAllEdges || focusedNodeIds.size > 0) {
      for (const edge of edges) {
        const from = nodesById.get(edge.from);
        const to = nodesById.get(edge.to);
        if (!from || !to) continue;
        if (
          (!showAllEdges && !focusedNodeIds.has(from.id) && !focusedNodeIds.has(to.id)) ||
          Math.max(from.x, to.x) < viewport.left ||
          Math.min(from.x, to.x) > viewport.right ||
          Math.max(from.y, to.y) < viewport.top ||
          Math.min(from.y, to.y) > viewport.bottom
        ) {
          continue;
        }
        context.moveTo(from.x, from.y);
        context.lineTo(to.x, to.y);
      }
    }
    context.stroke();
    context.globalAlpha = 1;

    const showLabels = scale >= (staticLayout ? 0.85 : 0.7);
    const selectedId = props.selectedId;
    const nodeRadius = (node: GraphNode): number => graphNodeRadius(node.kind);
    const outlineWidth = (node: GraphNode, emphasized: boolean): number =>
      emphasized ? 2.8 : node.kind === 'document' && staticLayout && scale < 0.35 ? 0.35 : 1.35;
    const nodeColors = (node: GraphNode): readonly string[] => {
      const tone = node.kind === 'domain' ? tones.other : tones[node.tone];
      return node.areaColors.length > 0 ? node.areaColors : [tone.fill];
    };
    /** Adds a node's fill (equal pie slices, one per area) to the path of each colour. */
    const addNodeFill = (node: GraphNode, paths: Map<string, Path2D>): void => {
      const radius = nodeRadius(node);
      const colors = nodeColors(node);
      const slice = (Math.PI * 2) / colors.length;
      colors.forEach((color, index) => {
        let path = paths.get(color);
        if (!path) {
          path = new Path2D();
          paths.set(color, path);
        }
        if (colors.length === 1) {
          path.moveTo(node.x + radius, node.y);
          path.arc(node.x, node.y, radius, 0, Math.PI * 2);
          return;
        }
        const start = -Math.PI / 2 + index * slice;
        // fill() closes each wedge; closePath() on a path this long costs more than the draw.
        path.moveTo(node.x, node.y);
        path.arc(node.x, node.y, radius, start, start + slice);
      });
    };
    const fillPaths = (paths: Map<string, Path2D>): void => {
      for (const [color, path] of paths) {
        context.fillStyle = color;
        context.fill(path);
      }
    };

    // Static layouts never overlap nodes, so ordinary nodes paint as one path per fill colour and
    // one per outline width; twenty thousand separate arc/fill/stroke calls cost a whole frame.
    // The paths cover the viewport plus half a screen on each side and are reused while panning
    // and zooming stay inside that region (or always, once it holds every node), so a gesture
    // frame only fills cached paths.
    // Selected and hovered nodes stay in the paths and are repainted on top, so hovering never
    // invalidates them.
    const batchKey = `${layoutVersion}|${theme.dark}|${scale < 0.35}`;
    let batches: NodeBatches | null = null;
    if (staticLayout) {
      const cached = nodeBatchCache;
      const viewportArea = rectArea(viewport);
      batches =
        cached &&
        cached.key === batchKey &&
        (cached.complete ||
          (cached.region.left <= viewport.left &&
            cached.region.right >= viewport.right &&
            cached.region.top <= viewport.top &&
            cached.region.bottom >= viewport.bottom &&
            rectArea(cached.region) <= viewportArea * 16))
          ? cached
          : null;
      if (!batches) {
        const marginX = (viewport.right - viewport.left) / 2;
        const marginY = (viewport.bottom - viewport.top) / 2;
        const region = {
          left: viewport.left - marginX,
          right: viewport.right + marginX,
          top: viewport.top - marginY,
          bottom: viewport.bottom + marginY,
        };
        const fills = new Map<string, Path2D>();
        const outlines = new Map<number, Path2D>();
        let complete = true;
        for (const node of nodes) {
          const radius = nodeRadius(node);
          if (
            node.x + radius < region.left ||
            node.x - radius > region.right ||
            node.y + radius < region.top ||
            node.y - radius > region.bottom
          ) {
            complete = false;
            continue;
          }
          addNodeFill(node, fills);
          const lineWidth = outlineWidth(node, false);
          let outline = outlines.get(lineWidth);
          if (!outline) {
            outline = new Path2D();
            outlines.set(lineWidth, outline);
          }
          outline.moveTo(node.x + radius, node.y);
          outline.arc(node.x, node.y, radius, 0, Math.PI * 2);
        }
        batches = { key: batchKey, region, complete, fills, outlines };
        nodeBatchCache = batches;
      }
      fillPaths(batches.fills);
      context.strokeStyle = theme.graphStroke;
      for (const [lineWidth, outline] of batches.outlines) {
        context.lineWidth = lineWidth / scale;
        context.stroke(outline);
      }
    }

    const detailed: Array<{ node: GraphNode; batched: boolean; label: boolean }> = [];
    for (const node of nodes) {
      const emphasized = node.documentId === selectedId || node.id === hoveredNodeId;
      const batched = staticLayout && !emphasized;
      const showNodeLabel = node.kind === 'domain' || showLabels || emphasized;
      // Batched shapes are already painted; only labels and individual shapes remain.
      if (batched && !showNodeLabel) continue;
      const radius = nodeRadius(node);
      const labelPadding = node.kind === 'domain' ? 120 / scale : 38;
      if (!isVisible(node.x, node.y, radius + (showNodeLabel ? labelPadding : 0))) continue;
      detailed.push({ node, batched, label: showNodeLabel });
    }

    for (const { node, batched } of detailed) {
      if (batched) continue;
      const selected = node.documentId === selectedId;
      const hovered = node.id === hoveredNodeId;
      const fills = new Map<string, Path2D>();
      addNodeFill(node, fills);
      fillPaths(fills);
      context.beginPath();
      context.arc(node.x, node.y, nodeRadius(node), 0, Math.PI * 2);
      context.strokeStyle = selected ? theme.danger : theme.graphStroke;
      context.lineWidth = outlineWidth(node, selected || hovered) / scale;
      context.stroke();
    }

    // Labels never overlap: placed greedily (selected, hovered, then by degree) and skipped when
    // their screen box meets one already placed. A screen-space grid keeps the check local.
    const labelPriority = (node: GraphNode): number =>
      node.documentId === selectedId ? 2 : node.id === hoveredNodeId ? 1 : 0;
    const labelled = detailed
      .filter((entry) => entry.label)
      .map((entry) => entry.node)
      .sort(
        (left, right) => labelPriority(right) - labelPriority(left) || right.degree - left.degree,
      );
    const placedLabels = new Map<string, WorldRect[]>();
    const labelCells = (box: WorldRect): string[] => {
      const keys: string[] = [];
      for (
        let x = Math.floor(box.left / LABEL_CELL);
        x <= Math.floor(box.right / LABEL_CELL);
        x += 1
      )
        for (
          let y = Math.floor(box.top / LABEL_CELL);
          y <= Math.floor(box.bottom / LABEL_CELL);
          y += 1
        )
          keys.push(`${x}:${y}`);
      return keys;
    };
    context.textAlign = 'center';
    context.textBaseline = 'top';
    context.fillStyle = theme.text;
    let font = '';
    for (const node of labelled) {
      const domain = node.kind === 'domain';
      const nextFont = domain ? `600 ${12 / scale}px Arial` : '500 11px Arial';
      if (nextFont !== font) {
        context.font = nextFont;
        font = nextFont;
      }
      const label = shortLabel(node.label, domain ? 26 : 32);
      const labelY = node.y + nodeRadius(node) + (domain ? 8 / scale : GRAPH_NODE_GAP);
      const labelWidth = context.measureText(label).width * scale;
      const screenX = width / 2 + panX + node.x * scale;
      const screenY = height / 2 + panY + labelY * scale;
      const box = {
        left: screenX - labelWidth / 2,
        right: screenX + labelWidth / 2,
        top: screenY,
        bottom: screenY + (domain ? 14 : 13 * scale),
      };
      const cells = labelCells(box);
      const overlaps = cells.some((key) =>
        (placedLabels.get(key) ?? []).some(
          (other) =>
            box.left < other.right &&
            box.right > other.left &&
            box.top < other.bottom &&
            box.bottom > other.top,
        ),
      );
      if (overlaps && labelPriority(node) === 0) continue;
      for (const key of cells) {
        const cell = placedLabels.get(key);
        if (cell) cell.push(box);
        else placedLabels.set(key, [box]);
      }
      context.fillText(label, node.x, labelY);
    }

    context.restore();
  };

  const postToWorker = (message: GraphLayoutRequest, transfer: Transferable[] = []): void => {
    worker?.postMessage(message, transfer);
  };

  const applyPositions = (message: GraphLayoutResponse): void => {
    if (message.id !== layoutId) return;
    setLayoutState(message.settled ? 'settled' : 'running');
    const positions = message.positions;
    nodes.forEach((node, index) => {
      if (node === draggedNode) return;
      node.x = positions[index * 2] ?? node.x;
      node.y = positions[index * 2 + 1] ?? node.y;
    });
    hitIndexDirty = true;
    layoutVersion += 1;
    layoutBounds = knowledgeGraphBounds(nodes);
    if (!viewInteracted) fitLayout();
    scheduleDraw();
  };

  /** Hands the layout to the worker: a bounded force layout, or the static grid when large. */
  const startLayout = (): void => {
    layoutId += 1;
    setLayoutState('pending');
    if (!worker) return;
    const positions = new Float32Array(nodes.length * 2);
    const kinds = new Uint8Array(nodes.length);
    const radii = new Float32Array(nodes.length);
    const groups = new Int32Array(nodes.length).fill(-1);
    let domainCount = 0;
    nodes.forEach((node, index) => {
      positions[index * 2] = node.x;
      positions[index * 2 + 1] = node.y;
      kinds[index] = node.kind === 'domain' ? GRAPH_KIND_DOMAIN : GRAPH_KIND_DOCUMENT;
      radii[index] = graphNodeRadius(node.kind);
      if (node.kind === 'domain') {
        groups[index] = domainCount;
        domainCount += 1;
      }
    });
    const edgeIndices = new Uint32Array(edges.length * 2);
    edges.forEach((edge, index) => {
      const from = nodesById.get(edge.from);
      const to = nodesById.get(edge.to);
      const fromIndex = from ? (nodeIndex.get(from) ?? 0) : 0;
      const toIndex = to ? (nodeIndex.get(to) ?? 0) : 0;
      edgeIndices[index * 2] = fromIndex;
      edgeIndices[index * 2 + 1] = toIndex;
      // A document's first area is its primary group.
      if ((groups[toIndex] ?? -1) < 0) groups[toIndex] = groups[fromIndex] ?? -1;
    });
    // Density sets the scale: the canvas area per node, never closer than a document's spacing.
    const spacing = Math.min(
      GRAPH_DOCUMENT_SPACING * 3,
      Math.max(GRAPH_DOCUMENT_SPACING, Math.sqrt((width * height) / Math.max(1, nodes.length))),
    );
    postToWorker(
      {
        type: 'start',
        id: layoutId,
        mode: staticLayout ? 'grid' : 'force',
        positions,
        edges: edgeIndices,
        kinds,
        radii,
        groups,
        gap: GRAPH_NODE_GAP,
        spacing,
      },
      [positions.buffer, edgeIndices.buffer, kinds.buffer, radii.buffer, groups.buffer],
    );
  };

  const rebuildGraph = (dark: boolean, fit = false): void => {
    const graph = buildGraph(props.documents, dark);
    nodes = graph.nodes;
    edges = graph.edges;
    nodesById = new Map(nodes.map((node) => [node.id, node] as const));
    nodeIndex = new Map(nodes.map((node, index) => [node, index] as const));
    hitIndexDirty = true;
    layoutVersion += 1;
    staticLayout = shouldUseStaticKnowledgeGraphLayout(nodes.length);
    layoutBounds = null;
    if (fit) {
      scale = 1;
      panX = 0;
      panY = 0;
      hoveredNodeId = null;
      viewInteracted = false;
    }
    startLayout();
    scheduleDraw();
  };

  createEffect(() => {
    props.documents;
    rebuildGraph(graphTheme.dark, true);
  });

  const refreshGraphTheme = (): void => {
    if (!canvas) return;
    const nextTheme = readGraphThemeColors(canvas);
    const rebuild = nextTheme.dark !== graphTheme.dark;
    const changed =
      rebuild ||
      nextTheme.text !== graphTheme.text ||
      nextTheme.graphStroke !== graphTheme.graphStroke ||
      nextTheme.danger !== graphTheme.danger ||
      nextTheme.canvasFill !== graphTheme.canvasFill;
    graphTheme = nextTheme;
    if (rebuild) rebuildGraph(graphTheme.dark);
    else if (changed) scheduleDraw();
  };

  onMount(() => {
    if (!canvas) return;
    worker = new Worker(new URL('./knowledge-graph.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (event: MessageEvent<GraphLayoutResponse>) => applyPositions(event.data);
    observer = new ResizeObserver(resize);
    observer.observe(canvas);
    themeObserver = new MutationObserver(refreshGraphTheme);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme'],
    });
    refreshGraphTheme();
    resize();
    // The first effect ran before the worker existed; lay out the current graph now.
    startLayout();
  });

  onCleanup(() => {
    if (drawFrame !== undefined) cancelAnimationFrame(drawFrame);
    worker?.terminate();
    observer?.disconnect();
    themeObserver?.disconnect();
  });

  const pinDragged = (): void => {
    if (!draggedNode || staticLayout) return;
    postToWorker({
      type: 'pin',
      id: layoutId,
      index: nodeIndex.get(draggedNode) ?? -1,
      x: draggedNode.x,
      y: draggedNode.y,
    });
  };

  const releaseDragged = (): void => {
    if (draggedNode && !staticLayout)
      postToWorker({ type: 'unpin', id: layoutId, index: nodeIndex.get(draggedNode) ?? -1 });
    draggedNode = null;
  };

  const pointFromEvent = (event: PointerEvent): Point => {
    const rect = canvas?.getBoundingClientRect();
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
  };

  const endPointer = (event: PointerEvent): void => {
    activePointers.delete(event.pointerId);
    if (pinchStartDistance !== null) {
      pinchStartDistance = null;
      pinchStartCenter = null;
      pinchStartWorld = null;
      pointerStart = null;
      pointerLast = null;
      releaseDragged();
      if (canvas?.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      scheduleDraw();
      return;
    }
    const point = pointFromEvent(event);
    if (!moved) {
      const node = hitTest(point);
      if (node?.documentId) props.onSelect(node.documentId);
    }
    releaseDragged();
    pointerStart = null;
    pointerLast = null;
    if (canvas?.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    scheduleDraw();
  };

  return (
    <section
      class="knowledge-graph-card paper-card"
      classList={{ 'knowledge-graph-card--dialog': props.variant === 'dialog' }}
      aria-label={browserI18n.getMessage('graph_aria_label')}
      data-node-count={props.documents.length}
      data-layout-state={layoutState()}
    >
      <Show when={props.variant !== 'dialog'}>
        <header>
          <div>
            <p class="archive-kicker">{browserI18n.getMessage('graph_kicker')}</p>
            <h2 id="knowledge-graph-title">{browserI18n.getMessage('graph_title')}</h2>
            <p>{browserI18n.getMessage('graph_hint')}</p>
          </div>
          <span>{documentCountLabel(props.documents.length)}</span>
        </header>
      </Show>

      <canvas
        ref={(element) => {
          canvas = element;
        }}
        class="knowledge-graph-canvas"
        aria-label={browserI18n.getMessage('graph_aria_label')}
        onPointerDown={(event) => {
          if (!canvas) return;
          canvas.setPointerCapture(event.pointerId);
          const point = pointFromEvent(event);
          activePointers.set(event.pointerId, point);
          if (activePointers.size === 2) {
            releaseDragged();
            pointerStart = null;
            pointerLast = null;
            const points = [...activePointers.values()];
            const first = points[0];
            const second = points[1];
            if (first && second) {
              pinchStartDistance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
              pinchStartCenter = {
                x: (first.x + second.x) / 2,
                y: (first.y + second.y) / 2,
              };
              pinchStartWorld = screenToWorld(pinchStartCenter);
              pinchStartScale = scale;
              moved = true;
            }
            return;
          }
          pointerStart = point;
          pointerLast = point;
          draggedNode = hitTest(point);
          moved = false;
          pinDragged();
        }}
        onPointerMove={(event) => {
          const point = pointFromEvent(event);
          activePointers.set(event.pointerId, point);
          if (
            activePointers.size >= 2 &&
            pinchStartDistance !== null &&
            pinchStartCenter &&
            pinchStartWorld
          ) {
            event.preventDefault();
            const points = [...activePointers.values()];
            const first = points[0];
            const second = points[1];
            if (!first || !second) return;
            const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
            const center = {
              x: (first.x + second.x) / 2,
              y: (first.y + second.y) / 2,
            };
            scale = clampScale(pinchStartScale * (distance / pinchStartDistance));
            viewInteracted = true;
            panX = center.x - width / 2 - pinchStartWorld.x * scale;
            panY = center.y - height / 2 - pinchStartWorld.y * scale;
            scheduleDraw();
            return;
          }
          if (!pointerLast) {
            // Hover only while no button is pressed: dragging a node dirties the hit index on
            // every move, and rebuilding it for a large graph would cost each frame.
            const hit = hitTest(point);
            const nextHoveredNodeId = hit?.id ?? null;
            if (nextHoveredNodeId !== hoveredNodeId) {
              hoveredNodeId = nextHoveredNodeId;
              scheduleDraw();
            }
            return;
          }
          const dx = point.x - pointerLast.x;
          const dy = point.y - pointerLast.y;
          if (
            Math.hypot(
              point.x - (pointerStart?.x ?? point.x),
              point.y - (pointerStart?.y ?? point.y),
            ) > 4
          ) {
            moved = true;
          }
          if (draggedNode) {
            draggedNode.x += dx / scale;
            draggedNode.y += dy / scale;
            hitIndexDirty = true;
            layoutVersion += 1;
            pinDragged();
          } else {
            panX += dx;
            panY += dy;
          }
          viewInteracted = true;
          pointerLast = point;
          scheduleDraw();
        }}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onPointerLeave={() => {
          if (pointerLast) return;
          hoveredNodeId = null;
          scheduleDraw();
        }}
        onWheel={(event) => {
          event.preventDefault();
          const factor = event.deltaY > 0 ? 0.9 : 1.1;
          scale = clampScale(scale * factor);
          viewInteracted = true;
          scheduleDraw();
        }}
      />

      <Show when={(props.total ?? props.documents.length) > props.documents.length}>
        <div class="knowledge-graph-card__summary" role="status">
          <span class="knowledge-graph-card__summary-text">
            Показано {props.documents.length.toLocaleString('ru-RU')} из{' '}
            {getPluralMessage('graph_of_documents', props.total ?? props.documents.length)}
          </span>
          <Show when={props.onShowAll}>
            {(showAll) => (
              <Button
                class="knowledge-graph-card__show-all"
                variant="secondary"
                onClick={() => showAll()()}
              >
                Показать все
              </Button>
            )}
          </Show>
        </div>
      </Show>

      <div class="knowledge-graph-legend">
        <span>
          <i class="domain" /> {browserI18n.getMessage('graph_legend_domain')}
        </span>
        <span>
          <i class="clinical" /> КР
        </span>
        <span>
          <i class="drug" /> Препараты
        </span>
        <span>
          <i class="legal" /> Право
        </span>
        <span>
          <i class="notes" /> Заметки
        </span>
      </div>
    </section>
  );
}
