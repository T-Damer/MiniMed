import type { MedicalDocumentSummary } from '@localmed/contracts';
import { createEffect, type JSX, onCleanup, onMount, Show } from 'solid-js';

import { type GraphTone, graphToneForSourceType } from '@/features/library/graph-tones';
import { browserI18n } from '@/i18n/browser-i18n';
import { documentCountLabel, specialtyLabel } from '@/i18n/labels';

interface KnowledgeGraphProps {
  readonly documents: readonly MedicalDocumentSummary[];
  readonly selectedId: string | undefined;
  readonly onSelect: (id: string) => void;
  readonly variant?: 'standalone' | 'dialog';
  readonly simulationActive?: boolean;
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
  x: number;
  y: number;
  vx: number;
  vy: number;
  fixed: boolean;
}

interface GraphEdge {
  readonly from: string;
  readonly to: string;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

const OTHER_DOCUMENTS_DOMAIN = '__other_documents__';

interface GraphTheme {
  readonly text: string;
  readonly graphStroke: string;
  readonly danger: string;
}

const TONES: Readonly<Record<GraphTone, { readonly fill: string }>> = {
  clinical: { fill: '#d9e6d2' },
  drug: { fill: '#d9e8ed' },
  legal: { fill: '#f1dfc4' },
  notes: { fill: '#ead9e5' },
  other: { fill: '#fbf7ea' },
};

function readCssVar(element: Element, name: string, fallback: string): string {
  const value = getComputedStyle(element).getPropertyValue(name).trim();
  return value || fallback;
}

function readGraphTheme(canvas: HTMLCanvasElement): GraphTheme {
  return {
    text: readCssVar(canvas, '--theme-text', '#292720'),
    graphStroke: readCssVar(canvas, '--theme-graph-stroke', '#817a6d'),
    danger: readCssVar(canvas, '--theme-danger', '#87453c'),
  };
}

/* Every medical area gets its own fill; a document in several areas is drawn as a pie of them.
   The palette is muted to sit on the paper theme, and the color is chosen by hashing the specialty
   key so an area keeps its color no matter which documents are installed. */
const DOMAIN_PALETTE: readonly string[] = [
  '#e3c6d2',
  '#c4d9e4',
  '#cfe0c2',
  '#e8d8b0',
  '#d5cde6',
  '#c2ded6',
  '#e6cbbd',
  '#dee3b8',
];

function domainColor(specialty: string): string {
  let hash = 0;
  for (let index = 0; index < specialty.length; index += 1) {
    hash = (hash * 31 + specialty.charCodeAt(index)) >>> 0;
  }
  return DOMAIN_PALETTE[hash % DOMAIN_PALETTE.length] ?? '#fbf7ea';
}

function shortLabel(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

function buildGraph(documents: readonly MedicalDocumentSummary[]): {
  readonly nodes: GraphNode[];
  readonly edges: GraphEdge[];
} {
  const domains = new Map<string, GraphNode>();
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const count = Math.max(1, documents.length);

  documents.forEach((document, index) => {
    const angle = (index / count) * Math.PI * 2;
    const specialties = document.specialties.length
      ? document.specialties
      : [OTHER_DOCUMENTS_DOMAIN];
    const documentNode: GraphNode = {
      id: `document:${document.id}`,
      kind: 'document',
      label: document.shortTitle ?? document.title,
      documentId: document.id,
      tone: graphToneForSourceType(document.sourceType),
      areaColors: specialties.map(domainColor),
      x: Math.cos(angle) * 190,
      y: Math.sin(angle) * 150,
      vx: 0,
      vy: 0,
      fixed: false,
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
          areaColors: [domainColor(specialty)],
          x: Math.cos(domainAngle) * 80,
          y: Math.sin(domainAngle) * 70,
          vx: 0,
          vy: 0,
          fixed: false,
        };
        domains.set(specialty, domain);
        nodes.push(domain);
      }
      edges.push({ from: domain.id, to: documentNode.id });
    });
  });

  return { nodes, edges };
}

