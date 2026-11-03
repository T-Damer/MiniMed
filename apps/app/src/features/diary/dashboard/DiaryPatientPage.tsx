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
import { PAGE_HEROES } from '@/app/page-heroes';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import type { HeaderAction } from '@/components/HeaderActions';
import { NavBack } from '@/components/NavBack';
import { OverlayDialog } from '@/components/OverlayDialog';
import { Page } from '@/components/Page';
import { Heading } from '@/components/Text';
import { DiaryHeatmap, heatmapRange } from '@/diary/DiaryHeatmap';
import {
  createHeatFilter,
  DOCTOR_HEAT_FILTER_KEY,
  effectiveHeatParts,
} from '@/diary/heatmap-filter';
import '@/diary/diary-care.css';
import type { DiaryAlert } from '@localmed/contracts';
import { patientRowSummary } from '@/components/patient-picker-summary';
import { replicaResults } from '@/features/diary/connected/diary-replica';
import type { DoctorDiaries, DoctorPatient } from '@/features/diary/connected/doctor-workspace';
import {
  exportCsv,
  exportRows,
  exportXlsx,
  questionnaireSeries,
} from '@/features/diary/dashboard/diary-insights';
import { PairingView } from '@/features/diary/dashboard/PairingView';
import {
  AlertDialog,
  CorrectEntryDialog,
  CuratorsDialog,
  TipsDialog,
} from '@/features/diary/dashboard/PatientDialogs';
import { PatientOverview } from '@/features/diary/dashboard/PatientOverview';
import { telHref } from '@/features/diary/dashboard/patient-contact';
import { overviewSignals } from '@/features/diary/dashboard/patient-overview';
import { isOnline, presenceLabel } from '@/features/diary/dashboard/presence';
import {
  dayKey,
  diaryStarted,
  entriesOfDay,
  type HeatPart,
  heatmapDays,
  heatParts,
} from '@/features/diary/diary-care';
import { diaryToFhirBundle } from '@/features/diary/diary-fhir';
import {
  type DiaryEntry,
  type DiaryInvitation,
  describeDiaryEntry,
} from '@/features/diary/diary-model';
import type { DiarySub } from '@/features/notes/notes-routing';
import { crossesLimit } from '@/state/assessment-limits';

type Dialog =
  | 'day'
  | 'pair'
  | 'curators'
  | 'tips'
  | 'export'
  | { readonly correct: DiaryEntry }
  | { readonly alert: DiaryAlert };

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

