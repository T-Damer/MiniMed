import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  Match,
  on,
  onCleanup,
  Show,
  Switch,
} from 'solid-js';
import { toast } from 'solid-sonner';

import { AppGlyph } from '@/components/AppGlyph';
import { NavBack } from '@/components/NavBack';
import { Page } from '@/components/Page';
import { SearchField } from '@/components/SearchField';
import { SegmentedControl } from '@/components/SegmentedControl';
import { Heading } from '@/components/Text';
import type { StatusFocus } from '@/features/vaccination/VaccinationChartView';
import { VaccinationChartView } from '@/features/vaccination/VaccinationChartView';
import { VaccinationChildRow } from '@/features/vaccination/VaccinationChildRow';
import {
  VaccinationAgeSheet,
  VaccinationGroupSheet,
} from '@/features/vaccination/VaccinationDoseSheet';
import { VaccinationEpidemicView } from '@/features/vaccination/VaccinationEpidemicView';
import { VaccinationHelp } from '@/features/vaccination/VaccinationHelp';
import { VaccinationPrintDialog } from '@/features/vaccination/VaccinationPrintDialog';
import { VaccinationPrintThumb } from '@/features/vaccination/VaccinationPrintThumb';
import { VaccinationStatusBar } from '@/features/vaccination/VaccinationStatusBar';
import {
  getVaccinationCalendar,
  isAgeRow,
  itemDoseLabel,
  type NationalRow,
  nationalDoses,
} from '@/features/vaccination/vaccination-calendar';
import { buildNationalChart } from '@/features/vaccination/vaccination-chart';
import {
  type ChildInput,
  childBirthDate,
  handoutSubjectFor,
  hasChild,
  NO_CHILD,
} from '@/features/vaccination/vaccination-child';
import { filterEpidemicRows } from '@/features/vaccination/vaccination-filter';
import { displayIsoDate, todayIso } from '@/features/vaccination/vaccination-format';
import { buildHandout } from '@/features/vaccination/vaccination-handout';
import { renderVaccinationHandoutHtml } from '@/features/vaccination/vaccination-handout-print';
import {
  type DoseMarkState,
  markedAs,
  nextMarkState,
  withMark,
  withMarks,
} from '@/features/vaccination/vaccination-record';
import { createRecordState } from '@/features/vaccination/vaccination-record-state';
import { buildChildCalendar, overdueItemIds } from '@/features/vaccination/vaccination-status';
import { pluralRu } from '@/i18n/labels';
import '@/styles/vaccination.css';

type VaccinationPart = 'national' | 'epidemic';

const PART_OPTIONS = [
  { value: 'national', label: 'Национальный' },
  { value: 'epidemic', label: 'Эпид. показания' },
] as const satisfies readonly { value: VaccinationPart; label: string }[];

/** The one undo toast of the screen: a tap on a cell or a bulk mark replaces the last one. */
const UNDO_TOAST_ID = 'vaccination-mark';

/** Typing in the search of epidemic indications filters this long after the last key. */
const SEARCH_DELAY_MS = 200;

const LEGEND = [
  { status: 'done', label: 'сделана' },
  { status: 'planned', label: 'запланирована' },
  { status: 'now', label: 'пора' },
  { status: 'overdue', label: 'просрочена' },
] as const;

function rowsCaption(shown: number, total: number): string {
  return `${shown} из ${total}`;
}

/**
 * «Календарь прививок»: the national calendar as a table of ages × vaccinations. Choose the child
 * and the table shows what they have, what is planned, what is due now and what is overdue; tap a
 * cell to mark it; print the page for the child's mother. The calendar by epidemic indications is
 * one switch away.
 */
