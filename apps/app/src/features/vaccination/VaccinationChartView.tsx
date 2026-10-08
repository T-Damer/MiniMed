import { createEffect, For, type JSX, on, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { useLongClick } from '@/components/use-long-click';
import {
  CHART_GROUP_LABELS,
  type ChartCell,
  type ChartColumn,
  type ChartDose,
  type NationalChart,
} from '@/features/vaccination/vaccination-chart';
import {
  type ChildCalendar,
  type DoseStatus,
  worstStatus,
} from '@/features/vaccination/vaccination-status';
import { motionMs } from '@/state/motion';

/** A group of vaccinations the chart can emphasise: the status chips above it pick one. */
export type StatusFocus = 'done' | 'planned' | 'now' | 'overdue';

export const STATUS_LABELS: Readonly<Record<DoseStatus, string>> = {
  done: 'сделана',
  planned: 'запланирована',
  now: 'пора сделать',
  overdue: 'просрочена',
  later: 'ещё рано',
  optional: 'по показаниям',
};

function DoseButton(props: {
  readonly dose: ChartDose;
  readonly column: ChartColumn;
  readonly infection: string;
  readonly status: DoseStatus;
  readonly dimmed: boolean;
  readonly onCycle: () => void;
  readonly onOpen: () => void;
}): JSX.Element {
  const handlers = useLongClick({
    onLongClick: props.onOpen,
    onClick: props.onCycle,
    mobileOnly: true,
  });
  const risk = (): boolean => props.dose.band === 'risk';
  return (
    <button
      {...handlers}
      type="button"
      class={`vax-chart__dose vax-chip vax-chip--${props.status}`}
      classList={{ 'vax-chart__dose--dimmed': props.dimmed }}
      data-item-id={props.dose.itemId}
      data-status={props.status}
      aria-label={`${props.infection}, ${props.column.ageLabel}: ${props.dose.text}, ${STATUS_LABELS[props.status]}`}
      title={props.dose.text}
      onContextMenu={(event) => {
        event.preventDefault();
        props.onOpen();
      }}
    >
      <span class="vax-chart__dose-label">
        {props.dose.label}
        {risk() ? '*' : ''}
      </span>
      <Show
        when={props.status === 'done' || props.status === 'planned' || props.status === 'overdue'}
      >
        <span class={`vax-chart__badge vax-chart__badge--${props.status}`} aria-hidden="true">
          <Show when={props.status === 'done'}>
            <AppGlyph name="check" class="vax-chart__badge-icon" />
          </Show>
          <Show when={props.status === 'planned'}>
            <AppGlyph name="clock" class="vax-chart__badge-icon" />
          </Show>
          <Show when={props.status === 'overdue'}>!</Show>
        </span>
      </Show>
    </button>
  );
}

/**
 * Infections × ages of the national calendar, the layout of the official infographic. A cell holds
 * the vaccination of that age: its colour is the child's status, a tap marks it, a long press opens
 * the age's sheet. A line on the age axis shows where the child is now.
 */
export function VaccinationChartView(props: {
  readonly chart: NationalChart;
  readonly child: ChildCalendar;
  /** Whether there is a child to mark vaccinations for. */
  readonly canMark: boolean;
  readonly focus: StatusFocus | undefined;
  /** Bumps when the view should bring the «now» line into view (a child was chosen). */
  readonly revealKey: string;
  readonly onCycle: (itemId: string) => void;
  /** Opens the sheet of an age; `itemId` names the vaccination the person pressed. */
  readonly onOpenAge: (rowId: string, itemId?: string) => void;
  readonly onOpenGroup: (itemId: string) => void;
}): JSX.Element {
  let scroller: HTMLDivElement | undefined;
  const columns = (): number => props.chart.columns.length;
  const statusOf = (itemId: string): DoseStatus => props.child.doses.get(itemId)?.status ?? 'later';
  const currentColumn = (columnId: string): boolean =>
    props.child.timing.get(columnId)?.status === 'current';
  const dimmed = (status: DoseStatus): boolean =>
    props.focus !== undefined && status !== props.focus;

  const reveal = (): void => {
    const marker = props.child.marker;
    if (!scroller || marker === null) return;
    const host = scroller;
    const line = host.querySelector<HTMLElement>('.vax-chart__now');
    if (!line) return;
    const target = line.offsetLeft - host.clientWidth / 2;
    host.scrollTo({
      left: Math.max(0, target),
      behavior: motionMs(1) === 0 ? 'auto' : 'smooth',
    });
  };
  // The «now» line is brought to the middle once per child, not on every mark.
  // Also when the marker first appears: the card's marks are read after the child is chosen.
  createEffect(
    on(
      () => `${props.revealKey}|${props.child.marker === null ? 'none' : 'line'}`,
      () => requestAnimationFrame(reveal),
    ),
  );

  const cellDoses = (cell: ChartCell): { markable: ChartDose[]; group: ChartDose | undefined } => ({
    markable: cell.doses.filter((dose) => !dose.category),
    group: cell.doses.find((dose) => dose.category),
  });

  return (
    <div class="vax-chart">
      <div class="vax-chart__scroller" ref={scroller}>
        <div
          class="vax-chart__plane"
          style={{
            '--vax-columns': String(columns()),
            '--vax-now': String(props.child.marker ?? 0),
          }}
        >
          <table class="vax-chart__table">
            <caption class="vax-chart__caption">
              Национальный календарь профилактических прививок
            </caption>
            <colgroup>
              <col class="vax-chart__col-label" />
              <For each={props.chart.columns}>{() => <col class="vax-chart__col" />}</For>
            </colgroup>
            <thead class="vax-chart__head">
              <tr class="vax-chart__axis-row">
                <th class="vax-chart__corner" scope="col" rowSpan={3}>
                  <span class="sr-only">Инфекция</span>
                </th>
                <td class="vax-chart__axis" colSpan={columns()} />
              </tr>
              <tr>
                <For each={props.chart.groups}>
                  {(group) => (
                    <th class="vax-chart__group" scope="colgroup" colSpan={group.span}>
                      {CHART_GROUP_LABELS[group.group]}
                    </th>
                  )}
                </For>
              </tr>
              <tr>
                <For each={props.chart.columns}>
                  {(column) => (
                    <th
                      class="vax-chart__age"
                      classList={{ 'vax-chart__age--now': currentColumn(column.rowId) }}
                      scope="col"
                      data-row-id={column.rowId}
                    >
                      <button
                        type="button"
                        class="vax-chart__age-button"
                        aria-label={column.ageLabel}
                        title={column.ageLabel}
                        onClick={() => props.onOpenAge(column.rowId)}
                      >
                        {column.shortLabel}
                      </button>
                    </th>
                  )}
                </For>
              </tr>
            </thead>
            <tbody>
              <For each={props.chart.rows}>
                {(row) => (
                  <tr class="vax-chart__row" data-infection={row.key}>
                    <th class="vax-chart__infection" scope="row">
                      {row.label}
                    </th>
                    <For each={props.chart.columns}>
                      {(column) => {
                        const cell = (): ChartCell =>
                          row.cells.get(column.rowId) ?? { doses: [], covered: null };
                        return (
                          <td
                            class="vax-chart__cell"
                            classList={{
                              'vax-chart__cell--now': currentColumn(column.rowId),
                              [`vax-chart__cell--covered-${cell().covered}`]:
                                cell().covered !== null,
                            }}
                          >
                            <Show
                              when={cellDoses(cell()).markable.length > 0}
                              fallback={
                                <Show when={cellDoses(cell()).group}>
                                  {(group) => (
                                    <button
                                      type="button"
                                      class="vax-chart__dose vax-chip vax-chip--group"
                                      title={group().text}
                                      aria-label={`${row.label}, ${column.ageLabel}: ${group().text}`}
                                      onClick={() => props.onOpenGroup(group().itemId)}
                                    >
                                      <span class="vax-chart__dose-label">{group().label}</span>
                                    </button>
                                  )}
                                </Show>
                              }
                            >
                              <For each={cellDoses(cell()).markable.slice(0, 1)}>
                                {(dose) => {
                                  const status = (): DoseStatus =>
                                    worstStatus(
                                      cellDoses(cell()).markable.map((item) =>
                                        statusOf(item.itemId),
                                      ),
                                    ) ?? 'later';
                                  return (
                                    <DoseButton
                                      dose={dose}
                                      column={column}
                                      infection={row.label}
                                      status={status()}
                                      dimmed={dimmed(status())}
                                      onCycle={() => {
                                        if (props.canMark) props.onCycle(dose.itemId);
                                        else props.onOpenAge(column.rowId, dose.itemId);
                                      }}
                                      onOpen={() => props.onOpenAge(column.rowId, dose.itemId)}
                                    />
                                  );
                                }}
                              </For>
                              <Show when={cellDoses(cell()).group}>
                                <span class="vax-chart__pip" aria-hidden="true" />
                              </Show>
                            </Show>
                          </td>
                        );
                      }}
                    </For>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
          <Show when={props.child.marker !== null}>
            <div class="vax-chart__now" aria-hidden="true">
              <span class="vax-chart__now-pin">сейчас</span>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}