const MEASURED_VITALS = ['systolic', 'diastolic', 'pulse', 'spo2', 'weight'] as const;
const MEASURED_SCORES = ['wellbeing', 'mood', 'craving'] as const;

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
  readonly onOpen: (sub: DiarySub) => void;
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
  const results = createMemo(() => {
    void props.version;
    return replicaResults(props.patient.replica);
  });
  const canEdit = () => props.patient.summary.role !== 'reader';
  const title = () =>
    `${props.patient.replica.profile?.emoji ?? ''} ${props.patient.replica.profile?.label ?? 'Пациент'}`.trim();

  const [savedParts, setInclude] = createHeatFilter(DOCTOR_HEAT_FILTER_KEY);
  const include = createMemo(() => {
    const current = results();
    return current ? effectiveHeatParts(heatParts(current.invitation), savedParts()) : savedParts();
  });
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
  const [quizzes] = createResource(
    () => {
      const current = results();
      return current ? { current, version: props.version } : undefined;
    },
    ({ current }) => questionnaireSeries(current.invitation, current.entries),
  );
  /**
   * Days over the doctor's red lines: questionnaire totals (worse with the schema's own alerts),
   * measurements and self-ratings; only the parts the calendar counts.
   */
  const symptomDays = createMemo(() => {
    const days = new Map<string, 0 | 1 | 2 | 3 | 4>();
    const counts = (part: HeatPart): boolean => !include().size || include().has(part);
    const raise = (at: string, level: 0 | 1 | 2 | 3 | 4): void => {
      const day = dayKey(at);
      if (level > (days.get(day) ?? 0)) days.set(day, level);
    };
    if (counts('questionnaires')) {
      for (const series of quizzes.latest ?? []) {
        for (const point of series.points) {
          const over = crossesLimit(series.limitId, point.total, series.preset);
          raise(point.at, point.alerts.length ? 4 : over ? 3 : 0);
        }
      }
    }
    const measured = [
      ...(counts('vitals') ? MEASURED_VITALS : []),
      ...(counts('scores') ? MEASURED_SCORES : []),
    ];
    for (const entry of results()?.entries ?? []) {
      for (const id of measured) {
        const value = entry.values[id];
        if (typeof value === 'number' && crossesLimit(id, value)) raise(entry.at, 2);
      }
    }
    return days;
  });
  /** What changed this week; undefined until the questionnaires are scored (one loading state). */
  const signals = createMemo(() => {
    const current = results();
    const scored = quizzes.latest;
    if (!current || !scored) return undefined;
    return overviewSignals({
      invitation: current.invitation,
      entries: current.entries,
      questionnaires: scored,
      devices: props.patient.summary.devices,
    });
  });
  const dayEntries = createMemo(() => entriesOfDay(results()?.entries ?? [], day()).toReversed());
  /** The chosen day's records (or its empty state): on the page and in the day sheet. */
  const dayRecords = (invitation: DiaryInvitation): JSX.Element => (
    <Show
      when={dayEntries().length}
      fallback={
        <div class="diary-patient__day-empty">
          <p class="diary-dash__quiet">В этот день записей нет.</p>
          <Button
            variant="secondary"
            icon={<AppGlyph name="browsers" class="diary-dash__glyph" />}
            onClick={() => props.onOpen(`day/${day()}`)}
          >
            {canEdit() ? 'Открыть день и отметить' : 'Открыть день пациента'}
          </Button>
        </div>
      }
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
                <span class="diary-timeline__line">{describeDiaryEntry(invitation, entry)}</span>
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
  );
  /** Before the diary began (a backfilled record moves the start back). */
  const beforeStart = (): boolean => {
    const current = results();
    return Boolean(current && day() < diaryStarted(current.invitation, current.entries));
  };
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
              // Again whenever needed: a lost page, another device (owner 2026-10-30).
              label: 'QR-код и ссылка для пациента',
              icon: 'qr-code' as const,
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

  const exportAs = async (kind: 'csv' | 'xlsx' | 'fhir'): Promise<void> => {
    const current = results();
    if (!current) return;
    const rows = exportRows(current.invitation, current.entries);
    const name = `дневник-${props.patient.replica.profile?.label ?? props.patient.summary.id}`;
    if (kind === 'fhir') {
      // HL7 FHIR R4, the same bundle the patient's own export makes (no name in it).
      const bundle = JSON.stringify(diaryToFhirBundle(current), null, 2);
      download(new Blob([bundle], { type: 'application/fhir+json' }), `${name}.fhir.json`);
    } else if (kind === 'csv') {
      download(new Blob([exportCsv(rows)], { type: 'text/csv;charset=utf-8' }), `${name}.csv`);
    } else {
      download(await exportXlsx(rows, name), `${name}.xlsx`);
    }
    setDialog(undefined);
  };

  return (
    <div class="diary-patient">
      <Page
        hero={PAGE_HEROES.patients}
        navigation={
          <NavBack class="knowledge-back-button" aria-label="К списку" onClick={props.onBack} />
        }
        title={<Heading depth={1}>{title()}</Heading>}
        description={(() => {
          void props.version;
          const label = presenceLabel(props.patient.summary);
          const birth = props.patient.replica.profile?.birthDate;
          const born = birth ? patientRowSummary(birth, dayKey(new Date())) : undefined;
          if (!label && !born) return undefined;
          return (
            <span class="diary-patient__line">
              <Show when={born}>{(text) => <span class="diary-patient__born">{text()}</span>}</Show>
              <Show when={label}>
                <span class="diary-presence">
                  <span
                    class="diary-presence__dot"
                    classList={{ 'diary-presence__dot--online': isOnline(props.patient.summary) }}
                    aria-hidden="true"
                  />
                  {label}
                </span>
              </Show>
            </span>
          );
        })()}
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
            <PatientOverview
              signals={signals()}
              onOpen={(target) =>
                'pair' in target ? setDialog('pair') : props.onOpen(`charts/${target.chart}`)
              }
              onAll={() => props.onOpen('charts')}
            />

            <DiaryHeatmap
              days={heat()}
              selected={day()}
              today={dayKey(new Date())}
              onSelect={(next) => {
                // A day opens as a sheet over the page; the full day screen is one tap further.
                setDay(next);
                setDialog('day');
              }}
              since={diaryStarted(current().invitation, current().entries)}
              parts={heatParts(current().invitation)}
              include={include()}
              onInclude={setInclude}
              symptomDays={symptomDays()}
            />

            <section class="diary-patient__section" aria-label="Записи дня">
              <div class="diary-patient__day-head">
                <h2 class="diary-patient__heading" ref={dayHeading}>
                  {new Date(`${day()}T12:00:00`).toLocaleDateString('ru-RU', {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                  })}
                </h2>
                <Show when={dayEntries().length}>
                  <Button
                    variant="icon"
                    aria-label="Экран пациента в этот день"
                    icon={<AppGlyph name="browsers" class="diary-dash__glyph" />}
                    onClick={() => props.onOpen(`day/${day()}`)}
                  />
                </Show>
              </div>
              {dayRecords(current().invitation)}
            </section>
          </>
        )}
      </Show>

      <Switch>
        <Match when={dialog() === 'day' && results()}>
          {(current) => (
            <OverlayDialog
              open
              title={new Date(`${day()}T12:00:00`).toLocaleDateString('ru-RU', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
              })}
              {...(beforeStart() ? { subtitle: 'До начала дневника' } : {})}
              headerEnd={
                <Show when={dayEntries().length}>
                  <Button
                    variant="icon"
                    aria-label="Экран пациента в этот день"
                    icon={<AppGlyph name="browsers" class="diary-dash__glyph" />}
                    onClick={() => props.onOpen(`day/${day()}`)}
                  />
                </Show>
              }
              onClose={() => setDialog(undefined)}
            >
              {dayRecords(current().invitation)}
            </OverlayDialog>
          )}
        </Match>
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
              <Button onClick={() => void exportAs('fhir')}>FHIR (JSON)</Button>
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
