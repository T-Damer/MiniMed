import { createMemo, createSignal, For, type JSX, Show } from 'solid-js';

import { Disclosure } from '@/components/Disclosure';
import { buildOfficialDocumentHash } from '@/state/document-route';
import { CellDrug } from './ComparisonMatrix';
import {
  type CellView,
  type ClusterView,
  type ColumnView,
  isDifference,
  rowSummary,
  type SectionRowView,
  unitsWord,
} from './comparison-view';
import '@/styles/drug-comparison.css';

/** Clusters shown before «Показать все»: a section can hold several hundred statements. */
const VISIBLE_CLUSTERS = 6;
const LONG_TEXT = 360;

function CellText(props: {
  readonly cell: CellView;
  readonly column: ColumnView;
  /** The row's own title: a statement's section is named only where it differs. */
  readonly rowTitle: string;
}): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const long = () => props.cell.text.length > LONG_TEXT;
  return (
    <div class="drug-comparison__cell" data-testid="comparison-unit">
      <CellDrug column={props.column} />
      <Show
        when={
          props.cell.sectionTitle.trim() !== '' && props.cell.sectionTitle.trim() !== props.rowTitle
        }
      >
        <span class="drug-comparison__cell-section">{props.cell.sectionTitle}</span>
      </Show>
      <p
        class="drug-comparison__quote-text"
        classList={{ 'drug-comparison__quote-text--clamped': long() && !open() }}
      >
        <For each={props.cell.segments}>
          {(segment) => (
            <Show when={segment.differs} fallback={segment.text}>
              <mark class="drug-comparison__diff">{segment.text}</mark>
            </Show>
          )}
        </For>
      </p>
      <span class="drug-comparison__actions">
        <Show when={long()}>
          <button
            type="button"
            class="drug-comparison__toggle"
            aria-expanded={open()}
            onClick={() => setOpen((value) => !value)}
          >
            {open() ? 'Свернуть' : 'Показать полностью'}
          </button>
        </Show>
        <Show when={props.cell.anchor && props.column.documentId}>
          <a
            class="drug-comparison__link"
            href={buildOfficialDocumentHash(
              props.column.documentId ?? '',
              props.cell.anchor ?? undefined,
            )}
          >
            Открыть в инструкции
          </a>
        </Show>
      </span>
    </div>
  );
}

function ClusterRow(props: {
  readonly cluster: ClusterView;
  readonly columns: readonly ColumnView[];
  readonly rowTitle: string;
}): JSX.Element {
  return (
    <div
      class="drug-comparison__row drug-comparison__row--cluster"
      data-kind={props.cluster.kind}
      data-identical={props.cluster.identical}
      data-testid="comparison-cluster"
    >
      <div class="drug-comparison__rowhead">
        <span
          class="drug-comparison__mark"
          classList={{
            'drug-comparison__mark--shared': props.cluster.kind === 'shared',
            'drug-comparison__mark--only': props.cluster.kind === 'only',
            'drug-comparison__mark--similar':
              !props.cluster.identical && props.cluster.kind !== 'only',
          }}
          data-testid="comparison-mark"
        >
          {props.cluster.label}
        </span>
      </div>
      <For each={props.columns}>
        {(column, position) => (
          <Show
            when={props.cluster.cells[position()]}
            fallback={
              <div class="drug-comparison__cell drug-comparison__cell--absent" aria-hidden="true">
                <span class="drug-comparison__absent">—</span>
              </div>
            }
          >
            {(cell) => <CellText cell={cell()} column={column} rowTitle={props.rowTitle} />}
          </Show>
        )}
      </For>
    </div>
  );
}

