import { createSignal, For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { SelectField } from '@/components/SelectField';
import { QuoteBlock } from '@/features/medication-safety/SafetyBlocks';
import { NOTHING_SAID_TEXT } from '@/features/medication-safety/safety-view';
import { buildOfficialDocumentHash } from '@/state/document-route';
import type { RegistryCell, RegistryRowSpec } from './comparison-registry';
import type { SafetyCell, SafetyRowView } from './comparison-safety';
import {
  type ColumnView,
  columnSourceLine,
  type QuoteRowView,
  SUBSTANCE_INSTRUCTION_NOTE,
} from './comparison-view';
import '@/styles/drug-comparison.css';

export const NO_LINE_NOTE = 'В прочитанной инструкции такой строки нет';

/** The name of the drug at the top of a stacked cell (phone layout); hidden beside the header. */
export function CellDrug(props: { readonly column: ColumnView }): JSX.Element {
  return <span class="drug-comparison__cell-drug">{props.column.item.label}</span>;
}

function ColumnHead(props: {
  readonly column: ColumnView;
  readonly onRemove: (id: string) => void;
  readonly onChoose: (id: string, documentId: string) => void;
}): JSX.Element {
  const column = () => props.column;
  const source = () => (column().state === 'ready' ? columnSourceLine(column()) : '');
  return (
    <div
      class="drug-comparison__colhead"
      data-testid="comparison-column"
      data-state={column().state}
    >
      <div class="drug-comparison__colhead-top">
        <h3 class="drug-comparison__colhead-name">{column().item.label}</h3>
        <button
          type="button"
          class="drug-comparison__remove"
          aria-label={`Убрать «${column().item.label}»`}
          onClick={() => props.onRemove(column().item.id)}
        >
          <AppGlyph name="minus" />
        </button>
      </div>
      <Show when={column().item.typed}>
        {(typed) => <p class="drug-comparison__colhead-note">по запросу «{typed()}»</p>}
      </Show>
      <Show when={column().choices.length > 1}>
        <SelectField
          class="drug-comparison__choice"
          label="Инструкция"
          hideLabel
          value={column().documentId ?? ''}
          options={column().choices.map((choice) => ({
            value: choice.documentId,
            label: choice.label,
          }))}
          onChange={(event) => props.onChoose(column().item.id, event.currentTarget.value)}
        />
      </Show>
      <Show when={column().state === 'loading'}>
        <p class="drug-comparison__colhead-note" role="status">
          Читаем установленную инструкцию…
        </p>
      </Show>
      <Show when={column().state === 'not-installed'}>
        <p class="drug-comparison__colhead-note" data-testid="comparison-not-installed">
          Инструкция не установлена: скачайте её ниже.
        </p>
      </Show>
      <Show when={column().state === 'no-instruction'}>
        <p class="drug-comparison__colhead-note" data-testid="comparison-no-instruction">
          Инструкции этого вещества нет в источниках приложения.
        </p>
      </Show>
      <Show when={column().state === 'ready'}>
        <p class="drug-comparison__colhead-source" data-testid="comparison-source">
          {source()}
        </p>
        <Show when={column().source?.qualityNote}>
          {(note) => <p class="drug-comparison__colhead-note">{note()}</p>}
        </Show>
        <Show when={!column().own}>
          <p class="drug-comparison__colhead-note">{SUBSTANCE_INSTRUCTION_NOTE}</p>
        </Show>
        <Show when={column().kindLabel === 'листок-вкладыш'}>
          <p class="drug-comparison__colhead-note">
            Читается листок-вкладыш: его разделы и слова отличаются от инструкции для врача.
          </p>
        </Show>
      </Show>
    </div>
  );
}

function RegistryCellView(props: {
  readonly cell: RegistryCell;
  readonly column: ColumnView;
}): JSX.Element {
  const [open, setOpen] = createSignal(false);
  return (
    <div
      class="drug-comparison__cell"
      classList={{ 'drug-comparison__cell--empty': props.cell.empty }}
    >
      <CellDrug column={props.column} />
      <ul class="drug-comparison__lines">
        <For each={props.cell.lines}>{(line) => <li class="drug-comparison__line">{line}</li>}</For>
        <Show when={open()}>
          <For each={props.cell.more}>
            {(line) => <li class="drug-comparison__line">{line}</li>}
          </For>
        </Show>
      </ul>
      <Show when={props.cell.more.length > 0}>
        <button
          type="button"
          class="drug-comparison__toggle"
          aria-expanded={open()}
          onClick={() => setOpen((value) => !value)}
        >
          {open() ? 'Свернуть' : `ещё ${props.cell.more.length}`}
        </button>
      </Show>
    </div>
  );
}

function QuoteLineCell(props: {
  readonly column: ColumnView;
  readonly block: QuoteRowView['blocks'][number];
}): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const long = () => (props.block?.text.length ?? 0) > 240;
  return (
    <div class="drug-comparison__cell" data-testid="comparison-quote-cell">
      <CellDrug column={props.column} />
      <Show
        when={props.column.state === 'ready'}
        fallback={<p class="drug-comparison__muted">Инструкция не прочитана</p>}
      >
        <Show when={props.block} fallback={<p class="drug-comparison__muted">{NO_LINE_NOTE}</p>}>
          {(block) => (
            <>
              <p
                class="drug-comparison__quote-text"
                classList={{ 'drug-comparison__quote-text--clamped': long() && !open() }}
              >
                {block().text}
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
                <Show when={block().anchor && props.column.documentId}>
                  <a
                    class="drug-comparison__link"
                    href={buildOfficialDocumentHash(
                      props.column.documentId ?? '',
                      block().anchor ?? undefined,
                    )}
                  >
                    Открыть в инструкции
                  </a>
                </Show>
              </span>
            </>
          )}
        </Show>
      </Show>
    </div>
  );
}

