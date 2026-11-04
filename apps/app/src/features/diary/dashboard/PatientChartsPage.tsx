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
import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { describeRanges } from '@/components/date-ranges';
import { EmptyState } from '@/components/EmptyState';
import type { HeaderAction } from '@/components/HeaderActions';
import { NavBack } from '@/components/NavBack';
import { OverlayDialog } from '@/components/OverlayDialog';
import { Page } from '@/components/Page';
import { revealElement } from '@/components/reveal';
import { Heading } from '@/components/Text';
import type { DoctorDiaries, DoctorPatient } from '@/features/diary/connected/doctor-workspace';
import {
  type BrushLine,
  ChartBrush,
  ChartDatesSheet,
} from '@/features/diary/dashboard/ChartPeriod';
import { ChartSettingsSheet } from '@/features/diary/dashboard/ChartSettingsSheet';
import { CombinedChart } from '@/features/diary/dashboard/CombinedChart';
import {
  CHART_PRESETS,
  type ChartPreset,
  type ChartSpan,
  presetSpan,
  shiftSpan,
  spanDays,
  spanLabel,
  spanName,
  spanNow,
  spanPreset,
  spanTimes,
} from '@/features/diary/dashboard/chart-period';
import { createChartSettings } from '@/features/diary/dashboard/chart-settings';
import { combinedSources, combinedView, rangeOf } from '@/features/diary/dashboard/combined-series';
import {
  chartSeries,
  DIARY_CHARTS,
  type DiaryChart,
  intakeCharts,
} from '@/features/diary/dashboard/diary-charts';
import {
  medicineAdherence,
  missReasonsText,
  type QuestionnaireSeries,
  questionnaireSeries,
} from '@/features/diary/dashboard/diary-insights';
import { medicineIntake } from '@/features/diary/dashboard/diary-intake';
import { LimitDialog, type LimitTarget } from '@/features/diary/dashboard/LimitDialog';
import { PatientDayDetails } from '@/features/diary/dashboard/PatientDayDetails';
import { AlertNotices, CorrectEntryDialog } from '@/features/diary/dashboard/PatientDialogs';
import { INTAKE_CHART_ID } from '@/features/diary/dashboard/patient-overview';
import { TrendChart, type TrendLimit } from '@/features/diary/dashboard/TrendChart';
import { dayKey, diaryStarted } from '@/features/diary/diary-care';
import type { DiaryEntry, DiaryResults } from '@/features/diary/diary-model';
import { planEditDays, planOn } from '@/features/diary/plan-history';
import { assessmentBounds, crossesLimit, MEASUREMENT_LIMIT_LABEL } from '@/state/assessment-limits';

import '@/features/diary/dashboard/chart-settings.css';
import { motionMs } from '@/state/motion';

type Dialog =
  | {
      readonly notice: {
        readonly title: string;
        readonly point: QuestionnaireSeries['points'][number];
      };
    }
  | { readonly limit: readonly LimitTarget[] }
  | { readonly day: string }
  | { readonly correct: DiaryEntry }
  | { readonly settings: true }
  | { readonly dates: true };

