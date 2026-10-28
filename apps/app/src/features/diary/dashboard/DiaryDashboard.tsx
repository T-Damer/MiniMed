import type { DiaryAlert } from '@localmed/contracts';
import {
  createMemo,
  createResource,
  createSignal,
  For,
  type JSX,
  Match,
  onCleanup,
  Show,
  Switch,
} from 'solid-js';
import { AppContextMenu, type AppContextMenuAction } from '@/components/AppContextMenu';
import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { ConfirmationDialog } from '@/components/ConfirmationDialog';
import { FloatingActionButton } from '@/components/FloatingActionButton';
import type { HeaderAction } from '@/components/HeaderActions';
import { NavBack } from '@/components/NavBack';
import { Page } from '@/components/Page';
import { SegmentedControl } from '@/components/SegmentedControl';
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
import { DEMO_LABEL_PREFIX, seedDemoPatients } from '@/features/diary/dashboard/demo-patients';
import { adherence } from '@/features/diary/dashboard/diary-insights';
import { enableDoctorPush } from '@/features/diary/dashboard/doctor-push';
import { NEW_PATIENT_ROUTE, NewPatientScreen } from '@/features/diary/dashboard/NewPatientScreen';
import { PatientDayView } from '@/features/diary/dashboard/PatientDayView';
import { AlertDialog } from '@/features/diary/dashboard/PatientDialogs';
import { PatientScreenPage } from '@/features/diary/dashboard/PatientScreenPage';
import { PushHelpDialog } from '@/features/diary/dashboard/PushHelpDialog';
import { telHref } from '@/features/diary/dashboard/patient-contact';
import {
  lastPatientEntry,
  orderPatients,
  PATIENT_ORDER_LABEL,
  type PatientOrder,
} from '@/features/diary/dashboard/patient-order';
import { isOnline } from '@/features/diary/dashboard/presence';
import { SignInGarden } from '@/features/diary/dashboard/SignInGarden';
import { diariesPath } from '@/features/notes/notes-routing';
import { navigateBack } from '@/state/app-back';
import { FEEDBACK_MOMENTS, playFeedback } from '@/state/ui-feedback';
import '@/features/diary/dashboard/diary-dashboard.css';
import { activeProfile } from '@/state/app-profile';

const ORDER_KEY = 'minimed.diary.patient-order.v1';

