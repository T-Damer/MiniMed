import {
  createMemo,
  createSignal,
  type JSX,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import { PAGE_HEROES } from '@/app/page-heroes';

import type { NavItem } from '@/app/root-view';
import { useBottomNav } from '@/app/use-bottom-nav';
import { BottomNav } from '@/components/BottomNav';
import type { HeaderAction } from '@/components/HeaderActions';

import { DiaryEntryForm } from '@/diary/DiaryEntryForm';
import { DiaryHome, type SavedEntry } from '@/diary/DiaryHome';
import { DiaryMore } from '@/diary/DiaryMore';
import { DiaryRecords } from '@/diary/DiaryRecords';
import { DiarySend } from '@/diary/DiarySend';
import { DiaryToday } from '@/diary/DiaryToday';
import { whenLabel } from '@/diary/diary-home';
import { ScreenHeader } from '@/diary/diary-ui';
import { InstallWarning } from '@/diary/InstallWarning';
import { syncNeedsAction, syncWords } from '@/diary/sync-words';
import {
  isConnectedDiary,
  PatientConnection,
  type ReminderSettings,
  type SyncStatus,
} from '@/features/diary/connected/patient-connection';
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
export type DiaryScreen = 'home' | 'entry' | 'records' | 'send' | 'more';

const SCREENS: readonly DiaryScreen[] = ['home', 'entry', 'records', 'send', 'more'];
const HISTORY_KEY = 'diaryScreen';

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

function screenFromHistory(): DiaryScreen {
  const state = window.history.state as Record<string, unknown> | null;
  const value = state?.[HISTORY_KEY];
  return SCREENS.find((screen) => screen === value) ?? 'home';
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
  const [results, setResults] = createSignal<DiaryResults>(props.initial);
  const [sent, setSent] = createSignal(props.store.meta(props.initial.invitation.id).sent);
  const [meta, setMeta] = createSignal(props.store.meta(props.initial.invitation.id));
  const [error, setError] = createSignal('');
  const [notice, setNotice] = createSignal(props.notice);
  const [saved, setSaved] = createSignal<SavedEntry | undefined>(undefined);
  const [screen, setScreen] = createSignal<DiaryScreen>(props.initialScreen ?? 'home');
  const [editing, setEditing] = createSignal<DiaryEntry | undefined>(undefined);
  // Where «Сохранить» and «Отмена» of the entry form return to.
  const [returnTo, setReturnTo] = createSignal<'home' | 'records'>('home');
  const invitation = () => results().invitation;
  // A step was added to the browser's history by this page: going home pops it again.
  let pushed = false;

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
  const reload = (): void => {
    const fresh = props.store.read(invitation().id);
    if (fresh) setResults(fresh);
    setMeta(props.store.meta(invitation().id));
  };
  const runSync = async (): Promise<void> => {
    const current = connection();
    if (!current) return;
    // «Принял» pressed in a notification while the diary was closed.
    if (await current.applyReminderActions()) reload();
    setSync({ ...current.status(), phase: 'syncing' });
    const status = await current.sync();
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
        stopListening = opened.listen((status) => {
          setSync(status);
          reload();
        });
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
    if (next === 'home') {
      if (pushed) {
        // Back first; the popstate brings the home in. Rendering it now would let a sheet it opens
        // on mount push its history layer before this back, which would then pop that layer.
        pushed = false;
        window.history.back();
        return;
      }
      setScreen('home');
    } else {
      if (!pushed && screen() === 'home') {
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
    if (screenFromHistory() !== 'home') {
      window.history.replaceState(null, '', window.location.href);
    }
    props.store.setMeta(invitation().id, { lastOpenedAt: new Date().toISOString() });
    props.store.setUi({ lastOpenedId: invitation().id });
    const onPop = (): void => {
      const next = screenFromHistory();
      pushed = next !== 'home';
      setError('');
      setScreen(next);
      window.scrollTo(0, 0);
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

  const status = () => shareStatus(results().entries, sent());

  const startEntry = (entry: DiaryEntry | undefined, from: 'home' | 'records'): void => {
    setSaved(undefined);
    if (isCareDiary(invitation())) {
      // Marks of a care diary are made on its day page, one sheet per intake or checkpoint:
      // «Изменить» in «Записи» opens that entry's sheet there.
      setEditTarget(entry);
      navigate('home');
      return;
    }
    setEditing(entry);
    setReturnTo(from);
    navigate('entry');
  };

  // The patient's tab bar (owner 2026-10-28: the main app's bar): a care diary's own pages.
  type Tab = Exclude<DiaryScreen, 'entry'>;
  const tabbed = (): boolean => isCareDiary(invitation());
  const tabs = createMemo((): readonly NavItem<Tab>[] => [
    { id: 'home', label: 'Сегодня', icon: 'calendar' },
    { id: 'records', label: 'Записи', icon: 'check' },
    // A connected diary sends by itself; a QR diary is handed over before the visit.
    ...(sync() ? [] : [{ id: 'send' as const, label: 'Врачу', icon: 'share' as const }]),
    { id: 'more', label: 'Настройки', icon: 'system' },
  ]);
  const tabNav = useBottomNav<Tab>({
    view: () => (screen() === 'entry' ? 'home' : screen()) as Tab,
    items: tabs,
    navigate: (next) => {
      setSaved(undefined);
      navigate(next);
    },
    enabled: () => tabbed() && screen() !== 'entry',
  });

  // The day page's sheets, opened from the header and from «Записи».
  let openers:
    | {
        readonly openContacts: () => void;
        readonly openCrisis: () => void;
        readonly openEntry: (entry: DiaryEntry) => void;
      }
    | undefined;
  const [editTarget, setEditTarget] = createSignal<DiaryEntry | undefined>(undefined);
  const homeActions = createMemo((): readonly HeaderAction[] => {
    const current = sync();
    return [
      ...(current && syncNeedsAction(current)
        ? [
            {
              id: 'sync',
              label: 'Отправить врачу сейчас',
              icon: 'refresh' as const,
              priority: 2 as const,
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
              onSelect: () => openers?.openContacts(),
            },
          ]
        : []),
      {
        id: 'crisis',
        label: 'Помощь, если очень плохо',
        icon: 'lifebuoy' as const,
        priority: 1 as const,
        danger: true,
        onSelect: () => openers?.openCrisis(),
      },
    ];
  });
  const homeLine = (): string | undefined => {
    const current = sync();
    const parts = [invitation().doctor, current ? syncWords(current) : undefined].filter(Boolean);
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

  return (
    <>
      <Switch>
        <Match when={screen() === 'entry'}>
          <EntryPage
            invitation={invitation()}
            entry={editing()}
            backLabel={returnTo() === 'records' ? 'Мои записи' : 'На главную'}
            onSave={save}
            onLeave={() => navigate(returnTo())}
          />
        </Match>
        <Match when={screen() === 'records'}>
          <DiaryRecords
            results={results()}
            sent={sent()}
            saved={saved()}
            error={error()}
            onBack={
              tabbed()
                ? undefined
                : () => {
                    setSaved(undefined);
                    navigate('home');
                  }
            }
            tabbed={tabbed()}
            connected={sync() !== undefined}
            onWrite={() => startEntry(undefined, 'records')}
            onSend={() => navigate('send')}
            onEdit={(entry) => startEntry(entry, 'records')}
            onDelete={remove}
          />
        </Match>
        <Match when={screen() === 'send'}>
          <DiarySend
            results={results()}
            status={status()}
            onSent={confirmSent}
            tabbed={tabbed()}
            onBack={() => navigate('home')}
            onWrite={() => startEntry(undefined, 'home')}
          />
        </Match>
        <Match when={screen() === 'more'}>
          <DiaryMore
            store={props.store}
            entries={results().entries.length}
            onBack={tabbed() ? undefined : () => navigate('home')}
            hasOtherDiaries={props.hasOtherDiaries}
            onPrint={() => printHtmlInFrame(diaryPrintHtml(invitation(), results().entries, 10))}
            onFhir={() => downloadFhir(results())}
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
              connection()
                ? async () => {
                    await connection()?.withdraw();
                    props.onBack();
                  }
                : undefined
            }
          />
        </Match>
        <Match when={screen() === 'home' && isCareDiary(invitation())}>
          <DiaryToday
            header={
              <>
                <ScreenHeader
                  title={invitation().title}
                  subtitle={homeLine()}
                  backLabel="Мои дневники"
                  onBack={props.hasOtherDiaries ? props.onBack : undefined}
                  headerActions={homeActions()}
                  hero={PAGE_HEROES.diaryToday}
                />
                <InstallWarning
                  store={props.store}
                  entries={results().entries.length}
                  connected={sync() !== undefined}
                />
              </>
            }
            results={results()}
            status={status()}
            consentAt={meta().consentAt}
            tipsRead={meta().tipsRead ?? []}
            controls={(api) => {
              openers = api;
            }}
            openOnMount={editTarget()}
            onSave={saveCare}
            onRemove={remove}
            onConsent={() => updateMeta({ consentAt: new Date().toISOString() })}
            onTipRead={(id) => updateMeta({ tipsRead: [...(meta().tipsRead ?? []), id] })}
            sync={sync()}
            notice={notice()}
            onDismissNotice={() => setNotice(undefined)}
            onUrgent={() => {
              const current = connection();
              if (current) void current.raiseAlert().then(setSync);
            }}
          />
        </Match>
        <Match when={screen() === 'home'}>
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
      <Show when={tabbed() && screen() !== 'entry' && (!invitation().consent || meta().consentAt)}>
        <Portal>
          <BottomNav
            view={() => (screen() === 'entry' ? 'home' : screen()) as Tab}
            items={tabs}
            label="Дневник"
            dragIndex={tabNav.dragIndex}
            dragging={tabNav.dragging}
            pressed={tabNav.pressed}
            bubbleStyle={tabNav.bubbleStyle}
            bindNav={tabNav.bindNav}
            onPointerDown={tabNav.handlePointerDown}
            onPointerMove={tabNav.handlePointerMove}
            onPointerUp={tabNav.handlePointerUp}
            onPointerCancel={tabNav.handlePointerCancel}
            onItemClick={tabNav.handleClick}
          />
        </Portal>
      </Show>
    </>
  );
}
