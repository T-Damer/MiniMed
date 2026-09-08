import { isHttpUrl } from '@localmed/contracts';
import Chart from 'chart.js/auto';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { toast } from 'solid-sonner';

import {
  AppContextMenu,
  type AppContextMenuAction,
  requestContextMenu,
} from '@/components/AppContextMenu';
import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { NavBack } from '@/components/NavBack';
import { Page } from '@/components/Page';
import { SearchField } from '@/components/SearchField';
import { useStickySurface } from '@/components/sticky-surface';
import { Heading } from '@/components/Text';
import type { NotesRoute } from '@/features/notes/notes-routing';
import { notesPath, notesPatientsPath } from '@/features/notes/notes-routing';
import { openDocumentOverlay } from '@/state/document-navigation';
import {
  appendEpisode,
  appendEvent,
  buildDynamics,
  buildDynamicsGroups,
  type ClinicalEpisode,
  type CreatePatientProfileInput,
  closeClinicalEpisode,
  createClinicalEpisode,
  createLaboratoryEvent,
  createManualMeasurementEvent,
  createMedicationEvent,
  createPatientProfile,
  type DynamicsChartGroup,
  emptyPatientVaultSnapshot,
  latestObservation,
  type MedicationEventKind,
  PATIENT_METRIC_REGISTRY,
  type PatientEvent,
  type PatientObservation,
  type PatientProfile,
  type PatientVaultSnapshot,
  reviseManualObservation,
} from '@/state/patient-domain';
import {
  acknowledgePatientVaultUiCleared,
  createPatientVault,
  deletePatientFromVault,
  deletePatientVault,
  exportPatientVaultBackup,
  importPatientVaultBackup,
  isPatientVaultUnlocked,
  lockPatientVault,
  PATIENT_VAULT_EVENT,
  PATIENT_VAULT_LOCK_EVENT,
  patientVaultStorageMode,
  readPatientVault,
  unlockPatientVault,
  updatePatientVault,
} from '@/state/patient-vault';
import { isPatientVaultNativePlatform } from '@/state/patient-vault-native';
import '@/styles/patient-workspace.css';

export type PatientRoute = Extract<
  NotesRoute,
  { kind: 'patients' | 'new-patient' | 'patient' | 'patient-dynamics' }
>;

export interface PatientWorkspaceProps {
  readonly route: PatientRoute;
  readonly onNavigate: (path: string) => void;
  readonly backLabel?: string;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium' }).format(date);
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

function observationSourceLabel(source: PatientObservation['source']): string {
  if (source.kind === 'tool-result') return `${source.toolId} · версия ${source.toolVersion}`;
  if (source.kind === 'manual') return `Ручной показатель · ${source.label}`;
  return `Лаборатория · ${source.label}`;
}

function observationToolVersion(observation: PatientObservation): string | undefined {
  return observation.source.kind === 'tool-result' ? observation.source.toolVersion : undefined;
}

function dateInputValue(value: string): string {
  return value.slice(0, 10);
}

function asIsoDate(value: string): string {
  return value ? new Date(`${value}T12:00:00.000Z`).toISOString() : new Date().toISOString();
}

function parseReportRange(text: string): {
  readonly text: string;
  readonly lower?: number;
  readonly upper?: number;
} {
  const normalized = text.trim();
  const numbers =
    normalized
      .replaceAll(',', '.')
      .match(/-?\d+(?:\.\d+)?/gu)
      ?.map(Number) ?? [];
  return {
    text: normalized,
    ...(numbers[0] === undefined ? {} : { lower: numbers[0] }),
    ...(numbers[1] === undefined ? {} : { upper: numbers[1] }),
  };
}

function eventDescription(event: PatientEvent): string {
  if (event.kind === 'medication') {
    return event.medicationKind === 'start'
      ? 'Начало лечения'
      : event.medicationKind === 'stop'
        ? 'Отмена'
        : event.medicationKind === 'dose-change'
          ? 'Изменение дозы'
          : 'Приём';
  }
  if (event.kind === 'tool-result') return event.provenance?.toolId ?? 'Результат инструмента';
  return event.title;
}

interface MedicationTimeline {
  readonly title: string;
  readonly startedAt: string | undefined;
  readonly stoppedAt: string | undefined;
  readonly events: readonly PatientEvent[];
}

function buildMedicationTimeline(
  snapshot: PatientVaultSnapshot,
  patientId: string,
): readonly MedicationTimeline[] {
  const groups = new Map<string, PatientEvent[]>();
  for (const event of snapshot.events) {
    if (event.patientId !== patientId || event.kind !== 'medication') continue;
    const key = event.title.trim().toLocaleLowerCase('ru-RU');
    const events = groups.get(key) ?? [];
    events.push(event);
    groups.set(key, events);
  }
  return [...groups.values()]
    .map((events) => {
      const ordered = events.toSorted((left, right) =>
        left.occurredAt.localeCompare(right.occurredAt),
      );
      const startedAt = ordered.find((event) => event.medicationKind === 'start')?.occurredAt;
      const stoppedAt = ordered.find((event) => event.medicationKind === 'stop')?.occurredAt;
      return {
        title: ordered[0]?.title ?? 'Препарат',
        startedAt,
        stoppedAt,
        events: ordered,
      };
    })
    .toSorted((left, right) => left.title.localeCompare(right.title));
}

function DynamicsChart(props: {
  readonly group: DynamicsChartGroup;
  readonly hidden: ReadonlySet<string>;
}): JSX.Element {
  let canvas: HTMLCanvasElement | undefined;
  let chart: Chart<'line'> | undefined;
  const draw = (): void => {
    if (!canvas) return;
    chart?.destroy();
    const visibleSeries = props.group.series.filter((series) => !props.hidden.has(series.key));
    const observations = visibleSeries.flatMap((series) => series.observations);
    const times = observations.map((observation) => Date.parse(observation.observedAt));
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    const colors = ['#146c94', '#b25b24', '#5d7f3b', '#7a4b91'];
    const datasets = visibleSeries.flatMap((series, index) => {
      const color = colors[index % colors.length] ?? '#146c94';
      const points = series.observations.map((observation) => ({
        x: Date.parse(observation.observedAt),
        y: observation.value,
      }));
      const zones = new Map<
        string,
        { readonly lower?: number; readonly upper?: number; readonly title: string }
      >();
      for (const observation of series.observations) {
        const verdict = observation.evaluation?.verdict;
        if (!verdict || (verdict.lowerBound === undefined && verdict.upperBound === undefined))
          continue;
        zones.set(`${verdict.title}|${verdict.lowerBound}|${verdict.upperBound}`, {
          title: verdict.title,
          ...(verdict.lowerBound === undefined ? {} : { lower: verdict.lowerBound }),
          ...(verdict.upperBound === undefined ? {} : { upper: verdict.upperBound }),
        });
      }
      return [
        {
          label: `${series.metricId} · ${series.unit}`,
          data: points,
          borderColor: color,
          backgroundColor: `${color}1f`,
          pointRadius: 3,
          tension: 0.2,
          spanGaps: true,
        },
        ...[...zones.values()].flatMap((zone) => [
          ...(zone.lower === undefined || !Number.isFinite(minTime) || !Number.isFinite(maxTime)
            ? []
            : [
                {
                  label: `${zone.title} — нижняя граница`,
                  data: [
                    { x: minTime, y: zone.lower },
                    { x: maxTime, y: zone.lower },
                  ],
                  borderColor: color,
                  borderDash: [5, 4],
                  pointRadius: 0,
                  tension: 0,
                },
              ]),
          ...(zone.upper === undefined || !Number.isFinite(minTime) || !Number.isFinite(maxTime)
            ? []
            : [
                {
                  label: `${zone.title} — верхняя граница`,
                  data: [
                    { x: minTime, y: zone.upper },
                    { x: maxTime, y: zone.upper },
                  ],
                  borderColor: color,
                  borderDash: [5, 4],
                  pointRadius: 0,
                  tension: 0,
                },
              ]),
        ]),
      ];
    });
    chart = new Chart(canvas, {
      type: 'line',
      data: {
        datasets,
      },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            type: 'linear',
            ticks: {
              callback: (value) => formatDate(new Date(Number(value)).toISOString()),
            },
          },
          y: { beginAtZero: false },
        },
        plugins: { legend: { display: datasets.length > 1 } },
      },
    });
  };
  onMount(draw);
  createEffect(() => {
    props.hidden;
    draw();
  });
  onCleanup(() => chart?.destroy());
  return (
    <canvas
      ref={canvas}
      class="patient-dynamics-chart__canvas"
      aria-label={`График ${props.group.metricId}`}
    />
  );
}