export function KnowledgeGraph(props: KnowledgeGraphProps): JSX.Element {
  let canvas: HTMLCanvasElement | undefined;
  let frame = 0;
  let observer: ResizeObserver | undefined;
  let nodes: GraphNode[] = [];
  let edges: GraphEdge[] = [];
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
  let simulationActive = true;
  let animationFrameActive = true;

  const wakeSimulation = (): void => {
    simulationActive = true;
  };

  const shouldSimulate = (): boolean =>
    animationFrameActive && props.simulationActive !== false && simulationActive;

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
    draw();
  };

  const screenToWorld = (point: Point): Point => ({
    x: (point.x - width / 2 - panX) / scale,
    y: (point.y - height / 2 - panY) / scale,
  });

  const hitTest = (point: Point): GraphNode | null => {
    const world = screenToWorld(point);
    let nearest: GraphNode | null = null;
    let distance = Number.POSITIVE_INFINITY;
    for (const node of nodes) {
      const radius = node.kind === 'domain' ? 31 : 22;
      const candidate = Math.hypot(world.x - node.x, world.y - node.y);
      if (candidate <= radius && candidate < distance) {
        nearest = node;
        distance = candidate;
      }
    }
    return nearest;
  };

  const stepSimulation = (): boolean => {
    const damping = 0.86;
    for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
      const left = nodes[leftIndex];
      if (!left) continue;
      for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
        const right = nodes[rightIndex];
        if (!right) continue;
        const dx = right.x - left.x;
        const dy = right.y - left.y;
        const distanceSquared = Math.max(180, dx * dx + dy * dy);
        const distance = Math.sqrt(distanceSquared);
        const force = 760 / distanceSquared;
        const fx = (dx / distance) * force;
        const fy = (dy / distance) * force;
        if (!left.fixed) {
          left.vx -= fx;
          left.vy -= fy;
        }
        if (!right.fixed) {
          right.vx += fx;
          right.vy += fy;
        }
      }
    }

    const byId = new Map(nodes.map((node) => [node.id, node] as const));
    for (const edge of edges) {
      const from = byId.get(edge.from);
      const to = byId.get(edge.to);
      if (!from || !to) continue;
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const desired = from.kind === 'domain' ? 118 : 102;
      const force = (distance - desired) * 0.0019;
      const fx = (dx / distance) * force;
      const fy = (dy / distance) * force;
      if (!from.fixed) {
        from.vx += fx;
        from.vy += fy;
      }
      if (!to.fixed) {
        to.vx -= fx;
        to.vy -= fy;
      }
    }

    let energy = 0;
    for (const node of nodes) {
      if (node.fixed) continue;
      // Just enough pull to keep the layout on screen; the old value packed everything into a clump.
      node.vx += -node.x * 0.0003;
      node.vy += -node.y * 0.0003;
      node.vx *= damping;
      node.vy *= damping;
      node.x += node.vx;
      node.y += node.vy;
      energy += Math.abs(node.vx) + Math.abs(node.vy);
    }
    return energy > 0.015;
  };

  const draw = (): void => {
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const theme = readGraphTheme(canvas);
    context.clearRect(0, 0, width, height);
    context.save();
    context.translate(width / 2 + panX, height / 2 + panY);
    context.scale(scale, scale);

    const byId = new Map(nodes.map((node) => [node.id, node] as const));
    context.lineWidth = 1 / scale;
    context.strokeStyle = theme.graphStroke;
    context.globalAlpha = 0.35;
    for (const edge of edges) {
      const from = byId.get(edge.from);
      const to = byId.get(edge.to);
      if (!from || !to) continue;
      context.beginPath();
      context.moveTo(from.x, from.y);
      context.lineTo(to.x, to.y);
      context.stroke();
    }
    context.globalAlpha = 1;

    for (const node of nodes) {
      const selected = node.documentId === props.selectedId;
      const hovered = node.id === hoveredNodeId;
      const tone = node.kind === 'domain' ? TONES.other : TONES[node.tone];
      const radius = node.kind === 'domain' ? 26 : 17;
      const colors = node.areaColors.length > 0 ? node.areaColors : [tone.fill];

      if (colors.length === 1) {
        context.beginPath();
        context.arc(node.x, node.y, radius, 0, Math.PI * 2);
        context.fillStyle = colors[0] ?? tone.fill;
        context.fill();
      } else {
        // Equal pie slices, one per area the document belongs to.
        const slice = (Math.PI * 2) / colors.length;
        colors.forEach((color, index) => {
          const start = -Math.PI / 2 + index * slice;
          context.beginPath();
          context.moveTo(node.x, node.y);
          context.arc(node.x, node.y, radius, start, start + slice);
          context.closePath();
          context.fillStyle = color;
          context.fill();
        });
      }

      context.beginPath();
      context.arc(node.x, node.y, radius, 0, Math.PI * 2);
      context.strokeStyle = selected ? theme.danger : theme.graphStroke;
      context.lineWidth = (selected || hovered ? 2.8 : 1.35) / scale;
      context.stroke();

      context.textAlign = 'center';
      context.textBaseline = 'top';
      context.font = `${node.kind === 'domain' ? 600 : 500} ${node.kind === 'domain' ? 12 : 11}px Arial`;
      context.fillStyle = theme.text;
      context.fillText(
        shortLabel(node.label, node.kind === 'domain' ? 26 : 32),
        node.x,
        node.y + 29,
      );
    }

    context.restore();
  };

  const animate = (): void => {
    if (shouldSimulate()) simulationActive = stepSimulation();
    draw();
    frame = requestAnimationFrame(animate);
  };

  createEffect(() => {
    animationFrameActive = props.simulationActive !== false;
    if (animationFrameActive) wakeSimulation();
  });

  createEffect(() => {
    const graph = buildGraph(props.documents);
    nodes = graph.nodes;
    edges = graph.edges;
    scale = 1;
    panX = 0;
    panY = 0;
    hoveredNodeId = null;
    wakeSimulation();
  });

  onMount(() => {
    if (!canvas) return;
    observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    frame = requestAnimationFrame(animate);
  });

  onCleanup(() => {
    cancelAnimationFrame(frame);
    observer?.disconnect();
  });

  const pointFromEvent = (event: PointerEvent): Point => {
    const rect = canvas?.getBoundingClientRect();
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
  };

  const clampScale = (value: number): number => Math.max(0.55, Math.min(2.4, value));
  const endPointer = (event: PointerEvent): void => {
    activePointers.delete(event.pointerId);
    if (pinchStartDistance !== null) {
      pinchStartDistance = null;
      pinchStartCenter = null;
      pinchStartWorld = null;
      pointerStart = null;
      pointerLast = null;
      draggedNode = null;
      if (canvas?.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      wakeSimulation();
      draw();
      return;
    }
    const point = pointFromEvent(event);
    if (!moved) {
      const node = hitTest(point);
      if (node?.documentId) props.onSelect(node.documentId);
    }
    if (draggedNode) draggedNode.fixed = false;
    draggedNode = null;
    pointerStart = null;
    pointerLast = null;
    if (canvas?.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    wakeSimulation();
  };

  return (
    <section
      class="knowledge-graph-card paper-card"
      classList={{ 'knowledge-graph-card--dialog': props.variant === 'dialog' }}
      aria-label={browserI18n.getMessage('graph_aria_label')}
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
            if (draggedNode) draggedNode.fixed = false;
            draggedNode = null;
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
            wakeSimulation();
            return;
          }
          pointerStart = point;
          pointerLast = point;
          draggedNode = hitTest(point);
          moved = false;
          if (draggedNode) draggedNode.fixed = true;
          wakeSimulation();
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
            panX = center.x - width / 2 - pinchStartWorld.x * scale;
            panY = center.y - height / 2 - pinchStartWorld.y * scale;
            wakeSimulation();
            draw();
            return;
          }
          const hit = hitTest(point);
          const nextHoveredNodeId = hit?.id ?? null;
          if (nextHoveredNodeId !== hoveredNodeId) {
            hoveredNodeId = nextHoveredNodeId;
            draw();
          }
          if (!pointerLast) return;
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
            draggedNode.vx = 0;
            draggedNode.vy = 0;
          } else {
            panX += dx;
            panY += dy;
          }
          pointerLast = point;
          wakeSimulation();
          draw();
        }}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onPointerLeave={() => {
          if (pointerLast) return;
          hoveredNodeId = null;
          draw();
        }}
        onWheel={(event) => {
          event.preventDefault();
          const factor = event.deltaY > 0 ? 0.9 : 1.1;
          scale = clampScale(scale * factor);
          wakeSimulation();
          draw();
        }}
      />

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