function SafetyCellView(props: {
  readonly column: ColumnView;
  readonly cell: SafetyCell;
}): JSX.Element {
  return (
    <div class="drug-comparison__cell" data-testid="comparison-safety-cell">
      <CellDrug column={props.column} />
      <Show when={props.cell.state === 'not-read'}>
        <p class="drug-comparison__muted">Инструкция не прочитана</p>
      </Show>
      <Show when={props.cell.state === 'nothing-said'}>
        <p class="drug-comparison__muted">{NOTHING_SAID_TEXT}</p>
      </Show>
      <Show when={props.cell.state === 'ready'}>
        <Show when={props.cell.numbers.length > 0}>
          <ul class="drug-comparison__numbers" aria-label="Числа из текста инструкции">
            <For each={props.cell.numbers}>
              {(text) => <li class="drug-comparison__number">{text}</li>}
            </For>
          </ul>
        </Show>
        <For each={props.cell.quotes}>
          {(quote) => <QuoteBlock documentId={props.cell.documentId ?? ''} quote={quote} />}
        </For>
        <Show when={props.cell.hidden > 0}>
          <p class="drug-comparison__muted">
            Ещё предложений: {props.cell.hidden}. Откройте инструкцию целиком.
          </p>
        </Show>
      </Show>
    </div>
  );
}

function Row(props: {
  readonly title: string;
  readonly note?: string;
  readonly children: JSX.Element;
}): JSX.Element {
  return (
    <div class="drug-comparison__row">
      <div class="drug-comparison__rowhead">
        <span class="drug-comparison__rowhead-title">{props.title}</span>
        <Show when={props.note}>
          {(note) => <span class="drug-comparison__rowhead-note">{note()}</span>}
        </Show>
      </div>
      {props.children}
    </div>
  );
}

/**
 * The scalar rows: the column heads, the registry rows, the short quoted lines and the SAFE1 rows.
 * The first column is pinned while the drug columns scroll; on a phone every row stacks and each
 * drug's value carries its name.
 */
export function ComparisonMatrix(props: {
  readonly columns: readonly ColumnView[];
  readonly registry: readonly {
    readonly spec: RegistryRowSpec;
    readonly cells: readonly RegistryCell[];
  }[];
  readonly registrySource: string;
  readonly quoteRows: readonly QuoteRowView[];
  readonly safetyRows: readonly SafetyRowView[];
  readonly onRemove: (id: string) => void;
  readonly onChoose: (id: string, documentId: string) => void;
}): JSX.Element {
  return (
    <div
      class="drug-comparison__matrix"
      style={{ '--cmp-columns': String(props.columns.length) }}
      data-testid="comparison-matrix"
    >
      <div class="drug-comparison__grid">
        <div class="drug-comparison__row drug-comparison__row--head">
          <div class="drug-comparison__rowhead drug-comparison__rowhead--corner">Параметр</div>
          <For each={props.columns}>
            {(column) => (
              <ColumnHead column={column} onRemove={props.onRemove} onChoose={props.onChoose} />
            )}
          </For>
        </div>

        <h3 class="drug-comparison__group">Данные реестров</h3>
        <p class="drug-comparison__group-source">{props.registrySource}</p>
        <For each={props.registry}>
          {(row) => (
            <Row title={row.spec.title} note={row.spec.source}>
              <For each={props.columns}>
                {(column, position) => (
                  <Show when={row.cells[position()]}>
                    {(cell) => <RegistryCellView cell={cell()} column={column} />}
                  </Show>
                )}
              </For>
            </Row>
          )}
        </For>

        <h3 class="drug-comparison__group">Из инструкций</h3>
        <p class="drug-comparison__group-source">
          Строки инструкций дословно; в каждом столбце читается инструкция, указанная в его
          заголовке.
        </p>
        <For each={props.quoteRows}>
          {(row) => (
            <Row title={row.title}>
              <For each={props.columns}>
                {(column, position) => (
                  <QuoteLineCell column={column} block={row.blocks[position()] ?? null} />
                )}
              </For>
            </Row>
          )}
        </For>
        <For each={props.safetyRows}>
          {(row) => (
            <Row title={row.title} note="предложения из инструкции">
              <For each={props.columns}>
                {(column, position) => (
                  <Show when={row.cells[position()]}>
                    {(cell) => <SafetyCellView column={column} cell={cell()} />}
                  </Show>
                )}
              </For>
            </Row>
          )}
        </For>
      </div>
    </div>
  );
}
