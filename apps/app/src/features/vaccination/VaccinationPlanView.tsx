import { createMemo, createSignal, For, type JSX, Show } from 'solid-js';

import { Disclosure } from '@/components/Disclosure';
import { TextField } from '@/components/TextField';
import { VaccinationProcedureParagraph } from '@/features/vaccination/VaccinationProcedureView';
import { VaccinationSourceLink } from '@/features/vaccination/VaccinationSourceLink';
import {
  procedureItemsFor,
  type VaccinationCalendar,
} from '@/features/vaccination/vaccination-calendar';
import {
  buildChildPlan,
  type CalendarDate,
  formatIsoDate,
  PLAN_PROBLEM_MESSAGES,
  type PlanEntry,
  type PlanStatus,
} from '@/features/vaccination/vaccination-plan';
import { displayIsoDate } from '@/features/vaccination/vaccination-print';

const STATUS_LABELS: Readonly<Record<PlanStatus, string>> = {
  passed: 'Возраст уже наступил',
  current: 'Последний наступивший возраст',
  upcoming: 'Предстоит',
};

function dateLabel(date: CalendarDate): string {
  return displayIsoDate(formatIsoDate(date));
}

function periodLabel(entry: PlanEntry): string {
  const prefix = entry.approximate ? '≈ ' : '';
  return formatIsoDate(entry.from) === formatIsoDate(entry.to)
    ? `${prefix}${dateLabel(entry.from)}`
    : `${prefix}${dateLabel(entry.from)} — ${dateLabel(entry.to)}`;
}

/** Today as an ISO date in the device's time zone. */
export function todayIso(now = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Dates for the age rows of the national calendar counted from a birth date. The birth date stays
 * in this screen: it is neither stored nor placed in the address.
 */
export function VaccinationPlanView(props: {
  readonly calendar: VaccinationCalendar;
}): JSX.Element {
  const [birth, setBirth] = createSignal('');
  const today = todayIso();
  const plan = createMemo(() =>
    birth() ? buildChildPlan(props.calendar.national.rows, birth(), today) : undefined,
  );
  const entries = createMemo(() => {
    const current = plan();
    return current?.kind === 'plan' ? current.entries : undefined;
  });
  const problem = createMemo(() => {
    const current = plan();
    return current?.kind === 'problem' ? PLAN_PROBLEM_MESSAGES[current.problem] : undefined;
  });
  const rowsById = createMemo(
    () => new Map(props.calendar.national.rows.map((row) => [row.id, row])),
  );
  return (
    <section class="vax-plan" aria-label="План прививок по дате рождения">
      <p class="vax-plan__note">
        Расчётные даты по возрастам национального календаря. Приказ не называет дат и интервалов:
        план не учитывает уже сделанные прививки, противопоказания, нарушения сроков и инструкции к
        вакцинам. Дата рождения нигде не сохраняется.
      </p>
      <TextField
        class="vax-plan__birth"
        label="Дата рождения ребёнка"
        type="date"
        value={birth()}
        max={today}
        onInput={(event) => setBirth(event.currentTarget.value)}
      />
      <Show when={problem()}>
        {(message) => (
          <p class="vax-plan__problem" role="alert">
            {message()}
          </p>
        )}
      </Show>
      <Show when={entries()}>
        {(list) => (
          <ol class="vax-plan__list">
            <For each={list()}>
              {(entry) => (
                <li
                  class="vax-plan__entry"
                  classList={{
                    'vax-plan__entry--current': entry.status === 'current',
                    'vax-plan__entry--passed': entry.status === 'passed',
                  }}
                  data-row-id={entry.rowId}
                  data-status={entry.status}
                >
                  <header class="vax-plan__entry-head">
                    <h3 class="vax-plan__age">
                      {entry.number}. {entry.ageLabel}
                    </h3>
                    <p class="vax-plan__date">
                      <span class="vax-plan__date-value">{periodLabel(entry)}</span>
                      <span class="vax-plan__status">{STATUS_LABELS[entry.status]}</span>
                    </p>
                  </header>
                  <Show when={rowsById().get(entry.rowId)}>
                    {(row) => (
                      <>
                        <ul class="vax-items">
                          <For each={row().items}>
                            {(item) => (
                              <li class="vax-items__item">
                                {item.text}
                                <For each={procedureItemsFor(props.calendar, item.infectionKey)}>
                                  {(paragraph) => (
                                    <span class="vax-plan__ref">
                                      условия: п. {paragraph.number} приложения № 3
                                    </span>
                                  )}
                                </For>
                              </li>
                            )}
                          </For>
                        </ul>
                        <VaccinationSourceLink
                          calendar={props.calendar}
                          source={row().source}
                          rowLabel={`строка ${row().number} приложения № 1`}
                        />
                      </>
                    )}
                  </Show>
                </li>
              )}
            </For>
          </ol>
        )}
      </Show>
      <Show when={entries()}>
        <Disclosure
          variant="card"
          class="vax-plan__conditions"
          title="Условия из порядка проведения прививок (приложение № 3)"
        >
          <For each={props.calendar.procedure.items}>
            {(item) => <VaccinationProcedureParagraph calendar={props.calendar} item={item} />}
          </For>
        </Disclosure>
      </Show>
      <p class="vax-plan__convention">
        Месяцы считаются календарными, «4,5 месяца» — 4 месяца и 15 дней (≈). Дни жизни считаются с
        дня рождения как первого дня: «3–7 день» — с третьего по седьмой. Окно «6–7 лет» показано от
        6-летия до 7-летия; его границы определяет врач по приказу и инструкции к вакцине.
      </p>
    </section>
  );
}
