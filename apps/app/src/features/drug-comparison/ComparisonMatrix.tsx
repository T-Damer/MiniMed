import { createMemo, createSignal, For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { createLineClamp } from '@/components/line-clamp';
import { OverlayDialog } from '@/components/OverlayDialog';
import { SelectField } from '@/components/SelectField';
import { QuoteBlock } from '@/features/medication-safety/SafetyBlocks';
import { NOTHING_SAID_TEXT } from '@/features/medication-safety/safety-view';
import {
  AFFINITY_TIER_LABELS,
  BBB_LEVEL_LABELS,
  CLINICAL_EFFECT_LEVEL_TEXT,
  CLINICAL_EFFECT_META,
  type DrugPharmacologyProfile,
  type DrugReceptorBinding,
  sedationActivationBalance,
  splitEffectsByCategory,
} from '@/features/medications/pharmacology/drug-pharmacology-schema';
import { lookupPharmacologyForCandidates } from '@/features/medications/pharmacology/pharmacology-interactions';
import { lookupReceptorInfo } from '@/features/medications/pharmacology/receptor-encyclopedia';
import { openDocumentOverlay } from '@/state/document-navigation';
import { buildOfficialDocumentHash } from '@/state/document-route';
import type { RegistryCell, RegistryRowSpec } from './comparison-registry';
import type { SafetyCell, SafetyRowView } from './comparison-safety';
import { type ColumnView, columnSourceLine, type QuoteRowView } from './comparison-view';
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
  return (
    <div
      class="drug-comparison__colhead"
      data-testid="comparison-column"
      data-state={column().state}
    >
      <div class="drug-comparison__colhead-top">
        <h3 class="drug-comparison__colhead-name">
          <a
            class="drug-comparison__colhead-link"
            href={buildOfficialDocumentHash(`esklp.mnn.${column().item.id.split('|')[0] ?? ''}`)}
            onClick={(event) => {
              if (event.button !== 0 || event.ctrlKey || event.metaKey) return;
              event.preventDefault();
              openDocumentOverlay(`esklp.mnn.${column().item.id.split('|')[0] ?? ''}`, null, {
                title: column().item.label,
              });
            }}
          >
            {column().item.label}
          </a>
        </h3>
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
          Инструкция не установлена.
        </p>
      </Show>
      <Show when={column().state === 'no-instruction'}>
        <p class="drug-comparison__colhead-note" data-testid="comparison-no-instruction">
          Инструкции этого вещества нет в источниках приложения.
        </p>
      </Show>
      <Show when={column().state === 'ready'}>
        <Show when={column().source?.qualityNote}>
          {(note) => <p class="drug-comparison__colhead-note">{note()}</p>}
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

/**
 * Which instruction each column was read from — kind, edition, register, date — as small text at
 * the end of the comparison: reference data, never between the drugs and their lines.
 */
export function ComparisonSources(props: { readonly columns: readonly ColumnView[] }): JSX.Element {
  const ready = () => props.columns.filter((column) => column.state === 'ready');
  return (
    <Show when={ready().length > 0}>
      <section class="drug-comparison__sources" aria-label="Источники текстов">
        <For each={ready()}>
          {(column) => (
            <p class="drug-comparison__source-line" data-testid="comparison-source">
              <span class="drug-comparison__source-drug">{column.item.label}: </span>
              {columnSourceLine(column)}
            </p>
          )}
        </For>
      </section>
    </Show>
  );
}

const QUOTE_LINES = 5;

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
  const [element, setElement] = createSignal<HTMLParagraphElement>();
  const clamp = createLineClamp({
    element,
    visibleLines: QUOTE_LINES,
    track: () => props.block?.text,
  });
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
                ref={setElement}
                class="drug-comparison__quote-text"
                classList={{ 'drug-comparison__quote-text--clamped': clamp.folded() }}
              >
                {block().text}
              </p>
              <span class="drug-comparison__actions">
                <Show when={clamp.foldable()}>
                  <button
                    type="button"
                    class="drug-comparison__toggle"
                    aria-expanded={clamp.expanded()}
                    onClick={() => clamp.toggle()}
                  >
                    {clamp.expanded() ? 'Свернуть' : 'Показать полностью'}
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
  const pharmacologyByColumn = createMemo<readonly (DrugPharmacologyProfile | null)[]>(() =>
    props.columns.map((column) =>
      lookupPharmacologyForCandidates([
        column.item.id.split('|')[0],
        column.item.product,
        column.item.label,
      ]),
    ),
  );
  const hasPharmacology = createMemo(() => pharmacologyByColumn().some((item) => item !== null));
  const [selectedReceptor, setSelectedReceptor] = createSignal<{
    readonly drugLabel: string;
    readonly binding: DrugReceptorBinding;
  } | null>(null);

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

        <Show when={hasPharmacology()}>
          <h3 class="drug-comparison__group">Фармакологический профиль</h3>
          <p class="drug-comparison__group-source">
            Структурированные параметры (рецепторы, аффинность, ГЭБ, t½, CYP и выраженность
            эффектов). Нажмите на рецептор, чтобы открыть зоны и механизм действия.
          </p>

          <Row title="Класс">
            <For each={props.columns}>
              {(column, position) => {
                const profile = () => pharmacologyByColumn()[position()] ?? null;
                return (
                  <div class="drug-comparison__cell">
                    <CellDrug column={column} />
                    <span class="drug-comparison__value">{profile()?.classLabel ?? '—'}</span>
                  </div>
                );
              }}
            </For>
          </Row>

          <Row title="Период полувыведения (t½)">
            <For each={props.columns}>
              {(column, position) => {
                const profile = () => pharmacologyByColumn()[position()] ?? null;
                return (
                  <div class="drug-comparison__cell">
                    <CellDrug column={column} />
                    <span class="drug-comparison__value">{profile()?.pk.halfLife ?? '—'}</span>
                  </div>
                );
              }}
            </For>
          </Row>

          <Row title="Проникновение через ГЭБ">
            <For each={props.columns}>
              {(column, position) => {
                const bbb = () => pharmacologyByColumn()[position()]?.pk.bbb ?? null;
                return (
                  <div class="drug-comparison__cell">
                    <CellDrug column={column} />
                    <Show when={bbb()} fallback={<span class="drug-comparison__muted">—</span>}>
                      {(entry) => (
                        <div class="drug-comparison__pharma-stack">
                          <span
                            class={`drug-comparison__bbb-badge drug-comparison__bbb-badge--${entry().level}`}
                          >
                            {BBB_LEVEL_LABELS[entry().level]}
                          </span>
                          <p class="drug-comparison__pharma-note">{entry().summary}</p>
                        </div>
                      )}
                    </Show>
                  </div>
                );
              }}
            </For>
          </Row>

          <Row title="Метаболизм / CYP">
            <For each={props.columns}>
              {(column, position) => {
                const profile = () => pharmacologyByColumn()[position()] ?? null;
                return (
                  <div class="drug-comparison__cell">
                    <CellDrug column={column} />
                    <span class="drug-comparison__value">{profile()?.pk.metabolism ?? '—'}</span>
                  </div>
                );
              }}
            </For>
          </Row>

          <Row title="Седация / активация">
            <For each={props.columns}>
              {(column, position) => {
                const profile = () => pharmacologyByColumn()[position()] ?? null;
                return (
                  <div class="drug-comparison__cell">
                    <CellDrug column={column} />
                    <Show when={profile()} fallback={<span class="drug-comparison__muted">—</span>}>
                      {(facts) => {
                        const balance = sedationActivationBalance(facts().effects);
                        return (
                          <div class="drug-comparison__pharma-stack">
                            <span class="drug-comparison__value">{balance.label}</span>
                            <span class="drug-comparison__pharma-note">
                              Седация {CLINICAL_EFFECT_LEVEL_TEXT[balance.sedation]} · Активация{' '}
                              {CLINICAL_EFFECT_LEVEL_TEXT[balance.activation]}
                            </span>
                          </div>
                        );
                      }}
                    </Show>
                  </div>
                );
              }}
            </For>
          </Row>

          <Row title="Рецепторы и аффинность" note="нажмите для справки">
            <For each={props.columns}>
              {(column, position) => {
                const profile = () => pharmacologyByColumn()[position()] ?? null;
                return (
                  <div class="drug-comparison__cell">
                    <CellDrug column={column} />
                    <Show when={profile()} fallback={<span class="drug-comparison__muted">—</span>}>
                      {(facts) => (
                        <div class="drug-comparison__receptor-list">
                          <For each={facts().receptors}>
                            {(binding) => (
                              <button
                                type="button"
                                class={`drug-comparison__receptor-chip drug-comparison__receptor-chip--${binding.affinity}`}
                                onClick={() =>
                                  setSelectedReceptor({
                                    drugLabel: column.item.label,
                                    binding,
                                  })
                                }
                              >
                                <span class="drug-comparison__receptor-name">
                                  {binding.receptor}
                                </span>
                                <Show when={binding.kiNm}>
                                  {(ki) => <span class="drug-comparison__receptor-ki">{ki()}</span>}
                                </Show>
                              </button>
                            )}
                          </For>
                        </div>
                      )}
                    </Show>
                  </div>
                );
              }}
            </For>
          </Row>

          <Row title="Побочные реакции (сила)">
            <For each={props.columns}>
              {(column, position) => {
                const profile = () => pharmacologyByColumn()[position()] ?? null;
                return (
                  <div class="drug-comparison__cell">
                    <CellDrug column={column} />
                    <Show when={profile()} fallback={<span class="drug-comparison__muted">—</span>}>
                      {(facts) => {
                        const adverse = splitEffectsByCategory(facts().effects).adverse.filter(
                          (item) => item.level > 0,
                        );
                        return (
                          <Show
                            when={adverse.length > 0}
                            fallback={
                              <span class="drug-comparison__muted">
                                Без выраженного профиля в схеме
                              </span>
                            }
                          >
                            <ul class="drug-comparison__adverse-list">
                              <For each={adverse}>
                                {(metric) => (
                                  <li
                                    class={`drug-comparison__adverse-item drug-comparison__adverse-item--level-${metric.level}`}
                                  >
                                    <span class="drug-comparison__adverse-label">
                                      {CLINICAL_EFFECT_META[metric.kind].shortLabel}
                                    </span>
                                    <span class="drug-comparison__adverse-level">
                                      {CLINICAL_EFFECT_LEVEL_TEXT[metric.level]}
                                    </span>
                                  </li>
                                )}
                              </For>
                            </ul>
                          </Show>
                        );
                      }}
                    </Show>
                  </div>
                );
              }}
            </For>
          </Row>
        </Show>

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

      <OverlayDialog
        open={selectedReceptor() !== null}
        title={
          selectedReceptor()
            ? `${selectedReceptor()?.binding.receptor} · ${selectedReceptor()?.drugLabel}`
            : 'Рецептор'
        }
        onClose={() => setSelectedReceptor(null)}
      >
        <Show when={selectedReceptor()}>
          {(active) => {
            const info = lookupReceptorInfo(active().binding.receptor);
            return (
              <div class="drug-comparison__receptor-modal">
                <div class="drug-comparison__receptor-meta">
                  <span class="drug-comparison__receptor-action">
                    {active().binding.action} · {AFFINITY_TIER_LABELS[active().binding.affinity]}
                    <Show when={active().binding.kiNm}>{(ki) => ` · Ki ${ki()}`}</Show>
                  </span>
                </div>
                <p class="drug-comparison__receptor-line">
                  <strong>Путь / зона: </strong>
                  {active().binding.pathway}
                </p>
                <p class="drug-comparison__receptor-line">{active().binding.clinicalEffect}</p>
                <Show when={info}>
                  {(ref) => (
                    <div class="drug-comparison__receptor-ref">
                      <strong class="drug-comparison__receptor-ref-name">{ref().fullName}</strong>
                      <p class="drug-comparison__receptor-ref-mech">{ref().mechanism}</p>
                      <ul class="drug-comparison__receptor-zones">
                        <For each={ref().zones}>
                          {(entry) => (
                            <li class="drug-comparison__receptor-zone">
                              <strong>{entry.zone}: </strong>
                              {entry.role}
                            </li>
                          )}
                        </For>
                      </ul>
                      <p class="drug-comparison__receptor-line">
                        <strong>Блокада: </strong>
                        {ref().antagonismEffects}
                      </p>
                      <p class="drug-comparison__receptor-line">
                        <strong>Активация: </strong>
                        {ref().agonismEffects}
                      </p>
                    </div>
                  )}
                </Show>
              </div>
            );
          }}
        </Show>
      </OverlayDialog>
    </div>
  );
}
