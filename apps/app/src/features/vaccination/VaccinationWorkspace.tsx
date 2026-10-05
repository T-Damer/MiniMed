import { createMemo, createSignal, For, type JSX, Match, Show, Switch } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { Disclosure } from '@/components/Disclosure';
import { NavBack } from '@/components/NavBack';
import { useNarrowViewport } from '@/components/narrow-viewport';
import { Page } from '@/components/Page';
import { SearchField } from '@/components/SearchField';
import { SegmentedControl } from '@/components/SegmentedControl';
import { SelectField } from '@/components/SelectField';
import { Heading } from '@/components/Text';
import { VaccinationEpidemicView } from '@/features/vaccination/VaccinationEpidemicView';
import { VaccinationGridView } from '@/features/vaccination/VaccinationGridView';
import { VaccinationNationalView } from '@/features/vaccination/VaccinationNationalView';
import { todayIso, VaccinationPlanView } from '@/features/vaccination/VaccinationPlanView';
import { VaccinationPrintDialog } from '@/features/vaccination/VaccinationPrintDialog';
import { VaccinationProcedureView } from '@/features/vaccination/VaccinationProcedureView';
import { getVaccinationCalendar, isAgeRow } from '@/features/vaccination/vaccination-calendar';
import {
  type CalendarFilter,
  type CalendarPart,
  DEFAULT_FILTER,
  filterEpidemicRows,
  filterNationalRows,
  type PopulationFilter,
} from '@/features/vaccination/vaccination-filter';
import { displayIsoDate } from '@/features/vaccination/vaccination-print';
import { pluralRu } from '@/i18n/labels';
import '@/styles/vaccination.css';

export type VaccinationPart = CalendarPart | 'plan' | 'procedure';
type NationalLayout = 'order' | 'grid';

const PART_OPTIONS = [
  { value: 'national', label: 'Национальный' },
  { value: 'plan', label: 'План ребёнка' },
  { value: 'epidemic', label: 'Эпидемические показания' },
  { value: 'procedure', label: 'Порядок' },
] as const satisfies readonly { value: VaccinationPart; label: string }[];

const POPULATION_OPTIONS = [
  { value: 'all', label: 'Все' },
  { value: 'children', label: 'Дети' },
  { value: 'adults', label: 'Взрослые' },
] as const satisfies readonly { value: PopulationFilter; label: string }[];

const LAYOUT_OPTIONS = [
  { value: 'order', label: 'Как в приказе' },
  { value: 'grid', label: 'Сводка по возрасту' },
] as const satisfies readonly { value: NationalLayout; label: string }[];

function rowsCaption(shown: number, total: number): string {
  return `Показано ${shown} из ${total} ${pluralRu(total, 'строки', 'строк', 'строк')}`;
}

/**
 * «Календарь прививок»: the national calendar and the calendar by epidemic indications of order
 * 1122н as the order prints them, a summary by age, a plan from a birth date and the order of
 * procedure; filters and a print of the whole document.
 */
