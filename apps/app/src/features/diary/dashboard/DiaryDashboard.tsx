import { createMemo, createResource, createSignal, For, type JSX, onCleanup, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { NavBack } from '@/components/NavBack';
import { Page } from '@/components/Page';
import { Heading } from '@/components/Text';
import { pluralize } from '@/diary/diary-format';
import { replicaResults } from '@/features/diary/connected/diary-replica';
import {
  type DoctorSession,
  restoreDoctorSession,
  signOut,
} from '@/features/diary/connected/doctor-account';
import { DoctorDiaries, type DoctorPatient } from '@/features/diary/connected/doctor-workspace';
import { DiaryPatientPage } from '@/features/diary/dashboard/DiaryPatientPage';
import { DoctorSignIn } from '@/features/diary/dashboard/DoctorSignIn';
import { adherence } from '@/features/diary/dashboard/diary-insights';
import { enableDoctorPush } from '@/features/diary/dashboard/doctor-push';
import { NewPatientDialog } from '@/features/diary/dashboard/NewPatientDialog';
import '@/features/diary/dashboard/diary-dashboard.css';
import { activeProfile } from '@/state/app-profile';

function relative(iso: string | null): string {
  if (!iso) return 'записей ещё нет';
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 2) return 'только что';
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${pluralize(hours, 'час', 'часа', 'часов')} назад`;
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

function percent(share: number | undefined): string {
  return share === undefined ? '—' : `${Math.round(share * 100)} %`;
}

function PatientRow(props: {
  readonly patient: DoctorPatient;
  readonly onOpen: () => void;
  readonly onAccept: () => void;
}): JSX.Element {
  const results = () => replicaResults(props.patient.replica);
  const week = () => {
    const current = results();
    return current ? adherence(current.invitation, current.entries, 7) : undefined;
  };
  const status = () => props.patient.summary.status;
  return (
    <li class="diary-dash-row">
      <button
        type="button"
        class="diary-dash-row__open"
        classList={{ 'diary-dash-row__open--alert': props.patient.summary.openAlerts > 0 }}
        onClick={() => (status() === 'pending' ? props.onAccept() : props.onOpen())}
      >
        <span class="diary-dash-row__avatar" aria-hidden="true">
          {props.patient.replica.profile?.emoji ?? '🙂'}
        </span>
        <span class="diary-dash-row__text">
          <span class="diary-dash-row__name">
            {props.patient.replica.profile?.label ??
              (status() === 'pending' ? 'Приглашение к пациенту' : 'Пациент')}
          </span>
          <span class="diary-dash-row__meta">
            {status() === 'pending'
              ? 'Нажмите, чтобы принять'
              : status() === 'withdrawn'
                ? 'Согласие отозвано'
                : `${relative(props.patient.summary.lastRecordAt)} · за 7 дней ${percent(week()?.share)}${
                    props.patient.summary.devices === 0 ? ' · телефон не подключён' : ''
                  }`}
          </span>
        </span>
        <Show when={props.patient.summary.openAlerts > 0}>
          <span class="diary-dash-row__alert" role="img" aria-label="Срочная отметка">
            !
          </span>
        </Show>
        <AppGlyph name="caret-right" class="diary-dash-row__chevron" />
      </button>
    </li>
  );
}

/**
 * «Дневники пациентов»: the doctor's connected diaries. Sign-in, the list with urgent marks on
 * top, and one patient's page. Everything is decrypted on this device (ADR-0026).
 */
export function DiaryDashboard(props: {
  readonly patientId: string | undefined;
  readonly onBack: () => void;
  readonly onOpenPatient: (id: string) => void;
  readonly onList: () => void;
}): JSX.Element {
  const [session, setSession] = createSignal<DoctorSession | undefined>();
  const [workspace, setWorkspace] = createSignal<DoctorDiaries | undefined>();
  const [version, setVersion] = createSignal(0);
  const [error, setError] = createSignal('');
  const [creating, setCreating] = createSignal(false);
  const [pushState, setPushState] = createSignal<'off' | 'on' | 'unsupported' | 'denied'>('off');

  let stopCurrent: (() => void) | undefined;
  onCleanup(() => stopCurrent?.());
  const start = (next: DoctorSession): void => {
    stopCurrent?.();
    setSession(next);
    const diaries = new DoctorDiaries(next);
    const unsubscribe = diaries.subscribe(() => setVersion((value) => value + 1));
    stopCurrent = () => {
      unsubscribe();
      diaries.disconnect();
    };
    setWorkspace(diaries);
    diaries
      .refresh()
      .then(() => diaries.connectLive())
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'Не удалось загрузить дневники.');
      });
  };

  const [restored] = createResource(async () => {
    const found = await restoreDoctorSession().catch((cause: unknown) => {
      console.warn('Дневники: сохранённый вход не открылся', cause);
      return undefined;
    });
    if (found) start(found);
    return true;
  });

  const patients = createMemo(() => {
    version();
    return workspace()?.patients() ?? [];
  });
  const alerts = createMemo(() => {
    version();
    return workspace()?.alerts() ?? [];
  });
  const current = createMemo(() => {
    version();
    return props.patientId ? workspace()?.patient(props.patientId) : undefined;
  });

  const label = (patientId: string): string => {
    const patient = workspace()?.patient(patientId);
    return `${patient?.replica.profile?.emoji ?? ''} ${patient?.replica.profile?.label ?? 'Пациент'}`.trim();
  };

  return (
    <section class="diary-dash" aria-label="Дневники пациентов">
      <Show when={props.patientId ? current() : undefined}>
        {(patient) => (
          <Show when={workspace()}>
            {(diaries) => (
              <DiaryPatientPage
                workspace={diaries()}
                patient={patient()}
                version={version()}
                onBack={props.onList}
              />
            )}
          </Show>
        )}
      </Show>
      <Show when={!(props.patientId && current())}>
        <Page
          navigation={
            // In the diaries-only app there is nowhere to go back to.
            activeProfile() ? undefined : (
              <NavBack class="knowledge-back-button" aria-label="Назад" onClick={props.onBack} />
            )
          }
          title={<Heading depth={1}>Дневники пациентов</Heading>}
          actions={
            <Show when={session()}>
              <Button
                variant="icon"
                aria-label="Новый пациент"
                icon={<AppGlyph name="plus" class="diary-dash__glyph" />}
                onClick={() => setCreating(true)}
              />
            </Show>
          }
          help={
            <p>
              Пациент заполняет дневник на своём телефоне, записи приходят сюда сами. Они шифруются
              на устройствах: сервер хранит только шифр, прочитать его можете вы и подключённые
              кураторы. Срочные отметки (например, мысли о самоповреждении в PHQ-9) поднимаются
              наверх и приходят уведомлением.
            </p>
          }
        />
        <Show
          when={session()}
          fallback={
            <Show when={restored()} fallback={<p class="diary-dash__quiet">Открываем…</p>}>
              <DoctorSignIn onSignedIn={start} />
            </Show>
          }
        >
          {(signedIn) => (
            <>
              <div class="diary-dash__me">
                <span class="diary-dash__me-name">{signedIn().doctor.name}</span>
                <Show when={pushState() !== 'on'}>
                  <Button
                    variant="quiet"
                    icon={<AppGlyph name="vibrate" class="diary-dash__glyph" />}
                    disabled={pushState() === 'unsupported' || pushState() === 'denied'}
                    onClick={() => void enableDoctorPush(signedIn()).then(setPushState)}
                  >
                    {pushState() === 'unsupported'
                      ? 'Уведомления недоступны'
                      : pushState() === 'denied'
                        ? 'Уведомления запрещены'
                        : 'Уведомлять о срочном'}
                  </Button>
                </Show>
                <Button
                  variant="quiet"
                  onClick={() => {
                    void signOut(signedIn()).finally(() => {
                      workspace()?.disconnect();
                      setWorkspace(undefined);
                      setSession(undefined);
                    });
                  }}
                >
                  Выйти
                </Button>
              </div>
              <Show when={error()}>
                <p class="diary-dash__error" role="alert">
                  {error()}
                </p>
              </Show>
              <Show when={alerts().length}>
                <ul class="diary-dash-alerts" aria-label="Срочные отметки">
                  <For each={alerts()}>
                    {(alert) => (
                      <li class="diary-dash-alert">
                        <button
                          type="button"
                          class="diary-dash-alert__open"
                          onClick={() => props.onOpenPatient(alert.patientId)}
                        >
                          <span class="diary-dash-alert__mark" aria-hidden="true">
                            !
                          </span>
                          <span class="diary-dash-alert__text">
                            {alert.kind === 'withdrawn'
                              ? `${label(alert.patientId)}: согласие отозвано`
                              : `${label(alert.patientId)}: срочная отметка`}
                            <span class="diary-dash-alert__when">{relative(alert.at)}</span>
                          </span>
                        </button>
                        <Button
                          variant="icon"
                          aria-label="Отметить как просмотренное"
                          icon={<AppGlyph name="check" class="diary-dash__glyph" />}
                          onClick={() => void workspace()?.ackAlert(alert.id)}
                        />
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
              <Show
                when={workspace()?.isLoaded() || version() > 0}
                fallback={<p class="diary-dash__quiet">Загружаем и расшифровываем дневники…</p>}
              >
                <Show
                  when={patients().length}
                  fallback={
                    <div class="diary-dash__empty">
                      <p class="diary-dash__quiet">Пациентов пока нет.</p>
                      <Button variant="primary" onClick={() => setCreating(true)}>
                        Новый пациент
                      </Button>
                    </div>
                  }
                >
                  <ul class="diary-dash-list">
                    <For each={patients()}>
                      {(patient) => (
                        <PatientRow
                          patient={patient}
                          onOpen={() => props.onOpenPatient(patient.summary.id)}
                          onAccept={() => {
                            void workspace()
                              ?.accept(patient.summary.id)
                              .then(() => props.onOpenPatient(patient.summary.id))
                              .catch((cause: unknown) =>
                                setError(
                                  cause instanceof Error ? cause.message : 'Не удалось принять.',
                                ),
                              );
                          }}
                        />
                      )}
                    </For>
                  </ul>
                </Show>
              </Show>
            </>
          )}
        </Show>
      </Show>
      <Show when={creating() && workspace()}>
        {(diaries) => (
          <NewPatientDialog
            workspace={diaries()}
            onClose={() => setCreating(false)}
            onCreated={(id) => props.onOpenPatient(id)}
          />
        )}
      </Show>
    </section>
  );
}
