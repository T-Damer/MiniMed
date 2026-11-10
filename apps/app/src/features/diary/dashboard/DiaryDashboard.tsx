import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  Match,
  on,
  onCleanup,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import { PAGE_HEROES } from '@/app/page-heroes';
import { navigateWithMotion } from '@/app/route-motion';
import { AppContextMenu, type AppContextMenuAction } from '@/components/AppContextMenu';
import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { ConfirmationDialog } from '@/components/ConfirmationDialog';
import { createDebouncer } from '@/components/debounced-value';
import { EmptyState } from '@/components/EmptyState';
import type { HeaderAction } from '@/components/HeaderActions';
import { NavBack } from '@/components/NavBack';
import { OverlayDialog } from '@/components/OverlayDialog';
import { Page } from '@/components/Page';
import { PatientRowsSkeleton } from '@/components/PatientRowsSkeleton';
import { Heading } from '@/components/Text';
import { pluralize } from '@/diary/diary-format';
import { InstallCard } from '@/diary/InstallWarning';
import { replicaResults } from '@/features/diary/connected/diary-replica';
import { isDemoSession } from '@/features/diary/connected/doctor-account';
import type { DoctorDiaries, DoctorPatient } from '@/features/diary/connected/doctor-workspace';
import { CuratorStack } from '@/features/diary/dashboard/CuratorStack';
import { DiaryPatientPage } from '@/features/diary/dashboard/DiaryPatientPage';
import { DoctorSignIn } from '@/features/diary/dashboard/DoctorSignIn';
import { DEMO_LABEL_PREFIX, hasDemoSet } from '@/features/diary/dashboard/demo-patients';
import { adherence } from '@/features/diary/dashboard/diary-insights';
import { enableDoctorPush } from '@/features/diary/dashboard/doctor-push';
import {
  addDemoPatients,
  demoProgress,
  doctorIsAdmin,
  doctorLoadError,
  doctorPushState,
  doctorRestored,
  doctorSession,
  doctorVersion,
  doctorWorkspace,
  leaveDoctor,
  restoreDoctor,
  setDoctorPushState,
  startDoctor,
} from '@/features/diary/dashboard/doctor-store';
import { sessionGreetingLine } from '@/features/diary/dashboard/greetings';
import { HeaderCounters } from '@/features/diary/dashboard/HeaderCounters';
import { NEW_PATIENT_ROUTE, NewPatientScreen } from '@/features/diary/dashboard/NewPatientScreen';
import { NewPatientShelf } from '@/features/diary/dashboard/NewPatientShelf';
import {
  discardNewPatientDraft,
  loadNewPatientDrafts,
  newPatientDrafts,
} from '@/features/diary/dashboard/new-patient-drafts';
import { OnlineTag } from '@/features/diary/dashboard/OnlineTag';
import { PairingView } from '@/features/diary/dashboard/PairingView';
import { PatientAssignmentPage } from '@/features/diary/dashboard/PatientAssignmentPage';
import { PatientChartsPage } from '@/features/diary/dashboard/PatientChartsPage';
import { PatientDayView } from '@/features/diary/dashboard/PatientDayView';
import { PatientListTools } from '@/features/diary/dashboard/PatientListTools';
import { PatientScreenPage } from '@/features/diary/dashboard/PatientScreenPage';
import { PushHelpDialog } from '@/features/diary/dashboard/PushHelpDialog';
import { telHref } from '@/features/diary/dashboard/patient-contact';
import {
  changedByColleague,
  matchesFilter,
  matchesQuery,
  type PatientFilter,
  patientCounters,
} from '@/features/diary/dashboard/patient-list';
import {
  lastPatientEntry,
  orderPatients,
  type PatientOrder,
} from '@/features/diary/dashboard/patient-order';
import { markSeen, stampFirstSight } from '@/features/diary/dashboard/patient-seen';
import { isOnline } from '@/features/diary/dashboard/presence';
import {
  SERVICE_OVERVIEW_ROUTE,
  ServiceOverviewPage,
} from '@/features/diary/dashboard/ServiceOverviewPage';
import { SignInGarden } from '@/features/diary/dashboard/SignInGarden';
import { type DiarySub, diariesPath } from '@/features/notes/notes-routing';
import { navigateBack } from '@/state/app-back';
import { FEEDBACK_MOMENTS, playFeedback } from '@/state/ui-feedback';
import '@/features/diary/dashboard/diary-dashboard.css';
import '@/features/diary/dashboard/diary-list.css';
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
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
  });
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
  /** The doctors who curate this patient show as avatars (their members are read when near). */
  readonly workspace: DoctorDiaries;
  /** A colleague changed the plan since the doctor last opened this patient. */
  readonly colleagueChanged: boolean;
}): JSX.Element {
  const results = () => replicaResults(props.patient.replica);
  const week = () => {
    const current = results();
    return current ? adherence(current.invitation, current.entries, 7) : undefined;
  };
  const status = () => props.patient.summary.status;
  return (
    <li class="diary-dash-row" data-patient-id={props.patient.summary.id}>
      <AppContextMenu actions={props.actions} hideButton class="diary-dash-row__menu">
        <button
          type="button"
          class="diary-dash-row__open"
          classList={{
            'diary-dash-row__open--alert': props.patient.summary.openAlerts > 0,
          }}
          onClick={() => (status() === 'pending' ? props.onAccept() : props.onOpen())}
        >
          <span class="diary-dash-row__avatar" aria-hidden="true">
            {props.patient.replica.profile?.emoji ?? '🙂'}
            <Show when={isOnline(props.patient.summary)}>
              <span class="diary-dash-row__online" />
            </Show>
          </span>
          <span class="diary-dash-row__text">
            <span class="diary-dash-row__title">
              <span class="diary-dash-row__name">
                {props.patient.replica.profile?.label ??
                  (status() === 'pending' ? 'Приглашение к пациенту' : 'Пациент')}
              </span>
              <Show when={isOnline(props.patient.summary)}>
                <OnlineTag class="diary-dash-row__online-tag" />
              </Show>
              <Show when={props.colleagueChanged}>
                <span class="diary-dash-row__changed" data-testid="diary-colleague-changed">
                  <span class="diary-dash-row__changed-dot" aria-hidden="true" />
                  изменил(а) коллега
                </span>
              </Show>
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
          <CuratorStack workspace={props.workspace} patientId={props.patient.summary.id} />
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
  /** The patient view to edit, one day as the patient saw it, or the patient's charts. */
  readonly view?: 'screen' | 'day' | 'charts' | 'task' | undefined;
  readonly day?: string | undefined;
  /** The chart the charts page opens at. */
  readonly chart?: string | undefined;
  /** The assigned worksheet the task page shows (CBT1). */
  readonly task?: string | undefined;
  readonly onBack: () => void;
  readonly onOpenPatient: (id: string, sub?: DiarySub) => void;
  /** The new patient's page in place of «Новый пациент», so back returns to the list. */
  readonly onReplacePatient: (id: string) => void;
  /** «Новый пациент» continued from this draft (`new-patient-drafts.ts`). */
  readonly draft?: string | undefined;
  /** The empty form became a draft: the address takes its id, in place. */
  readonly onDraft: (id: string) => void;
  /** A draft card in the list: «Новый пациент» where the doctor left it. */
  readonly onOpenDraft: (id: string) => void;
  readonly onList: () => void;
}): JSX.Element {
  // The session, the workspace and its patients outlive this component (doctor-store.ts): a tab
  // switch unmounts the dashboard, and coming back finds the list as it was left.
  const session = doctorSession;
  const workspace = doctorWorkspace;
  const version = doctorVersion;
  const restored = doctorRestored;
  const pushState = doctorPushState;
  const isAdmin = doctorIsAdmin;
  const demo = demoProgress;
  const [error, setError] = createSignal('');
  const [order, setOrder] = createSignal<PatientOrder>(readOrder());
  const [showArchive, setShowArchive] = createSignal(false);
  const [leaving, setLeaving] = createSignal(false);
  /** Archived patients waiting for «Удалить» to be confirmed. */
  const [deleting, setDeleting] = createSignal<readonly DoctorPatient[]>([]);
  const [pushHelp, setPushHelp] = createSignal(false);
  /** The patient whose pairing code and link are shown again (a lost page, another device). */
  const [pairing, setPairing] = createSignal<string>();
  // Taps that change the screen answer at once: the page on screen starts leaving, and the route
  // changes two frames later (app/route-motion.ts).
  const openPatient = (id: string, sub?: DiarySub): void =>
    navigateWithMotion(() => props.onOpenPatient(id, sub));
  const toList = (): void => navigateWithMotion(props.onList);
  const openDraft = (id: string): void => navigateWithMotion(() => props.onOpenDraft(id));
  const toPatient = (id: string): void => navigateWithMotion(() => navigateBack(diariesPath(id)));
  const chooseOrder = (next: PatientOrder): void => {
    setOrder(next);
    try {
      window.localStorage.setItem(ORDER_KEY, next);
    } catch (cause) {
      console.warn('Порядок списка не сохранён', cause);
    }
  };

  // A list shown from memory is read again quietly; the first visit reads it once, with the sign-in.
  onMount(() => {
    void restoreDoctor();
    workspace()?.refreshQuietly();
  });
  // The new patients begun on this device show at the top of the list once the doctor is in.
  createEffect(() => {
    const current = session();
    if (current) void loadNewPatientDrafts(current);
  });

  /** When the copy on screen was saved, without a network; undefined while live. */
  const offlineSince = (): string | undefined => {
    version();
    return workspace()?.offlineSince();
  };

  const patients = createMemo(() => {
    version();
    return workspace()?.patients() ?? [];
  });
  const current = createMemo(() => {
    version();
    return props.patientId ? workspace()?.patient(props.patientId) : undefined;
  });
  const adding = (): boolean => props.patientId === NEW_PATIENT_ROUTE;
  const overviewing = (): boolean => props.patientId === SERVICE_OVERVIEW_ROUTE;

  const addDemo = (diaries: DoctorDiaries): void => {
    setError('');
    addDemoPatients(diaries);
  };
  /** In the demo account the demo patients stay: no archive, so no delete either. */
  const demoLocked = (patient: DoctorPatient): boolean => {
    const current = session();
    return (
      current !== undefined &&
      isDemoSession(current) &&
      (patient.replica.profile?.label.startsWith(DEMO_LABEL_PREFIX) ?? false)
    );
  };
  const hasDemo = (): boolean =>
    hasDemoSet(patients().map((patient) => patient.replica.profile?.label));

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
        onSelect: () => openPatient(NEW_PATIENT_ROUTE),
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
                  setDoctorPushState(next);
                  if (next !== 'on') setPushHelp(true);
                });
              },
            },
          ]),
      ...(isAdmin()
        ? [
            {
              id: 'service',
              label: 'Обзор сервиса',
              icon: 'chart-line' as const,
              priority: 3 as const,
              menuOnly: true,
              onSelect: () => openPatient(SERVICE_OVERVIEW_ROUTE),
            },
          ]
        : []),
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

  const ordered = createMemo(() => {
    const all = orderPatients(patients(), order());
    return {
      active: all.filter((patient) => !patient.replica.profile?.archived),
      archived: all.filter((patient) => patient.replica.profile?.archived),
    };
  });

  // The search filters as the doctor types (debounced); a header counter filters by one tap.
  const [query, setQuery] = createSignal('');
  const [appliedQuery, setAppliedQuery] = createSignal('');
  const [filter, setFilter] = createSignal<PatientFilter | undefined>();
  const applyQuery = createDebouncer((value: string) => setAppliedQuery(value), 160);
  onCleanup(() => applyQuery.cancel());
  const typeQuery = (value: string): void => {
    setQuery(value);
    if (value.trim() === '') {
      applyQuery.cancel();
      setAppliedQuery('');
      return;
    }
    applyQuery.call(value);
  };
  const toggleFilter = (next: PatientFilter): void => {
    setFilter(filter() === next ? undefined : next);
  };
  const counters = createMemo(() => patientCounters(ordered().active, new Date()));
  const filtering = (): boolean => appliedQuery().trim() !== '' || filter() !== undefined;
  const clearFilters = (): void => {
    applyQuery.cancel();
    setQuery('');
    setAppliedQuery('');
    setFilter(undefined);
  };
  const listed = createMemo(() => {
    const now = new Date();
    const text = appliedQuery();
    const chosen = filter();
    const keep = (patient: DoctorPatient): boolean =>
      matchesQuery(patient, text) && matchesFilter(patient, chosen, now);
    const all = ordered();
    return { active: all.active.filter(keep), archived: all.archived.filter(keep) };
  });

  // What this doctor has seen: a colleague's plan change after it is marked on the row.
  const doctorId = (): string => workspace()?.doctorId ?? '';
  const [seenVersion, setSeenVersion] = createSignal(0);
  const seen = createMemo(() => {
    seenVersion();
    const me = doctorId();
    return me
      ? stampFirstSight(
          me,
          patients().map((patient) => patient.summary.id),
        )
      : new Map<string, string>();
  });
  createEffect(() => {
    const id = props.patientId;
    const me = doctorId();
    if (!id || !me || !current()) return;
    markSeen(me, id);
    setSeenVersion((value) => value + 1);
  });

  const sameIds = (left: readonly string[], right: readonly string[]): boolean =>
    left.length === right.length && left.every((id, index) => id === right[index]);
  const activeIds = createMemo(() => listed().active.map((patient) => patient.summary.id), [], {
    equals: sameIds,
  });
  const archivedIds = createMemo(() => listed().archived.map((patient) => patient.summary.id), [], {
    equals: sameIds,
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
    ordered().archived.filter((patient) => patient.summary.role === 'owner'),
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

  /** What the doctor can do with a patient (long press or right click on its row). */
  const rowActions = (patient: DoctorPatient): readonly AppContextMenuAction[] => {
    const id = patient.summary.id;
    const phone = patient.replica.profile?.phone;
    const archived = patient.replica.profile?.archived === true;
    return [
      {
        id: 'open',
        label: 'Открыть',
        icon: 'arrow-right',
        onSelect: () => openPatient(id),
      },
      ...(patient.summary.role !== 'reader' && patient.replica.invitation
        ? [
            {
              id: 'screen',
              label: 'Редактировать',
              icon: 'edit' as const,
              onSelect: () => openPatient(id, 'screen'),
            },
          ]
        : []),
      ...(patient.summary.role !== 'reader' && patient.replica.invitation
        ? [
            {
              id: 'pair',
              label: 'QR-код и ссылка для пациента',
              icon: 'qr-code' as const,
              onSelect: () => setPairing(id),
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
      ...(patient.replica.profile && patient.summary.role !== 'reader' && !demoLocked(patient)
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
    ];
  };

  /**
   * A row is made once per patient id and follows the patient it shows: a patient read again is a
   * new object, and a row keyed by it would be built anew (its mark popping in again) on every live
   * update or quiet refresh.
   */
  const row = (id: string): JSX.Element => {
    const found = createMemo(() => {
      version();
      return workspace()?.patient(id);
    });
    return (
      <Show when={found()}>
        {(patient) => (
          <Show when={workspace()}>
            {(diaries) => (
              <PatientRow
                patient={patient()}
                workspace={diaries()}
                colleagueChanged={
                  changedByColleague(patient(), doctorId(), seen().get(id)) !== undefined
                }
                onOpen={() => openPatient(id)}
                onAccept={() => {
                  void diaries()
                    .accept(id)
                    .then(() => props.onOpenPatient(id))
                    .catch((cause: unknown) =>
                      setError(cause instanceof Error ? cause.message : 'Не удалось принять.'),
                    );
                }}
                actions={rowActions(patient())}
              />
            )}
          </Show>
        )}
      </Show>
    );
  };

  // A row that appears after the list was built (a search that lets one back in, a new patient)
  // grows in; the list's first build is the page's own entry.
  let listElement: HTMLUListElement | undefined;
  let shownBefore: ReadonlySet<string> | undefined;
  createEffect(
    on(activeIds, (ids) => {
      const before = shownBefore;
      shownBefore = new Set(ids);
      if (!before) return;
      const fresh = ids.filter((id) => !before.has(id));
      if (fresh.length === 0) return;
      requestAnimationFrame(() => {
        fresh.forEach((id, index) => {
          listElement?.querySelector(`[data-patient-id="${id}"]`)?.animate(
            [
              { opacity: 0, transform: 'translateY(0.5rem) scale(0.985)' },
              { opacity: 1, transform: 'none' },
            ],
            {
              duration: 200,
              delay: Math.min(index, 6) * 30,
              easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
              fill: 'backwards',
            },
          );
        });
      });
    }),
  );

  const label = (patientId: string): string => {
    const patient = workspace()?.patient(patientId);
    return `${patient?.replica.profile?.emoji ?? ''} ${patient?.replica.profile?.label ?? 'Пациент'}`.trim();
  };

  return (
    <section
      class="diary-dash"
      classList={{
        'diary-dash--garden': Boolean(session()) && !props.patientId,
        'diary-dash--signed-out': !session(),
      }}
      aria-label="Дневники пациентов"
    >
      <Show when={session() && !props.patientId}>
        <div class="diary-dash__garden" aria-hidden="true">
          <SignInGarden />
        </div>
      </Show>
      <Show when={session()}>
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
          icon="arrow-square-out"
          danger
          onConfirm={() => {
            setLeaving(false);
            leaveDoctor();
          }}
          onOpenChange={setLeaving}
        />
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
            onState={setDoctorPushState}
            onClose={() => setPushHelp(false)}
          />
        )}
      </Show>
      <Show when={pairing() ? workspace() : undefined}>
        {(diaries) => (
          <OverlayDialog
            open
            title="QR-код и ссылка для пациента"
            onClose={() => setPairing(undefined)}
          >
            <PairingView
              workspace={diaries()}
              patientId={pairing() ?? ''}
              onDone={() => setPairing(undefined)}
            />
          </OverlayDialog>
        )}
      </Show>
      <Show when={adding() ? workspace() : undefined}>
        {(diaries) => (
          <NewPatientScreen
            workspace={diaries()}
            draftId={props.draft}
            onDraft={props.onDraft}
            onBack={toList}
            onCreated={(id) => props.onReplacePatient(id)}
          />
        )}
      </Show>
      <Show when={overviewing() && isAdmin() ? session() : undefined}>
        {(signedIn) => <ServiceOverviewPage session={signedIn()} onBack={toList} />}
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
                    onBack={toList}
                    onOpen={(sub) => openPatient(patient().summary.id, sub)}
                  />
                }
              >
                <Match when={props.view === 'screen' && replicaResults(patient().replica)}>
                  {(ready) => (
                    <PatientScreenPage
                      workspace={diaries()}
                      patient={patient()}
                      invitation={ready().invitation}
                      onClose={() => toPatient(patient().summary.id)}
                    />
                  )}
                </Match>
                <Match when={props.view === 'charts' && replicaResults(patient().replica)}>
                  {(ready) => (
                    <PatientChartsPage
                      workspace={diaries()}
                      patient={patient()}
                      results={ready()}
                      version={version()}
                      focus={props.chart}
                      onBack={() => toPatient(patient().summary.id)}
                      onFill={(day) => openPatient(patient().summary.id, `day/${day}`)}
                    />
                  )}
                </Match>
                <Match
                  when={
                    props.view === 'task' && props.task
                      ? replicaResults(patient().replica)
                      : undefined
                  }
                >
                  {(ready) => (
                    <PatientAssignmentPage
                      results={ready()}
                      assignmentId={props.task ?? ''}
                      patientLabel={patient().replica.profile?.label ?? ''}
                      onBack={() => toPatient(patient().summary.id)}
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
                      onBack={() => toPatient(patient().summary.id)}
                    />
                  )}
                </Match>
              </Switch>
            )}
          </Show>
        )}
      </Show>
      <Show
        when={
          !(props.patientId && current()) &&
          !(adding() && workspace()) &&
          !(overviewing() && isAdmin())
        }
      >
        {/* Signed out, the sign-in is the whole screen: no header, no bottom bar (owner 2026-10-30). */}
        <Show when={session()}>
          <Page
            hero={PAGE_HEROES.patients}
            class="diary-dash__header"
            navigation={
              // In the diaries-only app there is nowhere to go back to.
              activeProfile() ? undefined : (
                <NavBack class="knowledge-back-button" aria-label="Назад" onClick={props.onBack} />
              )
            }
            title={
              <Heading depth={1} class="diary-dash__title">
                <img
                  class="diary-dash__logo"
                  src={`${import.meta.env.BASE_URL}diaries/logo.svg`}
                  alt=""
                  width="40"
                  height="40"
                />
                Сигнум
              </Heading>
            }
            description={session() ? sessionGreetingLine() : undefined}
            room={
              session() && ordered().active.length > 0 ? (
                <HeaderCounters counters={counters()} active={filter()} onToggle={toggleFilter} />
              ) : undefined
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
        </Show>
        <Show
          when={session()}
          fallback={
            <Show
              when={restored()}
              fallback={
                <PatientRowsSkeleton label="Загружаем дневники" testId="patient-list-skeleton" />
              }
            >
              <DoctorSignIn
                onSignedIn={(next) => {
                  startDoctor(next);
                }}
                // In the diaries-only app there is nowhere to go back to.
                onBack={activeProfile() ? undefined : props.onBack}
              />
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
              <Show when={offlineSince()}>
                {(since) => (
                  <p class="diary-dash__quiet" role="status" data-testid="diary-offline">
                    Нет связи с сервером: показана копия от{' '}
                    {new Date(since()).toLocaleString('ru-RU', {
                      day: 'numeric',
                      month: 'long',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    . Обновится сама, когда связь вернётся.
                  </p>
                )}
              </Show>
              {/* The doctor keeps the diaries one tap away too: an app, not a site (owner 2026-11-03). */}
              <Show when={activeProfile()}>
                <InstallCard
                  title="Установите «Сигнум» как приложение"
                  text="Откроется одним нажатием, как программа, работает без сети и сообщит о срочной отметке."
                  icon={`${import.meta.env.BASE_URL}diaries/logo.svg`}
                />
              </Show>
              <Show when={error() || doctorLoadError()}>
                <p class="diary-dash__error" role="alert">
                  {error() || doctorLoadError()}
                </p>
              </Show>
              {/* Alerts show as «!» on their rows and in full on the patient's page (owner 2026-10-30). */}
              <Show
                when={workspace()?.isLoaded() || version() > 0}
                fallback={
                  <PatientRowsSkeleton label="Загружаем дневники" testId="patient-list-skeleton" />
                }
              >
                {/* «Создать пациента» stays above the list, however long (owner 2026-11-05). */}
                <NewPatientShelf
                  drafts={newPatientDrafts()}
                  onCreate={() => openPatient(NEW_PATIENT_ROUTE)}
                  onOpen={openDraft}
                  onDiscard={(id) => {
                    const current = session();
                    if (current) discardNewPatientDraft(current, id);
                  }}
                />
                <Show
                  when={patients().length}
                  fallback={
                    <EmptyState
                      glyph="users"
                      title="Первый пациент — пара минут"
                      text="Соберите экран дневника и покажите пациенту QR-код."
                      data-testid="diary-empty"
                      actions={
                        <Show when={workspace()}>
                          {(diaries) => (
                            <Button disabled={Boolean(demo())} onClick={() => addDemo(diaries())}>
                              Посмотреть на демо
                            </Button>
                          )}
                        </Show>
                      }
                    />
                  }
                >
                  <PatientListTools
                    query={query()}
                    onQuery={typeQuery}
                    placeholder={`Поиск среди ${ordered().active.length} ${pluralize(ordered().active.length, 'пациента', 'пациентов', 'пациентов')}`}
                    order={order()}
                    onOrder={chooseOrder}
                  />
                  <ul
                    class="diary-dash-list"
                    ref={(element) => {
                      listElement = element;
                    }}
                  >
                    <For each={activeIds()}>{(id) => row(id)}</For>
                  </ul>
                  <Show
                    when={
                      filtering() && listed().active.length === 0 && listed().archived.length === 0
                    }
                  >
                    <div role="status">
                      <EmptyState
                        class="diary-dash__nothing"
                        glyph="search"
                        title="Никого не нашли"
                        text={
                          appliedQuery().trim()
                            ? 'Проверьте, как записано имя: ищем по каждому слову.'
                            : 'Под этот фильтр сейчас никто не подходит.'
                        }
                        actions={
                          <Button
                            variant="secondary"
                            icon={<AppGlyph name="users" class="diary-dash__glyph" />}
                            onClick={clearFilters}
                          >
                            Показать всех
                          </Button>
                        }
                      />
                    </div>
                  </Show>
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
                        <For each={archivedIds()}>{(id) => row(id)}</For>
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
