import { createSignal, For, type JSX, Show } from 'solid-js';

import { Button } from '@/components/Button';
import { Disclosure } from '@/components/Disclosure';
import { useNarrowViewport } from '@/components/narrow-viewport';
import { VaccinationSourceLink } from '@/features/vaccination/VaccinationSourceLink';
import {
  isAgeRow,
  type NationalRow,
  type VaccinationCalendar,
} from '@/features/vaccination/vaccination-calendar';
import { pluralRu } from '@/i18n/labels';

function rowTitle(row: NationalRow): string {
  return isAgeRow(row) ? row.category : row.items.map((item) => item.text).join('; ');
}

function VaccineList(props: { readonly row: NationalRow }): JSX.Element {
  return (
    <ul class="vax-items">
      <For each={props.row.items}>
        {(item) => (
          <li class="vax-items__item" data-item-id={item.id}>
            {item.text}
          </li>
        )}
      </For>
    </ul>
  );
}

/** Appendix 1 as the order prints it: number, category and age, vaccination; a real table. */
function NationalTable(props: {
  readonly calendar: VaccinationCalendar;
  readonly rows: readonly NationalRow[];
}): JSX.Element {
  const columns = (): readonly string[] => props.calendar.national.columns;
  return (
    <div class="vax-table-wrap">
      <table class="vax-table">
        <caption class="vax-table__caption">{props.calendar.national.title}</caption>
        <thead class="vax-table__head">
          <tr class="vax-table__head-row">
            <th class="vax-table__th vax-table__th--number" scope="col">
              {columns()[0]}
            </th>
            <th class="vax-table__th" scope="col">
              {columns()[1]}
            </th>
            <th class="vax-table__th" scope="col">
              {columns()[2]}
            </th>
            <th class="vax-table__th vax-table__th--source" scope="col">
              Источник
            </th>
          </tr>
        </thead>
        <tbody class="vax-table__body">
          <For each={props.rows}>
            {(row) => (
              <tr class="vax-table__row" data-row-id={row.id}>
                <th class="vax-table__cell vax-table__cell--number" scope="row">
                  {row.number}.
                </th>
                <td class="vax-table__cell vax-table__cell--category">{row.category}</td>
                <td class="vax-table__cell">
                  <VaccineList row={row} />
                </td>
                <td class="vax-table__cell vax-table__cell--source">
                  <VaccinationSourceLink
                    calendar={props.calendar}
                    source={row.source}
                    rowLabel={`строка ${row.number} приложения № 1`}
                  />
                </td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  );
}

/** The same rows for a phone: one card per row, vaccinations in the expandable body. */
function NationalCards(props: {
  readonly calendar: VaccinationCalendar;
  readonly rows: readonly NationalRow[];
}): JSX.Element {
  const [open, setOpen] = createSignal<readonly string[]>([]);
  const allOpen = (): boolean => props.rows.every((row) => open().includes(row.id));
  const toggle = (id: string, value: boolean): void => {
    setOpen((current) => [...current.filter((entry) => entry !== id), ...(value ? [id] : [])]);
  };
  return (
    <div class="vax-cards">
      <div class="vax-cards__toolbar">
        <Button
          type="button"
          variant="quiet"
          class="vax-cards__toggle-all"
          onClick={() => {
            setOpen(allOpen() ? [] : props.rows.map((row) => row.id));
          }}
        >
          {allOpen() ? 'Свернуть все строки' : 'Развернуть все строки'}
        </Button>
      </div>
      <ul class="vax-cards__list">
        <For each={props.rows}>
          {(row) => (
            <li class="vax-cards__item" data-row-id={row.id}>
              <Disclosure
                variant="card"
                title={
                  <span class="vax-cards__title">
                    <span class="vax-cards__number">{row.number}.</span> {rowTitle(row)}
                  </span>
                }
                meta={`${row.items.length} ${pluralRu(row.items.length, 'прививка', 'прививки', 'прививок')}`}
                open={open().includes(row.id)}
                onToggle={(value) => toggle(row.id, value)}
              >
                <div class="vax-cards__body">
                  <Show when={!isAgeRow(row)}>
                    <p class="vax-cards__category">
                      <span class="vax-cards__label">Категории: </span>
                      {row.category}
                    </p>
                  </Show>
                  <VaccineList row={row} />
                  <VaccinationSourceLink
                    calendar={props.calendar}
                    source={row.source}
                    rowLabel={`строка ${row.number} приложения № 1`}
                  />
                </div>
              </Disclosure>
            </li>
          )}
        </For>
      </ul>
    </div>
  );
}

export function VaccinationNationalView(props: {
  readonly calendar: VaccinationCalendar;
  readonly rows: readonly NationalRow[];
}): JSX.Element {
  const narrow = useNarrowViewport();
  return (
    <Show when={!narrow()} fallback={<NationalCards calendar={props.calendar} rows={props.rows} />}>
      <NationalTable calendar={props.calendar} rows={props.rows} />
    </Show>
  );
}
