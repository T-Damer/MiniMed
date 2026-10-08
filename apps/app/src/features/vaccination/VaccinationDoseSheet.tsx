import { For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { OverlayDialog } from '@/components/OverlayDialog';
import { SegmentedControl } from '@/components/SegmentedControl';
import { TextField } from '@/components/TextField';
import { STATUS_LABELS } from '@/features/vaccination/VaccinationChartView';
import { VaccinationSourceLink } from '@/features/vaccination/VaccinationSourceLink';
import {
  itemDoseLabel,
  type NationalRow,
  procedureItemsFor,
  type VaccinationCalendar,
} from '@/features/vaccination/vaccination-calendar';
import { displayDate } from '@/features/vaccination/vaccination-format';
import { formatIsoDate } from '@/features/vaccination/vaccination-plan';
import type { DoseMarkState } from '@/features/vaccination/vaccination-record';
import type { ChildCalendar } from '@/features/vaccination/vaccination-status';

type MarkChoice = 'none' | DoseMarkState;

const MARK_OPTIONS = [
  { value: 'none', label: 'Нет' },
  { value: 'done', label: 'Сделана' },
  { value: 'planned', label: 'План' },
] as const satisfies readonly { value: MarkChoice; label: string }[];

/** «≈ 17.06.2025» or «≈ 15.03.2031 — 15.03.2032»: when the age comes for this child. */
function timingLabel(child: ChildCalendar, rowId: string): string {
  const timing = child.timing.get(rowId);
  if (!timing) return '';
  const prefix = timing.approximate ? '≈ ' : '';
  return formatIsoDate(timing.from) === formatIsoDate(timing.to)
    ? `${prefix}${displayDate(timing.from)}`
    : `${prefix}${displayDate(timing.from)} — ${displayDate(timing.to)}`;
}

/**
 * One age of the calendar: its vaccinations in the order's own words, the mark and date of each,
 * and the link to the page of the official PDF the row is printed on.
 */
export function VaccinationAgeSheet(props: {
  readonly open: boolean;
  readonly calendar: VaccinationCalendar;
  readonly row: NationalRow | undefined;
  /** The vaccination the person pressed; it is highlighted among the age's others. */
  readonly focusItemId: string | undefined;
  readonly child: ChildCalendar;
  readonly canMark: boolean;
  readonly today: string;
  readonly onMark: (itemId: string, state: DoseMarkState | undefined, date?: string | null) => void;
  readonly onMarkAll: (itemIds: readonly string[]) => void;
  readonly onClose: () => void;
}): JSX.Element {
  return (
    <OverlayDialog
      open={props.open && props.row !== undefined}
      title={props.row?.ageLabel ?? ''}
      {...(props.row && timingLabel(props.child, props.row.id)
        ? { subtitle: timingLabel(props.child, props.row.id) }
        : {})}
      class="vax-sheet"
      bodyClass="vax-sheet__body"
      onClose={props.onClose}
      headerEnd={
        <Show when={props.canMark && props.row}>
          {(row) => (
            <Button
              type="button"
              variant="icon"
              class="vax-sheet__all"
              aria-label="Отметить всё сделанным"
              title="Отметить всё сделанным"
              icon={<AppGlyph name="list-checks" />}
              onClick={() => props.onMarkAll(row().items.map((item) => item.id))}
            />
          )}
        </Show>
      }
    >
      <Show when={props.row}>
        {(row) => (
          <>
            <ul class="vax-sheet__doses">
              <For each={row().items}>
                {(item) => {
                  const state = () => props.child.doses.get(item.id);
                  const mark = () => state()?.mark;
                  const choice = (): MarkChoice => mark()?.state ?? 'none';
                  const paragraphs = procedureItemsFor(props.calendar, item.infectionKey);
                  return (
                    <li
                      class="vax-dose"
                      classList={{ 'vax-dose--focused': props.focusItemId === item.id }}
                      data-item-id={item.id}
                    >
                      <p class="vax-dose__head">
                        <span
                          class={`vax-dose__label vax-chip vax-chip--${state()?.status ?? 'later'}`}
                        >
                          {itemDoseLabel(item)}
                          {item.band === 'risk' ? '*' : ''}
                        </span>
                        <span class="vax-dose__status">
                          {STATUS_LABELS[state()?.status ?? 'later']}
                        </span>
                      </p>
                      <p class="vax-dose__text">{item.text}</p>
                      <Show when={item.product}>
                        {(product) => (
                          <p class="vax-dose__note">
                            {product().code} — {product().label}
                          </p>
                        )}
                      </Show>
                      <Show when={paragraphs.length > 0}>
                        <p class="vax-dose__note">
                          Условия: п. {paragraphs.map((paragraph) => paragraph.number).join(', ')}{' '}
                          порядка проведения прививок
                        </p>
                      </Show>
                      <Show when={props.canMark}>
                        <div class="vax-dose__mark">
                          <SegmentedControl
                            class="vax-dose__choice"
                            stretch
                            label={`Отметка: ${item.text}`}
                            options={MARK_OPTIONS}
                            value={choice()}
                            onChange={(value) =>
                              props.onMark(item.id, value === 'none' ? undefined : value)
                            }
                          />
                          <Show when={mark()}>
                            {(current) => (
                              <TextField
                                class="vax-dose__date"
                                label={
                                  current().state === 'done' ? 'Дата прививки' : 'Дата по плану'
                                }
                                type="date"
                                value={current().date ?? ''}
                                {...(current().state === 'done' ? { max: props.today } : {})}
                                onChange={(event) =>
                                  props.onMark(
                                    item.id,
                                    current().state,
                                    event.currentTarget.value === ''
                                      ? null
                                      : event.currentTarget.value,
                                  )
                                }
                              />
                            )}
                          </Show>
                        </div>
                      </Show>
                      <VaccinationSourceLink
                        calendar={props.calendar}
                        source={row().source}
                        rowLabel={`строка ${row().number} приложения № 1`}
                      />
                    </li>
                  );
                }}
              </For>
            </ul>
            <Show when={!props.canMark}>
              <p class="vax-sheet__hint">Выберите ребёнка, чтобы отмечать прививки.</p>
            </Show>
          </>
        )}
      </Show>
    </OverlayDialog>
  );
}

/** A row of the calendar that names a group of people, not an age (rows 16–19). */
export function VaccinationGroupSheet(props: {
  readonly open: boolean;
  readonly calendar: VaccinationCalendar;
  readonly row: NationalRow | undefined;
  readonly onClose: () => void;
}): JSX.Element {
  return (
    <OverlayDialog
      open={props.open && props.row !== undefined}
      title={props.row?.items.map((item) => item.text).join('; ') ?? ''}
      class="vax-sheet"
      bodyClass="vax-sheet__body"
      onClose={props.onClose}
    >
      <Show when={props.row}>
        {(row) => (
          <>
            <p class="vax-sheet__category">{row().category}</p>
            <VaccinationSourceLink
              calendar={props.calendar}
              source={row().source}
              rowLabel={`строка ${row().number} приложения № 1`}
            />
          </>
        )}
      </Show>
    </OverlayDialog>
  );
}
