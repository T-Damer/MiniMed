import {
  createMemo,
  createResource,
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { PAGE_HEROES } from '@/app/page-heroes';

import { describeRanges } from '@/components/date-ranges';
import { EmptyState } from '@/components/EmptyState';
import { NavBack } from '@/components/NavBack';
import { OverlayDialog } from '@/components/OverlayDialog';
import { Page } from '@/components/Page';
import { SegmentedControl } from '@/components/SegmentedControl';
import { Heading } from '@/components/Text';
import type { DoctorPatient } from '@/features/diary/connected/doctor-workspace';
import {
  chartSeries,
  DIARY_CHARTS,
  type DiaryChart,
  intakeCharts,
} from '@/features/diary/dashboard/diary-charts';
import {
  medicineAdherence,
  type QuestionnaireSeries,
  questionnaireSeries,
} from '@/features/diary/dashboard/diary-insights';
import { medicineIntake } from '@/features/diary/dashboard/diary-intake';
import { LimitDialog, type LimitTarget } from '@/features/diary/dashboard/LimitDialog';
import { AlertNotices } from '@/features/diary/dashboard/PatientDialogs';
import { INTAKE_CHART_ID } from '@/features/diary/dashboard/patient-overview';
import { TrendChart, type TrendLimit } from '@/features/diary/dashboard/TrendChart';
import type { DiaryResults } from '@/features/diary/diary-model';
import { assessmentBounds, crossesLimit, MEASUREMENT_LIMIT_LABEL } from '@/state/assessment-limits';
import { motionMs } from '@/state/motion';

type Period = '14' | '30' | '90';
type Dialog =
  | {
      readonly notice: {
        readonly title: string;
        readonly point: QuestionnaireSeries['points'][number];
      };
    }
  | { readonly limit: readonly LimitTarget[] };

const DAY = 86_400_000;

/** The DOM id of a chart on this page, the target of the overview's signals. */
export function chartAnchor(id: string): string {
  return `diary-chart-${id}`;
}

/** The red lines a declared chart draws, as the «Порог тревоги» dialog edits them. */
function chartLimits(chart: DiaryChart): (LimitTarget & { readonly axis?: 'right' })[] {
  return (chart.limits ?? []).map((limit) => ({
    id: limit.id,
    label: MEASUREMENT_LIMIT_LABEL[limit.id] ?? limit.id,
    ...(limit.unit ? { unit: limit.unit } : {}),
    ...(limit.axis ? { axis: limit.axis } : {}),
  }));
}

/** The doctor's red lines for these measurements or questionnaires. */
function limitsOf(targets: readonly LimitTarget[]): TrendLimit[] {
  return targets.flatMap((target) => {
    const bounds = assessmentBounds(target.id, target.preset);
    return [
      ...(bounds.above === undefined
        ? []
        : [{ value: bounds.above, label: `${target.label}: выше ${bounds.above}` }]),
      ...(bounds.below === undefined
        ? []
        : [{ value: bounds.below, label: `${target.label}: ниже ${bounds.below}` }]),
    ];
  });
}

function quizLimit(series: QuestionnaireSeries): LimitTarget {
  return { id: series.limitId, label: series.title, unit: 'баллов', preset: series.preset };
}

/**
 * Every chart of one patient on a page of its own (owner 2026-11-03: the patient page leads with
 * what changed; the charts are one tap away): medicine intake by day, the declared charts,
 * questionnaire totals with their red lines, and profile questionnaires as their results. Opened
 * from a signal, the page starts at that chart.
 */
export function PatientChartsPage(props: {
  readonly patient: DoctorPatient;
  readonly results: DiaryResults;
  /** Bumps when the workspace changes. */
  readonly version: number;
  /** The chart to start at (`DiaryChart.id`, `intake`, a questionnaire checkpoint id). */
  readonly focus?: string | undefined;
  readonly onBack: () => void;
}): JSX.Element {
  const [period, setPeriod] = createSignal<Period>('30');
  const [dialog, setDialog] = createSignal<Dialog>();
  const from = (): number => Date.now() - Number(period()) * DAY;
  const recent = createMemo(() => {
    const since = from();
    return props.results.entries.filter((entry) => Date.parse(entry.at) >= since);
  });
  const medicines = createMemo(() =>
    medicineAdherence(props.results.invitation, props.results.entries, Number(period())),
  );
  const intake = createMemo(() =>
    intakeCharts(medicineIntake(props.results.invitation, props.results.entries, Number(period()))),
  );
  const [quizzes] = createResource(
    () => ({ results: props.results, version: props.version }),
    ({ results }) => questionnaireSeries(results.invitation, results.entries),
  );
  const title = () =>
    `${props.patient.replica.profile?.emoji ?? ''} ${props.patient.replica.profile?.label ?? 'Пациент'}`.trim();
  const courseOf = (itemId: string): string | undefined => {
    const course = props.results.invitation.plan?.find((item) => item.id === itemId)?.course;
    return course?.length ? describeRanges(course) : undefined;
  };
  const openLimit = (targets: readonly LimitTarget[]) => () => setDialog({ limit: targets });
  /** The latest answers raised the schema's alerts or crossed the red line: why, one tap away. */
  const quizWarning = (series: QuestionnaireSeries) => {
    const last = series.points.at(-1);
    if (!last) return undefined;
    if (!last.alerts.length && !crossesLimit(series.limitId, last.total, series.preset)) {
      return undefined;
    }
    return {
      label: `${series.title}: ${last.total} из ${last.max}, ${last.headline}`,
      onOpen: () => setDialog({ notice: { title: series.title, point: last } }),
    };
  };

  // Opened from a signal: start at its chart once it is there (questionnaires come later), and
  // once more after the page has slid in, which moves the layout under a first scroll.
  onMount(() => {
    const focus = props.focus;
    if (!focus) return;
    const scroll = (): boolean => {
      const target = document.getElementById(chartAnchor(focus));
      target?.scrollIntoView({ block: 'start' });
      return Boolean(target);
    };
    let tries = 0;
    const timer = window.setInterval(() => {
      tries += 1;
      if (scroll() || tries > 20) {
        window.clearInterval(timer);
        window.setTimeout(scroll, motionMs(320));
      }
    }, 60);
    onCleanup(() => window.clearInterval(timer));
  });

  return (
    <div class="diary-patient diary-charts-page">
      <Page
        hero={PAGE_HEROES.patients}
        navigation={
          <NavBack class="knowledge-back-button" aria-label="К пациенту" onClick={props.onBack} />
        }
        title={<Heading depth={1}>Графики</Heading>}
        description={title()}
        help={
          <p>
            Линии — записи пациента за выбранный период. Красный пунктир — порог тревоги: карандаш у
            графика меняет его для всех пациентов на этом устройстве.
          </p>
        }
      />
      <SegmentedControl
        label="Период"
        value={period()}
        options={[
          { value: '14', label: '14 дней' },
          { value: '30', label: '30 дней' },
          { value: '90', label: '90 дней' },
        ]}
        onChange={setPeriod}
      />

      <Show when={medicines().length}>
        <section
          id={chartAnchor(INTAKE_CHART_ID)}
          class="diary-patient__section diary-patient__section--card diary-charts-page__anchor"
          aria-label="Приём лекарств"
        >
          <h2 class="diary-patient__heading">Приём лекарств</h2>
          <ul class="diary-adherence">
            <For each={medicines()}>
              {(medicine) => {
                const share = () => (medicine.planned ? medicine.taken / medicine.planned : 0);
                return (
                  <li class="diary-adherence__row">
                    <span class="diary-adherence__name">
                      {medicine.name}
                      <Show when={courseOf(medicine.itemId)}>
                        {(text) => <span class="diary-adherence__course">{text()}</span>}
                      </Show>
                    </span>
                    <span class="diary-adherence__bar" aria-hidden="true">
                      <span
                        class="diary-adherence__fill"
                        style={{ width: `${Math.round(share() * 100)}%` }}
                      />
                    </span>
                    <span class="diary-adherence__value">
                      <Show when={medicine.planned} fallback="приёмов ещё не было">
                        {medicine.taken} из {medicine.planned}
                        {medicine.skipped ? `, пропущено ${medicine.skipped}` : ''}
                      </Show>
                    </span>
                  </li>
                );
              }}
            </For>
          </ul>
          <div class="diary-intake">
            <For each={intake()}>
              {(chart) => (
                <TrendChart
                  title={chart.title}
                  from={from()}
                  to={Date.now()}
                  min={0}
                  daily
                  series={chart.series}
                />
              )}
            </For>
          </div>
        </section>
      </Show>

      <div class="diary-patient__charts">
        <For each={DIARY_CHARTS}>
          {(chart) => (
            <Show when={chartSeries(chart, recent()).length}>
              <div id={chartAnchor(chart.id)} class="diary-charts-page__anchor">
                <TrendChart
                  from={from()}
                  to={Date.now()}
                  title={chart.title}
                  min={chart.min}
                  max={chart.max}
                  rightMin={chart.rightMin}
                  rightMax={chart.rightMax}
                  daily={chart.daily === true}
                  series={chartSeries(chart, recent())}
                  limits={chartLimits(chart).flatMap((target) =>
                    limitsOf([target]).map((limit) =>
                      target.axis ? { ...limit, axis: target.axis } : limit,
                    ),
                  )}
                  onLimit={chart.limits?.length ? openLimit(chartLimits(chart)) : undefined}
                />
              </div>
            </Show>
          )}
        </For>
        <For each={quizzes.latest ?? []}>
          {(series) => (
            <Show
              when={!series.profile}
              fallback={
                <section
                  id={chartAnchor(series.checkpointId)}
                  class="diary-patient__section diary-patient__section--card diary-charts-page__anchor"
                  aria-label={series.title}
                >
                  <h2 class="diary-patient__heading">{series.title}</h2>
                  <ul class="diary-charts-page__results">
                    <For each={series.points.toReversed()}>
                      {(point) => (
                        <li class="diary-charts-page__result">
                          <span class="diary-charts-page__result-when">
                            {new Date(point.at).toLocaleDateString('ru-RU', {
                              day: 'numeric',
                              month: 'short',
                            })}
                          </span>
                          <span class="diary-charts-page__result-text">{point.headline}</span>
                        </li>
                      )}
                    </For>
                  </ul>
                </section>
              }
            >
              <section
                id={chartAnchor(series.checkpointId)}
                class="diary-patient__quiz diary-charts-page__anchor"
              >
                <TrendChart
                  from={from()}
                  to={Date.now()}
                  title={`${series.title}, сумма баллов`}
                  limits={limitsOf([quizLimit(series)])}
                  onLimit={openLimit([quizLimit(series)])}
                  warning={quizWarning(series)}
                  min={0}
                  max={series.points[0]?.max}
                  series={[
                    {
                      label: series.title,
                      points: series.points.map((point) => ({ at: point.at, value: point.total })),
                      color: '--theme-accent',
                    },
                  ]}
                />
              </section>
            </Show>
          )}
        </For>
      </div>
      <Show when={!recent().length && !medicines().length}>
        <EmptyState glyph="chart-line" title={`За ${period()} дней записей нет`} />
      </Show>

      <Show
        when={(() => {
          const current = dialog();
          return current && 'notice' in current ? current.notice : undefined;
        })()}
      >
        {(notice) => (
          <OverlayDialog
            open
            title={notice().title}
            subtitle={`${notice().point.total} из ${notice().point.max} · ${new Date(notice().point.at).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}`}
            class="diary-dash-dialog"
            onClose={() => setDialog(undefined)}
          >
            <AlertNotices cause={notice()} />
          </OverlayDialog>
        )}
      </Show>
      <Show
        when={(() => {
          const current = dialog();
          return current && 'limit' in current ? current.limit : undefined;
        })()}
      >
        {(targets) => <LimitDialog targets={targets()} onClose={() => setDialog(undefined)} />}
      </Show>
    </div>
  );
}