/** The longest history the combined chart's overview reads, in days. */
const HISTORY_DAYS = 400;

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
        : [
            {
              value: bounds.above,
              label: `${target.label}: выше ${bounds.above}`,
              kind: 'above' as const,
            },
          ]),
      ...(bounds.below === undefined
        ? []
        : [
            {
              value: bounds.below,
              label: `${target.label}: ниже ${bounds.below}`,
              kind: 'below' as const,
            },
          ]),
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
  readonly workspace: DoctorDiaries;
  readonly patient: DoctorPatient;
  readonly results: DiaryResults;
  /** Bumps when the workspace changes. */
  readonly version: number;
  /** The chart to start at (`DiaryChart.id`, `intake`, a questionnaire checkpoint id). */
  readonly focus?: string | undefined;
  readonly onBack: () => void;
  /** The patient's screen of a day, to fill it in (`…/day/<date>`). */
  readonly onFill: (day: string) => void;
}): JSX.Element {
  // The doctor's choice for this patient: what the combined chart shows and the period's length
  // (DIARY-CHARTS); the period itself starts at the last N days every visit.
  const [settings, changeSettings] = createChartSettings(
    props.workspace.doctorId,
    props.patient.summary.id,
  );
  const today = dayKey(new Date());
  const [span, setSpan] = createSignal<ChartSpan>(presetSpan(settings().preset, today));
  const [dialog, setDialog] = createSignal<Dialog>();
  const times = createMemo(() => spanTimes(span()));
  const from = (): number => times().from;
  const to = (): number => times().to;
  const first = createMemo(() => diaryStarted(props.results.invitation, props.results.entries));
  const recent = createMemo(() => {
    const { from: since, to: until } = times();
    return props.results.entries.filter((entry) => {
      const at = Date.parse(entry.at);
      return at >= since && at <= until;
    });
  });
  const medicines = createMemo(() =>
    medicineAdherence(
      props.results.invitation,
      props.results.entries.filter((entry) => Date.parse(entry.at) <= to()),
      spanDays(span()),
      spanNow(span()),
    ),
  );
  // Every day of the diary, with the prescribed dose of each day from the plan then in force: an
  // edit moves the dotted line from the day it was made (DIARY20). The period's days are a slice.
  const history = createMemo(() => {
    void props.version;
    const plans = props.patient.replica.planHistory;
    return medicineIntake(
      props.results.invitation,
      props.results.entries,
      Math.min(HISTORY_DAYS, spanDays({ from: first(), to: today })),
      new Date(),
      (day) => planOn(plans, day, props.results.invitation),
    );
  });
  const intakes = createMemo(() => {
    const { from: since, to: until } = span();
    return history().map((medicine) => ({
      ...medicine,
      days: medicine.days.filter((day) => day.day >= since && day.day <= until),
    }));
  });
  const intake = createMemo(() => intakeCharts(intakes()));
  const [quizzes] = createResource(
    () => ({ results: props.results, version: props.version }),
    ({ results }) => questionnaireSeries(results.invitation, results.entries),
  );
  /** Everything the combined chart can show, over the whole diary. */
  const sources = createMemo(() =>
    combinedSources({
      intakes: history(),
      entries: props.results.entries,
      quizzes: quizzes.latest ?? [],
      today,
    }),
  );
  /** The period with the doctor's choice applied. */
  const combined = createMemo(() =>
    combinedView({
      ...sources(),
      intakes: history(),
      hidden: settings().hidden,
      span: span(),
      alarms: settings().alarms,
    }),
  );
  /** The shown lines over the whole diary, faint in the overview strip. */
  const brushLines = createMemo((): BrushLine[] => {
    const hidden = new Set(settings().hidden);
    return sources()
      .sources.filter((source) => !hidden.has(source.key))
      .map((source) => {
        const { low, high } = source.fixed ?? rangeOf(source.points);
        return {
          color: source.color,
          points: source.points.map((point) => ({
            at: point.at,
            value: ((point.value - low) / (high - low || 1)) * 100,
          })),
        };
      });
  });
  const choices = (): number => sources().sources.length + sources().tracks.length;
  const choosePreset = (preset: ChartPreset): void => {
    setSpan(presetSpan(preset, today));
    changeSettings({ preset });
  };
  // The period in the header, so it stays in reach while the page scrolls (owner 2026-11-04:
  // «sticky, a settings button in the header with a context menu»); its name under the title.
  const headerActions = createMemo((): readonly HeaderAction[] => {
    const current = span();
    const preset = spanPreset(current, today);
    return [
      {
        id: 'period',
        label: `Период: ${spanName(current, today)}`,
        icon: 'calendar',
        priority: 1,
        testId: 'chart-period',
        menu: [
          ...CHART_PRESETS.map((one) => ({
            id: `preset-${one.value}`,
            label: one.label,
            icon: one.value === preset ? ('check' as const) : ('calendar' as const),
            onSelect: () => choosePreset(one.value),
          })),
          {
            id: 'earlier',
            label: 'Раньше',
            icon: 'caret-left',
            onSelect: () => setSpan(shiftSpan(current, -1, today)),
          },
          {
            id: 'later',
            label: 'Позже',
            icon: 'caret-right',
            disabled: current.to >= today,
            onSelect: () => setSpan(shiftSpan(current, 1, today)),
          },
          {
            id: 'dates',
            label: 'Свои даты',
            icon: 'calendar',
            onSelect: () => setDialog({ dates: true }),
          },
        ],
      },
    ];
  });
  const title = () =>
    `${props.patient.replica.profile?.emoji ?? ''} ${props.patient.replica.profile?.label ?? 'Пациент'}`.trim();
  const courseOf = (itemId: string): string | undefined => {
    const course = props.results.invitation.plan?.find((item) => item.id === itemId)?.course;
    return course?.length ? describeRanges(course) : undefined;
  };
  const openDay = (day: string): void => {
    setDialog({ day });
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
  // once more after the page has slid in, which moves the layout under a first scroll; the chart
  // pulses when it is really on screen (`revealElement`).
  onMount(() => {
    const focus = props.focus;
    if (!focus) return;
    const target = (): HTMLElement | null => document.getElementById(chartAnchor(focus));
    let cancel: (() => void) | undefined;
    let tries = 0;
    let settle: number | undefined;
    const timer = window.setInterval(() => {
      tries += 1;
      const found = target();
      if (found) found.scrollIntoView({ block: 'start' });
      if (found || tries > 20) {
        window.clearInterval(timer);
        settle = window.setTimeout(() => {
          const element = target();
          if (element) cancel = revealElement(element, { block: 'start' });
        }, motionMs(320));
      }
    }, 60);
    onCleanup(() => {
      window.clearInterval(timer);
      window.clearTimeout(settle);
      cancel?.();
    });
  });

  return (
    <div class="diary-patient diary-charts-page">
      <Page
        hero={PAGE_HEROES.patients}
        navigation={
          <NavBack class="knowledge-back-button" aria-label="К пациенту" onClick={props.onBack} />
        }
        title={
          <Heading depth={1} class="diary-charts-page__title">
            Графики
            <span class="diary-charts-page__span" data-testid="chart-period-name">
              {spanName(span(), today)}
            </span>
          </Heading>
        }
        headerActions={headerActions()}
        description={title()}
        help={
          <p>
            Сверху — все показатели на одном графике, ниже — каждый подробно. Красный пунктир —
            порог тревоги, красный фон — дни, когда значение его перешло; карандаш у графика меняет
            порог для всех пациентов на этом устройстве. Пунктир «Назначено» — доза по плану,
            действовавшему в тот день.
          </p>
        }
      />

      <Show when={choices() > 1}>
        <section
          class="diary-patient__section diary-patient__section--card diary-combined"
          aria-label="Статистика"
        >
          <div class="diary-combined__head">
            <h2 class="diary-patient__heading diary-combined__title">Статистика</h2>
            <Button
              variant="quiet"
              icon={<AppGlyph name="sliders-horizontal" />}
              onClick={() => setDialog({ settings: true })}
            >
              Настроить
            </Button>
          </div>
          <p class="diary-charts-page__hint">Нажмите на день, чтобы увидеть его значения</p>
          <Show
            when={combined().series.length || combined().tracks.length}
            fallback={
              <p class="diary-charts-page__hint">
                За {spanLabel(span(), today)} нет выбранных показателей — нажмите «Настроить»
              </p>
            }
          >
            <CombinedChart
              view={combined()}
              from={from()}
              to={to()}
              median={settings().median}
              average={settings().average}
              legend={settings().legend}
              onDay={openDay}
            />
          </Show>
          <Show when={spanDays({ from: first(), to: today }) > 7}>
            <ChartBrush
              first={first()}
              today={today}
              span={span()}
              lines={brushLines()}
              onSpan={setSpan}
            />
          </Show>
        </section>
        <h2 class="diary-charts-page__details">Подробно</h2>
      </Show>

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
                        <Show when={missReasonsText(medicine.reasons)}>
                          {(why) => <span class="diary-adherence__why">{why()}</span>}
                        </Show>
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
                  onDay={openDay}
                  title={chart.title}
                  from={from()}
                  to={to()}
                  min={0}
                  daily
                  series={chart.series}
                  marks={chart.marks}
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
                  onDay={openDay}
                  from={from()}
                  to={to()}
                  title={chart.title}
                  min={chart.min}
                  max={chart.max}
                  rightMin={chart.rightMin}
                  rightMax={chart.rightMax}
                  daily={chart.daily === true}
                  series={chartSeries(chart, recent())}
                  limits={chartLimits(chart).flatMap((target) => {
                    // A line names the one series it judges when the chart has several.
                    const judged = chart.series.filter((one) => one.field === target.id);
                    const series = judged.length === 1 ? judged[0]?.label : undefined;
                    return limitsOf([target]).map((limit) => ({
                      ...limit,
                      ...(target.axis ? { axis: target.axis } : {}),
                      ...(series ? { series } : {}),
                    }));
                  })}
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
                  onDay={openDay}
                  from={from()}
                  to={to()}
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
        <EmptyState glyph="chart-line" title={`За ${spanLabel(span(), today)} записей нет`} />
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
            subtitle={new Date(notice().point.at).toLocaleString('ru-RU', {
              day: 'numeric',
              month: 'long',
              hour: '2-digit',
              minute: '2-digit',
            })}
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
      <Show
        when={(() => {
          const current = dialog();
          return current && 'day' in current ? current.day : undefined;
        })()}
      >
        {(day) => (
          <OverlayDialog
            open
            title={new Date(`${day()}T12:00:00`).toLocaleDateString('ru-RU', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
            onClose={() => setDialog(undefined)}
          >
            <PatientDayDetails
              workspace={props.workspace}
              patient={props.patient}
              results={props.results}
              day={day()}
              edits={planEditDays(props.patient.replica.planHistory).get(day()) ?? []}
              onCorrect={(entry) => setDialog({ correct: entry })}
              onFill={() => props.onFill(day())}
            />
          </OverlayDialog>
        )}
      </Show>
      <Show
        when={(() => {
          const current = dialog();
          return current && 'settings' in current;
        })()}
      >
        <ChartSettingsSheet
          sources={sources().sources}
          tracks={sources().tracks}
          settings={settings()}
          onChange={changeSettings}
          onClose={() => setDialog(undefined)}
        />
      </Show>
      <Show when={(() => dialog() && 'dates' in (dialog() ?? {}))()}>
        <ChartDatesSheet
          span={span()}
          today={today}
          onSpan={setSpan}
          onClose={() => setDialog(undefined)}
        />
      </Show>
      <Show
        when={(() => {
          const current = dialog();
          return current && 'correct' in current ? current.correct : undefined;
        })()}
      >
        {(entry) => (
          <CorrectEntryDialog
            workspace={props.workspace}
            patient={props.patient}
            invitation={props.results.invitation}
            entry={entry()}
            onClose={() => setDialog(undefined)}
          />
        )}
      </Show>
    </div>
  );
}
