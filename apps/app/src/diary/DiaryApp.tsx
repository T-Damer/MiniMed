import { createSignal, type JSX, onCleanup, onMount, Show } from 'solid-js';

import { Button } from '@/components/Button';
import { DiaryList } from '@/diary/DiaryList';
import { type DiaryScreen, DiaryView } from '@/diary/DiaryView';
import { entriesLabel } from '@/diary/diary-format';
import { isStandaloneApp } from '@/diary/install-state';
import { diaryInvitationLink, readInvitationFragment } from '@/features/diary/diary-codec';
import type { InvitationMergeOutcome } from '@/features/diary/diary-merge';
import type { DiaryResults } from '@/features/diary/diary-model';
import {
  createDiaryStore,
  type DiaryOpenResult,
  type DiaryStore,
} from '@/features/diary/diary-storage';

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

type State =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string; readonly store: DiaryStore | undefined }
  | { readonly kind: 'list'; readonly store: DiaryStore }
  | {
      readonly kind: 'diary';
      readonly store: DiaryStore;
      readonly results: DiaryResults;
      readonly notice: string | undefined;
      /** The step to open first; the diary home when absent. */
      readonly screen: DiaryScreen | undefined;
    };

/** The browser must be able to keep the diary; private windows and blocked storage cannot. */
function openStorage(): Storage {
  try {
    const storage = window.localStorage;
    const probe = 'minimed.diary.probe';
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch (cause) {
    throw new Error(
      'Браузер не разрешает сохранять записи на этом устройстве (возможно, открыто приватное окно). Откройте ссылку врача в обычном окне браузера.',
      { cause },
    );
  }
}

function linkNotice(
  outcome: InvitationMergeOutcome,
  entries: number,
  skipped: number,
): string | undefined {
  // The home-screen icon opens with the link it was saved with, every time: a diary that is
  // already here (or newer than the saved link) needs no remark.
  const fromIcon = isStandaloneApp() && (outcome === 'same' || outcome === 'older');
  const base = fromIcon
    ? undefined
    : (() => {
        switch (outcome) {
          case 'new':
            if (isStandaloneApp()) {
              return 'Дневник открыт. Если вы уже делали записи в Safari, сюда они не попали: перенесите их файлом («Ещё» → «Восстановить записи»).';
            }
            return 'Дневник добавлен. Он сохранён на этом устройстве: при следующем открытии страницы вы найдёте его здесь.';
          case 'same':
            return entries > 0
              ? `Это ваш дневник, он уже был на этом устройстве. Ваши записи на месте (${entriesLabel(entries)}).`
              : undefined;
          case 'updated':
            return `Врач обновил дневник. Ваши записи сохранены${entries > 0 ? ` (${entriesLabel(entries)})` : ''}.`;
          case 'older':
            return 'Эта ссылка старее вашего дневника. Показана последняя версия, записи сохранены.';
          case 'incompatible':
            return 'Эта ссылка относится к тому же дневнику, но не подходит к вашим записям. Дневник оставлен как был. Попросите врача выдать новый.';
        }
      })();
  return skipped > 0
    ? [base, `Не удалось прочитать записей: ${skipped}. Их исходный текст сохранён.`]
        .filter(Boolean)
        .join(' ')
    : base;
}

/** Keeps the address bar a complete link to this diary, so a home-screen shortcut opens it. */
function syncAddress(results: DiaryResults): void {
  const base = window.location.href.split('#')[0] ?? '';
  void diaryInvitationLink(results.invitation, base)
    // Keep the history state: it remembers which step of the diary is open.
    .then((link) => window.history.replaceState(window.history.state, '', link))
    .catch(() => console.warn('Не удалось обновить адрес страницы дневника.'));
}

function clearAddress(): void {
  window.history.replaceState(null, '', window.location.href.split('#')[0] ?? '');
}

export function DiaryApp(): JSX.Element {
  const [state, setState] = createSignal<State>({ kind: 'loading' });

  const showDiary = (
    store: DiaryStore,
    results: DiaryResults,
    notice?: string,
    screen?: DiaryScreen,
  ): void => {
    setState({ kind: 'diary', store, results, notice, screen });
    syncAddress(results);
  };

  const openFromList = (store: DiaryStore, id: string, screen?: DiaryScreen): void => {
    try {
      const results = store.read(id);
      if (!results) {
        setState({ kind: 'list', store });
        return;
      }
      showDiary(store, results, undefined, screen);
    } catch (cause) {
      setState({
        kind: 'error',
        message: errorMessage(cause, 'Не удалось открыть дневник.'),
        store,
      });
    }
  };

  /** A diary that was just opened or added from a link: show it with what happened. */
  const showOpened = (store: DiaryStore, opened: DiaryOpenResult): void =>
    showDiary(
      store,
      opened.results,
      linkNotice(opened.outcome, opened.results.entries.length, opened.salvagedSkipped),
    );

  // Two links opened one after the other: the later one wins even if the earlier finishes last.
  let latestOpen = 0;
  const open = async (): Promise<void> => {
    let store: DiaryStore | undefined;
    const ticket = ++latestOpen;
    try {
      store = createDiaryStore(openStorage());
      const invitation = await readInvitationFragment(window.location.hash);
      if (invitation) {
        // The link is stored even when a later one has already taken over the screen.
        const opened = store.open(invitation);
        if (ticket === latestOpen) showOpened(store, opened);
        return;
      }
      if (ticket !== latestOpen) return;
      // No link: the patient came back through the home-screen icon or a bookmark. One diary
      // opens straight away; with several, the list puts the one used last first.
      const summaries = store.summaries();
      const only = summaries.length === 1 ? summaries[0] : undefined;
      if (only) openFromList(store, only.invitation.id);
      else setState({ kind: 'list', store });
    } catch (cause) {
      if (ticket !== latestOpen) return;
      setState({
        kind: 'error',
        message: errorMessage(cause, 'Не удалось открыть дневник.'),
        store,
      });
    }
  };

  onMount(() => {
    void open();
    const onHash = (): void => void open();
    window.addEventListener('hashchange', onHash);
    onCleanup(() => window.removeEventListener('hashchange', onHash));
  });

  return (
    <>
      {(() => {
        const current = state();
        switch (current.kind) {
          case 'loading':
            return <p class="diary-page diary-page--status">Открываем дневник…</p>;
          case 'error': {
            const { store } = current;
            return (
              <main class="diary-page">
                <p class="diary-error" role="alert">
                  {current.message}
                </p>
                <p class="diary-header__privacy">
                  Попросите врача ещё раз показать QR-код или прислать ссылку на дневник.
                </p>
                <Show when={store}>
                  {(ready) => (
                    <Button
                      class="diary-button"
                      type="button"
                      onClick={() => {
                        clearAddress();
                        setState({ kind: 'list', store: ready() });
                      }}
                    >
                      Мои дневники
                    </Button>
                  )}
                </Show>
              </main>
            );
          }
          case 'list':
            return (
              <DiaryList
                store={current.store}
                onOpen={(id, screen) => openFromList(current.store, id, screen)}
                onOpened={(opened) => showOpened(current.store, opened)}
              />
            );
          case 'diary':
            return (
              <DiaryView
                store={current.store}
                initial={current.results}
                notice={current.notice}
                initialScreen={current.screen}
                hasOtherDiaries={current.store.summaries().length > 1}
                onOpened={(opened) => showOpened(current.store, opened)}
                onBack={() => {
                  clearAddress();
                  setState({ kind: 'list', store: current.store });
                }}
              />
            );
        }
      })()}
    </>
  );
}
