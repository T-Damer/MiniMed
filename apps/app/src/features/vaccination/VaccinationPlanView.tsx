import { createMemo, createSignal, For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { Disclosure } from '@/components/Disclosure';
import { VaccinationChildPanel } from '@/features/vaccination/VaccinationChildPanel';
import { VaccinationPrintDialog } from '@/features/vaccination/VaccinationPrintDialog';
import { VaccinationProcedureParagraph } from '@/features/vaccination/VaccinationProcedureView';
import { VaccinationSourceLink } from '@/features/vaccination/VaccinationSourceLink';
import {
  itemDoseLabel,
  procedureItemsFor,
  type VaccinationCalendar,
} from '@/features/vaccination/vaccination-calendar';
import { CHART_BAND_LABELS } from '@/features/vaccination/vaccination-chart';
import {
  type ChildInput,
  childBirthDate,
  diarySubjectFor,
} from '@/features/vaccination/vaccination-child';
import { buildDiarySheet, type DiaryResult } from '@/features/vaccination/vaccination-diary';
import {
  renderVaccinationDiaryHtml,
  VACCINATION_DIARY_TITLE,
} from '@/features/vaccination/vaccination-diary-print';
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
 * Dates for the age rows of the national calendar counted from a birth date, for a patient card
 * (the plan is attached to it) or for a birth date alone (nothing is stored), and the print of the
 * personal vaccination diary.
 */
export function VaccinationPlanView(props: {
  readonly calendar: VaccinationCalendar;
}): JSX.Element {
  const today = todayIso();
  const [child, setChild] = createSignal<ChildInput>();
  const [previewOpen, setPreviewOpen] = createSignal(false);
  const birth = createMemo(() => {
    const input = child();
    return input ? (childBirthDate(input) ?? '') : '';
  });
  const typedBirth = createMemo(() => child()?.typedBirthDate ?? '');
  const plan = createMemo(() => {
    // A date that is typed but not a calendar date is explained by the field itself.
    const date = birth() || typedBirth();
    return date ? buildChildPlan(props.calendar.national.rows, date, today) : undefined;
  });
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
  const diary = createMemo<DiaryResult | undefined>(() => {
    const input = child();
    const subject = input ? diarySubjectFor(input) : null;
    return subject ? buildDiarySheet(props.calendar, subject, today) : undefined;
  });
  const diaryHtml = createMemo(() => {
    const result = diary();
    return result?.kind === 'sheet' ? renderVaccinationDiaryHtml(props.calendar, result.sheet) : '';
  });
  return (
    <section class="vax-plan" aria-label="План прививок по дате рождения">
      <p class="vax-plan__note">
        Расчётные даты по возрастам национального календаря. Приказ не называет дат и интервалов:
        план не учитывает уже сделанные прививки, противопоказания, нарушения сроков и инструкции к
        вакцинам.
      </p>
      <VaccinationChildPanel calendar={props.calendar} today={today} onChange={setChild} />
      <Show when={problem()}>
        {(message) => (
          <p class="vax-plan__problem" role="alert">
            {message()}
          </p>
        )}
      </Show>
      <Show when={entries()}>
        {(list) => (
          <>
            <header class="vax-plan__toolbar">
              <h2 class="vax-plan__toolbar-title">План по возрастам</h2>
              <Button
                type="button"
                variant="primary"
                class="vax-plan__diary"
                icon={<AppGlyph name="printer" />}
                disabled={diary()?.kind !== 'sheet'}
                onClick={() => setPreviewOpen(true)}
              >
                Дневник для мамы
              </Button>
            </header>
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
                          <ul class="vax-items vax-plan__doses">
                            <For each={row().items}>
                              {(item) => (
                                <li class="vax-items__item vax-plan__dose">
                                  <span
                                    class={`vax-plan__dose-label vax-plan__dose-label--${item.band}`}
                                    title={CHART_BAND_LABELS[item.band]}
                                  >
                                    {itemDoseLabel(item)}
                                    {item.product ? ` · ${item.product.code}` : ''}
                                  </span>
                                  <span class="vax-plan__dose-text">
                                    {item.text}
                                    <For
                                      each={procedureItemsFor(props.calendar, item.infectionKey)}
                                    >
                                      {(paragraph) => (
                                        <span class="vax-plan__ref">
                                          условия: п. {paragraph.number} приложения № 3
                                        </span>
                                      )}
                                    </For>
                                  </span>
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
          </>
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
      <VaccinationPrintDialog
        open={previewOpen()}
        html={diaryHtml()}
        printTitle={VACCINATION_DIARY_TITLE}
        dialogTitle="Дневник прививок"
        frameTitle="Предпросмотр дневника прививок"
        note="Лист для мамы: таблица национального календаря, плановая дата под каждой прививкой и пустое поле для отметки. Печатается на одной странице A4 альбомной."
        onClose={() => setPreviewOpen(false)}
      />
    </section>
  );
}