export function VaccinationWorkspace(props: {
  /** From the address (`?part=`); anything that is not a part of the screen is ignored. */
  readonly initialPart?: string | undefined;
  readonly onBack: () => void;
}): JSX.Element {
  const calendar = getVaccinationCalendar();
  const chart = buildNationalChart(calendar);
  const columnIds = chart.columns.map((column) => column.rowId);
  const doses = nationalDoses(calendar);
  const [today, setToday] = createSignal(todayIso());
  // A page left open overnight still counts from the right day.
  const refreshToday = (): void => {
    setToday(todayIso());
  };
  document.addEventListener('visibilitychange', refreshToday);
  onCleanup(() => document.removeEventListener('visibilitychange', refreshToday));

  const [part, setPart] = createSignal<VaccinationPart>(
    props.initialPart === 'epidemic' ? 'epidemic' : 'national',
  );
  const [child, setChild] = createSignal<ChildInput>(NO_CHILD);
  const [focus, setFocus] = createSignal<StatusFocus>();
  const record = createRecordState(calendar.id, () => child().profile?.id);

  const canMark = (): boolean => hasChild(child()) && record.ready();
  // Statuses wait for the card's marks: no flash of «everything overdue» before they are read.
  const state = createMemo(() =>
    buildChildCalendar(
      calendar,
      columnIds,
      record.ready() ? childBirthDate(child()) : null,
      today(),
      record.marks(),
    ),
  );
  // The «now» line is brought into view once per child, not on every mark.
  const revealKey = (): string => `${child().profile?.id ?? ''}|${childBirthDate(child()) ?? ''}`;
  createEffect(
    on(
      revealKey,
      () => {
        setFocus(undefined);
        // An undo belongs to the child it was made for.
        toast.dismiss(UNDO_TOAST_ID);
      },
      { defer: true },
    ),
  );

  const update = (next: ReturnType<typeof record.marks>): void => record.update(next);
  /** A tap on a cell: the next mark, dated today when it is «сделана», with an undo in the toast. */
  const cycle = (itemId: string): void => {
    const before = record.marks();
    const next = nextMarkState(before[itemId]?.state);
    const after = markedAs(before, itemId, next, today());
    update(after);
    const label = doses.get(itemId)?.item;
    const date = after[itemId]?.date;
    const what =
      next === 'done'
        ? `сделана${date ? ` ${displayIsoDate(date)}` : ''}`
        : next === 'planned'
          ? 'в плане'
          : 'отметка снята';
    // One toast that follows the taps, so a run of taps does not pile them up.
    toast(`${label ? `${itemDoseLabel(label)} · ` : ''}${what}`, {
      id: UNDO_TOAST_ID,
      action: { label: 'Отменить', onClick: () => update(before) },
    });
  };
  const mark = (itemId: string, next: DoseMarkState | undefined, date?: string | null): void => {
    const marks = record.marks();
    update(
      date === undefined
        ? markedAs(marks, itemId, next, today())
        : withMark(marks, itemId, next, date),
    );
  };
  const markAll = (itemIds: readonly string[]): void => {
    update(withMarks(record.marks(), itemIds, 'done'));
  };
  const markOverdue = (): void => {
    const before = record.marks();
    const ids = overdueItemIds(state());
    if (ids.length === 0) return;
    update(withMarks(before, ids, 'done'));
    setFocus(undefined);
    toast(
      `Отмечено сделанными: ${ids.length} ${pluralRu(ids.length, 'прививка', 'прививки', 'прививок')}`,
      { id: UNDO_TOAST_ID, action: { label: 'Отменить', onClick: () => update(before) } },
    );
  };

  // Sheets keep their last content while they slide out.
  const [ageOpen, setAgeOpen] = createSignal(false);
  const [ageTarget, setAgeTarget] = createSignal<{ rowId: string; itemId?: string }>();
  const [groupOpen, setGroupOpen] = createSignal(false);
  const [groupRow, setGroupRow] = createSignal<NationalRow>();
  const ageRow = createMemo(() => {
    const target = ageTarget();
    return target ? calendar.national.rows.find((row) => row.id === target.rowId) : undefined;
  });
  const openAge = (rowId: string, itemId?: string): void => {
    setAgeTarget(itemId === undefined ? { rowId } : { rowId, itemId });
    setAgeOpen(true);
  };
  const openGroup = (itemId: string): void => {
    const row = doses.get(itemId)?.row;
    if (!row) return;
    setGroupRow(row);
    setGroupOpen(true);
  };

  const [previewOpen, setPreviewOpen] = createSignal(false);
  // The undo toast belongs to the chart; it must not sit over the preview's own controls.
  const openPreview = (): void => {
    toast.dismiss(UNDO_TOAST_ID);
    setPreviewOpen(true);
  };
  const handoutHtml = createMemo(() =>
    renderVaccinationHandoutHtml(
      buildHandout(calendar, columnIds, handoutSubjectFor(child()), record.marks(), today()),
    ),
  );

  const [query, setQuery] = createSignal('');
  const [appliedQuery, setAppliedQuery] = createSignal('');
  createEffect(
    on(query, (next) => {
      const timer = setTimeout(() => setAppliedQuery(next), SEARCH_DELAY_MS);
      onCleanup(() => clearTimeout(timer));
    }),
  );
  const epidemicRows = createMemo(() => filterEpidemicRows(calendar.epidemic.rows, appliedQuery()));

  const groupRows = calendar.national.rows.filter((row) => !isAgeRow(row));
  const orderNumbers = calendar.sources.map((source) => `№ ${source.orderNumber}`);

  return (
    <section class="vax" aria-label="Календарь прививок">
      <Page
        navigation={
          <NavBack
            class="vax__back knowledge-back-button"
            aria-label="Назад"
            onClick={props.onBack}
          />
        }
        title={<Heading depth={1}>Календарь прививок</Heading>}
        description={`Приказы ${orderNumbers.join(', ')}`}
        help={<VaccinationHelp calendar={calendar} />}
        actions={<VaccinationPrintThumb html={handoutHtml()} onOpen={openPreview} />}
      />
      <SegmentedControl
        class="vax__parts"
        stretch
        label="Календарь"
        options={PART_OPTIONS}
        value={part()}
        onChange={setPart}
      />
      <div class="vax__child" hidden={part() !== 'national'}>
        <VaccinationChildRow today={today()} onChange={setChild} />
      </div>
      <Switch>
        <Match when={part() === 'national'}>
          <Show when={record.problem()}>
            {(message) => (
              <p class="vax__problem" role="alert">
                {message()}
              </p>
            )}
          </Show>
          <Show when={state().problem}>
            {(message) => (
              <p class="vax__problem" role="alert">
                {message()}
              </p>
            )}
          </Show>
          <Show when={canMark() && state().birthDate !== null}>
            <VaccinationStatusBar
              counts={state().counts}
              focus={focus()}
              onFocus={setFocus}
              onMarkOverdue={markOverdue}
            />
          </Show>
          <VaccinationChartView
            chart={chart}
            child={state()}
            canMark={canMark()}
            focus={focus()}
            revealKey={revealKey()}
            onCycle={cycle}
            onOpenAge={openAge}
            onOpenGroup={openGroup}
          />
          <ul class="vax-legend" aria-label="Обозначения">
            <For each={LEGEND}>
              {(item) => (
                <li class="vax-legend__item">
                  <span class={`vax-legend__swatch vax-chip vax-chip--${item.status}`} />
                  {item.label}
                </li>
              )}
            </For>
            <li class="vax-legend__item">
              <span class="vax-legend__star">*</span>
              группы риска
            </li>
          </ul>
          <section class="vax-groups" aria-label="Прививки по категориям">
            <Heading depth={2} class="vax-groups__title">
              По категориям
            </Heading>
            <ul class="vax-groups__list">
              <For each={groupRows}>
                {(row) => (
                  <li class="vax-groups__item">
                    <button
                      type="button"
                      class="vax-groups__button"
                      data-row-id={row.id}
                      onClick={() => {
                        setGroupRow(row);
                        setGroupOpen(true);
                      }}
                    >
                      <span class="vax-groups__vaccine">
                        {row.items.map((item) => item.text).join('; ')}
                      </span>
                      <span class="vax-groups__who">{row.category}</span>
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </section>
        </Match>
        <Match when={part() === 'epidemic'}>
          <SearchField
            class="vax__search"
            label="Инфекция или категория"
            hideLabel
            placeholder="Например: клещевой энцефалит"
            value={query()}
            onInput={setQuery}
            onClear={() => setQuery('')}
            trailing={
              <Show when={appliedQuery() !== ''}>
                <span class="vax__count" role="status">
                  {rowsCaption(epidemicRows().length, calendar.epidemic.rows.length)}
                </span>
              </Show>
            }
          />
          <Show
            when={epidemicRows().length > 0}
            fallback={<p class="vax__empty">Ничего не найдено.</p>}
          >
            <VaccinationEpidemicView calendar={calendar} rows={epidemicRows()} />
          </Show>
        </Match>
      </Switch>
      <footer class="vax__sources">
        <span class="vax__sources-text">
          Приказы Минздрава {orderNumbers.join(' и ')}. Редакция с{' '}
          {displayIsoDate(calendar.edition.inForceFrom)} до{' '}
          {displayIsoDate(calendar.edition.validUntil)}.
        </span>
        <For each={calendar.sources}>
          {(source) => (
            <a
              class="vax__sources-link"
              href={source.publicationUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <AppGlyph name="arrow-square-out" class="vax__sources-icon" />№ {source.orderNumber},
              PDF
            </a>
          )}
        </For>
      </footer>
      <VaccinationAgeSheet
        open={ageOpen()}
        calendar={calendar}
        row={ageRow()}
        focusItemId={ageTarget()?.itemId}
        child={state()}
        canMark={canMark()}
        today={today()}
        onMark={mark}
        onMarkAll={markAll}
        onClose={() => setAgeOpen(false)}
      />
      <VaccinationGroupSheet
        open={groupOpen()}
        calendar={calendar}
        row={groupRow()}
        onClose={() => setGroupOpen(false)}
      />
      <VaccinationPrintDialog
        open={previewOpen()}
        html={handoutHtml()}
        onClose={() => setPreviewOpen(false)}
      />
    </section>
  );
}
