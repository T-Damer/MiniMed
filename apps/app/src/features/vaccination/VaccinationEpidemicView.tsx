import { createSignal, For, type JSX, Show } from 'solid-js';

import { Button } from '@/components/Button';
import { Disclosure } from '@/components/Disclosure';
import { useNarrowViewport } from '@/components/narrow-viewport';
import { VaccinationSourceLink } from '@/features/vaccination/VaccinationSourceLink';
import type {
  EpidemicRow,
  VaccinationBlock,
  VaccinationCalendar,
} from '@/features/vaccination/vaccination-calendar';

function Blocks(props: { readonly blocks: readonly VaccinationBlock[] }): JSX.Element {
  return (
    <div class="vax-blocks">
      <For each={props.blocks}>
        {(block) => (
          <p
            class="vax-blocks__block"
            classList={{ 'vax-blocks__block--bullet': block.kind === 'bullet' }}
          >
            <Show when={block.kind === 'bullet'}>
              <span class="vax-blocks__dash" aria-hidden="true">
                -{' '}
              </span>
            </Show>
            {block.text}
          </p>
        )}
      </For>
    </div>
  );
}

function Amendment(props: {
  readonly calendar: VaccinationCalendar;
  readonly row: EpidemicRow;
}): JSX.Element {
  return (
    <Show when={props.row.previousEdition}>
      {(previous) => (
        <div class="vax-amendment">
          <p class="vax-amendment__note">
            Строка в редакции приказа № {props.row.amendedBy}. Прежняя редакция (приказ № 1122н без
            изменений) сохранена для сверки.
          </p>
          <Disclosure variant="inline" title="Показать прежнюю редакцию строки">
            <Blocks blocks={previous().categories} />
            <VaccinationSourceLink
              calendar={props.calendar}
              source={previous().source}
              rowLabel={`прежняя редакция строки ${props.row.number} приложения № 2`}
            />
          </Disclosure>
        </div>
      )}
    </Show>
  );
}

function EpidemicTable(props: {
  readonly calendar: VaccinationCalendar;
  readonly rows: readonly EpidemicRow[];
}): JSX.Element {
  const columns = (): readonly string[] => props.calendar.epidemic.columns;
  return (
    <div class="vax-table-wrap">
      <table class="vax-table vax-table--epidemic">
        <caption class="vax-table__caption">{props.calendar.epidemic.title}</caption>
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
                <td class="vax-table__cell vax-table__cell--category">{row.vaccine}</td>
                <td class="vax-table__cell">
                  <Blocks blocks={row.categories} />
                  <Amendment calendar={props.calendar} row={row} />
                </td>
                <td class="vax-table__cell vax-table__cell--source">
                  <VaccinationSourceLink
                    calendar={props.calendar}
                    source={row.source}
                    rowLabel={`строка ${row.number} приложения № 2`}
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

function EpidemicCards(props: {
  readonly calendar: VaccinationCalendar;
  readonly rows: readonly EpidemicRow[];
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
                    <span class="vax-cards__number">{row.number}.</span> {row.vaccine}
                  </span>
                }
                open={open().includes(row.id)}
                onToggle={(value) => toggle(row.id, value)}
              >
                <div class="vax-cards__body">
                  <p class="vax-cards__label">{props.calendar.epidemic.columns[2]}</p>
                  <Blocks blocks={row.categories} />
                  <Amendment calendar={props.calendar} row={row} />
                  <VaccinationSourceLink
                    calendar={props.calendar}
                    source={row.source}
                    rowLabel={`строка ${row.number} приложения № 2`}
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

export function VaccinationEpidemicView(props: {
  readonly calendar: VaccinationCalendar;
  readonly rows: readonly EpidemicRow[];
}): JSX.Element {
  const narrow = useNarrowViewport();
  return (
    <Show when={!narrow()} fallback={<EpidemicCards calendar={props.calendar} rows={props.rows} />}>
      <EpidemicTable calendar={props.calendar} rows={props.rows} />
    </Show>
  );
}
