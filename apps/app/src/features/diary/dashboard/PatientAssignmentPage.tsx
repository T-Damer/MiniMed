import { createMemo, For, type JSX, Show } from 'solid-js';
import { toast } from 'solid-sonner';

import { PAGE_HEROES } from '@/app/page-heroes';
import { EmptyState } from '@/components/EmptyState';
import { NavBack } from '@/components/NavBack';
import { Page } from '@/components/Page';
import { Heading } from '@/components/Text';
import { pluralize } from '@/diary/diary-format';
import { spokenWords } from '@/diary/spoken';
import { TrendChart, type TrendSeries } from '@/features/diary/dashboard/TrendChart';
import {
  assignmentEntries,
  assignmentPrintRows,
  assignmentScheduleWords,
  assignmentWhat,
} from '@/features/diary/diary-assignments';
import type { DiaryAssignment, DiaryEntry, DiaryResults } from '@/features/diary/diary-model';
import { PrintManager } from '@/features/printing/print-manager';
import { formatWorksheetValue, worksheetPrintHtml } from '@/features/worksheets/worksheet-print';
import {
  isNumericField,
  type WorksheetFieldType,
  worksheetDoctorNote,
} from '@/state/user-worksheet-format';

import '@/features/worksheets/worksheets.css';
import { worksheetHelpSources } from '@/features/worksheets/worksheet-sources';

const COLORS = ['--theme-accent', '--theme-warning', '--theme-info', '--theme-danger'] as const;

/** One chart of an assignment: columns on the same scale share it (emotion before and after). */
export interface AssignmentChart {
  readonly title: string;
  readonly series: readonly TrendSeries[];
  readonly max?: number;
}

const SCALE_MAX: Readonly<Partial<Record<WorksheetFieldType, number>>> = {
  percent: 100,
  scale: 10,
};

/**
 * The columns the sheet declares for a chart, as lines over the patient's entries. Columns of a
 * fixed scale (0–100 %, 0–10) share one chart; a number or minutes column has its own.
 */
export function assignmentCharts(
  assignment: DiaryAssignment,
  entries: readonly DiaryEntry[],
): AssignmentChart[] {
  const charts: { key: string; title: string[]; series: TrendSeries[]; max?: number }[] = [];
  let color = 0;
  for (const field of assignment.worksheet.fields) {
    if (!field.chart || !isNumericField(field.type)) continue;
    const points = entries.flatMap((entry) => {
      const value = entry.sheet?.[field.id];
      return typeof value === 'number' ? [{ at: entry.at, value }] : [];
    });
    if (!points.length) continue;
    const series: TrendSeries = {
      label: field.label,
      color: COLORS[color % COLORS.length] ?? '--theme-accent',
      points,
    };
    color += 1;
    const max = SCALE_MAX[field.type];
    const key = max === undefined ? `field-${field.id}` : field.type;
    const chart = charts.find((candidate) => candidate.key === key);
    if (chart) {
      chart.title.push(field.label);
      chart.series.push(series);
    } else {
      charts.push({ key, title: [field.label], series: [series], ...(max ? { max } : {}) });
    }
  }
  return charts.map((chart) => ({
    title: chart.title
      .join(' и ')
      .replace(/ и (.)/u, (_, first: string) => ` и ${first.toLowerCase()}`),
    series: chart.series,
    ...(chart.max ? { max: chart.max } : {}),
  }));
}

