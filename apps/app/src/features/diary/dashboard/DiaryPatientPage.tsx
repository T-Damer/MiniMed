import {
  createMemo,
  createResource,
  createSignal,
  For,
  type JSX,
  Match,
  Show,
  Switch,
} from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { describeRanges } from '@/components/date-ranges';
import type { HeaderAction } from '@/components/HeaderActions';
import { NavBack } from '@/components/NavBack';
import { OverlayDialog } from '@/components/OverlayDialog';
import { Page } from '@/components/Page';
import { SegmentedControl } from '@/components/SegmentedControl';
import { StatCard, StatGrid } from '@/components/StatCard';
import { Heading } from '@/components/Text';
import { DiaryHeatmap, heatmapRange } from '@/diary/DiaryHeatmap';
import { pluralize } from '@/diary/diary-format';
import '@/diary/diary-care.css';
import type { DiaryAlert } from '@localmed/contracts';
import { replicaResults } from '@/features/diary/connected/diary-replica';
import type { DoctorDiaries, DoctorPatient } from '@/features/diary/connected/doctor-workspace';
import {
  type AlertCause,
  adherence,
  exportCsv,
  exportRows,
  exportXlsx,
  fieldSeries,
  medicineAdherence,
  questionnaireSeries,
} from '@/features/diary/dashboard/diary-insights';
import { PairingView } from '@/features/diary/dashboard/PairingView';
import {
  AlertDialog,
  AlertNotices,
  CorrectEntryDialog,
  CuratorsDialog,
  TipsDialog,
} from '@/features/diary/dashboard/PatientDialogs';
import { telHref } from '@/features/diary/dashboard/patient-contact';
import { TrendChart, type TrendLimit } from '@/features/diary/dashboard/TrendChart';
import {
  dayKey,
  diaryStarted,
  entriesOfDay,
  type HeatPart,
  heatmapDays,
  heatParts,
} from '@/features/diary/diary-care';
import { type DiaryEntry, describeDiaryEntry } from '@/features/diary/diary-model';
import { ASSESSMENT_LIMIT_LABEL, assessmentLimit, crossesLimit } from '@/state/assessment-limits';

type Dialog =
  | 'pair'
  | 'curators'
  | 'tips'
  | 'export'
  | { readonly correct: DiaryEntry }
  | { readonly alert: DiaryAlert }
  | { readonly notice: AlertCause };
type Period = '14' | '30' | '90';

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function within(entries: readonly DiaryEntry[], days: number): DiaryEntry[] {
  const since = Date.now() - days * 86_400_000;
  return entries.filter((entry) => Date.parse(entry.at) >= since);
}

/**
 * One connected patient for the doctor: the month calendar, adherence, charts of wellbeing, pressure,
 * pulse and saturation, questionnaire totals with their bands, and the day's entries to correct.
 */
