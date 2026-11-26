import {
  createEffect,
  createMemo,
  createSignal,
  type JSX,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import { PAGE_HEROES } from '@/app/page-heroes';
import { AppGlyph } from '@/components/AppGlyph';
import type { HeaderAction } from '@/components/HeaderActions';
import { CompanionIdentity, createCompanionSession } from '@/diary/CompanionChat';
import { CarerNameSheet, DiaryAccess } from '@/diary/DiaryAccess';
import { DiaryEntryForm } from '@/diary/DiaryEntryForm';
import { DiaryHome, type SavedEntry } from '@/diary/DiaryHome';
import { DiaryHelp, DiaryMore } from '@/diary/DiaryMore';
import { DiaryRecords } from '@/diary/DiaryRecords';
import { DiarySend } from '@/diary/DiarySend';
import { DiarySheet } from '@/diary/DiarySheet';
import { DiaryToday } from '@/diary/DiaryToday';
import { whenLabel } from '@/diary/diary-home';
import { ScreenHeader } from '@/diary/diary-ui';
import { InstallWarning } from '@/diary/InstallWarning';
import { StudyConsentCard, StudyConsentSheet } from '@/diary/StudyConsent';
import { syncNeedsAction, syncWords } from '@/diary/sync-words';
import { withMedHistory } from '@/features/diary/diary-med-history';
import '@/diary/carer.css';
import { markAuthor, markLine } from '@/features/diary/connected/carer';
import type { DiaryChatMessage } from '@/features/diary/connected/diary-chat';
import type { MediaOffer } from '@/features/diary/connected/media-signaling';
import {
  isConnectedDiary,
  PatientConnection,
  type ReminderSettings,
  type SyncStatus,
} from '@/features/diary/connected/patient-connection';
import {
  acceptedAll,
  acceptedAt,
  diaryOperator,
  joiningDocuments,
} from '@/features/diary/consent/joining-documents';
import { studyAnswer, studyConsentStatus } from '@/features/diary/consent/study-consent';
import { dayKey } from '@/features/diary/diary-care';
import { diaryToFhirBundle } from '@/features/diary/diary-fhir';
import { markAllSent, shareStatus } from '@/features/diary/diary-merge';
import {
  type DiaryEntry,
  type DiaryInvitation,
  type DiaryResults,
  isCareDiary,
  parseDiaryEntry,
} from '@/features/diary/diary-model';
import { diaryPrintHtml, printHtmlInFrame } from '@/features/diary/diary-print';
import {
  type DiaryOpenResult,
  type DiaryStore,
  withEntry,
  withoutEntry,
} from '@/features/diary/diary-storage';

const SYNC_DELAY_MS = 800;
const SYNC_INTERVAL_MS = 60_000;

/** The steps of one diary. «home» is the page the patient lands on; the others are one tap away. */
export type DiaryScreen =
  | 'home'
  | 'plan'
  | 'calendar'
  | 'entry'
  | 'records'
  | 'send'
  | 'more'
  | 'companion';

const SCREENS: readonly DiaryScreen[] = [
  'home',
  'plan',
  'calendar',
  'entry',
  'records',
  'send',
  'more',
  'companion',
];
const HISTORY_KEY = 'diaryScreen';
const NESTED_PARENT_KEY = 'diaryNestedParent';

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

function downloadFhir(results: DiaryResults): void {
  const blob = new Blob([JSON.stringify(diaryToFhirBundle(results), null, 2)], {
    type: 'application/fhir+json',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `дневник-${results.invitation.id}.fhir.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Asks the browser to keep the diary through low-storage cleanups; harmless when refused. */
function requestPersistentStorage(): void {
  void navigator.storage?.persist?.().catch(() => false);
}

function screenFromHistory(fallback: DiaryScreen = 'home'): DiaryScreen {
  const state = window.history.state as Record<string, unknown> | null;
  const value = state?.[HISTORY_KEY];
  return SCREENS.find((screen) => screen === value) ?? fallback;
}

function EntryPage(props: {
  readonly invitation: DiaryInvitation;
  readonly entry: DiaryEntry | undefined;
  readonly backLabel: string;
  readonly onSave: (value: Record<string, unknown>) => string | undefined;
  readonly onLeave: () => void;
}): JSX.Element {
  const subtitle = (): string =>
    props.entry
      ? `${props.invitation.title}. Запись от ${whenLabel(props.entry.at, new Date())}`
      : props.invitation.title;
  return (
    <main class="diary-page diary-page--entry">
      <ScreenHeader
        title={props.entry ? 'Изменить запись' : 'Новая запись'}
        subtitle={subtitle()}
        backLabel={props.backLabel}
        onBack={props.onLeave}
      />
      <DiaryEntryForm
        invitation={props.invitation}
        entry={props.entry}
        onSave={props.onSave}
        onCancel={props.onLeave}
      />
    </main>
  );
}

/**
 * One diary: the home page and the steps behind it. Each step is its own page with a way back, and
 * the browser's Back button (the one an Android phone has at the bottom) returns from a step to the
 * home instead of leaving the diary.
 */
export function DiaryView(props: {
  readonly store: DiaryStore;
  readonly initial: DiaryResults;
  /** The step to open first (the buttons on a diary card in the list). */
  readonly initialScreen?: DiaryScreen | undefined;
  /** What happened when the link was opened (a new diary, an update, an older link…). */
  readonly notice?: string | undefined;
  /** The patient has more than one diary, so «Мои дневники» is worth a button on the home. */
  readonly hasOtherDiaries: boolean;
  readonly onBack: () => void;
  readonly onOpened: (opened: DiaryOpenResult) => void;
}): JSX.Element {
  const companionSession = createCompanionSession(props.initial.invitation.id);
  const [mediaOffer, setMediaOffer] = createSignal<MediaOffer>();
  const [doctorMessages, setDoctorMessages] = createSignal<readonly DiaryChatMessage[]>([]);
  const [results, setResults] = createSignal<DiaryResults>(props.initial);
  const [sent, setSent] = createSignal(props.store.meta(props.initial.invitation.id).sent);
  const [meta, setMeta] = createSignal(props.store.meta(props.initial.invitation.id));
  const chatPlanChanges = createMemo(() => {
    const { chatPlanChanges, planChange } = meta();
    return chatPlanChanges ?? (planChange ? [planChange] : undefined);
  });
  const [error, setError] = createSignal('');
  const [notice, setNotice] = createSignal(props.notice);
  const [saved, setSaved] = createSignal<SavedEntry | undefined>(undefined);
  let baseScreen: DiaryScreen = isCareDiary(props.initial.invitation) ? 'plan' : 'home';
  const [screen, setScreen] = createSignal<DiaryScreen>(props.initialScreen ?? baseScreen);
  const [chatPrimary, setChatPrimary] = createSignal(false);
  const [settingsHelp, setSettingsHelp] = createSignal(false);
  const [editing, setEditing] = createSignal<DiaryEntry | undefined>(undefined);
  // Where «Сохранить» and «Отмена» of the entry form return to.
  const [returnTo, setReturnTo] = createSignal<'home' | 'records'>('home');
  const invitation = () => results().invitation;
  // A step was added to the browser's history by this page: going home pops it again.
  let pushed = false;
  let nestedParent: 'plan' | 'more' | undefined;
  let afterNestedBack: DiaryScreen | undefined;

  // Connected diary (ADR-0026): marks go to the doctor by themselves whenever there is a network.
  const [connection, setConnection] = createSignal<PatientConnection | undefined>(undefined);
  const [reminders, setReminders] = createSignal<ReminderSettings | undefined>(undefined);
  const [sync, setSync] = createSignal<SyncStatus | undefined>(
    isConnectedDiary(window.localStorage, props.initial.invitation.id)
      ? { phase: 'syncing', lastSyncAt: undefined, pending: 0 }
      : undefined,
  );
  let syncTimer: number | undefined;
  let stopListening: (() => void) | undefined;
  // Who has the diary may change with any sync (DIARY25): the access list and the marks re-read it.
  const [people, setPeople] = createSignal(0);
  const carer = (): boolean => connection()?.kind === 'carer';
  // The carer names their phone once, right after pairing; «Позже» puts it off to «Настройки».
  const [namePutOff, setNamePutOff] = createSignal(false);
  const reload = (): void => {
    const fresh = props.store.read(invitation().id);
    if (fresh) setResults(fresh);
    setMeta(props.store.meta(invitation().id));
    setPeople((count) => count + 1);
  };
  /** Who has the diary, read once per sync rather than once per entry. */
  const access = createMemo(() => {
    void people();
    const current = connection();
    return current
      ? { connection: current, phones: current.phones(), names: current.names() }
      : undefined;
  });
  /** «Отметил(а) опекун Ирина» under an entry, once the diary has a carer. */
  const markedBy = (entry: DiaryEntry): string | undefined => {
    const current = access();
    if (!current) return undefined;
    const who = markAuthor(
      current.connection.authorOf(entry.id),
      current.phones,
      current.names,
      current.connection.kind,
    );
    return who ? markLine(who) : undefined;
  };
  /** A carer's phone shows the diary as soon as it is paired: consent is the patient's. */
  const consentAt = (): string | undefined => meta().consentAt ?? (carer() ? 'carer' : undefined);
  const runSync = async (): Promise<void> => {
    const current = connection();
    if (!current) return;
    // «Принял» pressed in a notification while the diary was closed.
    if (await current.applyReminderActions()) reload();
    setSync({ ...current.status(), phase: 'syncing' });
    afterSync(await current.sync());
  };
  /** A removed carer's phone forgot the diary: back to the list. */
  const afterSync = (status: SyncStatus): void => {
    if (status.phase === 'ended' && !props.store.read(invitation().id)) {
      props.onBack();
      return;
    }
    setMediaOffer(connection()?.mediaOffer());
    setDoctorMessages(connection()?.chatMessages() ?? []);
    setSync(status);
    reload();
  };
  const scheduleSync = (): void => {
    if (!connection()) return;
    window.clearTimeout(syncTimer);
    syncTimer = window.setTimeout(() => void runSync(), SYNC_DELAY_MS);
  };
  onMount(() => {
    if (!isConnectedDiary(window.localStorage, props.initial.invitation.id)) return;
    void PatientConnection.open(window.localStorage, props.store, props.initial.invitation.id).then(
      (opened) => {
        if (!opened) return;
        setConnection(opened);
        setReminders(opened.reminderSettings());
        setSync(opened.status());
        void runSync();
        void opened.refreshPush().catch((cause: unknown) => {
          // Offline or the browser dropped the subscription: «Ещё» offers notifications again.
          console.warn('Подписка на уведомления не обновлена:', cause);
        });
        stopListening = opened.listen(afterSync);
      },
    );
    const onOnline = (): void => void runSync();
    // The worker tells an open diary about a «Принял» right away.
    const onWorkerMessage = (event: MessageEvent): void => {
      if ((event.data as { type?: unknown } | null)?.type === 'diary-reminder-action') {
        void runSync();
      }
    };
    navigator.serviceWorker?.addEventListener('message', onWorkerMessage);
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void runSync();
    };
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void runSync();
    }, SYNC_INTERVAL_MS);
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    onCleanup(() => {
      stopListening?.();
      window.clearTimeout(syncTimer);
      window.clearInterval(interval);
      window.removeEventListener('online', onOnline);
      navigator.serviceWorker?.removeEventListener('message', onWorkerMessage);
      document.removeEventListener('visibilitychange', onVisible);
    });
  });

  const navigate = (next: DiaryScreen): void => {
    setError('');
    if (next !== 'home') setEditTarget(undefined);
    if (nestedParent && next !== screen()) {
      if (next === baseScreen) window.history.go(-2);
      else {
        afterNestedBack = next === nestedParent ? undefined : next;
        window.history.back();
      }
      return;
    }
    const parent =
      screen() === 'plan' && next === 'calendar'
        ? 'plan'
        : screen() === 'more' && (next === 'records' || next === 'send')
          ? 'more'
          : undefined;
    if (pushed && parent) {
      window.history.pushState(
        { [HISTORY_KEY]: next, [NESTED_PARENT_KEY]: parent },
        '',
        window.location.href,
      );
      nestedParent = parent;
      setScreen(next);
      window.scrollTo(0, 0);
      return;
    }
    if (next === baseScreen) {
      if (pushed) {
        // Back first; the popstate brings the home in. Rendering it now would let a sheet it opens
        // on mount push its history layer before this back, which would then pop that layer.
        pushed = false;
        window.history.back();
        return;
      }
      setScreen(baseScreen);
    } else {
      if (!pushed) {
        window.history.pushState({ [HISTORY_KEY]: next }, '', window.location.href);
        pushed = true;
      } else if (pushed) {
        window.history.replaceState({ [HISTORY_KEY]: next }, '', window.location.href);
      }
      setScreen(next);
    }
    window.scrollTo(0, 0);
  };

  onMount(() => {
    // A reload leaves the step of the last visit in the history entry; this page starts at the
    // home (or at the step it was asked for), so that stale mark must not survive.
    if (window.history.state?.[HISTORY_KEY] !== undefined || window.history.state?.diarySheet) {
      window.history.replaceState(null, '', window.location.href);
    }
    props.store.setMeta(invitation().id, { lastOpenedAt: new Date().toISOString() });
    props.store.setUi({ lastOpenedId: invitation().id });
    const onPop = (): void => {
      const next = screenFromHistory(baseScreen);
      pushed = next !== baseScreen;
      const parent: unknown = window.history.state?.[NESTED_PARENT_KEY];
      nestedParent = parent === 'plan' || parent === 'more' ? parent : undefined;
      setError('');
      setScreen(next);
      window.scrollTo(0, 0);
      if (afterNestedBack) {
        const target = afterNestedBack;
        afterNestedBack = undefined;
        navigate(target);
      }
    };
    window.addEventListener('popstate', onPop);
    onCleanup(() => window.removeEventListener('popstate', onPop));
  });

  const commit = (next: DiaryResults): void => {
    props.store.save(next);
    setResults(next);
    requestPersistentStorage();
    scheduleSync();
  };

  let openedChat = false;
  createEffect(() => {
    if (
      openedChat ||
      !isCareDiary(invitation()) ||
      carer() ||
      (sync() && !connection()) ||
      (invitation().consent && !consentAt())
    )
      return;
    openedChat = true;
    if (pushed) return;
    baseScreen = 'companion';
    setChatPrimary(true);
    const initial = props.initialScreen;
    if (initial && initial !== 'companion') navigate(initial);
    else setScreen('companion');
  });

  const status = () => shareStatus(results().entries, sent());

  const startEntry = (entry: DiaryEntry | undefined, from: 'home' | 'records'): void => {
    setSaved(undefined);
    if (isCareDiary(invitation())) {
      // Marks of a care diary are made on its day page, one sheet per intake or checkpoint:
      // «Изменить» in «Записи» opens that entry's sheet there.
      setEditTarget(entry);
      setSelectedDay(undefined);
      navigate('home');
      return;
    }
    setEditing(entry);
    setReturnTo(from);
    navigate('entry');
  };

  const tabbed = (): boolean => isCareDiary(invitation());
  const [selectedDay, setSelectedDay] = createSignal<string>();

  // The day page's sheets, opened from the header and from «Записи».
  type DayControls = {
    readonly openContacts: () => void;
    readonly openCrisis: () => void;
    readonly openEntry: (entry: DiaryEntry) => void;
  };
  let chatOpeners: DayControls | undefined;
  let dayOpeners: DayControls | undefined;
  const [editTarget, setEditTarget] = createSignal<DiaryEntry | undefined>(undefined);
  const homeActions = (view: DiaryScreen): readonly HeaderAction[] => {
    const current = sync();
    return [
      ...(view === 'companion' || (!chatPrimary() && view === 'plan')
        ? [
            ...(view === 'companion'
              ? [
                  {
                    id: 'plan',
                    label: 'План',
                    icon: 'list-checks' as const,
                    priority: 1 as const,
                    onSelect: () => navigate('plan'),
                  },
                ]
              : []),
            {
              id: 'settings',
              label: 'Настройки',
              icon: 'system' as const,
              priority: 1 as const,
              onSelect: () => navigate('more'),
            },
          ]
        : []),
      ...(view === 'plan'
        ? [
            {
              id: 'calendar',
              label: 'Календарь',
              icon: 'calendar' as const,
              priority: 1 as const,
              onSelect: () => {
                setSelectedDay(undefined);
                navigate('calendar');
              },
            },
          ]
        : []),
      ...(current && syncNeedsAction(current)
        ? [
            {
              id: 'sync',
              label: 'Отправить врачу сейчас',
              icon: 'refresh' as const,
              priority: 2 as const,
              menuOnly: view === 'companion',
              disabled: current.phase === 'syncing',
              onSelect: () => void runSync(),
            },
          ]
        : []),
      ...(invitation().contacts?.length
        ? [
            {
              id: 'contacts',
              label: 'Связаться с врачом',
              icon: 'phone' as const,
              priority: 2 as const,
              menuOnly: view === 'companion',
              onSelect: () => (view === 'companion' ? chatOpeners : dayOpeners)?.openContacts(),
            },
          ]
        : []),
      {
        id: 'crisis',
        label: 'Помощь, если очень плохо',
        icon: 'lifebuoy' as const,
        priority: 1 as const,
        danger: true,
        menuOnly: view === 'companion',
        onSelect: () => (view === 'companion' ? chatOpeners : dayOpeners)?.openCrisis(),
      },
    ];
  };
  const homeLine = (): string | undefined => {
    const current = sync();
    const parts = [
      carer() ? 'Вы опекун' : undefined,
      invitation().doctor,
      current ? syncWords(current) : undefined,
    ].filter(Boolean);
    return parts.length ? parts.join(' · ') : undefined;
  };

  const save = (value: Record<string, unknown>): string | undefined => {
    try {
      const entry = parseDiaryEntry(invitation(), value);
      const existed = results().entries.some((candidate) => candidate.id === entry.id);
      commit(withEntry(withoutEntry(results(), entry.id), entry));
      setSaved({ entry, kind: existed ? 'edited' : 'new' });
      // The «diary added / updated» message is for the first look; it goes once the patient writes.
      setNotice(undefined);
      setEditing(undefined);
      navigate(returnTo());
      return undefined;
    } catch (cause) {
      return errorMessage(cause, 'Не удалось сохранить запись.');
    }
  };

  /** A mark from the day page of a care diary: saved in place, no page change. */
  const saveCare = (value: Record<string, unknown>): string | undefined => {
    try {
      const entry = parseDiaryEntry(invitation(), value);
      commit(withEntry(withoutEntry(results(), entry.id), entry));
      setNotice(undefined);
      return undefined;
    } catch (cause) {
      return errorMessage(cause, 'Не удалось сохранить отметку.');
    }
  };

  const updateMeta = (patch: Parameters<DiaryStore['setMeta']>[1]): void => {
    props.store.setMeta(invitation().id, patch);
    setMeta(props.store.meta(invitation().id));
    scheduleSync();
  };

  // A study the doctor named (voluntary): the answer is the patient's own, a carer's phone has none.
  const [studyOpen, setStudyOpen] = createSignal(false);
  const study = () => (carer() ? undefined : invitation().study);
  const studyStatus = () => studyConsentStatus(invitation().study, meta().study);

  const remove = (entry: DiaryEntry): void => {
    try {
      commit(withoutEntry(results(), entry.id));
      setSaved(undefined);
      setError('');
    } catch (cause) {
      setError(errorMessage(cause, 'Не удалось удалить запись.'));
    }
  };

  const confirmSent = (): void => {
    const next = markAllSent(results().entries, new Date().toISOString());
    props.store.setMeta(invitation().id, { sent: next });
    setSent(next);
  };

  const renderScreen = (shown: () => DiaryScreen): JSX.Element => (
    <Switch>
      <Match when={shown() === 'entry'}>
        <EntryPage
          invitation={invitation()}
          entry={editing()}
          backLabel={returnTo() === 'records' ? 'Мои записи' : 'На главную'}
          onSave={save}
          onLeave={() => navigate(returnTo())}
        />
      </Match>
      <Match when={shown() === 'records'}>
        <DiaryRecords
          results={results()}
          sent={sent()}
          saved={saved()}
          error={error()}
          onBack={() => {
            setSaved(undefined);
            navigate(tabbed() ? 'more' : 'home');
          }}
          tabbed={tabbed()}
          connected={sync() !== undefined}
          removed={meta().removedByDoctor}
          markedBy={markedBy}
          onWrite={() => startEntry(undefined, 'records')}
          onSend={() => navigate('send')}
          onEdit={(entry) => startEntry(entry, 'records')}
          onDelete={remove}
        />
      </Match>
      <Match when={shown() === 'send'}>
        <DiarySend
          results={results()}
          status={status()}
          onSent={confirmSent}
          tabbed={tabbed()}
          onBack={() => navigate(tabbed() ? 'more' : 'home')}
          onWrite={() => startEntry(undefined, 'home')}
        />
      </Match>
      <Match when={shown() === 'more'}>
        <DiaryMore
          store={props.store}
          entries={results().entries.length}
          onRecords={tabbed() ? () => navigate('records') : undefined}
          onSend={tabbed() && !sync() ? () => navigate('send') : undefined}
          onBack={
            tabbed() ? (chatPrimary() ? undefined : () => navigate('plan')) : () => navigate('home')
          }
          hasOtherDiaries={props.hasOtherDiaries}
          onPrint={() =>
            printHtmlInFrame(
              diaryPrintHtml(invitation(), results().entries, 10, {
                medHistory: results().medHistory ?? [],
              }),
            )
          }
          onFhir={() => downloadFhir(results())}
          medHistory={{
            items: results().medHistory ?? [],
            author: carer() ? 'carer' : 'patient',
            onSave: (item) =>
              commit(
                withMedHistory(results(), [
                  ...(results().medHistory ?? []).filter((known) => known.id !== item.id),
                  item,
                ]),
              ),
            onDelete: (id) =>
              commit(
                withMedHistory(
                  results(),
                  (results().medHistory ?? []).filter((known) => known.id !== id),
                ),
              ),
          }}
          consents={
            meta().consents?.length
              ? { accepted: meta().consents ?? [], operator: diaryOperator(invitation()) }
              : undefined
          }
          study={
            study() && consentAt()
              ? { status: studyStatus(), onOpen: () => setStudyOpen(true) }
              : undefined
          }
          onRestored={(id) => {
            if (id === invitation().id) setResults(props.store.read(id) ?? results());
          }}
          onOpened={props.onOpened}
          onList={props.onBack}
          onEnablePush={
            connection()
              ? async () => {
                  const state = await (connection() as PatientConnection).enablePush();
                  setReminders(connection()?.reminderSettings());
                  return state;
                }
              : undefined
          }
          pushOn={typeof Notification !== 'undefined' && Notification.permission === 'granted'}
          reminders={reminders()}
          onReminders={(patch) => {
            const current = connection();
            if (!current) return;
            void current.setReminders(patch).then(setSync);
            setReminders(current.reminderSettings());
          }}
          onWithdraw={
            connection() && !carer()
              ? async () => {
                  await connection()?.withdraw();
                  props.onBack();
                }
              : undefined
          }
          access={
            connection() ? (
              <DiaryAccess
                connection={connection() as PatientConnection}
                revision={people()}
                onChanged={() => void runSync()}
                onLeft={props.onBack}
              />
            ) : undefined
          }
        />
      </Match>
      <Match
        when={
          (shown() === 'home' ||
            shown() === 'plan' ||
            shown() === 'calendar' ||
            shown() === 'companion') &&
          isCareDiary(invitation())
            ? shown()
            : undefined
        }
        keyed
      >
        <DiaryToday
          header={
            <>
              <ScreenHeader
                title={
                  shown() === 'companion'
                    ? 'Чат'
                    : shown() === 'calendar'
                      ? 'Календарь'
                      : shown() === 'plan'
                        ? 'Назначения'
                        : selectedDay() && selectedDay() !== dayKey(new Date())
                          ? 'День'
                          : 'Сегодня'
                }
                titleContent={
                  shown() === 'companion' ? (
                    <CompanionIdentity diaryId={invitation().id} />
                  ) : undefined
                }
                subtitle={shown() === 'plan' || shown() === 'home' ? homeLine() : undefined}
                backLabel={
                  shown() === 'home' || shown() === 'calendar' ? 'Назначения' : 'Мои дневники'
                }
                onBack={
                  shown() === 'home' || shown() === 'calendar'
                    ? () => navigate('plan')
                    : shown() === 'plan' && props.hasOtherDiaries
                      ? props.onBack
                      : undefined
                }
                headerActions={homeActions(shown())}
                signum={shown() === 'companion' || !chatPrimary()}
                hero={shown() === 'home' ? PAGE_HEROES.diaryToday : undefined}
              />
              <Show when={shown() === 'home'}>
                <InstallWarning
                  store={props.store}
                  entries={results().entries.length}
                  connected={sync() !== undefined}
                />
              </Show>
            </>
          }
          afterChecklist={
            <Show when={shown() === 'plan'}>
              <InstallWarning
                store={props.store}
                entries={results().entries.length}
                connected={sync() !== undefined}
              />
            </Show>
          }
          studyCard={(() => {
            const offered = study();
            return offered && studyStatus().kind === 'unanswered' ? (
              <StudyConsentCard study={offered} onOpen={() => setStudyOpen(true)} />
            ) : undefined;
          })()}
          planMode={shown() === 'plan' ? 'today' : shown() === 'calendar' ? 'calendar' : undefined}
          initialDay={shown() === 'home' || shown() === 'calendar' ? selectedDay() : undefined}
          onDay={shown() === 'home' || shown() === 'calendar' ? setSelectedDay : undefined}
          companion={shown() === 'companion'}
          companionSession={companionSession}
          mediaOffer={mediaOffer()}
          mediaConnection={carer() ? undefined : connection()}
          doctorMessages={doctorMessages()}
          onDoctorMessage={
            connection() && !carer()
              ? async (id, text) => {
                  const recipient = connection();
                  if (!recipient) throw new Error('Дневник не подключён.');
                  await recipient.sendChat(id, text);
                  void runSync();
                }
              : undefined
          }
          onCloseCompanion={() => navigate('plan')}
          results={results()}
          status={status()}
          consentAt={
            shown() === 'companion' &&
            invitation().consent &&
            !acceptedAll(joiningDocuments(sync() !== undefined), meta().consents ?? [])
              ? undefined
              : consentAt()
          }
          existingConsents={meta().consents}
          tipsRead={meta().tipsRead ?? []}
          controls={(api) => {
            if (shown() === 'companion') chatOpeners = api;
            else dayOpeners = api;
          }}
          openOnMount={editTarget()}
          onSave={saveCare}
          onRemove={remove}
          onConsent={(consents) =>
            updateMeta({ consentAt: acceptedAt(consents) ?? new Date().toISOString(), consents })
          }
          onTipRead={(id) => updateMeta({ tipsRead: [...(meta().tipsRead ?? []), id] })}
          sync={sync()}
          notice={notice()}
          onDismissNotice={() => setNotice(undefined)}
          removed={meta().removedByDoctor}
          planChange={chatPrimary() ? undefined : meta().planChange}
          chatPlanChanges={chatPlanChanges()}
          onDismissPlanChange={() => updateMeta({ planChange: undefined })}
          onRequestHelp={
            connection() && !carer()
              ? async () => {
                  const current = connection();
                  if (!current) throw new Error('Дневник не подключён.');
                  const next = await current.raiseAlert();
                  setSync(next);
                  return next;
                }
              : undefined
          }
          onUrgent={() => {
            const current = connection();
            if (current) void current.raiseAlert().then(setSync);
          }}
        />
      </Match>
      <Match when={shown() === 'home'}>
        <DiaryHome
          store={props.store}
          results={results()}
          status={status()}
          notice={notice()}
          saved={saved()}
          error={error()}
          hasOtherDiaries={props.hasOtherDiaries}
          onWrite={() => startEntry(undefined, 'home')}
          onRecords={() => {
            setSaved(undefined);
            navigate('records');
          }}
          onSend={() => navigate('send')}
          onMore={() => navigate('more')}
          onDismissNotice={() => setNotice(undefined)}
          onList={props.onBack}
        />
      </Match>
    </Switch>
  );

  const modalTitle = () => {
    switch (screen()) {
      case 'more':
        return 'Настройки';
      case 'records':
        return 'Записи';
      case 'send':
        return 'Отправить врачу';
      case 'calendar':
        return 'Календарь';
      default:
        return 'План';
    }
  };

  return (
    <>
      <Show when={chatPrimary()} fallback={renderScreen(screen)}>
        <div inert={screen() !== 'companion'}>{renderScreen(() => 'companion')}</div>
        <Show when={screen() !== 'companion'}>
          <DiarySheet
            tall
            tracksHistory={false}
            title={modalTitle()}
            bodyClass="signum-route-modal__body"
            headerStart={
              <Show when={screen() === 'calendar' || screen() === 'records' || screen() === 'send'}>
                <button
                  type="button"
                  class="diary-sheet__close"
                  aria-label={screen() === 'calendar' ? 'План' : 'Настройки'}
                  onClick={() => navigate(screen() === 'calendar' ? 'plan' : 'more')}
                >
                  <AppGlyph name="caret-left" class="diary-sheet__close-icon" />
                </button>
              </Show>
            }
            headerEnd={
              <>
                <Show when={screen() === 'plan'}>
                  <button
                    type="button"
                    class="diary-sheet__close"
                    aria-label="Календарь"
                    onClick={() => {
                      setSelectedDay(undefined);
                      navigate('calendar');
                    }}
                  >
                    <AppGlyph name="calendar" class="diary-sheet__close-icon" />
                  </button>
                </Show>
                <Show when={screen() === 'more'}>
                  <button
                    type="button"
                    class="diary-sheet__close"
                    aria-label="Как пользоваться дневником"
                    onClick={() => setSettingsHelp(true)}
                  >
                    <AppGlyph name="question" class="diary-sheet__close-icon" />
                  </button>
                </Show>
              </>
            }
            onClose={() => navigate('companion')}
          >
            {renderScreen(screen)}
          </DiarySheet>
        </Show>
      </Show>
      <Show when={settingsHelp()}>
        <DiarySheet title="Как пользоваться дневником" onClose={() => setSettingsHelp(false)}>
          <DiaryHelp connected={sync() !== undefined} />
        </DiarySheet>
      </Show>
      <Show when={connection()?.kind === 'carer' && !connection()?.name && !namePutOff()}>
        <CarerNameSheet
          name=""
          onSave={async (name) => {
            const current = connection();
            if (current) setSync(await current.setName(name));
            reload();
          }}
          onClose={() => setNamePutOff(true)}
        />
      </Show>
      <Show when={studyOpen() && study()}>
        {(offered) => (
          <StudyConsentSheet
            study={offered()}
            status={studyStatus()}
            onAnswer={(answer) => updateMeta({ study: studyAnswer(offered(), answer) })}
            onClose={() => setStudyOpen(false)}
          />
        )}
      </Show>
    </>
  );
}