export function VaccinationWorkspace(props: {
  /** From the address (`?part=`); anything that is not a part of the screen is ignored. */
  readonly initialPart?: string | undefined;
  readonly onBack: () => void;
}): JSX.Element {
  const calendar = getVaccinationCalendar();
  const narrow = useNarrowViewport();
  const [part, setPart] = createSignal<VaccinationPart>(
    PART_OPTIONS.find((option) => option.value === props.initialPart)?.value ?? 'national',
  );
  const [layout, setLayout] = createSignal<NationalLayout>('order');
  const [filter, setFilter] = createSignal<CalendarFilter>(DEFAULT_FILTER);
  const [previewOpen, setPreviewOpen] = createSignal(false);
  const patch = (next: Partial<CalendarFilter>): void => {
    setFilter((current) => ({ ...current, ...next }));
  };

  const nationalRows = createMemo(() => filterNationalRows(calendar.national.rows, filter()));
  const epidemicRows = createMemo(() => filterEpidemicRows(calendar.epidemic.rows, filter()));
  const ageOptions = [
    { value: 'any', label: 'Любой возраст' },
    ...calendar.national.rows
      .filter(isAgeRow)
      .map((row) => ({ value: row.id, label: `${row.number}. ${row.category}` })),
  ];
  const filtersVisible = (): boolean => part() === 'national' || part() === 'epidemic';
  /** «Все · любой возраст», «Дети · 3. Дети 1 месяц», «Взрослые · «грипп»». */
  const filterSummary = (): string => {
    const current = filter();
    const parts: string[] = [
      POPULATION_OPTIONS.find((option) => option.value === current.population)?.label ?? 'Все',
    ];
    if (part() === 'national') {
      parts.push(
        ageOptions.find((option) => option.value === current.age)?.label ?? 'Любой возраст',
      );
    } else if (current.query.trim()) {
      parts.push(`«${current.query.trim()}»`);
    }
    return parts.join(' · ').toLocaleLowerCase('ru-RU');
  };
  const filters = (): JSX.Element => (
    <fieldset class="vax__filters" aria-label="Фильтры">
      <SegmentedControl
        class="vax__population"
        label="Кому"
        options={POPULATION_OPTIONS}
        value={filter().population}
        onChange={(value) => patch({ population: value })}
      />
      <Show when={part() === 'national'}>
        <SegmentedControl
          class="vax__layout"
          label="Вид таблицы"
          options={LAYOUT_OPTIONS}
          value={layout()}
          onChange={setLayout}
        />
        <SelectField
          class="vax__age"
          label="Возраст"
          options={ageOptions}
          value={filter().age}
          onChange={(event) => patch({ age: event.currentTarget.value })}
        />
      </Show>
      <Show when={part() === 'epidemic'}>
        <SearchField
          class="vax__query"
          label="Инфекция или категория"
          placeholder="Например: клещевой энцефалит"
          value={filter().query}
          onInput={(value) => patch({ query: value })}
          onClear={() => patch({ query: '' })}
        />
      </Show>
      <Button
        type="button"
        variant="quiet"
        class="vax__reset"
        disabled={JSON.stringify(filter()) === JSON.stringify(DEFAULT_FILTER)}
        onClick={() => setFilter(DEFAULT_FILTER)}
      >
        Сбросить фильтры
      </Button>
    </fieldset>
  );

  return (
    <section class="vax" aria-label="Календарь прививок">
      <header class="vax__chrome">
        <NavBack
          class="vax__back knowledge-back-button"
          aria-label="Назад"
          onClick={props.onBack}
        />
      </header>
      <Page
        icon={<AppGlyph name="calendar" class="page__icon-glyph" />}
        title={<Heading depth={1}>Календарь прививок</Heading>}
        description={`Национальный календарь и календарь по эпидемическим показаниям — ${calendar.edition.editionLine}.`}
        actions={
          <Button
            type="button"
            variant="primary"
            class="vax__print"
            icon={<AppGlyph name="printer" />}
            onClick={() => setPreviewOpen(true)}
          >
            Печать
          </Button>
        }
      />
      <section class="vax__notice paper-card" aria-label="Редакция и источник">
        <p class="vax__notice-edition">
          Приказ № 1122н в ред. приказа № 677н: в силу с{' '}
          {displayIsoDate(calendar.edition.inForceFrom)}, действует до{' '}
          {displayIsoDate(calendar.edition.validUntil)}.
        </p>
        <p class="vax__notice-check">
          Таблицы переписаны с официальных сканов; клиническую проверку врач ещё не проводил. У
          каждой строки есть ссылка на страницу официального PDF.
        </p>
        <Disclosure variant="inline" title="Редакция, источник и проверка" defaultOpen={!narrow()}>
          <div class="vax__notice-details">
            <p class="vax__notice-text">
              {calendar.edition.label}. Изменяющие приказы на портале проверены{' '}
              {displayIsoDate(calendar.edition.checkedOn)}. Таблицы сверены с распознанным текстом
              сканов слово в слово. Решение о вакцинации принимает врач по действующему приказу и
              инструкции к вакцине.
            </p>
            <p class="vax__notice-links">
              <For each={calendar.sources}>
                {(source) => (
                  <a
                    class="vax__notice-link"
                    href={source.publicationUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Официальная публикация: приказ № {source.orderNumber} (PDF, {source.pagesCount}{' '}
                    {pluralRu(source.pagesCount, 'страница', 'страницы', 'страниц')})
                  </a>
                )}
              </For>
            </p>
          </div>
        </Disclosure>
      </section>
      <SegmentedControl
        class="vax__parts"
        label="Раздел календаря"
        options={PART_OPTIONS}
        value={part()}
        onChange={setPart}
      />
      <Show when={filtersVisible()}>
        <Show when={narrow()} fallback={filters()}>
          {/* On a phone the filters fold into one line that names the current choice, so the
              table starts on the first screen. */}
          <Disclosure variant="inline" title={`Фильтры: ${filterSummary()}`} defaultOpen={false}>
            {filters()}
          </Disclosure>
        </Show>
      </Show>
      <Switch>
        <Match when={part() === 'national'}>
          <p class="vax__count" role="status">
            {rowsCaption(nationalRows().length, calendar.national.rows.length)}
          </p>
          <Show
            when={nationalRows().length > 0}
            fallback={<p class="vax__empty">Строк для выбранных условий нет.</p>}
          >
            <Show
              when={layout() === 'order'}
              fallback={<VaccinationGridView calendar={calendar} rows={nationalRows()} />}
            >
              <VaccinationNationalView calendar={calendar} rows={nationalRows()} />
            </Show>
          </Show>
        </Match>
        <Match when={part() === 'plan'}>
          <VaccinationPlanView calendar={calendar} />
        </Match>
        <Match when={part() === 'epidemic'}>
          <p class="vax__count" role="status">
            {rowsCaption(epidemicRows().length, calendar.epidemic.rows.length)}
          </p>
          <Show
            when={epidemicRows().length > 0}
            fallback={<p class="vax__empty">Строк для выбранных условий нет.</p>}
          >
            <VaccinationEpidemicView calendar={calendar} rows={epidemicRows()} />
          </Show>
        </Match>
        <Match when={part() === 'procedure'}>
          <VaccinationProcedureView calendar={calendar} />
        </Match>
      </Switch>
      <Show when={calendar.review.notes.length > 0}>
        <section class="vax__review paper-card" aria-label="Что проверить врачу">
          <Heading depth={2} class="vax__review-title">
            Что проверить по источнику
          </Heading>
          <ul class="vax__review-list">
            <For each={calendar.review.notes}>
              {(note) => <li class="vax__review-item">{note}</li>}
            </For>
          </ul>
        </section>
      </Show>
      <VaccinationPrintDialog
        open={previewOpen()}
        calendar={calendar}
        printedOn={todayIso()}
        onClose={() => setPreviewOpen(false)}
      />
    </section>
  );
}
