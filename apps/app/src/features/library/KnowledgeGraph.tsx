import type { MedicalDocumentSummary } from '@localmed/contracts';
import { createEffect, type JSX, onCleanup, onMount } from 'solid-js';

interface KnowledgeGraphProps {
  readonly documents: readonly MedicalDocumentSummary[];
  readonly selectedId: string | undefined;
  readonly onSelect: (id: string) => void;
}

type GraphNodeKind = 'domain' | 'document';

interface GraphNode {
  readonly id: string;
  readonly kind: GraphNodeKind;
  readonly label: string;
  readonly documentId: string | null;
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
    const documentNode: GraphNode = {
      id: `document:${document.id}`,
      kind: 'document',
      label: document.shortTitle ?? document.title,
      documentId: document.id,
      x: Math.cos(angle) * 190,
      y: Math.sin(angle) * 150,
      vx: 0,
      vy: 0,
      fixed: false,
    };
    nodes.push(documentNode);

    const specialties = document.specialties.length ? document.specialties : ['Другие документы'];
    specialties.forEach((specialty, specialtyIndex) => {
      let domain = domains.get(specialty);
      if (!domain) {
        const domainAngle = ((domains.size + specialtyIndex) / Math.max(1, count / 2)) * Math.PI * 2;
        domain = {
          id: `domain:${specialty}`,
          kind: 'domain',
          label: specialty,
          documentId: null,
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
  let draggedNode: GraphNode | null = null;
  let moved = false;
  let simulationTicks = 0;

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

  const stepSimulation = (): void => {
    if (simulationTicks > 420) return;
    simulationTicks += 1;
    const damping = 0.84;

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
        const force = 1150 / distanceSquared;
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

    for (const node of nodes) {
      if (node.fixed) continue;
      node.vx += -node.x * 0.0008;
      node.vy += -node.y * 0.0008;
      node.vx *= damping;
      node.vy *= damping;
      node.x += node.vx;
      node.y += node.vy;
    }
  };

  const draw = (): void => {
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, width, height);
    context.save();
    context.translate(width / 2 + panX, height / 2 + panY);
    context.scale(scale, scale);

    const byId = new Map(nodes.map((node) => [node.id, node] as const));
    context.lineWidth = 1 / scale;
    context.strokeStyle = 'rgba(72, 68, 58, 0.24)';
    for (const edge of edges) {
      const from = byId.get(edge.from);
      const to = byId.get(edge.to);
      if (!from || !to) continue;
      context.beginPath();
      context.moveTo(from.x, from.y);
      context.lineTo(to.x, to.y);
      context.stroke();
    }

    for (const node of nodes) {
      const selected = node.documentId === props.selectedId;
      context.beginPath();
      context.arc(node.x, node.y, node.kind === 'domain' ? 26 : 17, 0, Math.PI * 2);
      context.fillStyle = node.kind === 'domain' ? '#8f7849' : selected ? '#87453c' : '#fbf7ea';
      context.strokeStyle = selected ? '#87453c' : '#655e51';
      context.lineWidth = (selected ? 2.5 : 1.2) / scale;
      context.fill();
      context.stroke();

      context.textAlign = 'center';
      context.textBaseline = 'top';
      context.font = `${node.kind === 'domain' ? 600 : 500} ${node.kind === 'domain' ? 12 : 11}px Arial`;
      context.fillStyle = '#292720';
      context.fillText(shortLabel(node.label, node.kind === 'domain' ? 26 : 32), node.x, node.y + 29);
    }

    context.restore();
  };

  const animate = (): void => {
    stepSimulation();
    draw();
    frame = requestAnimationFrame(animate);
  };

  createEffect(() => {
    const graph = buildGraph(props.documents);
    nodes = graph.nodes;
    edges = graph.edges;
    simulationTicks = 0;
    scale = 1;
    panX = 0;
    panY = 0;
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

  return (
    <section class="knowledge-graph-card paper-card" aria-labelledby="knowledge-graph-title">
      <header>
        <div>
          <p class="archive-kicker">Карта связей</p>
          <h2 id="knowledge-graph-title">Области и документы</h2>
          <p>Перетаскивайте узлы, двигайте поле и используйте колесо для масштаба.</p>
        </div>
        <span>{props.documents.length} документов</span>
      </header>

      <canvas
        ref={(element) => {
          canvas = element;
        }}
        class="knowledge-graph-canvas"
        aria-label="Интерактивная карта медицинских областей и документов"
        onPointerDown={(event) => {
          if (!canvas) return;
          canvas.setPointerCapture(event.pointerId);
          const point = pointFromEvent(event);
          pointerStart = point;
          pointerLast = point;
          draggedNode = hitTest(point);
          moved = false;
          if (draggedNode) draggedNode.fixed = true;
        }}
        onPointerMove={(event) => {
          if (!pointerLast) return;
          const point = pointFromEvent(event);
          const dx = point.x - pointerLast.x;
          const dy = point.y - pointerLast.y;
          if (Math.hypot(point.x - (pointerStart?.x ?? point.x), point.y - (pointerStart?.y ?? point.y)) > 4) {
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
          draw();
        }}
        onPointerUp={(event) => {
          if (!canvas) return;
          const point = pointFromEvent(event);
          if (!moved) {
            const node = hitTest(point);
            if (node?.documentId) props.onSelect(node.documentId);
          }
          if (draggedNode) draggedNode.fixed = false;
          draggedNode = null;
          pointerStart = null;
          pointerLast = null;
          canvas.releasePointerCapture(event.pointerId);
        }}
        onWheel={(event) => {
          event.preventDefault();
          const factor = event.deltaY > 0 ? 0.9 : 1.1;
          scale = Math.max(0.55, Math.min(2.4, scale * factor));
          draw();
        }}
      />

      <div class="knowledge-graph-legend" aria-hidden="true">
        <span><i class="domain" /> медицинская область</span>
        <span><i class="document" /> документ</span>
      </div>
    </section>
  );
}