export function DiaryPatientPage(props: {
  readonly workspace: DoctorDiaries;
  readonly patient: DoctorPatient;
  /** Bumps when the workspace changes, so derived views recompute. */
  readonly version: number;
  readonly onBack: () => void;
  /** Opens the patient view to edit, or one day as the patient saw it. */
  readonly onOpen: (sub: 'screen' | `day/${string}`) => void;
  /** The day to show first (an alert opened from the list). */
  readonly initialDay?: string | undefined;
}): JSX.Element {
  const [dialog, setDialog] = createSignal<Dialog>();
  const [day, setDay] = createSignal(props.initialDay ?? dayKey(new Date()));
  let dayHeading: HTMLHeadingElement | undefined;
  const openDay = (next: string): void => {
    setDialog(undefined);
    setDay(next);
    requestAnimationFrame(() => dayHeading?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };
  const [period, setPeriod] = createSignal<Period>('30');
  const results = createMemo(() => {
    void props.version;
    return replicaResults(props.patient.replica);
  });
  const canEdit = () => props.patient.summary.role !== 'reader';
  const title = () =>
    `${props.patient.replica.profile?.emoji ?? ''} ${props.patient.replica.profile?.label ?? 'Пациент'}`.trim();

  const [include, setInclude] = createSignal<ReadonlySet<HeatPart>>(new Set());
  const heat = createMemo(() => {
    const current = results();
    if (!current) return [];
    const range = heatmapRange(
      diaryStarted(current.invitation, current.entries),
      dayKey(new Date()),
    );
    return heatmapDays(
      current.invitation,
      current.entries,
      range.from,
      range.to,
      new Date(),
      include(),
    );
  });
  const recent = createMemo(() => within(results()?.entries ?? [], Number(period())));
  const week = createMemo(() => {
    const current = results();
    return current ? adherence(current.invitation, current.entries, 7) : undefined;
  });
  const medicines = createMemo(() => {
    const current = results();
    return current ? medicineAdherence(current.invitation, current.entries, Number(period())) : [];
  });
  const [quizzes] = createResource(
    () => {
      const current = results();
      return current ? { current, version: props.version } : undefined;
    },
    ({ current }) => questionnaireSeries(current.invitation, current.entries),
  );
  /** Questionnaire days over the doctor's red line (worse with the schema's own alerts). */
  const symptomDays = createMemo(() => {
    const days = new Map<string, 0 | 1 | 2 | 3 | 4>();
    if (include().size && !include().has('questionnaires')) return days;
    for (const series of quizzes() ?? []) {
      const slug = series.checkpointId.replace(/^q-/u, '');
      for (const point of series.points) {
        const level = point.alerts.length ? 4 : crossesLimit(slug, point.total) ? 3 : 0;
        const day = dayKey(point.at);
        if (level > (days.get(day) ?? 0)) days.set(day, level);
      }
    }
    return days;
  });
  const dayEntries = createMemo(() => entriesOfDay(results()?.entries ?? [], day()).toReversed());
  const urgent = createMemo(() => {
    void props.version;
    return props.workspace.alerts().filter((alert) => alert.patientId === props.patient.summary.id);
  });

  const phone = (): string | undefined => props.patient.replica.profile?.phone;
  const actions = createMemo((): readonly HeaderAction[] => {
    const edit = canEdit();
    const ready = Boolean(results());
    return [
      ...(phone()
        ? [
            {
              id: 'call',
              label: 'Позвонить пациенту',
              icon: 'phone' as const,
              priority: 1 as const,
              onSelect: () => window.location.assign(telHref(phone() ?? '')),
            },
          ]
        : []),
      ...(edit
        ? [
            {
              id: 'screen',
              label: 'Экран пациента',
              icon: 'browsers' as const,
              priority: 2 as const,
              disabled: !ready,
              onSelect: () => props.onOpen('screen'),
            },
            {
              id: 'pair',
              label: 'Подключить телефон пациента',
              icon: 'share' as const,
              priority: 2 as const,
              onSelect: () => setDialog('pair'),
            },
          ]
        : []),
      {
        id: 'export',
        label: 'Выгрузить в таблицу',
        icon: 'file-xls',
        priority: 2,
        disabled: !results()?.entries.length,
        onSelect: () => setDialog('export'),
      },
      ...(edit
        ? [
            {
              id: 'tips',
              label: 'Подсказки пациенту',
              icon: 'lightbulb' as const,
              priority: 3 as const,
              disabled: !ready,
              onSelect: () => setDialog('tips'),
            },
          ]
        : []),
      {
        id: 'curators',
        label: 'Кураторы',
        icon: 'users',
        priority: 3,
        onSelect: () => setDialog('curators'),
      },
    ];
  });

  /** Course dates of a medicine: «20 окт. – 2 нояб. · 14 дней». */
  const courseOf = (itemId: string): string | undefined => {
    const course = results()?.invitation.plan?.find((item) => item.id === itemId)?.course;
    return course?.length ? describeRanges(course) : undefined;
  };

  /** The doctor's red lines for these measurements or questionnaires. */
  const limitsOf = (ids: readonly string[]): TrendLimit[] =>
    ids.flatMap((id) => {
      const limit = assessmentLimit(id);
      return limit
        ? [{ value: limit.value, label: `${ASSESSMENT_LIMIT_LABEL[id] ?? id}: порог` }]
        : [];
    });

  const exportAs = async (kind: 'csv' | 'xlsx'): Promise<void> => {
    const current = results();
    if (!current) return;
    const rows = exportRows(current.invitation, current.entries);
    const name = `дневник-${props.patient.replica.profile?.label ?? props.patient.summary.id}`;
    if (kind === 'csv') {
      download(new Blob([exportCsv(rows)], { type: 'text/csv;charset=utf-8' }), `${name}.csv`);
    } else {
      download(await exportXlsx(rows, name), `${name}.xlsx`);
    }
    setDialog(undefined);
  };

  return (
    <div class="diary-patient">
      <Page
        navigation={
          <NavBack class="knowledge-back-button" aria-label="К списку" onClick={props.onBack} />
        }
        title={<Heading depth={1}>{title()}</Heading>}
        headerActions={actions()}
        help={
          <>
            <p>
              Записи пациента приходят сюда вживую. Календарь показывает выполнение плана по дням,
              ниже — приём лекарств, графики и опросники за выбранный период.
            </p>
            <p>
              «Экран пациента» — то, что он видит у себя: правьте разделы прямо там, изменения
              придут на его телефон сами. Ошибочную запись можно исправить, пациент увидит отметку.
            </p>
          </>
        }
      />

      <Switch>
        <Match when={props.patient.summary.status === 'withdrawn'}>
          <p class="diary-dash__notice">Пациент отозвал согласие: записи удалены с сервера.</p>
        </Match>
        <Match when={!results()}>
          <p class="diary-dash__quiet">План ещё не создан или не расшифрован на этом устройстве.</p>
        </Match>
      </Switch>

      <Show when={urgent().length}>
        <ul class="diary-dash-alerts" aria-label="Срочные отметки пациента">
          <For each={urgent()}>
            {(alert) => (
              <li class="diary-dash-alert">
                <button
                  type="button"
                  class="diary-dash-alert__open"
                  onClick={() => setDialog({ alert })}
                >
                  <span class="diary-dash-alert__mark" aria-hidden="true">
                    !
                  </span>
                  <span class="diary-dash-alert__text">
                    {alert.kind === 'withdrawn' ? 'Согласие отозвано' : 'Срочная отметка'}
                    <span class="diary-dash-alert__when">
                      {new Date(alert.at).toLocaleString('ru-RU')} · подробнее
                    </span>
                  </span>
                </button>
                <Button
                  variant="icon"
                  aria-label="Отметить как просмотренное"
                  icon={<AppGlyph name="check" class="diary-dash__glyph" />}
                  onClick={() => void props.workspace.ackAlert(alert.id)}
                />
              </li>
            )}
          </For>
        </ul>
      </Show>

      <Show when={results()}>
        {(current) => (
          <>
            <StatGrid columns={3}>
              <StatCard
                value={
                  week()?.share === undefined ? '—' : `${Math.round((week()?.share ?? 0) * 100)} %`
                }
                label="плана за 7 дней"
                icon="check"
                tone={
                  week()?.share === undefined
                    ? 'default'
                    : (week()?.share ?? 0) >= 0.8
                      ? 'good'
                      : (week()?.share ?? 0) >= 0.5
                        ? 'warn'
                        : 'danger'
                }
              />
              <StatCard
                value={current().entries.length}
                label={pluralize(current().entries.length, 'запись', 'записи', 'записей')}
                icon="notes"
              />
              <Show
                when={props.patient.summary.devices > 0}
                fallback={
                  <StatCard
                    value="—"
                    label="Подключить телефон"
                    icon="share"
                    tone="warn"
                    disabled={!canEdit()}
                    onClick={() => setDialog('pair')}
                  />
                }
              >
                <StatCard
                  value={props.patient.summary.devices}
                  label={pluralize(
                    props.patient.summary.devices,
                    'телефон подключён',
                    'телефона подключено',
                    'телефонов подключено',
                  )}
                  icon="phone"
                  tone="accent"
                />
              </Show>
            </StatGrid>

            <DiaryHeatmap
              days={heat()}
              selected={day()}
              today={dayKey(new Date())}
              onSelect={(next) => {
                setDay(next);
                props.onOpen(`day/${next}`);
              }}
              parts={heatParts(current().invitation)}
              include={include()}
              onInclude={setInclude}
              symptomDays={symptomDays()}
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
              <section class="diary-patient__section" aria-label="Приём лекарств">
                <h2 class="diary-patient__heading">Приём лекарств</h2>
                <ul class="diary-adherence">
                  <For each={medicines()}>
                    {(medicine) => {
                      const share = () =>
                        medicine.planned ? medicine.taken / medicine.planned : 0;
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
                            {medicine.taken} из {medicine.planned}
                            {medicine.skipped ? `, пропущено ${medicine.skipped}` : ''}
                          </span>
                        </li>
                      );
                    }}
                  </For>
                </ul>
              </section>
            </Show>

            <div class="diary-patient__charts">
              <Show when={fieldSeries(recent(), 'wellbeing').length}>
                <TrendChart
                  from={Date.now() - Number(period()) * 86_400_000}
                  to={Date.now()}
                  title="Самочувствие (0–10)"
                  limits={limitsOf(['wellbeing'])}
                  min={0}
                  max={10}
                  series={[
                    {
                      label: 'Утром',
                      points: fieldSeries(recent(), 'wellbeing', 'am'),
                      color: '--theme-accent',
                    },
                    {
                      label: 'Вечером',
                      points: fieldSeries(recent(), 'wellbeing', 'pm'),
                      color: '--theme-warning',
                    },
                  ]}
                />
              </Show>
              <Show when={fieldSeries(recent(), 'mood').length}>
                <TrendChart
                  from={Date.now() - Number(period()) * 86_400_000}
                  to={Date.now()}
                  title="Настроение (0–10)"
                  min={0}
                  max={10}
                  series={[
                    {
                      label: 'Настроение',
                      points: fieldSeries(recent(), 'mood'),
                      color: '--theme-info',
                    },
                  ]}
                  limits={limitsOf(['mood'])}
                />
              </Show>
              <Show when={fieldSeries(recent(), 'weight').length}>
                <TrendChart
                  from={Date.now() - Number(period()) * 86_400_000}
                  to={Date.now()}
                  title="Вес, кг"
                  series={[
                    {
                      label: 'Вес',
                      points: fieldSeries(recent(), 'weight'),
                      color: '--theme-accent',
                    },
                  ]}
                />
              </Show>
              <Show when={fieldSeries(recent(), 'systolic').length}>
                <TrendChart
                  from={Date.now() - Number(period()) * 86_400_000}
                  to={Date.now()}
                  title="Давление, мм рт. ст."
                  series={[
                    {
                      label: 'Верхнее',
                      points: fieldSeries(recent(), 'systolic'),
                      color: '--theme-danger',
                    },
                    {
                      label: 'Нижнее',
                      points: fieldSeries(recent(), 'diastolic'),
                      color: '--theme-warning',
                    },
                  ]}
                  limits={limitsOf(['systolic', 'diastolic'])}
                />
              </Show>
              <Show
                when={fieldSeries(recent(), 'pulse').length || fieldSeries(recent(), 'spo2').length}
              >
                <TrendChart
                  from={Date.now() - Number(period()) * 86_400_000}
                  to={Date.now()}
                  title="Пульс и сатурация"
                  series={[
                    {
                      label: 'Пульс, уд/мин',
                      points: fieldSeries(recent(), 'pulse'),
                      color: '--theme-accent',
                    },
                    {
                      label: 'SpO₂, %',
                      points: fieldSeries(recent(), 'spo2'),
                      color: '--theme-info',
                      axis: 'right',
                    },
                  ]}
                  rightMin={85}
                  rightMax={100}
                  limits={[
                    ...limitsOf(['pulse']),
                    ...limitsOf(['spo2']).map((limit) => ({ ...limit, axis: 'right' as const })),
                  ]}
                />
              </Show>
              <For each={quizzes() ?? []}>
                {(series) => (
                  <section class="diary-patient__quiz">
                    <TrendChart
                      from={Date.now() - Number(period()) * 86_400_000}
                      to={Date.now()}
                      title={`${series.title}, сумма баллов`}
                      limits={limitsOf([series.checkpointId.replace(/^q-/u, '')])}
                      min={0}
                      max={series.points[0]?.max}
                      series={[
                        {
                          label: series.title,
                          points: series.points.map((point) => ({
                            at: point.at,
                            value: point.total,
                          })),
                          color: '--theme-accent',
                        },
                      ]}
                    />
                    <Show when={series.points.at(-1)}>
                      {(last) => (
                        <p class="diary-patient__quiz-last">
                          <span class="diary-patient__quiz-text">
                            Последний: {last().total} из {last().max} — {last().headline}
                          </span>
                          <Show when={last().alertDetails.length}>
                            <button
                              type="button"
                              class="diary-patient__quiz-alert"
                              aria-label={`Важно: ${last().alerts.join('; ')}`}
                              onClick={() =>
                                setDialog({
                                  notice: { title: series.title, point: last() },
                                })
                              }
                            >
                              !
                            </button>
                          </Show>
                        </p>
                      )}
                    </Show>
                  </section>
                )}
              </For>
            </div>

            <section class="diary-patient__section" aria-label="Записи дня">
              <h2 class="diary-patient__heading" ref={dayHeading}>
                {new Date(`${day()}T12:00:00`).toLocaleDateString('ru-RU', {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                })}
              </h2>
              <Show
                when={dayEntries().length}
                fallback={<p class="diary-dash__quiet">В этот день записей нет.</p>}
              >
                <ul class="diary-timeline">
                  <For each={dayEntries()}>
                    {(entry) => (
                      <li class="diary-timeline__item">
                        <span class="diary-timeline__time">
                          {new Date(entry.at).toLocaleTimeString('ru-RU', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                        <span class="diary-timeline__text">
                          <span class="diary-timeline__line">
                            {describeDiaryEntry(current().invitation, entry)}
                          </span>
                          <Show when={entry.note}>
                            <span class="diary-timeline__note">{entry.note}</span>
                          </Show>
                          <Show when={entry.corrected}>
                            <span class="diary-timeline__badge">исправлено врачом</span>
                          </Show>
                        </span>
                        <Show when={canEdit()}>
                          <Button
                            variant="icon"
                            aria-label="Исправить запись"
                            icon={<AppGlyph name="edit" class="diary-dash__glyph" />}
                            onClick={() => setDialog({ correct: entry })}
                          />
                        </Show>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </section>
          </>
        )}
      </Show>

      <Switch>
        <Match when={dialog() === 'pair'}>
          <OverlayDialog
            open
            title="Подключить телефон пациента"
            onClose={() => setDialog(undefined)}
          >
            <PairingView
              workspace={props.workspace}
              patientId={props.patient.summary.id}
              onDone={() => setDialog(undefined)}
            />
          </OverlayDialog>
        </Match>
        <Match when={dialog() === 'curators'}>
          <CuratorsDialog
            workspace={props.workspace}
            patient={props.patient}
            onClose={() => setDialog(undefined)}
          />
        </Match>
        <Match when={dialog() === 'tips' && results()}>
          {(current) => (
            <TipsDialog
              workspace={props.workspace}
              patient={props.patient}
              invitation={current().invitation}
              onClose={() => setDialog(undefined)}
            />
          )}
        </Match>
        <Match when={dialog() === 'export'}>
          <OverlayDialog
            open
            title="Выгрузить записи"
            subtitle="Расшифрованная копия на этом устройстве"
            onClose={() => setDialog(undefined)}
          >
            <div class="diary-dash-form__actions">
              <Button onClick={() => void exportAs('csv')}>CSV</Button>
              <Button variant="primary" onClick={() => void exportAs('xlsx')}>
                Excel (XLSX)
              </Button>
            </div>
          </OverlayDialog>
        </Match>
        <Match
          when={(() => {
            const current = dialog();
            const ready = results();
            return typeof current === 'object' && 'correct' in current && ready
              ? { entry: current.correct, invitation: ready.invitation }
              : undefined;
          })()}
        >
          {(target) => (
            <CorrectEntryDialog
              workspace={props.workspace}
              patient={props.patient}
              invitation={target().invitation}
              entry={target().entry}
              onClose={() => setDialog(undefined)}
            />
          )}
        </Match>
        <Match
          when={(() => {
            const current = dialog();
            return typeof current === 'object' && 'notice' in current ? current.notice : undefined;
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
        </Match>
        <Match
          when={(() => {
            const current = dialog();
            return typeof current === 'object' && 'alert' in current ? current.alert : undefined;
          })()}
        >
          {(alert) => (
            <AlertDialog
              workspace={props.workspace}
              alert={alert()}
              onOpenDay={openDay}
              onClose={() => setDialog(undefined)}
            />
          )}
        </Match>
      </Switch>
    </div>
  );
}
