import { createMemo, createSignal, For, type JSX, Show } from 'solid-js';
import { PAGE_HEROES } from '@/app/page-heroes';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import type { SavedEntry } from '@/diary/DiaryHome';
import { entriesLabel, formatTime } from '@/diary/diary-format';
import { groupEntriesByDay, whenLabel } from '@/diary/diary-home';
import { SavedBanner, ScreenHeader } from '@/diary/diary-ui';
import { type DiarySent, entryFingerprint } from '@/features/diary/diary-merge';
import {
  type DiaryEntry,
  type DiaryResults,
  describeDiaryEntry,
} from '@/features/diary/diary-model';
import type { DiaryRemoval } from '@/features/diary/diary-storage';

/** A line of «Записи»: the patient's entry, or one the doctor deleted (shown struck out). */
type RecordRow =
  | { readonly at: string; readonly entry: DiaryEntry }
  | { readonly at: string; readonly removed: DiaryRemoval };

/** What the doctor does not have yet for this entry, if anything. */
function entryBadge(entry: DiaryEntry, sent: DiarySent | undefined): string | undefined {
  const known = sent?.entries[entry.id];
  if (known === undefined) return 'Не отправлена врачу';
  return known === entryFingerprint(entry) ? undefined : 'Изменена после отправки';
}

/**
 * «Мои записи»: newest first, grouped by day with today marked. Each record can be changed or
 * deleted right there; deleting asks once, in place, in plain words.
 */
export function DiaryRecords(props: {
  readonly results: DiaryResults;
  readonly sent: DiarySent | undefined;
  readonly saved: SavedEntry | undefined;
  readonly error: string;
  /** Absent when the tab bar opened the page. */
  readonly onBack?: (() => void) | undefined;
  /**
   * A care diary with the tab bar: marks are made on «Сегодня» and the bar has «Врачу», so the dock
   * at the bottom is not repeated; a connected diary sends by itself, so no «не отправлена» badge.
   */
  readonly tabbed?: boolean;
  readonly connected?: boolean;
  /** Entries the doctor deleted (connected diary): they stay in the list, struck out. */
  readonly removed?: readonly DiaryRemoval[] | undefined;
  readonly onWrite: () => void;
  readonly onSend: () => void;
  readonly onEdit: (entry: DiaryEntry) => void;
  readonly onDelete: (entry: DiaryEntry) => void;
}): JSX.Element {
  const [confirming, setConfirming] = createSignal<string | undefined>(undefined);
  const days = createMemo(() =>
    groupEntriesByDay<RecordRow>(
      [
        ...props.results.entries.map((entry) => ({ at: entry.at, entry })),
        ...(props.removed ?? []).map((removed) => ({ at: removed.at, removed })),
      ],
      new Date(),
    ),
  );
  const invitation = () => props.results.invitation;

  /** One of the patient's entries, with its change and delete actions. */
  const recordRow = (entry: DiaryEntry, today: boolean): JSX.Element => (
    <li
      class="diary-record"
      classList={{
        'diary-record--today': today,
        'diary-record--fresh': props.saved?.entry.id === entry.id,
      }}
    >
      <span class="diary-record__time">{formatTime(entry.at)}</span>
      <span class="diary-record__value">{describeDiaryEntry(invitation(), entry)}</span>
      <Show when={entry.note}>
        <span class="diary-record__note">{entry.note}</span>
      </Show>
      <Show when={entry.corrected}>
        <span class="diary-record__badge diary-record__badge--doctor">Исправлено врачом</span>
      </Show>
      <Show when={!props.connected && entryBadge(entry, props.sent)}>
        {(badge) => <span class="diary-record__badge">{badge()}</span>}
      </Show>
      <Show
        when={confirming() === entry.id}
        fallback={
          <div class="diary-record__actions">
            <Button
              class="diary-button"
              type="button"
              icon={<AppGlyph name="edit" class="diary-record__icon" />}
              aria-label={`Изменить запись от ${whenLabel(entry.at, new Date())}`}
              onClick={() => props.onEdit(entry)}
            >
              Изменить
            </Button>
            <Button
              class="diary-button"
              type="button"
              icon={<AppGlyph name="trash" class="diary-record__icon" />}
              aria-label={`Удалить запись от ${whenLabel(entry.at, new Date())}`}
              onClick={() => setConfirming(entry.id)}
            >
              Удалить
            </Button>
          </div>
        }
      >
        <div class="diary-record__confirm" role="alert">
          <p class="diary-record__question">Удалить эту запись насовсем?</p>
          <div class="diary-record__actions">
            <Button
              class="diary-button diary-button--danger"
              type="button"
              variant="danger"
              onClick={() => {
                setConfirming(undefined);
                props.onDelete(entry);
              }}
            >
              Да, удалить
            </Button>
            <Button class="diary-button" type="button" onClick={() => setConfirming(undefined)}>
              Нет, оставить
            </Button>
          </div>
        </div>
      </Show>
    </li>
  );

  return (
    <main class="diary-page diary-page--records">
      <ScreenHeader
        title="Записи"
        subtitle={`${invitation().title}: ${entriesLabel(props.results.entries.length)}`}
        onBack={props.onBack}
        hero={PAGE_HEROES.diaryRecords}
      />
      <Show when={props.error}>
        <p class="diary-error" role="alert">
          {props.error}
        </p>
      </Show>
      <Show when={props.saved}>
        {(saved) => (
          <SavedBanner
            heading={saved().kind === 'new' ? 'Запись сохранена' : 'Запись изменена'}
            line={describeDiaryEntry(invitation(), saved().entry)}
            when={`Время: ${whenLabel(saved().entry.at, new Date())}.`}
          />
        )}
      </Show>
      <Show
        when={props.results.entries.length > 0 || (props.removed ?? []).length > 0}
        fallback={
          <section class="diary-card" aria-label="Записей пока нет">
            <h2 class="diary-card__title">Записей пока нет</h2>
            <p class="diary-card__text">
              Когда вы запишете показания, они появятся здесь, новые сверху.
            </p>
          </section>
        }
      >
        <div class="diary-days">
          <For each={days()}>
            {(day) => (
              <section class="diary-day">
                <h2 class="diary-day__title">
                  <span
                    class="diary-day__name"
                    classList={{ 'diary-day__name--today': day.label.today }}
                  >
                    {day.label.title}
                  </span>
                  <span class="diary-day__date">{day.label.date}</span>
                </h2>
                <ul class="diary-day__list">
                  <For each={day.entries}>
                    {(row) =>
                      'removed' in row ? (
                        <li class="diary-record diary-record--removed">
                          <span class="diary-record__time">{formatTime(row.removed.at)}</span>
                          <span class="diary-record__value diary-record__value--removed">
                            {row.removed.line}
                          </span>
                          <span class="diary-record__badge diary-record__badge--doctor">
                            Удалено врачом
                          </span>
                        </li>
                      ) : (
                        recordRow(row.entry, day.label.today)
                      )
                    }
                  </For>
                </ul>
              </section>
            )}
          </For>
        </div>
      </Show>
      <Show when={!props.tabbed}>
        <div class="diary-dock">
          <Button
            class="diary-button diary-dock__primary"
            type="button"
            variant="primary"
            icon={<AppGlyph name="edit" class="diary-record__icon" />}
            onClick={props.onWrite}
          >
            Записать показания
          </Button>
          <Button
            class="diary-button diary-dock__secondary"
            type="button"
            icon={<AppGlyph name="envelope-simple" class="diary-record__icon" />}
            onClick={props.onSend}
          >
            Отправить врачу
          </Button>
        </div>
      </Show>
    </main>
  );
}