function UnlockPanel(props: {
  readonly onUnlocked: (snapshot: PatientVaultSnapshot) => void;
}): JSX.Element {
  const [storedMode, setStoredMode] =
    createSignal<Awaited<ReturnType<typeof patientVaultStorageMode>>>();
  const [busy, setBusy] = createSignal(true);
  const [error, setError] = createSignal('');
  onMount(() => {
    void (async () => {
      try {
        const mode = await patientVaultStorageMode();
        setStoredMode(mode);
        if (mode === 'unencrypted' || (!mode && !isPatientVaultNativePlatform())) return;
        if (!mode) {
          await createPatientVault();
          props.onUnlocked(await readPatientVault());
        } else props.onUnlocked(await unlockPatientVault());
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : 'Keychain/Keystore недоступен; можно продолжить без шифрования.',
        );
      } finally {
        setBusy(false);
      }
    })();
  });
  const continueUnencrypted = async (): Promise<void> => {
    setError('');
    setBusy(true);
    try {
      if (storedMode() === 'unencrypted') props.onUnlocked(await unlockPatientVault());
      else {
        await createPatientVault({ allowUnencrypted: true });
        props.onUnlocked(await readPatientVault());
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось открыть хранилище.');
    } finally {
      setBusy(false);
    }
  };
  const canUseUnencrypted = (): boolean => storedMode() !== 'native-keychain';
  return (
    <section class="patient-workspace__unlock paper-card">
      <AppGlyph name="lock" class="patient-workspace__unlock-icon" />
      <Heading depth={2}>
        {busy()
          ? 'Открываем пациентов…'
          : canUseUnencrypted()
            ? 'Хранилище без шифрования'
            : 'Не удалось открыть Keychain'}
      </Heading>
      <Show when={!busy() && canUseUnencrypted()}>
        <p class="patient-workspace__warning" role="alert">
          Keychain/Keystore недоступен. Карточки будут храниться в IndexedDB без шифрования и
          останутся доступны любому, кто получит доступ к этому профилю браузера или устройству.
        </p>
      </Show>
      <Show when={error()}>
        <p class="patient-workspace__error" role="alert">
          {error()}
        </p>
      </Show>
      <Show when={!busy() && canUseUnencrypted()}>
        <Button type="button" variant="primary" onClick={() => void continueUnencrypted()}>
          {storedMode() === 'unencrypted' ? 'Открыть без шифрования' : 'Продолжить без шифрования'}
        </Button>
      </Show>
    </section>
  );
}