function SectionBlock(props: {
  readonly row: SectionRowView;
  readonly columns: readonly ColumnView[];
  readonly onlyDifferences: boolean;
  readonly defaultOpen: boolean;
}): JSX.Element {
  const [all, setAll] = createSignal(false);
  const visible = createMemo(() =>
    props.row.clusters.filter((cluster) => !props.onlyDifferences || isDifference(cluster)),
  );
  const shown = () => (all() ? visible() : visible().slice(0, VISIBLE_CLUSTERS));
  const missing = () =>
    props.columns.filter(
      (column, position) =>
        column.state === 'ready' && props.row.columns[position]?.hasSection === false,
    );
  const cut = () => props.row.columns.reduce((total, column) => total + column.cut, 0);
  return (
    <Disclosure
      class="drug-comparison__section"
      defaultOpen={props.defaultOpen}
      title={props.row.title}
      meta={
        <Show when={props.row.compared}>
          <span class="drug-comparison__section-count">{visible().length}</span>
        </Show>
      }
    >
      <div
        class="drug-comparison__section-body"
        data-testid="comparison-section"
        data-row={props.row.id}
      >
        <Show when={props.row.compared}>
          <p class="drug-comparison__summary" data-testid="comparison-summary">
            {rowSummary(props.row, props.columns)}
          </p>
        </Show>
        <For each={missing()}>
          {(column) => (
            <p class="drug-comparison__muted">
              В прочитанной инструкции «{column.item.label}» этого раздела нет.
            </p>
          )}
        </For>
        <Show when={cut() > 0}>
          <p class="drug-comparison__muted">
            Сравнены первые 400 пунктов каждой инструкции; ещё {cut()} {unitsWord(cut())} откройте в
            инструкции.
          </p>
        </Show>
        <Show
          when={props.row.compared}
          fallback={
            <p class="drug-comparison__muted" data-testid="comparison-not-compared">
              Пометки появятся, когда будут прочитаны инструкции хотя бы двух препаратов.
            </p>
          }
        >
          <Show
            when={visible().length > 0}
            fallback={
              <p class="drug-comparison__muted">
                {props.onlyDifferences
                  ? 'Различий в этом разделе нет: все пункты одинаковы.'
                  : 'В этом разделе нечего сравнивать.'}
              </p>
            }
          >
            <div class="drug-comparison__clusters-scroller">
              <div class="drug-comparison__clusters">
                <div class="drug-comparison__row drug-comparison__row--sub">
                  <div class="drug-comparison__rowhead drug-comparison__rowhead--corner">
                    Пометка
                  </div>
                  <For each={props.columns}>
                    {(column) => <div class="drug-comparison__subhead">{column.item.label}</div>}
                  </For>
                </div>
                <For each={shown()}>
                  {(cluster) => (
                    <ClusterRow
                      cluster={cluster}
                      columns={props.columns}
                      rowTitle={props.row.title}
                    />
                  )}
                </For>
              </div>
            </div>
            <Show when={visible().length > VISIBLE_CLUSTERS}>
              <button
                type="button"
                class="drug-comparison__more"
                aria-expanded={all()}
                onClick={() => setAll((value) => !value)}
              >
                {all() ? 'Свернуть' : `Показать все (${visible().length})`}
              </button>
            </Show>
          </Show>
        </Show>
      </div>
    </Disclosure>
  );
}

/** The six quoted sections, each with the statements matched across the instructions. */
export function ComparisonSections(props: {
  readonly rows: readonly SectionRowView[];
  readonly columns: readonly ColumnView[];
  readonly onlyDifferences: boolean;
}): JSX.Element {
  return (
    <section
      class="drug-comparison__sections"
      style={{ '--cmp-columns': String(props.columns.length) }}
      aria-label="Разделы инструкций"
    >
      <h3 class="drug-comparison__group">Разделы инструкций</h3>
      <p class="drug-comparison__group-source">
        Пункты разделов (предложения и пункты списков) дословно. «У обоих» — совпадают после
        приведения к общему виду (регистр, знаки, окончания слов, название самого препарата);
        «формулировки различаются» — слова совпадают не полностью, отличающиеся слова отмечены.
      </p>
      <For each={props.rows}>
        {(row, position) => (
          <SectionBlock
            row={row}
            columns={props.columns}
            onlyDifferences={props.onlyDifferences}
            defaultOpen={position() === 0}
          />
        )}
      </For>
    </section>
  );
}