function when(at: string): string {
  return new Date(at).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * One assigned worksheet as the doctor reads it (CBT1): what the patient wrote, row by row, with
 * the columns the sheet charts on a graph, the dictated texts marked, and the filled sheet to print.
 * How to read each column is in the «?».
 */
export function PatientAssignmentPage(props: {
  readonly results: DiaryResults;
  readonly assignmentId: string;
  readonly patientLabel: string;
  readonly onBack: () => void;
}): JSX.Element {
  const assignment = createMemo(() =>
    props.results.invitation.assignments?.find((one) => one.id === props.assignmentId),
  );
  const entries = createMemo(() => assignmentEntries(props.results.entries, props.assignmentId));
  const newestFirst = createMemo(() => entries().toReversed());
  const charts = createMemo(() => {
    const current = assignment();
    return current ? assignmentCharts(current, entries()) : [];
  });

  const print = (): void => {
    const current = assignment();
    if (!current) return;
    const html = worksheetPrintHtml(current.worksheet, assignmentPrintRows(entries()), {
      what: assignmentWhat(current),
      patient: props.patientLabel,
    });
    if (!PrintManager.html(html, current.worksheet.title)) {
      toast.error('Браузер не открыл окно печати. Разрешите всплывающие окна.');
    }
  };

  return (
    <main class="worksheet-task" aria-label="Задание пациента">
      <Show
        when={assignment()}
        fallback={
          <Page
            hero={PAGE_HEROES.patients}
            navigation={<NavBack aria-label="К пациенту" onClick={props.onBack} />}
            title={<Heading depth={1}>Задание не найдено</Heading>}
          />
        }
      >
        {(current) => (
          <>
            <Page
              hero={PAGE_HEROES.patients}
              navigation={
                <NavBack
                  class="knowledge-back-button"
                  aria-label="К пациенту"
                  onClick={props.onBack}
                />
              }
              title={<Heading depth={1}>{current().worksheet.title}</Heading>}
              description={[
                assignmentScheduleWords(current()),
                current().ended ? 'завершено' : '',
                `${entries().length} ${pluralize(entries().length, 'запись', 'записи', 'записей')}`,
              ]
                .filter(Boolean)
                .join(' · ')}
              headerActions={[
                {
                  id: 'print',
                  label: 'Печать заполненного листа',
                  icon: 'printer',
                  priority: 2,
                  onSelect: print,
                },
              ]}
              helpSources={worksheetHelpSources(current().worksheet)}
              help={
                <>
                  <For each={worksheetDoctorNote(current().worksheet).split(/\n{2,}/u)}>
                    {(paragraph) => <p>{paragraph}</p>}
                  </For>
                  <dl class="worksheet-task__hints">
                    <For each={current().worksheet.fields.filter((field) => field.doctorHint)}>
                      {(field) => (
                        <>
                          <dt class="worksheet-task__hint-term">{field.label}</dt>
                          <dd class="worksheet-task__hint-text">{field.doctorHint}</dd>
                        </>
                      )}
                    </For>
                  </dl>
                </>
              }
            />

            <Show when={current().why || current().what}>
              <section class="worksheet-task__memo" aria-label="Памятка пациента">
                <Show when={current().why}>
                  <p class="worksheet-task__memo-line">
                    <strong>Зачем:</strong> {current().why}
                  </p>
                </Show>
                <Show when={current().what}>
                  <p class="worksheet-task__memo-line">
                    <strong>Что делать:</strong> {current().what}
                  </p>
                </Show>
              </section>
            </Show>

            <For each={charts()}>
              {(chart) => (
                <TrendChart
                  title={chart.title}
                  series={chart.series}
                  min={0}
                  {...(chart.max ? { max: chart.max } : {})}
                />
              )}
            </For>

            <Show
              when={newestFirst().length}
              fallback={
                <EmptyState
                  glyph="note-pencil"
                  title="Записей пока нет"
                  text="Пациент увидит задание на экране «Сегодня»; записи придут сюда сами."
                />
              }
            >
              <ol class="worksheet-task__rows" aria-label="Записи пациента">
                <For each={newestFirst()}>
                  {(entry) => (
                    <li class="worksheet-task__row">
                      <p class="worksheet-task__row-when">{when(entry.at)}</p>
                      <dl class="worksheet-task__cells">
                        <For
                          each={current().worksheet.fields.filter(
                            (field) => entry.sheet?.[field.id] !== undefined,
                          )}
                        >
                          {(field) => {
                            const marks = (entry.spoken ?? []).filter(
                              (mark) => mark.target === field.id,
                            );
                            return (
                              <div class="worksheet-task__cell">
                                <dt class="worksheet-task__cell-label">{field.label}</dt>
                                <dd class="worksheet-task__cell-value">
                                  {formatWorksheetValue(entry.sheet?.[field.id])}
                                  {field.type === 'percent' ? ' %' : ''}
                                  <Show when={marks.length}>
                                    <span class="worksheet-task__spoken">{spokenWords(marks)}</span>
                                  </Show>
                                </dd>
                              </div>
                            );
                          }}
                        </For>
                        <Show when={entry.note}>
                          <div class="worksheet-task__cell">
                            <dt class="worksheet-task__cell-label">Что ещё важно</dt>
                            <dd class="worksheet-task__cell-value">
                              {entry.note}
                              <Show
                                when={
                                  (entry.spoken ?? []).filter((mark) => mark.target === '#note')
                                    .length
                                }
                              >
                                <span class="worksheet-task__spoken">
                                  {spokenWords(
                                    (entry.spoken ?? []).filter((mark) => mark.target === '#note'),
                                  )}
                                </span>
                              </Show>
                            </dd>
                          </div>
                        </Show>
                      </dl>
                      {/* Reserved (CBT1): a simplified retelling of a spoken text, when one exists. */}
                      <Show when={entry.insights?.length}>
                        <div class="worksheet-task__insight">
                          <For each={entry.insights ?? []}>
                            {(insight) => (
                              <p class="worksheet-task__insight-text">
                                <strong>Проще:</strong> {insight.simplified}
                                <Show when={insight.tone.length}>
                                  {' · '}
                                  {insight.tone.map((tone) => tone.label).join(', ')}
                                </Show>
                              </p>
                            )}
                          </For>
                        </div>
                      </Show>
                    </li>
                  )}
                </For>
              </ol>
            </Show>
          </>
        )}
      </Show>
    </main>
  );
}
