import type { MedicalDocumentSummary } from '@localmed/contracts';
import { createMemo, For, type JSX } from 'solid-js';

interface KnowledgeGraphProps {
  readonly documents: readonly MedicalDocumentSummary[];
  readonly selectedId: string | undefined;
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

  const specialtyPosition = createMemo(
    () => new Map(specialtyNodes().map((node) => [node.label, node] as const)),
  );
  const documentPosition = createMemo(
    () => new Map(documentNodes().map((node) => [node.id, node] as const)),
  );

  return (
    <section class="knowledge-graph-card paper-card" aria-labelledby="knowledge-graph-title">
      <header>
        <div>
          <p class="archive-kicker">Граф корпуса</p>
          <h2 id="knowledge-graph-title">Документы и специализации</h2>
        </div>
        <span>
          {props.documents.length} документов · {specialties().length} областей
        </span>
      </header>
      <div class="knowledge-graph-scroll">
        <svg
          class="knowledge-graph"
          viewBox="0 0 940 660"
          role="img"
          aria-label="Граф связей документов и медицинских специализаций"
        >
          <title>Граф связей документов и медицинских специализаций</title>
          <g class="knowledge-links">
            <For each={props.documents}>
              {(document) => {
                const target = documentPosition().get(document.id);
                return (
                  <For each={document.specialties}>
                    {(specialty) => {
                      const source = specialtyPosition().get(specialty);
                      if (!source || !target) return null;
                      return <line x1={source.x} y1={source.y} x2={target.x} y2={target.y} />;
                    }}
                  </For>
                );
              }}
            </For>
          </g>
          <g class="knowledge-specialties">
            <For each={specialtyNodes()}>
              {(node) => (
                <g transform={`translate(${node.x} ${node.y})`}>
                  <circle r="38" />
                  <text text-anchor="middle" dy="-2">
                    {shortened(node.label, 16)}
                  </text>
                  <text class="node-kind" text-anchor="middle" dy="13">
                    ОБЛАСТЬ
                  </text>
                </g>
              )}
            </For>
          </g>
          <g class="knowledge-documents">
            <For each={documentNodes()}>
              {(node) => (
                <a
                  href={`#document-${node.id}`}
                  aria-label={`Открыть документ: ${node.label}`}
                  onClick={(event) => {
                    event.preventDefault();
                    props.onSelect(node.id);
                  }}
                >
                  <g
                    classList={{ selected: props.selectedId === node.id }}
                    transform={`translate(${node.x} ${node.y})`}
                  >
                    <rect x="-96" y="-34" width="192" height="68" rx="4" />
                    <path d="M-82 -34h50l10 10h104" />
                    <text text-anchor="middle" dy="-2">
                      {shortened(node.label)}
                    </text>
                    <text class="node-kind" text-anchor="middle" dy="15">
                      ДОКУМЕНТ
                    </text>
                  </g>
                </a>
              )}
            </For>
          </g>
        </svg>
      </div>
      <p class="knowledge-graph-caption">
        Линии показывают принадлежность документа к специальности. Выберите документ, затем откройте
        его оглавление и источник.
      </p>
    </section>
  );
}