function readOrder(): PatientOrder {
  try {
    const stored = window.localStorage.getItem(ORDER_KEY);
    return stored === 'doctor' || stored === 'name' ? stored : 'patient';
  } catch (cause) {
    console.warn('Порядок списка не прочитан', cause);
    return 'patient';
  }
}

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
  /** Long press or right click: what the doctor can do with this patient. */
  readonly actions: readonly AppContextMenuAction[];
}): JSX.Element {
  const results = () => replicaResults(props.patient.replica);
  const week = () => {
    const current = results();
    return current ? adherence(current.invitation, current.entries, 7) : undefined;
  };
  const status = () => props.patient.summary.status;
  return (
    <li class="diary-dash-row">
      <AppContextMenu actions={props.actions} hideButton class="diary-dash-row__menu">
        <button
          type="button"
          class="diary-dash-row__open"
          classList={{ 'diary-dash-row__open--alert': props.patient.summary.openAlerts > 0 }}
          onClick={() => (status() === 'pending' ? props.onAccept() : props.onOpen())}
        >
          <span class="diary-dash-row__avatar" aria-hidden="true">
            {props.patient.replica.profile?.emoji ?? '🙂'}
            <Show when={isOnline(props.patient.summary)}>
              <span class="diary-dash-row__online" />
            </Show>
          </span>
          <span class="diary-dash-row__text">
            <Show when={isOnline(props.patient.summary)}>
              <span class="visually-hidden">В сети.</span>
            </Show>
            <span class="diary-dash-row__name">
              {props.patient.replica.profile?.label ??
                (status() === 'pending' ? 'Приглашение к пациенту' : 'Пациент')}
            </span>
            <span class="diary-dash-row__meta">
              {status() === 'pending'
                ? 'Нажмите, чтобы принять'
                : status() === 'withdrawn'
                  ? 'Согласие отозвано'
                  : `${relative(lastPatientEntry(props.patient) || null)} · за 7 дней ${percent(week()?.share)}${
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
      </AppContextMenu>
    </li>
  );
}

/**
 * «Дневники пациентов»: the doctor's connected diaries. Sign-in, the list with urgent marks on
 * top, and one patient's page. Everything is decrypted on this device (ADR-0026).
 */
export function DiaryDashboard(props: {
  readonly patientId: string | undefined;
  /** The patient view to edit, or one day as the patient saw it. */
  readonly view?: 'screen' | 'day' | undefined;
  readonly day?: string | undefined;
  readonly onBack: () => void;
  readonly onOpenPatient: (id: string, sub?: 'screen' | `day/${string}`) => void;
  readonly onList: () => void;
}): JSX.Element {
  const [session, setSession] = createSignal<DoctorSession | undefined>();
  const [workspace, setWorkspace] = createSignal<DoctorDiaries | undefined>();
  const [version, setVersion] = createSignal(0);
  const [error, setError] = createSignal('');
  const [pushState, setPushState] = createSignal<'off' | 'on' | 'unsupported' | 'denied'>('off');
  const [demo, setDemo] = createSignal('');
  const [order, setOrder] = createSignal<PatientOrder>(readOrder());
  const [showArchive, setShowArchive] = createSignal(false);
  const [leaving, setLeaving] = createSignal(false);
  /** Archived patients waiting for «Удалить» to be confirmed. */
  const [deleting, setDeleting] = createSignal<readonly DoctorPatient[]>([]);
  const [pushHelp, setPushHelp] = createSignal(false);
  const chooseOrder = (next: PatientOrder): void => {
    setOrder(next);
    try {
      window.localStorage.setItem(ORDER_KEY, next);
    } catch (cause) {
      console.warn('Порядок списка не сохранён', cause);
    }
  };
  const [shownAlert, setShownAlert] = createSignal<DiaryAlert>();
  const [focusDay, setFocusDay] = createSignal<string>();

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
    // Allowed on an earlier visit: re-send the subscription with its payload keys, no prompt.
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      void enableDoctorPush(next).then(setPushState, (cause: unknown) => {
        console.warn('Дневники: подписка на уведомления не обновлена', cause);
      });
    }
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
  const adding = (): boolean => props.patientId === NEW_PATIENT_ROUTE;

  const addDemo = (diaries: DoctorDiaries): void => {
    setError('');
    setDemo('Готовим демо-пациентов…');
    seedDemoPatients(diaries, { onProgress: setDemo })
      .then(() => playFeedback(...FEEDBACK_MOMENTS.saved))
      .catch((cause: unknown) => {
        playFeedback(...FEEDBACK_MOMENTS.failed);
        setError(cause instanceof Error ? cause.message : 'Не удалось добавить демо-пациентов.');
      })
      .finally(() => setDemo(''));
  };
  const hasDemo = (): boolean =>
    patients().some((patient) => patient.replica.profile?.label.startsWith(DEMO_LABEL_PREFIX));

  const leave = (current: DoctorSession): void => {
    void signOut(current).finally(() => {
      workspace()?.disconnect();
      setWorkspace(undefined);
      setSession(undefined);
    });
  };

  const actions = createMemo((): readonly HeaderAction[] | undefined => {
    const current = session();
    const diaries = workspace();
    if (!current || !diaries) return undefined;
    const push = pushState();
    return [
      {
        id: 'new',
        label: 'Новый пациент',
        icon: 'plus',
        priority: 1,
        onSelect: () => props.onOpenPatient(NEW_PATIENT_ROUTE),
      },
      ...(push === 'on'
        ? []
        : [
            {
              id: 'push',
              label: push === 'off' ? 'Уведомлять о срочном' : 'Уведомления выключены',
              icon: 'vibrate' as const,
              priority: 3 as const,
              menuOnly: true,
              onSelect: () => {
                if (push !== 'off') {
                  setPushHelp(true);
                  return;
                }
                void enableDoctorPush(current).then((next) => {
                  setPushState(next);
                  if (next !== 'on') setPushHelp(true);
                });
              },
            },
          ]),
      {
        id: 'demo',
        label: 'Добавить демо-пациентов',
        icon: 'users',
        priority: 3,
        menuOnly: true,
        disabled: Boolean(demo()) || hasDemo(),
        onSelect: () => addDemo(diaries),
      },
      {
        id: 'out',
        label: `Выйти · ${current.doctor.name}`,
        icon: 'arrow-square-out',
        priority: 3,
        menuOnly: true,
        danger: true,
        onSelect: () => setLeaving(true),
      },
    ];
  });

  const listed = createMemo(() => {
    const all = orderPatients(patients(), order());
    return {
      active: all.filter((patient) => !patient.replica.profile?.archived),
      archived: all.filter((patient) => patient.replica.profile?.archived),
    };
  });

  const archive = (patient: DoctorPatient, archived: boolean): void => {
    const profile = patient.replica.profile;
    if (!profile) return;
    const { archived: _was, ...rest } = profile;
    workspace()
      ?.writeProfile(patient.summary.id, archived ? { ...rest, archived: true } : rest)
      .then(() => playFeedback(...FEEDBACK_MOMENTS.saved))
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : 'Не удалось изменить архив.'),
      );
  };

  /** Archived patients this doctor owns: only the owner can delete a diary. */
  const deletable = createMemo(() =>
    listed().archived.filter((patient) => patient.summary.role === 'owner'),
  );

  const remove = async (doomed: readonly DoctorPatient[]): Promise<void> => {
    setDeleting([]);
    const diaries = workspace();
    if (!diaries) return;
    try {
      for (const patient of doomed) await diaries.removePatient(patient.summary.id);
      playFeedback(...FEEDBACK_MOMENTS.saved);
    } catch (cause) {
      playFeedback(...FEEDBACK_MOMENTS.failed);
      setError(cause instanceof Error ? cause.message : 'Не удалось удалить.');
    }
  };

  const row = (patient: DoctorPatient): JSX.Element => {
    const id = patient.summary.id;
    const phone = patient.replica.profile?.phone;
    const archived = patient.replica.profile?.archived === true;
    return (
      <PatientRow
        patient={patient}
        onOpen={() => props.onOpenPatient(id)}
        onAccept={() => {
          void workspace()
            ?.accept(id)
            .then(() => props.onOpenPatient(id))
            .catch((cause: unknown) =>
              setError(cause instanceof Error ? cause.message : 'Не удалось принять.'),
            );
        }}
        actions={[
          {
            id: 'open',
            label: 'Открыть',
            icon: 'arrow-right',
            onSelect: () => props.onOpenPatient(id),
          },
          ...(patient.summary.role !== 'reader' && patient.replica.invitation
            ? [
                {
                  id: 'screen',
                  label: 'Экран пациента',
                  icon: 'browsers' as const,
                  onSelect: () => props.onOpenPatient(id, 'screen'),
                },
              ]
            : []),
          ...(phone
            ? [
                {
                  id: 'call',
                  label: 'Позвонить',
                  icon: 'phone' as const,
                  onSelect: () => window.location.assign(telHref(phone)),
                },
              ]
            : []),
          ...(patient.replica.profile && patient.summary.role !== 'reader'
            ? [
                {
                  id: 'archive',
                  label: archived ? 'Вернуть из архива' : 'В архив',
                  icon: 'archive' as const,
                  onSelect: () => archive(patient, !archived),
                },
              ]
            : []),
          ...(archived && patient.summary.role === 'owner'
            ? [
                {
                  id: 'delete',
                  label: 'Удалить',
                  icon: 'trash' as const,
                  danger: true,
                  onSelect: () => setDeleting([patient]),
                },
              ]
            : []),
        ]}
      />
    );
  };

  const label = (patientId: string): string => {
    const patient = workspace()?.patient(patientId);
    return `${patient?.replica.profile?.emoji ?? ''} ${patient?.replica.profile?.label ?? 'Пациент'}`.trim();
  };

  return (
    <section
      class="diary-dash"
      classList={{ 'diary-dash--garden': Boolean(session()) && !props.patientId }}
      aria-label="Дневники пациентов"
    >
      <Show when={session() && !props.patientId}>
        <div class="diary-dash__garden" aria-hidden="true">
          <SignInGarden />
        </div>
      </Show>
      <Show when={session() && !props.patientId}>
        <FloatingActionButton
          label="Новый пациент"
          onClick={() => props.onOpenPatient(NEW_PATIENT_ROUTE)}
        />
      </Show>
      <Show when={session()}>
        {(current) => (
          <ConfirmationDialog
            open={leaving()}
            title="Выйти из дневников?"
            description={
              <p>
                Ключи на этом устройстве закроются. Войти снова можно паролем или кодом
                восстановления.
              </p>
            }
            confirmLabel="Выйти"
            danger
            onConfirm={() => {
              setLeaving(false);
              leave(current());
            }}
            onOpenChange={setLeaving}
          />
        )}
      </Show>
      <ConfirmationDialog
        open={deleting().length > 0}
        title={
          deleting().length === 1
            ? `Удалить «${label(deleting()[0]?.summary.id ?? '')}»?`
            : `Удалить ${deleting().length} ${pluralize(deleting().length, 'пациента', 'пациентов', 'пациентов')}?`
        }
        description={
          <p>
            Дневник и все записи удалятся с сервера, у пациента он перестанет обновляться. Вернуть
            не получится.
          </p>
        }
        confirmLabel="Удалить"
        danger
        onConfirm={() => void remove(deleting())}
        onOpenChange={(open) => {
          if (!open) setDeleting([]);
        }}
      />
      <Show when={pushHelp() && session()}>
        {(current) => (
          <PushHelpDialog
            session={current()}
            state={pushState()}
            onState={setPushState}
            onClose={() => setPushHelp(false)}
          />
        )}
      </Show>
      <Show when={shownAlert() && workspace()}>
        {(diaries) => (
          <AlertDialog
            workspace={diaries()}
            alert={shownAlert() as DiaryAlert}
            onOpenDay={(day) => {
              const alert = shownAlert();
              setFocusDay(day);
              // Navigate from inside the sheet: the new page takes the layer's place in history.
              if (alert) props.onOpenPatient(alert.patientId);
              setShownAlert(undefined);
            }}
            onClose={() => setShownAlert(undefined)}
          />
        )}
      </Show>
      <Show when={adding() ? workspace() : undefined}>
        {(diaries) => (
          <NewPatientScreen
            workspace={diaries()}
            onBack={props.onList}
            onCreated={(id) => props.onOpenPatient(id)}
          />
        )}
      </Show>
      <Show when={props.patientId ? current() : undefined}>
        {(patient) => (
          <Show when={workspace()}>
            {(diaries) => (
              <Switch
                fallback={
                  <DiaryPatientPage
                    workspace={diaries()}
                    patient={patient()}
                    version={version()}
                    onBack={props.onList}
                    onOpen={(sub) => props.onOpenPatient(patient().summary.id, sub)}
                    initialDay={focusDay()}
                  />
                }
              >
                <Match when={props.view === 'screen' && replicaResults(patient().replica)}>
                  {(ready) => (
                    <PatientScreenPage
                      workspace={diaries()}
                      patient={patient()}
                      invitation={ready().invitation}
                      onClose={() => navigateBack(diariesPath(patient().summary.id))}
                    />
                  )}
                </Match>
                <Match when={props.view === 'day' && props.day}>
                  {(day) => (
                    <PatientDayView
                      workspace={diaries()}
                      patient={patient()}
                      version={version()}
                      day={day()}
                      onBack={() => navigateBack(diariesPath(patient().summary.id))}
                    />
                  )}
                </Match>
              </Switch>
            )}
          </Show>
        )}
      </Show>
      <Show when={!(props.patientId && current()) && !(adding() && workspace())}>
        <Page
          class="diary-dash__header"
          navigation={
            // In the diaries-only app there is nowhere to go back to.
            activeProfile() ? undefined : (
              <NavBack class="knowledge-back-button" aria-label="Назад" onClick={props.onBack} />
            )
          }
          // Signed out, the centred sign-in card carries the page; the header keeps only its tools.
          title={session() ? <Heading depth={1}>Дневники пациентов</Heading> : undefined}
          description={
            session() && patients().length
              ? `${patients().length} ${pluralize(patients().length, 'пациент', 'пациента', 'пациентов')}${
                  alerts().length ? ` · срочных: ${alerts().length}` : ''
                }`
              : undefined
          }
          headerActions={actions()}
          help={
            <>
              <p>
                Пациент заполняет дневник на своём телефоне — записи приходят сюда сами, вживую.
                Экран пациента вы собираете из разделов: лекарства со временем приёма и сроком
                курса, самочувствие, давление и пульс, описание, выбор, опросники.
              </p>
              <p>
                Всё шифруется на устройствах: сервер хранит только шифр, прочитать его можете вы и
                подключённые кураторы. Срочные отметки (например, мысли о самоповреждении в PHQ-9)
                поднимаются наверх и приходят уведомлением.
              </p>
              <p>«⋯» — уведомления, демо-пациенты и выход.</p>
            </>
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
              <Show when={demo()}>
                <p class="diary-dash__quiet" role="status">
                  {demo()}
                </p>
              </Show>
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
                          onClick={() => setShownAlert(alert)}
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
                      <Heading depth={2} class="diary-dash__empty-title">
                        Первый пациент — пара минут
                      </Heading>
                      <p class="diary-dash__empty-text">
                        Соберите экран дневника: лекарства, самочувствие, опросники. Затем покажите
                        пациенту QR-код — его телефон подключится, и записи начнут приходить сюда.
                      </p>
                      <div class="diary-dash__empty-actions">
                        <Button
                          variant="primary"
                          onClick={() => props.onOpenPatient(NEW_PATIENT_ROUTE)}
                        >
                          Новый пациент
                        </Button>
                        <Show when={workspace()}>
                          {(diaries) => (
                            <Button disabled={Boolean(demo())} onClick={() => addDemo(diaries())}>
                              Посмотреть на демо
                            </Button>
                          )}
                        </Show>
                      </div>
                    </div>
                  }
                >
                  <div class="diary-dash__order-row">
                    <AppGlyph name="arrows-down-up" class="diary-dash__order-glyph" />
                    <SegmentedControl
                      label="Порядок"
                      class="diary-dash__order"
                      value={order()}
                      options={(['patient', 'doctor', 'name'] as const).map((value) => ({
                        value,
                        label: PATIENT_ORDER_LABEL[value],
                      }))}
                      onChange={chooseOrder}
                    />
                  </div>
                  <ul class="diary-dash-list">
                    <For each={listed().active}>{(patient) => row(patient)}</For>
                  </ul>
                  <Show when={listed().archived.length}>
                    <button
                      type="button"
                      class="diary-dash__archive-toggle"
                      aria-expanded={showArchive()}
                      onClick={() => setShowArchive(!showArchive())}
                    >
                      <AppGlyph name="archive" class="diary-dash__glyph" />
                      Архив · {listed().archived.length}
                      <AppGlyph
                        name={showArchive() ? 'caret-up' : 'caret-down'}
                        class="diary-dash__glyph"
                      />
                    </button>
                    <Show when={showArchive()}>
                      <ul class="diary-dash-list diary-dash-list--archive">
                        <For each={listed().archived}>{(patient) => row(patient)}</For>
                      </ul>
                      <Show when={deletable().length}>
                        <Button
                          variant="quiet"
                          class="diary-dash__archive-clear"
                          icon={<AppGlyph name="trash" />}
                          onClick={() => setDeleting(deletable())}
                        >
                          {deletable().length === 1 ? 'Удалить' : 'Удалить все'}
                        </Button>
                      </Show>
                    </Show>
                  </Show>
                </Show>
              </Show>
            </>
          )}
        </Show>
      </Show>
    </section>
  );
}
