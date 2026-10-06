import { createSignal, For, type JSX, Show } from 'solid-js';

import { Button } from '@/components/Button';
import { entriesLabel, formatDateTime } from '@/diary/diary-format';
import { InstallCard, MessengerWarning } from '@/diary/InstallCard';
import { isStandaloneApp } from '@/diary/install-state';
import { PasteLinkCard } from '@/diary/PasteLinkCard';
import { RestoreCard } from '@/diary/RestoreCard';
import type { DiaryOpenResult, DiaryStore, DiarySummary } from '@/features/diary/diary-storage';

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

/** The diary used last comes first and is marked, so the patient lands on «their» diary. */
function ordered(
  diaries: readonly DiarySummary[],
  lastOpenedId: string | undefined,
): DiarySummary[] {
  const stamp = (summary: DiarySummary): string =>
    summary.lastOpenedAt ?? summary.invitation.issuedAt;
  return diaries.toSorted((left, right) => {
    if (left.invitation.id === lastOpenedId) return -1;
    if (right.invitation.id === lastOpenedId) return 1;
    return stamp(right).localeCompare(stamp(left));
  });
}

export function DiaryList(props: {
  readonly store: DiaryStore;
  readonly onOpen: (id: string) => void;
  /** A diary added from a pasted link. */
  readonly onOpened: (opened: DiaryOpenResult) => void;
}): JSX.Element {
  const [diaries, setDiaries] = createSignal(props.store.summaries());
  const [error, setError] = createSignal('');
  const refresh = (): void => {
    setDiaries(props.store.summaries());
  };
  const list = () => ordered(diaries(), props.store.ui().lastOpenedId);

  const remove = (diary: DiarySummary): void => {
    const unsent = diary.unsent > 0 ? ` Не передано врачу записей: ${diary.unsent}.` : '';
    if (
      !window.confirm(
        `Удалить дневник «${diary.invitation.title}» и все его записи с этого устройства?${unsent}`,
      )
    ) {
      return;
    }
    try {
      props.store.remove(diary.invitation.id);
      refresh();
    } catch (cause) {
      setError(errorMessage(cause, 'Не удалось удалить дневник.'));
    }
  };

  return (
    <main class="diary-page">
      <h1 class="diary-header__title">Мои дневники</h1>
      <MessengerWarning />
      <Show when={props.store.warnings().length > 0}>
        <p class="diary-error" role="alert">
          {props.store.warnings().join(' ')}
        </p>
      </Show>
      <Show when={error()}>
        <p class="diary-error" role="alert">
          {error()}
        </p>
      </Show>
      <Show
        when={diaries().length > 0}
        fallback={
          <p class="diary-header__privacy">
            Здесь пока нет дневников.{' '}
            {isStandaloneApp()
              ? 'Значок на экране «Домой» хранит записи отдельно от Safari, поэтому он открылся пустым. '
              : ''}
            Вставьте ссылку, которую прислал врач (или откройте её, или отсканируйте QR-код). Если
            вы переносите записи из Safari или с другого устройства, восстановите их из файла ниже.
          </p>
        }
      >
        <ul class="diary-list">
          <For each={list()}>
            {(diary, index) => (
              <li
                class="diary-list__item"
                classList={{ 'diary-list__item--current': index() === 0 }}
              >
                <button
                  type="button"
                  class="diary-list__open"
                  classList={{ 'diary-list__open--current': index() === 0 }}
                  onClick={() => props.onOpen(diary.invitation.id)}
                >
                  <span class="diary-list__open-content">
                    <Show when={index() === 0 && diaries().length > 1}>
                      <span class="diary-list__badge">Продолжить</span>
                    </Show>
                    <span class="diary-list__title">{diary.invitation.title}</span>
                    <Show when={diary.invitation.doctor}>
                      <span class="diary-list__meta">Врач: {diary.invitation.doctor}</span>
                    </Show>
                    <span class="diary-list__meta">
                      {diary.entries > 0
                        ? `${entriesLabel(diary.entries)}, последняя: ${formatDateTime(diary.lastEntryAt ?? diary.invitation.issuedAt)}`
                        : 'Записей пока нет'}
                    </span>
                    <Show when={diary.unsent > 0}>
                      <span class="diary-list__meta diary-list__meta--attention">
                        Не передано врачу: {diary.unsent}
                      </span>
                    </Show>
                  </span>
                </button>
                <Button
                  class="diary-list__delete"
                  type="button"
                  variant="quiet"
                  aria-label={`Удалить: ${diary.invitation.title}`}
                  title="Удалить дневник с этого устройства"
                  onClick={() => remove(diary)}
                >
                  Удалить
                </Button>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <PasteLinkCard
        store={props.store}
        prominent={diaries().length === 0}
        onOpened={props.onOpened}
      />
      <InstallCard store={props.store} entries={diaries().reduce((sum, d) => sum + d.entries, 0)} />
      <RestoreCard store={props.store} onRestored={refresh} />
    </main>
  );
}
