import type { MedicalDocumentSummary } from '@localmed/contracts';
import { createMemo, For, type JSX, Show } from 'solid-js';

interface CorpusGraphProps {
  readonly documents: readonly MedicalDocumentSummary[];
  readonly selectedId: string | undefined;
  readonly onSelect: (documentId: string) => void;
}

interface GraphNode {
  readonly id: string;
  readonly label: string;
  readonly kind: 'document' | 'specialty';
  readonly x: number;
  readonly y: number;
}

interface GraphEdge {
  readonly id: string;
  readonly from: GraphNode;
  readonly to: GraphNode;
}

const WIDTH = 920;
const HEIGHT = 560;
const CENTER_X = WIDTH / 2;
const CENTER_Y = HEIGHT / 2;

function shortLabel(value: string, max = 27): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

export function CorpusGraph(props: CorpusGraphProps): JSX.Element {
  const graph = createMemo(() => {
    const specialties = [...new Set(props.documents.flatMap((document) => document.specialties))].sort(
      (left, right) => left.localeCompare(right, 'ru'),
    );
    const specialtyNodes = specialties.map<GraphNode>((specialty, index) => {
      const angle = (Math.PI * 2 * index) / Math.max(specialties.length, 1) - Math.PI / 2;
      const radius = specialties.length <= 4 ? 92 : 126;
      return {
        id: `specialty:${specialty}`,
        label: specialty,
        kind: 'specialty',
        x: CENTER_X + Math.cos(angle) * radius,
        y: CENTER_Y + Math.sin(angle) * radius,
      };
    });
    const specialtyByName = new Map(
      specialtyNodes.map((node) => [node.label, node] as const),
    );
    const documentNodes = props.documents.map<GraphNode>((document, index) => {
      const angle = (Math.PI * 2 * index) / Math.max(props.documents.length, 1) - Math.PI / 2;
      const radiusX = 340;
      const radiusY = 220;
      return {
        id: document.id,
        label: document.shortTitle ?? document.title,
        kind: 'document',
        x: CENTER_X + Math.cos(angle) * radiusX,
        y: CENTER_Y + Math.sin(angle) * radiusY,
      };
    });
    const edges = documentNodes.flatMap<GraphEdge>((documentNode) => {
      const document = props.documents.find((item) => item.id === documentNode.id);
      return (document?.specialties ?? []).flatMap((specialty) => {
        const specialtyNode = specialtyByName.get(specialty);
        return specialtyNode
          ? [
              {
                id: `${documentNode.id}:${specialty}`,
                from: documentNode,
                to: specialtyNode,
              },
            ]
          : [];
      });
    });
    return { specialtyNodes, documentNodes, edges };
  });

  return (
    <section class="corpus-graph-panel" aria-labelledby="corpus-graph-title">
      <header>
        <div>
          <p class="archive-kicker">Карта локального фонда</p>
          <h2 id="corpus-graph-title">Документы и специализации</h2>
        </div>
        <span>{graph().edges.length} связей</span>
      </header>

      <Show
        when={props.documents.length > 0}
        fallback={<p class="graph-empty">В активном пакете нет документов для визуализации.</p>}
      >
        <div class="corpus-graph-scroll">
          <svg
            class="corpus-graph"
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            role="img"
            aria-label="Граф связей документов и медицинских специализаций"
          >
            <title>Граф связей документов и медицинских специализаций</title>
            <g class="graph-edges">
              <For each={graph().edges}>
                {(edge) => (
                  <line
                    x1={edge.from.x}
                    y1={edge.from.y}
                    x2={edge.to.x}
                    y2={edge.to.y}
                  />
                )}
              </For>
            </g>

            <g class="graph-specialties">
              <For each={graph().specialtyNodes}>
                {(node) => (
                  <g transform={`translate(${node.x} ${node.y})`}>
                    <circle r="35" />
                    <text text-anchor="middle" dy="-2">
                      {shortLabel(node.label, 15)}
                    </text>
                    <text class="graph-node-kind" text-anchor="middle" dy="12">
                      SPECIALTY
                    </text>
                  </g>
                )}
              </For>
            </g>

            <g class="graph-documents">
              <For each={graph().documentNodes}>
                {(node) => (
                  <g
                    classList={{ selected: props.selectedId === node.id }}
                    transform={`translate(${node.x} ${node.y})`}
                    role="button"
                    tabindex="0"
                    aria-label={`Открыть документ: ${node.label}`}
                    onClick={() => props.onSelect(node.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        props.onSelect(node.id);
                      }
                    }}
                  >
                    <rect x="-76" y="-32" width="152" height="64" rx="4" />
                    <path d="M-64 -32h48l9 9h71" />
                    <text text-anchor="middle" dy="-2">
                      {shortLabel(node.label)}
                    </text>
                    <text class="graph-node-kind" text-anchor="middle" dy="14">
                      DOCUMENT
                    </text>
                  </g>
                )}
              </For>
            </g>
          </svg>
        </div>
        <p class="graph-caption">
          Линия означает, что документ входит в область специализации. Нажмите на папку, чтобы открыть
          ее оглавление и исходные абзацы.
        </p>
      </Show>
    </section>
  );
}
