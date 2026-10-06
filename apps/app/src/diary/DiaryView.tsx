import { createSignal, type JSX, Match, onCleanup, onMount, Switch } from 'solid-js';

import { DiaryEntryForm } from '@/diary/DiaryEntryForm';
import { DiaryHome, type SavedEntry } from '@/diary/DiaryHome';
import { DiaryMore } from '@/diary/DiaryMore';
import { DiaryRecords } from '@/diary/DiaryRecords';
import { DiarySend } from '@/diary/DiarySend';
import { whenLabel } from '@/diary/diary-home';
import { ScreenHeader } from '@/diary/diary-ui';
import { diaryToFhirBundle } from '@/features/diary/diary-fhir';
import { markAllSent, shareStatus } from '@/features/diary/diary-merge';
import {
  type DiaryEntry,
  type DiaryInvitation,
  type DiaryResults,
  parseDiaryEntry,
} from '@/features/diary/diary-model';
import { diaryPrintHtml, printHtmlInFrame } from '@/features/diary/diary-print';
import {
  type DiaryOpenResult,
  type DiaryStore,
  withEntry,
  withoutEntry,
} from '@/features/diary/diary-storage';

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

  const navigate = (next: DiaryScreen): void => {
    setError('');
    if (next === 'home') {
      setScreen('home');
      if (pushed) {
        pushed = false;
        window.history.back();
      }
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
  };

  const status = () => shareStatus(results().entries, sent());

  const startEntry = (entry: DiaryEntry | undefined, from: 'home' | 'records'): void => {
    setSaved(undefined);
    setEditing(entry);
    setReturnTo(from);
    navigate('entry');
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
          onBack={() => {
            setSaved(undefined);
            navigate('home');
          }}
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
          onBack={() => navigate('home')}
          onWrite={() => startEntry(undefined, 'home')}
        />
      </Match>
      <Match when={screen() === 'more'}>
        <DiaryMore
          store={props.store}
          entries={results().entries.length}
          onBack={() => navigate('home')}
          onPrint={() => printHtmlInFrame(diaryPrintHtml(invitation(), results().entries, 10))}
          onFhir={() => downloadFhir(results())}
          onRestored={(id) => {
            if (id === invitation().id) setResults(props.store.read(id) ?? results());
          }}
          onOpened={props.onOpened}
          onList={props.onBack}
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
  );
}
