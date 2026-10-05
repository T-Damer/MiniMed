import { For, type JSX, Show } from 'solid-js';
import { VaccinationSourceLink } from '@/features/vaccination/VaccinationSourceLink';
import type { NationalRow, VaccinationCalendar } from '@/features/vaccination/vaccination-calendar';
import { buildSummaryGrid } from '@/features/vaccination/vaccination-grid';

/**
 * Infection × age grid of the national calendar. The order prints the calendar by age; this view
 * regroups the same vaccinations by infection and says so. Category rows follow in full.
 */
export function VaccinationGridView(props: {
  readonly calendar: VaccinationCalendar;
  /** Rows of Appendix 1 left after the filters; the grid keeps the columns of those rows only. */
  readonly rows: readonly NationalRow[];
}): JSX.Element {
  const grid = () =>
    buildSummaryGrid({
      ...props.calendar,
      national: { ...props.calendar.national, rows: [...props.rows] },
    });
  return (
    <div class="vax-grid">
      <p class="vax-grid__note">
        Сводка составлена из таблицы приложения № 1: приказ печатает календарь по возрасту, здесь те
        же прививки собраны по инфекциям. V — вакцинация, RV — ревакцинация, цифра — номер прививки
        в названии, * — «группы риска». Наведите на ячейку, чтобы увидеть формулировку приказа.
      </p>
      <Show
        when={grid().columns.length > 0}
        fallback={<p class="vax-grid__empty">Для выбранных условий возрастных строк нет.</p>}
      >
        <div class="vax-grid__scroller">
          <table class="vax-grid__table">
            <caption class="vax-grid__caption">Сводка национального календаря по возрасту</caption>
            <thead class="vax-grid__head">
              <tr class="vax-grid__head-row">
                <th class="vax-grid__corner" scope="col">
                  Инфекция
                </th>
                <For each={grid().columns}>
                  {(column) => (
                    <th class="vax-grid__age" scope="col" data-row-id={column.rowId}>
                      {column.label}
                    </th>
                  )}
                </For>
              </tr>
            </thead>
            <tbody class="vax-grid__body">
              <For each={grid().rows}>
                {(row) => (
                  <tr class="vax-grid__row" data-infection={row.infectionKey}>
                    <th class="vax-grid__infection" scope="row">
                      {row.infection}
                    </th>
                    <For each={grid().columns}>
                      {(column) => (
                        <td class="vax-grid__cell">
                          <For each={row.cells.get(column.rowId) ?? []}>
                            {(dose) => (
                              <span class="vax-grid__dose" title={dose.text}>
                                {dose.label}
                                {dose.qualifier ? '*' : ''}
                              </span>
                            )}
                          </For>
                        </td>
                      )}
                    </For>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </Show>
      <Show when={grid().categoryRows.length > 0}>
        <section class="vax-grid__categories" aria-label="Прививки по категориям">
          <h3 class="vax-grid__categories-title">Прививки по категориям (строки 16–19)</h3>
          <ul class="vax-grid__category-list">
            <For each={grid().categoryRows}>
              {(row) => (
                <li class="vax-grid__category" data-row-id={row.id}>
                  <p class="vax-grid__category-vaccine">
                    <span class="vax-grid__category-number">{row.number}.</span>{' '}
                    {row.items.map((item) => item.text).join('; ')}
                  </p>
                  <p class="vax-grid__category-text">{row.category}</p>
                  <VaccinationSourceLink
                    calendar={props.calendar}
                    source={row.source}
                    rowLabel={`строка ${row.number} приложения № 1`}
                  />
                </li>
              )}
            </For>
          </ul>
        </section>
      </Show>
    </div>
  );
}
