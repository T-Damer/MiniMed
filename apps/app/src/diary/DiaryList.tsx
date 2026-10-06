import { createSignal, For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import type { DiaryScreen } from '@/diary/DiaryView';
import { formatDateTime } from '@/diary/diary-format';
import { sendSummary } from '@/diary/diary-home';
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

/**
 * «Мои дневники»: one big card per diary — its name, the doctor, the last entry and where sending
 * stands — with the same three buttons as inside the diary, so the patient can write a reading or
 * send the records without opening it first.
 */
export function DiaryList(props: {
  readonly store: DiaryStore;
  readonly onOpen: (id: string, screen?: DiaryScreen) => void;
  /** A diary added from a pasted link. */
  readonly onOpened: (opened: DiaryOpenResult) => void;
}): JSX.Element {
  const [diaries, setDiaries] = createSignal(props.store.summaries());
  const [error, setError] = createSignal('');
  const [confirming, setConfirming] = createSignal<string | undefined>(undefined);
  const refresh = (): void => {
    setDiaries(props.store.summaries());
  };
  const list = () => ordered(diaries(), props.store.ui().lastOpenedId);

  const remove = (diary: DiarySummary): void => {
    try {
      props.store.remove(diary.invitation.id);
      setConfirming(undefined);
      refresh();
    } catch (cause) {
      setError(errorMessage(cause, 'Не удалось удалить дневник.'));
    }
  };

  const send = (diary: DiarySummary) =>
    sendSummary({
      total: diary.entries,
      unsent: diary.unsent,
      changed: 0,
      sentAt: props.store.meta(diary.invitation.id).sent?.at,
    });

  return (
    <main class="diary-page diary-page--list">
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
          <p class="diary-header__privacy diary-list__empty">
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
                <Show when={index() === 0 && diaries().length > 1}>
                  <span class="diary-list__badge">Продолжить</span>
                </Show>
                <button
                  type="button"
                  class="diary-list__open"
                  onClick={() => props.onOpen(diary.invitation.id)}
                >
                  <span class="diary-list__title">{diary.invitation.title}</span>
                  <Show when={diary.invitation.doctor}>
                    <span class="diary-list__meta">Врач: {diary.invitation.doctor}</span>
                  </Show>
                  <span class="diary-list__meta">
                    {diary.entries > 0
                      ? `Последняя запись: ${formatDateTime(diary.lastEntryAt ?? diary.invitation.issuedAt)}`
                      : 'Записей пока нет'}
                  </span>
                  <AppGlyph name="caret-right" class="diary-list__chevron" />
                </button>
                <Show when={send(diary).tone !== 'empty'}>
                  <p
                    class="diary-list__status"
                    classList={{
                      'diary-list__status--pending': send(diary).tone === 'pending',
                      'diary-list__status--done': send(diary).tone === 'done',
                    }}
                  >
                    {send(diary).text}
                  </p>
                </Show>
                <div class="diary-list__actions">
                  <Button
                    class="diary-button"
                    type="button"
                    variant="primary"
                    icon={<AppGlyph name="edit" class="diary-list__icon" />}
                    aria-label={`Записать показания: ${diary.invitation.title}`}
                    onClick={() => props.onOpen(diary.invitation.id, 'entry')}
                  >
                    Записать показания
                  </Button>
                  <Button
                    class="diary-button"
                    type="button"
                    icon={<AppGlyph name="list-bullets" class="diary-list__icon" />}
                    aria-label={`Мои записи (${diary.entries}): ${diary.invitation.title}`}
                    onClick={() => props.onOpen(diary.invitation.id, 'records')}
                  >
                    Мои записи ({diary.entries})
                  </Button>
                  <Button
                    class="diary-button"
                    type="button"
                    icon={<AppGlyph name="envelope-simple" class="diary-list__icon" />}
                    aria-label={`Отправить врачу: ${diary.invitation.title}`}
                    onClick={() => props.onOpen(diary.invitation.id, 'send')}
                  >
                    Отправить врачу
                  </Button>
                </div>
                <Show
                  when={confirming() === diary.invitation.id}
                  fallback={
                    <Button
                      class="diary-list__delete"
                      type="button"
                      variant="quiet"
                      aria-label={`Удалить дневник: ${diary.invitation.title}`}
                      onClick={() => setConfirming(diary.invitation.id)}
                    >
                      Удалить дневник
                    </Button>
                  }
                >
                  <div class="diary-list__confirm" role="alert">
                    <p class="diary-list__question">
                      Удалить дневник «{diary.invitation.title}» и все его записи с этого
                      устройства?
                      {diary.unsent > 0 ? ` Врачу не отправлено записей: ${diary.unsent}.` : ''}
                    </p>
                    <div class="diary-list__actions">
                      <Button
                        class="diary-button diary-button--danger"
                        type="button"
                        variant="danger"
                        onClick={() => remove(diary)}
                      >
                        Да, удалить
                      </Button>
                      <Button
                        class="diary-button"
                        type="button"
                        onClick={() => setConfirming(undefined)}
                      >
                        Нет, оставить
                      </Button>
                    </div>
                  </div>
                </Show>
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
      <InstallCard
        store={props.store}
        entries={diaries().reduce((sum, d) => sum + d.entries, 0)}
        variant="tip"
      />
      <RestoreCard store={props.store} onRestored={refresh} />
    </main>
  );
}
