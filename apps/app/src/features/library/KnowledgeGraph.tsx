import type { MedicalDocumentSummary } from '@localmed/contracts';
import { createMemo, For, type JSX } from 'solid-js';

interface KnowledgeGraphProps {
  readonly documents: readonly MedicalDocumentSummary[];
  readonly selectedId?: string;
  readonly onSelect: (id: string) => void;
}

interface PositionedNode {
  readonly id: string;
  readonly label: string;
  readonly x: number;
  readonly y: number;
}

function shortened(value: string, limit = 25): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

export function KnowledgeGraph(props: KnowledgeGraphProps): JSX.Element {
  const specialties = createMemo(() =>
    [...new Set(props.documents.flatMap((document) => document.specialties))].toSorted(),
  );

  const specialtyNodes = createMemo<readonly PositionedNode[]>(() => {
    const values = specialties();
    const spacing = 520 / Math.max(values.length, 1);
    return values.map((specialty, index) => ({
      id: `specialty:${specialty}`,
      label: specialty,
      x: 245,
      y: 70 + spacing * index + spacing / 2,
    }));
  });

  const documentNodes = createMemo<readonly PositionedNode[]>(() => {
    const spacing = 520 / Math.max(props.documents.length, 1);
    return props.documents.map((document, index) => ({
      id: document.id,
      label: document.shortTitle ?? document.title,
      x: 690,
      y: 70 + spacing * index + spacing / 2,
    }));
  });

  const specialtyPosition = createMemo(() =>
    new Map(specialtyNodes().map((node) => [node.label, node] as const)),
  );
  const documentPosition = createMemo(() =>
    new Map(documentNodes().map((node) => [node.id, node] as const)),
  );

  return (
    <div class="knowledge-graph paper-card">
      <div class="graph-key" aria-hidden="true">
        <span><i class="graph-dot root" /> корпус</span>
        <span><i class="graph-dot specialty" /> специальность</span>
        <span><i class="graph-dot document" /> документ</span>
      </div>
      <svg viewBox="0 0 900 660" role="img" aria-label="Связи документов и специальностей">
        <g class="graph-edges">
          <For each={specialtyNodes()}>
            {(node) => <path d={`M112 330 C160 330 190 ${node.y} ${node.x - 25} ${node.y}`} />}
          </For>
          <For each={props.documents}>
            {(document) => {
              const target = documentPosition().get(document.id);
              return (
                <For each={document.specialties}>
                  {(specialty) => {
                    const source = specialtyPosition().get(specialty);
                    if (!source || !target) return null;
                    return (
                      <path
                        classList={{ active: props.selectedId === document.id }}
                        d={`M${source.x + 74} ${source.y} C465 ${source.y} 510 ${target.y} ${target.x - 98} ${target.y}`}
                      />
                    );
                  }}
                </For>
              );
            }}
          </For>
        </g>

        <g class="graph-root">
          <circle cx="90" cy="330" r="43" />
          <text x="90" y="325">MINIMED</text>
          <text class="secondary" x="90" y="344">КОРПУС</text>
        </g>

        <For each={specialtyNodes()}>
          {(node) => (
            <g class="graph-specialty" transform={`translate(${node.x} ${node.y})`}>
              <rect x="-74" y="-22" width="148" height="44" rx="4" />
              <text x="0" y="4">{shortened(node.label, 21)}</text>
            </g>
          )}
        </For>

        <For each={documentNodes()}>
          {(node) => (
            <g
              class="graph-document"
              classList={{ selected: props.selectedId === node.id }}
              transform={`translate(${node.x} ${node.y})`}
              role="button"
              tabindex="0"
              onClick={() => props.onSelect(node.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') props.onSelect(node.id);
              }}
            >
              <rect x="-98" y="-27" width="196" height="54" rx="4" />
              <path d="M-98-27h55l12 10h129" />
              <text x="0" y="5">{shortened(node.label)}</text>
            </g>
          )}
        </For>
      </svg>
      <p class="graph-note">
        Связи строятся из метаданных корпуса: специальность → документ. Нажмите на папку, чтобы открыть
        ее структуру и исходные разделы.
      </p>
    </div>
  );
}