function NewPatientForm(props: {
  readonly onCreated: (snapshot: PatientVaultSnapshot, id: string) => void;
  readonly onCancel: () => void;
}): JSX.Element {
  const [name, setName] = createSignal('');
  const [recordNumber, setRecordNumber] = createSignal('');
  const [birthDate, setBirthDate] = createSignal('');
  const [sex, setSex] = createSignal<PatientProfile['biologicalSex']>();
  const [weight, setWeight] = createSignal('');
  const [height, setHeight] = createSignal('');
  const [error, setError] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const submit = async (event: SubmitEvent): Promise<void> => {
    event.preventDefault();
    if (busy()) return;
    setError('');
    setBusy(true);
    try {
      let profileInput: CreatePatientProfileInput = {
        displayName: name(),
        localRecordNumber: recordNumber(),
      };
      const selectedBirthDate = birthDate();
      const selectedSex = sex();
      const selectedWeight = weight();
      const selectedHeight = height();
      if (selectedBirthDate) profileInput = { ...profileInput, birthDate: selectedBirthDate };
      if (selectedSex) profileInput = { ...profileInput, biologicalSex: selectedSex };
      if (selectedWeight) profileInput = { ...profileInput, weightKg: Number(selectedWeight) };
      if (selectedHeight) profileInput = { ...profileInput, heightCm: Number(selectedHeight) };
      const created = createPatientProfile(profileInput);
      const snapshot = await updatePatientVault((current) => {
        let next: PatientVaultSnapshot = {
          ...current,
          profiles: [...current.profiles, created.profile],
        };
        for (const initialEvent of created.initialEvents) next = appendEvent(next, initialEvent);
        return next;
      });
      props.onCreated(snapshot, created.profile.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось создать карточку пациента.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section class="patient-workspace__panel paper-card">
      <Heading depth={2}>Новая карточка пациента</Heading>
      <form class="patient-workspace__form" onSubmit={submit}>
        <label class="patient-workspace__field">
          <span class="patient-workspace__label">Имя или псевдоним</span>
          <input
            class="patient-workspace__control"
            value={name()}
            onInput={(event) => setName(event.currentTarget.value)}
            required
          />
        </label>
        <label class="patient-workspace__field">
          <span class="patient-workspace__label">Номер карты (необязательно)</span>
          <input
            class="patient-workspace__control"
            value={recordNumber()}
            onInput={(event) => setRecordNumber(event.currentTarget.value)}
          />
        </label>
        <label class="patient-workspace__field">
          <span class="patient-workspace__label">Дата рождения</span>
          <input
            class="patient-workspace__control"
            type="date"
            value={birthDate()}
            onInput={(event) => setBirthDate(event.currentTarget.value)}
          />
        </label>
        <label class="patient-workspace__field">
          <span class="patient-workspace__label">Биологический пол</span>
          <select
            class="patient-workspace__control"
            value={sex() ?? ''}
            onChange={(event) =>
              setSex((event.currentTarget.value || undefined) as PatientProfile['biologicalSex'])
            }
          >
            <option value="">Не указан</option>
            <option value="female">Женский</option>
            <option value="male">Мужской</option>
            <option value="intersex">Интерсекс</option>
            <option value="unknown">Неизвестно</option>
          </select>
        </label>
        <div class="patient-workspace__form-grid">
          <label class="patient-workspace__field">
            <span class="patient-workspace__label">Масса, кг</span>
            <input
              class="patient-workspace__control"
              type="number"
              min="0"
              step="0.01"
              value={weight()}
              onInput={(event) => setWeight(event.currentTarget.value)}
            />
          </label>
          <label class="patient-workspace__field">
            <span class="patient-workspace__label">Рост, см</span>
            <input
              class="patient-workspace__control"
              type="number"
              min="0"
              step="0.1"
              value={height()}
              onInput={(event) => setHeight(event.currentTarget.value)}
            />
          </label>
        </div>
        <Show when={error()}>
          <p class="patient-workspace__error" role="alert">
            {error()}
          </p>
        </Show>
        <div class="patient-workspace__actions">
          <Button type="button" variant="quiet" disabled={busy()} onClick={props.onCancel}>
            Отмена
          </Button>
          <Button type="submit" variant="primary" disabled={busy()}>
            {busy() ? 'Создаём…' : 'Создать карточку'}
          </Button>
        </div>
      </form>
    </section>
  );
}

function ManualEventForm(props: {
  readonly patientId: string;
  readonly episodeId: string | undefined;
  readonly onSaved: (snapshot: PatientVaultSnapshot) => void;
  readonly snapshot: PatientVaultSnapshot;
}): JSX.Element {
  const [kind, setKind] = createSignal<'measurement' | 'laboratory' | 'medication'>('measurement');
  const [metricId, setMetricId] = createSignal('body-mass');
  const [label, setLabel] = createSignal('Масса тела');
  const [value, setValue] = createSignal('');
  const [unit, setUnit] = createSignal('кг');
  const [date, setDate] = createSignal(dateInputValue(new Date().toISOString()));
  const [range, setRange] = createSignal('');
  const [medicationKind, setMedicationKind] = createSignal<MedicationEventKind>('start');
  const [medication, setMedication] = createSignal('');
  const [error, setError] = createSignal('');
  const [customMetric, setCustomMetric] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const customMetricChoice = '__custom__';
  const metricChoice = (): string =>
    customMetric() ? customMetricChoice : `${metricId()}:${unit()}`;
  const applyMetricChoice = (choice: string): void => {
    if (choice === customMetricChoice) {
      setCustomMetric(true);
      setMetricId('');
      setLabel('');
      setUnit('');
      return;
    }
    setCustomMetric(false);
    const [nextMetricId, ...unitParts] = choice.split(':');
    const definition = [...PATIENT_METRIC_REGISTRY, ...props.snapshot.metricDefinitions].find(
      (candidate) => candidate.metricId === nextMetricId && candidate.unit === unitParts.join(':'),
    );
    if (!definition) return;
    setMetricId(definition.metricId);
    setLabel(definition.label);
    setUnit(definition.unit);
  };
  const quickMetric = (next: string, nextLabel: string, nextUnit: string): void => {
    setCustomMetric(false);
    setMetricId(next);
    setLabel(nextLabel);
    setUnit(nextUnit);
    setKind('measurement');
  };
  const submit = async (event: SubmitEvent): Promise<void> => {
    event.preventDefault();
    if (busy()) return;
    setError('');
    setBusy(true);
    try {
      const occurredAt = asIsoDate(date());
      const episode = props.episodeId ? { episodeId: props.episodeId } : {};
      const created =
        kind() === 'medication'
          ? createMedicationEvent({
              patientId: props.patientId,
              ...episode,
              occurredAt,
              medicationKind: medicationKind(),
              title: medication(),
            })
          : kind() === 'laboratory'
            ? createLaboratoryEvent({
                patientId: props.patientId,
                ...episode,
                occurredAt,
                metricId: metricId(),
                label: label(),
                value: Number(value()),
                unit: unit(),
                ...(range().trim() ? { reportRange: parseReportRange(range()) } : {}),
              })
            : createManualMeasurementEvent({
                patientId: props.patientId,
                ...episode,
                occurredAt,
                metricId: metricId(),
                label: label(),
                value: Number(value()),
                unit: unit(),
              });
      const next = await updatePatientVault((snapshot) => appendEvent(snapshot, created));
      setValue('');
      props.onSaved(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось записать событие.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form class="patient-workspace__event-form paper-card" onSubmit={submit}>
      <Heading depth={3}>Быстрая запись</Heading>
      <div class="patient-workspace__quick-actions">
        <button
          class="patient-workspace__quick-action"
          type="button"
          onClick={() => quickMetric('body-mass', 'Масса тела', 'кг')}
        >
          Масса
        </button>
        <button
          class="patient-workspace__quick-action"
          type="button"
          onClick={() => quickMetric('body-height', 'Рост', 'см')}
        >
          Рост
        </button>
        <button
          class="patient-workspace__quick-action"
          type="button"
          onClick={() =>
            quickMetric('blood-pressure-systolic', 'Давление: систолическое', 'мм рт. ст.')
          }
        >
          АД верхнее
        </button>
        <button
          class="patient-workspace__quick-action"
          type="button"
          onClick={() =>
            quickMetric('blood-pressure-diastolic', 'Давление: диастолическое', 'мм рт. ст.')
          }
        >
          АД нижнее
        </button>
        <button
          class="patient-workspace__quick-action"
          type="button"
          onClick={() => quickMetric('pulse', 'Пульс', 'уд/мин')}
        >
          Пульс
        </button>
      </div>
      <label class="patient-workspace__field">
        <span class="patient-workspace__label">Тип события</span>
        <select
          class="patient-workspace__control"
          value={kind()}
          onChange={(event) =>
            setKind(event.currentTarget.value as 'measurement' | 'laboratory' | 'medication')
          }
        >
          <option value="measurement">Показатель</option>
          <option value="laboratory">Лаборатория</option>
          <option value="medication">Лекарство</option>
        </select>
      </label>
      <Show when={kind() !== 'medication'}>
        <div class="patient-workspace__form-grid">
          <label class="patient-workspace__field">
            <span class="patient-workspace__label">Показатель</span>
            <select
              class="patient-workspace__control"
              value={metricChoice()}
              onChange={(event) => applyMetricChoice(event.currentTarget.value)}
            >
              <For each={PATIENT_METRIC_REGISTRY}>
                {(definition) => (
                  <option value={`${definition.metricId}:${definition.unit}`}>
                    {definition.label} · {definition.unit}
                  </option>
                )}
              </For>
              <For
                each={props.snapshot.metricDefinitions.filter(
                  (definition) => definition.kind === 'custom',
                )}
              >
                {(definition) => (
                  <option value={`${definition.metricId}:${definition.unit}`}>
                    {definition.label} · {definition.unit} · пользовательский
                  </option>
                )}
              </For>
              <option value={customMetricChoice}>Создать свой показатель…</option>
            </select>
          </label>
          <Show when={customMetric()}>
            <label class="patient-workspace__field">
              <span class="patient-workspace__label">Идентификатор пользовательского ряда</span>
              <input
                class="patient-workspace__control"
                value={metricId()}
                onInput={(event) => setMetricId(event.currentTarget.value)}
                required
              />
            </label>
            <label class="patient-workspace__field">
              <span class="patient-workspace__label">Название пользовательского показателя</span>
              <input
                class="patient-workspace__control"
                value={label()}
                onInput={(event) => setLabel(event.currentTarget.value)}
                required
              />
            </label>
            <label class="patient-workspace__field">
              <span class="patient-workspace__label">Единица пользовательского показателя</span>
              <input
                class="patient-workspace__control"
                value={unit()}
                onInput={(event) => setUnit(event.currentTarget.value)}
                required
              />
            </label>
          </Show>
          <label class="patient-workspace__field">
            <span class="patient-workspace__label">Значение</span>
            <input
              class="patient-workspace__control"
              type="number"
              step="any"
              value={value()}
              onInput={(event) => setValue(event.currentTarget.value)}
              required
            />
          </label>
          <Show when={!customMetric()}>
            <span class="patient-workspace__field">
              <span class="patient-workspace__label">Единица</span>
              <output class="patient-workspace__control">{unit()}</output>
            </span>
          </Show>
        </div>
        <Show when={kind() === 'laboratory'}>
          <label class="patient-workspace__field">
            <span class="patient-workspace__label">Референс с бланка</span>
            <input
              class="patient-workspace__control"
              value={range()}
              onInput={(event) => setRange(event.currentTarget.value)}
              placeholder="Например: 3,5–5,5 ммоль/л"
            />
          </label>
        </Show>
      </Show>
      <Show when={kind() === 'medication'}>
        <label class="patient-workspace__field">
          <span class="patient-workspace__label">Препарат</span>
          <input
            class="patient-workspace__control"
            value={medication()}
            onInput={(event) => setMedication(event.currentTarget.value)}
            required
          />
        </label>
        <label class="patient-workspace__field">
          <span class="patient-workspace__label">Событие лечения</span>
          <select
            class="patient-workspace__control"
            value={medicationKind()}
            onChange={(event) =>
              setMedicationKind(event.currentTarget.value as MedicationEventKind)
            }
          >
            <option value="start">Начало</option>
            <option value="take">Приём</option>
            <option value="dose-change">Изменение дозы</option>
            <option value="stop">Отмена</option>
          </select>
        </label>
      </Show>
      <label class="patient-workspace__field">
        <span class="patient-workspace__label">Дата</span>
        <input
          class="patient-workspace__control"
          type="date"
          value={date()}
          onInput={(event) => setDate(event.currentTarget.value)}
          required
        />
      </label>
      <Show when={error()}>
        <p class="patient-workspace__error" role="alert">
          {error()}
        </p>
      </Show>
      <Button type="submit" variant="primary" disabled={busy()}>
        {busy() ? 'Записываем…' : 'Записать'}
      </Button>
    </form>
  );
}

function PatientList(props: {
  readonly backLabel?: string;
  readonly snapshot: PatientVaultSnapshot;
  readonly onNavigate: (path: string) => void;
  readonly onExportBackup: () => void;
  readonly onImportBackup: () => void;
  readonly onDeleteAll: () => void;
}): JSX.Element {
  const [query, setQuery] = createSignal('');
  const [headingElement, setHeadingElement] = createSignal<HTMLElement | undefined>();

  useStickySurface(headingElement);

  const visibleProfiles = createMemo(() => {
    const normalizedQuery = query().trim().toLocaleLowerCase('ru-RU');
    if (!normalizedQuery) return props.snapshot.profiles;
    return props.snapshot.profiles.filter((profile) =>
      [
        profile.displayName,
        profile.localRecordNumber,
        profile.birthDate,
        profile.biologicalSex,
        profile.summary,
      ]
        .filter((value): value is string => Boolean(value))
        .join(' ')
        .toLocaleLowerCase('ru-RU')
        .includes(normalizedQuery),
    );
  });

  const menuActions: readonly AppContextMenuAction[] = [
    {
      id: 'lock',
      label: 'Заблокировать',
      icon: 'lock',
      onSelect: lockPatientVault,
    },
    {
      id: 'export-backup',
      label: 'Экспорт backup',
      icon: 'download',
      onSelect: props.onExportBackup,
    },
    {
      id: 'import-backup',
      label: 'Импорт backup',
      icon: 'file-arrow-down',
      onSelect: props.onImportBackup,
    },
    {
      id: 'delete-all',
      label: 'Удалить всё',
      icon: 'trash',
      danger: true,
      onSelect: props.onDeleteAll,
    },
  ];

  return (
    <>
      <header
        ref={setHeadingElement}
        class="patient-workspace__search-chrome knowledge-subroute-heading knowledge-subroute-heading--blurred sticky-surface route-sticky-chrome route-sticky-chrome--transparent"
      >
        <NavBack
          class="patient-workspace__back-button knowledge-back-button knowledge-subroute-heading__control"
          aria-label={props.backLabel ?? 'Назад к заметкам'}
          onClick={() => props.onNavigate(notesPath())}
        />
        <SearchField
          class="patient-workspace__search route-search knowledge-subroute-heading__control"
          id="patient-workspace-search"
          value={query()}
          onInput={setQuery}
          onClear={() => setQuery('')}
          label="Поиск по пациентам"
          hideLabel
          placeholder="Имя, номер карты или дата рождения"
        />
        <div class="patient-workspace__search-actions">
          <Button
            type="button"
            variant="primary"
            class="patient-workspace__new-button"
            aria-label="Новый пациент"
            title="Новый пациент"
            onClick={() => props.onNavigate(notesPatientsPath('new'))}
            icon={<AppGlyph name="plus" />}
          />
          <AppContextMenu class="patient-workspace__menu" actions={menuActions} hideButton>
            <Button
              type="button"
              variant="icon"
              class="patient-workspace__menu-button"
              aria-label="Действия с пациентами"
              title="Действия с пациентами"
              onClick={requestContextMenu}
              icon={<AppGlyph name="menu" />}
            />
          </AppContextMenu>
        </div>
      </header>
      <Page
        class="patient-workspace__page"
        icon={<AppGlyph name="users" class="page__icon-glyph" />}
        title={<Heading depth={1}>Пациенты</Heading>}
        description="Карточки пациентов хранятся локально и доступны в поиске «Ваши данные»."
      />
      <div class="patient-workspace__list">
        <For each={visibleProfiles()}>
          {(profile) => {
            const weight = latestObservation(props.snapshot, profile.id, 'body-mass', 'кг');
            const height = latestObservation(props.snapshot, profile.id, 'body-height', 'см');
            return (
              <button
                type="button"
                class="patient-workspace__patient-card paper-card"
                onClick={() => props.onNavigate(notesPatientsPath(profile.id))}
              >
                <strong class="patient-workspace__patient-name">{profile.displayName}</strong>
                <small class="patient-workspace__patient-meta">
                  {profile.birthDate
                    ? `рожд. ${formatDate(profile.birthDate)}`
                    : 'Дата рождения не указана'}
                  {profile.biologicalSex ? ` · ${profile.biologicalSex}` : ''}
                </small>
                <span class="patient-workspace__patient-measurement">
                  {weight ? `${weight.value} кг` : 'масса —'} ·{' '}
                  {height ? `${height.value} см` : 'рост —'}
                </span>
              </button>
            );
          }}
        </For>
      </div>
      <Show when={visibleProfiles().length === 0}>
        <div class="patient-workspace__empty paper-card" role="status">
          <AppGlyph
            name={query().trim() ? 'magnifying-glass-plus' : 'users'}
            class="patient-workspace__empty-icon"
          />
          <p class="patient-workspace__empty-text">
            {query().trim() ? 'По запросу ничего не найдено.' : 'Карточек пока нет.'}
          </p>
        </div>
      </Show>
    </>
  );
}

function PatientDetail(props: {
  readonly profile: PatientProfile;
  readonly snapshot: PatientVaultSnapshot;
  readonly focusEpisodeId?: string;
  readonly onNavigate: (path: string) => void;
  readonly onSnapshot: (snapshot: PatientVaultSnapshot) => void;
  readonly onExport: (patientId: string) => void;
  readonly onDelete: (patientId: string) => void;
}): JSX.Element {
  const [episode, setEpisode] = createSignal<ClinicalEpisode>();
  const [episodeText, setEpisodeText] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [editingObservationId, setEditingObservationId] = createSignal<string>();
  const [revisionValue, setRevisionValue] = createSignal('');
  const events = createMemo(() =>
    props.snapshot.events
      .filter((event) => event.patientId === props.profile.id)
      .toSorted((left, right) => right.occurredAt.localeCompare(left.occurredAt)),
  );
  const episodes = createMemo(() =>
    props.snapshot.episodes
      .filter((candidate) => candidate.patientId === props.profile.id)
      .toSorted((left, right) => right.startedAt.localeCompare(left.startedAt)),
  );
  const activeEpisodeId = () => (episode()?.status === 'open' ? episode()?.id : undefined);
  createEffect(() => {
    const targetId = props.focusEpisodeId;
    if (!targetId) return;
    const target = episodes().find((candidate) => candidate.id === targetId);
    if (!target) return;
    setEpisode(target);
    queueMicrotask(() => {
      document.getElementById(target.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  });
  const saveEpisode = async (): Promise<void> => {
    if (busy()) return;
    setBusy(true);
    try {
      const created = createClinicalEpisode({ patientId: props.profile.id, text: episodeText() });
      const next = await updatePatientVault((snapshot) => appendEpisode(snapshot, created));
      setEpisode(created);
      props.onSnapshot(next);
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : 'Не удалось создать осмотр.');
    } finally {
      setBusy(false);
    }
  };
  const closeEpisode = async (episodeId: string): Promise<void> => {
    if (busy()) return;
    setBusy(true);
    try {
      const next = await updatePatientVault((snapshot) =>
        closeClinicalEpisode(snapshot, episodeId),
      );
      if (episode()?.id === episodeId) setEpisode(undefined);
      props.onSnapshot(next);
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : 'Не удалось закрыть осмотр.');
    } finally {
      setBusy(false);
    }
  };
  const startObservationRevision = (observation: PatientObservation): void => {
    if (busy()) return;
    setEditingObservationId(observation.id);
    setRevisionValue(String(observation.value));
  };
  const cancelObservationRevision = (): void => {
    setEditingObservationId(undefined);
    setRevisionValue('');
  };
  const reviseObservation = async (observation: PatientObservation): Promise<void> => {
    if (busy()) return;
    const value = Number(revisionValue());
    if (!Number.isFinite(value)) {
      toast('Введите конечное числовое значение.');
      return;
    }
    setBusy(true);
    try {
      const next = await updatePatientVault((snapshot) =>
        reviseManualObservation(snapshot, observation.id, { value }),
      );
      cancelObservationRevision();
      props.onSnapshot(next);
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : 'Не удалось сохранить исправление.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div class="patient-workspace__toolbar">
        <div>
          <button
            type="button"
            class="patient-workspace__back"
            onClick={() => props.onNavigate(notesPatientsPath())}
          >
            <AppGlyph name="arrow-left" /> Пациенты
          </button>
          <p class="archive-kicker">Карточка пациента</p>
          <Heading depth={1}>{props.profile.displayName}</Heading>
          <p>
            {props.profile.birthDate
              ? `Дата рождения: ${formatDate(props.profile.birthDate)}`
              : 'Дата рождения не указана'}
            {props.profile.biologicalSex ? ` · Пол: ${props.profile.biologicalSex}` : ''}
          </p>
        </div>
        <div class="patient-workspace__actions">
          <Button
            type="button"
            variant="secondary"
            icon={<AppGlyph name="graph" />}
            onClick={() => props.onNavigate(notesPatientsPath(props.profile.id, true))}
          >
            Динамика
          </Button>
          <Button type="button" variant="quiet" onClick={() => props.onExport(props.profile.id)}>
            Экспорт карточки
          </Button>
          <Button type="button" variant="danger" onClick={() => props.onDelete(props.profile.id)}>
            Удалить карточку
          </Button>
          <Button
            type="button"
            variant="quiet"
            icon={<AppGlyph name="lock" />}
            onClick={lockPatientVault}
          >
            Заблокировать
          </Button>
        </div>
      </div>
      <section class="patient-workspace__panel paper-card">
        <Heading depth={2}>Осмотр</Heading>
        <Show when={episodes().length > 0}>
          <div class="patient-workspace__episode-list">
            <For each={episodes()}>
              {(candidate) => (
                <div
                  id={candidate.id}
                  class="patient-workspace__episode"
                  classList={{
                    'patient-workspace__episode--active': episode()?.id === candidate.id,
                  }}
                >
                  <span class="patient-workspace__episode-title">
                    {candidate.title} · {formatDate(candidate.startedAt)}
                  </span>
                  <span class="patient-workspace__episode-status">
                    {candidate.status === 'open' ? 'Открыт' : 'Закрыт'}
                  </span>
                  <Show when={candidate.status === 'open'}>
                    <Button
                      type="button"
                      variant="quiet"
                      disabled={busy()}
                      onClick={() => setEpisode(candidate)}
                    >
                      Выбрать для записи
                    </Button>
                    <Button
                      type="button"
                      variant="quiet"
                      disabled={busy()}
                      onClick={() => void closeEpisode(candidate.id)}
                    >
                      Закрыть
                    </Button>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Show>
        <textarea
          class="patient-workspace__control"
          value={episodeText()}
          onInput={(event) => setEpisodeText(event.currentTarget.value)}
          placeholder="Краткая запись осмотра"
          rows={3}
        />
        <div class="patient-workspace__actions">
          <Button
            type="button"
            variant="primary"
            disabled={busy()}
            onClick={() => void saveEpisode()}
          >
            {busy() ? 'Сохраняем…' : 'Создать осмотр'}
          </Button>
          <Show when={episode()}>
            <small class="patient-workspace__event-text">
              Текущий осмотр {episode()?.status === 'open' ? 'открыт' : 'закрыт'}:{' '}
              {formatDate(episode()?.startedAt ?? '')}
            </small>
          </Show>
        </div>
      </section>
      <ManualEventForm
        patientId={props.profile.id}
        episodeId={activeEpisodeId()}
        snapshot={props.snapshot}
        onSaved={props.onSnapshot}
      />
      <section class="patient-workspace__timeline">
        <Heading depth={2} class="patient-workspace__section-title">
          События
        </Heading>
        <Show
          when={events().length > 0}
          fallback={<p class="patient-workspace__empty paper-card">Событий пока нет.</p>}
        >
          <For each={events()}>
            {(event) => (
              <article
                id={event.id}
                class="patient-workspace__event paper-card"
                data-episode-id={event.episodeId ?? ''}
              >
                <time class="patient-workspace__event-time">
                  {formatDateTime(event.occurredAt)}
                </time>
                <strong class="patient-workspace__event-title">{event.title}</strong>
                <span class="patient-workspace__event-description">{eventDescription(event)}</span>
                <For each={event.observations}>
                  {(observation) => (
                    <>
                      <small class="patient-workspace__event-observation">
                        {observation.value} {observation.unit}
                        {observation.evaluation?.verdict
                          ? ` · ${observation.evaluation.verdict.title}`
                          : ''}
                      </small>
                      <Show
                        when={
                          !event.supersededBy &&
                          (event.kind === 'manual-measurement' ||
                            event.kind === 'laboratory-result')
                        }
                      >
                        <Show
                          when={editingObservationId() === observation.id}
                          fallback={
                            <button
                              type="button"
                              class="patient-workspace__event-action"
                              disabled={busy()}
                              onClick={() => startObservationRevision(observation)}
                            >
                              Исправить значение
                            </button>
                          }
                        >
                          <div class="patient-workspace__event-revision">
                            <label class="patient-workspace__event-revision-label">
                              <span>Новое значение</span>
                              <input
                                class="patient-workspace__event-revision-input"
                                type="number"
                                step="any"
                                value={revisionValue()}
                                onInput={(inputEvent) =>
                                  setRevisionValue(inputEvent.currentTarget.value)
                                }
                              />
                            </label>
                            <div class="patient-workspace__event-revision-actions">
                              <button
                                type="button"
                                class="patient-workspace__event-action"
                                disabled={busy()}
                                onClick={() => void reviseObservation(observation)}
                              >
                                {busy() ? 'Сохраняем…' : 'Сохранить исправление'}
                              </button>
                              <button
                                type="button"
                                class="patient-workspace__event-action"
                                disabled={busy()}
                                onClick={cancelObservationRevision}
                              >
                                Отмена
                              </button>
                            </div>
                          </div>
                        </Show>
                      </Show>
                    </>
                  )}
                </For>
                <Show when={event.supersededBy}>
                  <small class="patient-workspace__event-revision-status">
                    Заменено исправлением.
                  </small>
                </Show>
              </article>
            )}
          </For>
        </Show>
      </section>
    </>
  );
}

function DynamicsView(props: {
  readonly profile: PatientProfile;
  readonly snapshot: PatientVaultSnapshot;
  readonly onNavigate: (path: string) => void;
  readonly onOpenEpisode: (episodeId: string) => void;
}): JSX.Element {
  const series = createMemo(() => buildDynamics(props.snapshot, props.profile.id));
  const groups = createMemo(() => buildDynamicsGroups(props.snapshot, props.profile.id));
  const medicationTimeline = createMemo(() =>
    buildMedicationTimeline(props.snapshot, props.profile.id),
  );
  const [hidden, setHidden] = createSignal<ReadonlySet<string>>(new Set());
  const [selectedSource, setSelectedSource] = createSignal<PatientObservation>();
  const updateHidden = (key: string, current: ReadonlySet<string>): ReadonlySet<string> => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  };
  const toggle = (key: string): void => {
    setHidden(updateHidden(key, hidden()));
  };
  const patientEvents = createMemo(() =>
    props.snapshot.events
      .filter((event) => event.patientId === props.profile.id)
      .toSorted((left, right) => left.occurredAt.localeCompare(right.occurredAt)),
  );
  const selectedEvent = createMemo(() => {
    const observation = selectedSource();
    return observation
      ? props.snapshot.events.find((event) => event.id === observation.eventId)
      : undefined;
  });
  const selectedEpisode = createMemo(() => {
    const event = selectedEvent();
    return event?.episodeId
      ? props.snapshot.episodes.find((episode) => episode.id === event.episodeId)
      : undefined;
  });
  const selectedSourceLinks = createMemo(() => selectedSource()?.evaluation?.sourceLinks ?? []);
  const scrollTo = (id: string): void => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  return (
    <>
      <div class="patient-workspace__toolbar">
        <div>
          <button
            type="button"
            class="patient-workspace__back"
            onClick={() => props.onNavigate(notesPatientsPath(props.profile.id))}
          >
            <AppGlyph name="arrow-left" /> {props.profile.displayName}
          </button>
          <p class="archive-kicker">Продольные наблюдения</p>
          <Heading depth={1} class="patient-dynamics__page-title">
            Динамика
          </Heading>
          <p>Ряды разделены по показателю, единице, инструменту и методике.</p>
        </div>
        <Button
          type="button"
          variant="quiet"
          icon={<AppGlyph name="lock" />}
          onClick={lockPatientVault}
        >
          Заблокировать
        </Button>
      </div>
      <section class="patient-workspace__sources paper-card">
        <span class="patient-workspace__sources-label">Источники рядов</span>
        <div class="patient-workspace__sources-list">
          <For each={series()}>
            {(item) => (
              <button
                class="patient-workspace__source"
                type="button"
                aria-pressed={!hidden().has(item.key)}
                classList={{ 'patient-workspace__source--hidden': hidden().has(item.key) }}
                onClick={() => {
                  toggle(item.key);
                  setSelectedSource(item.observations[0]);
                }}
              >
                {item.metricId} · {item.unit} · {item.method}
              </button>
            )}
          </For>
        </div>
      </section>
      <Show when={selectedSource()}>
        {(observation) => (
          <section class="patient-workspace__source-details paper-card">
            <strong class="patient-workspace__source-details-title">Источник наблюдения</strong>
            <span class="patient-workspace__source-details-text">
              {observationSourceLabel(observation().source)}
            </span>
            <Show when={selectedEvent()}>
              {(event) => (
                <span class="patient-workspace__source-details-text">
                  Результат: {event().title} · {formatDateTime(event().occurredAt)}
                </span>
              )}
            </Show>
            <Show when={selectedEpisode()}>
              {(episode) => (
                <span class="patient-workspace__source-details-text">
                  Осмотр: {episode().title} · {episode().status === 'open' ? 'открыт' : 'закрыт'}
                </span>
              )}
            </Show>
            <Show when={observationToolVersion(observation())}>
              <small class="patient-workspace__source-details-text">
                Версия инструмента: {observationToolVersion(observation())}
              </small>
            </Show>
            <button
              class="patient-workspace__source-details-link"
              type="button"
              onClick={() => scrollTo(observation().eventId)}
            >
              Открыть событие
            </button>
            <Show when={selectedEpisode()}>
              {(episode) => (
                <button
                  class="patient-workspace__source-details-link"
                  type="button"
                  onClick={() => props.onOpenEpisode(episode().id)}
                >
                  Открыть осмотр
                </button>
              )}
            </Show>
            <Show when={selectedSourceLinks().length > 0}>
              <div class="patient-workspace__source-details-methodology">
                <span class="patient-workspace__source-details-text">Методика:</span>
                <For each={selectedSourceLinks()}>
                  {(source) => {
                    const sourceUrl = source.url && isHttpUrl(source.url) ? source.url : undefined;
                    return (
                      <Show
                        when={sourceUrl ?? source.documentId}
                        fallback={
                          <span class="patient-workspace__source-details-text">{source.title}</span>
                        }
                      >
                        <Show
                          when={sourceUrl}
                          fallback={
                            <button
                              class="patient-workspace__source-details-link"
                              type="button"
                              onClick={() => {
                                if (source.documentId) openDocumentOverlay(source.documentId);
                              }}
                            >
                              {source.title}
                            </button>
                          }
                        >
                          {(url) => (
                            <a
                              class="patient-workspace__source-details-link"
                              href={url()}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {source.title}
                            </a>
                          )}
                        </Show>
                      </Show>
                    );
                  }}
                </For>
              </div>
            </Show>
          </section>
        )}
      </Show>
      <div class="patient-dynamics">
        <For each={groups()}>
          {(group) => (
            <section
              class="patient-dynamics__series paper-card"
              classList={{
                'patient-dynamics__series--hidden': group.series.every((item) =>
                  hidden().has(item.key),
                ),
              }}
            >
              <header class="patient-dynamics__header">
                <div class="patient-dynamics__heading">
                  <Heading depth={2} class="patient-dynamics__series-title">
                    {group.metricId}
                  </Heading>
                  <small class="patient-dynamics__meta">
                    {group.unit} · {group.series.map((item) => item.method).join(' · ')}
                  </small>
                </div>
                <button
                  class="patient-dynamics__toggle"
                  type="button"
                  onClick={() => {
                    for (const item of group.series) toggle(item.key);
                  }}
                >
                  {group.series.every((item) => hidden().has(item.key)) ? 'Показать' : 'Скрыть'}
                </button>
              </header>
              <div class="patient-dynamics-chart">
                <DynamicsChart group={group} hidden={hidden()} />
              </div>
              <table class="patient-dynamics__table">
                <caption class="patient-dynamics__caption">Наблюдения</caption>
                <thead class="patient-dynamics__table-head">
                  <tr class="patient-dynamics__table-row">
                    <th class="patient-dynamics__table-cell" scope="col">
                      Дата
                    </th>
                    <th class="patient-dynamics__table-cell" scope="col">
                      Значение
                    </th>
                    <th class="patient-dynamics__table-cell" scope="col">
                      Оценка
                    </th>
                  </tr>
                </thead>
                <tbody class="patient-dynamics__table-body">
                  <For each={group.series.flatMap((item) => item.observations)}>
                    {(observation) => (
                      <tr class="patient-dynamics__table-row">
                        <td class="patient-dynamics__table-cell">
                          {formatDateTime(observation.observedAt)}
                        </td>
                        <td class="patient-dynamics__table-cell">
                          {observation.value} {observation.unit}
                        </td>
                        <td class="patient-dynamics__table-cell">
                          {observation.evaluation?.verdict?.title ??
                            observation.evaluation?.status ??
                            '—'}
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </section>
          )}
        </For>
      </div>
      <Show when={medicationTimeline().length > 0}>
        <section class="patient-dynamics__medication paper-card">
          <Heading depth={2} class="patient-workspace__section-title">
            Лекарственные интервалы и маркеры
          </Heading>
          <For each={medicationTimeline()}>
            {(medication) => (
              <article class="patient-dynamics__medication-item">
                <strong class="patient-dynamics__medication-title">{medication.title}</strong>
                <span class="patient-dynamics__medication-interval">
                  Интервал:{' '}
                  {medication.startedAt ? formatDateTime(medication.startedAt) : 'не указан'}
                  {' — '}
                  {medication.stoppedAt ? formatDateTime(medication.stoppedAt) : 'продолжается'}
                </span>
                <div class="patient-dynamics__medication-markers">
                  <For each={medication.events}>
                    {(event) => (
                      <button
                        class="patient-dynamics__medication-marker"
                        type="button"
                        onClick={() => scrollTo(event.id)}
                      >
                        {eventDescription(event)} · {formatDateTime(event.occurredAt)}
                      </button>
                    )}
                  </For>
                </div>
              </article>
            )}
          </For>
        </section>
      </Show>
      <section class="patient-workspace__timeline">
        <Heading depth={2} class="patient-workspace__section-title">
          Хронология лечения и записей
        </Heading>
        <For each={patientEvents()}>
          {(event) => (
            <article id={event.id} class="patient-workspace__event paper-card">
              <time class="patient-workspace__event-time">{formatDateTime(event.occurredAt)}</time>
              <strong class="patient-workspace__event-title">{event.title}</strong>
              <span class="patient-workspace__event-description">{eventDescription(event)}</span>
              <Show when={event.text}>
                <small class="patient-workspace__event-text">{event.text}</small>
              </Show>
            </article>
          )}
        </For>
      </section>
    </>
  );
}

export function PatientWorkspace(props: PatientWorkspaceProps): JSX.Element {
  const [snapshot, setSnapshot] = createSignal<PatientVaultSnapshot>();
  const [error, setError] = createSignal('');
  let vaultReadRequest = 0;
  const routePatientId = () =>
    props.route.kind === 'patient' || props.route.kind === 'patient-dynamics'
      ? props.route.patientId
      : null;
  onMount(() => {
    const refreshVault = (): void => {
      const request = ++vaultReadRequest;
      if (!isPatientVaultUnlocked()) {
        setSnapshot(undefined);
        acknowledgePatientVaultUiCleared();
        return;
      }
      void readPatientVault()
        .then((next) => {
          if (request === vaultReadRequest && isPatientVaultUnlocked()) setSnapshot(next);
        })
        .catch(() => {
          if (request === vaultReadRequest && isPatientVaultUnlocked()) setSnapshot(undefined);
        });
    };
    window.addEventListener(PATIENT_VAULT_EVENT, refreshVault);
    window.addEventListener(PATIENT_VAULT_LOCK_EVENT, refreshVault);
    onCleanup(() => {
      window.removeEventListener(PATIENT_VAULT_EVENT, refreshVault);
      window.removeEventListener(PATIENT_VAULT_LOCK_EVENT, refreshVault);
    });
    refreshVault();
  });
  createEffect(() => {
    if (!isPatientVaultUnlocked()) setSnapshot(undefined);
  });
  const unlocked = (): boolean => snapshot() !== undefined && isPatientVaultUnlocked();
  const selectedProfile = createMemo(() => {
    const id = routePatientId();
    return id ? snapshot()?.profiles.find((profile) => profile.id === id) : undefined;
  });
  const onUnlocked = (next: PatientVaultSnapshot): void => {
    vaultReadRequest += 1;
    setSnapshot(next);
    setError('');
  };
  const onSnapshot = (next: PatientVaultSnapshot): void => {
    setSnapshot(next);
  };
  const importBackup = async (): Promise<void> => {
    const raw = window.prompt('Вставьте JSON резервной копии');
    if (!raw) return;
    try {
      await importPatientVaultBackup(JSON.parse(raw) as unknown);
      const request = ++vaultReadRequest;
      const next = await readPatientVault();
      if (request === vaultReadRequest && isPatientVaultUnlocked()) setSnapshot(next);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Не удалось импортировать резервную копию.',
      );
    }
  };
  const exportBackup = async (): Promise<void> => {
    if (!window.confirm('Резервная копия содержит пациентские данные без шифрования. Продолжить?'))
      return;
    try {
      const backup = await exportPatientVaultBackup();
      await navigator.clipboard.writeText(JSON.stringify(backup));
      toast('Незашифрованная резервная копия скопирована.');
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Не удалось экспортировать резервную копию.',
      );
    }
  };
  const exportPatient = async (patientId: string): Promise<void> => {
    if (!window.confirm('Экспорт содержит данные пациента без шифрования. Продолжить?')) return;
    try {
      const backup = await exportPatientVaultBackup(patientId);
      await navigator.clipboard.writeText(JSON.stringify(backup));
      toast('Незашифрованная копия карточки скопирована.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось экспортировать карточку.');
    }
  };
  const deleteAllPatients = async (): Promise<void> => {
    if (!window.confirm('Удалить все карточки пациентов и локальные файлы?')) return;
    try {
      await deletePatientVault();
      setSnapshot(undefined);
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : 'Не удалось удалить карточки пациентов.');
    }
  };
  const deletePatient = async (patientId: string): Promise<void> => {
    if (
      !window.confirm(
        'Удалить карточку пациента, её осмотры и события? Отменить это действие нельзя.',
      )
    )
      return;
    try {
      await deletePatientFromVault(patientId);
      const request = ++vaultReadRequest;
      const next = await readPatientVault();
      if (request === vaultReadRequest && isPatientVaultUnlocked()) setSnapshot(next);
      props.onNavigate(notesPatientsPath());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось удалить карточку пациента.');
    }
  };
  return (
    <section class="patient-workspace" aria-label="Карточки пациентов">
      <Show
        when={!unlocked()}
        fallback={
          <>
            <Show when={props.route.kind === 'patients'}>
              <PatientList
                backLabel={props.backLabel ?? 'Назад к заметкам'}
                snapshot={snapshot() ?? emptyPatientVaultSnapshot()}
                onNavigate={props.onNavigate}
                onExportBackup={() => void exportBackup()}
                onImportBackup={() => void importBackup()}
                onDeleteAll={() => void deleteAllPatients()}
              />
            </Show>
            <Show when={props.route.kind === 'new-patient'}>
              <NewPatientForm
                onCreated={(next, id) => {
                  setSnapshot(next);
                  props.onNavigate(notesPatientsPath(id));
                }}
                onCancel={() => props.onNavigate(notesPatientsPath())}
              />
            </Show>
            <Show
              when={props.route.kind === 'patient' || props.route.kind === 'patient-dynamics'}
              fallback={
                <Show when={props.route.kind !== 'patients'}>
                  <p class="patient-workspace__error" role="alert">
                    Пациент не найден.
                  </p>
                </Show>
              }
            >
              <Show
                when={selectedProfile()}
                fallback={
                  <p class="patient-workspace__error" role="alert">
                    Пациент не найден.
                  </p>
                }
              >
                {(profile) => (
                  <Show
                    when={props.route.kind === 'patient'}
                    fallback={
                      <DynamicsView
                        profile={profile()}
                        snapshot={snapshot() ?? emptyPatientVaultSnapshot()}
                        onNavigate={props.onNavigate}
                        onOpenEpisode={(episodeId) =>
                          props.onNavigate(notesPatientsPath(profile().id, false, episodeId))
                        }
                      />
                    }
                  >
                    <PatientDetail
                      profile={profile()}
                      snapshot={snapshot() ?? emptyPatientVaultSnapshot()}
                      {...(props.route.kind === 'patient' && props.route.episodeId
                        ? { focusEpisodeId: props.route.episodeId }
                        : {})}
                      onNavigate={props.onNavigate}
                      onSnapshot={onSnapshot}
                      onExport={(patientId) => void exportPatient(patientId)}
                      onDelete={(patientId) => void deletePatient(patientId)}
                    />
                  </Show>
                )}
              </Show>
            </Show>
          </>
        }
      >
        <UnlockPanel onUnlocked={onUnlocked} />
        <Show when={error()}>
          <p class="patient-workspace__error" role="alert">
            {error()}
          </p>
        </Show>
      </Show>
    </section>
  );
}
