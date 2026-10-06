import { For, type JSX, onMount, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { lastEntrySummary, sendSummary, todaySummary, whenLabel } from '@/diary/diary-home';
import { ActionCard, SavedBanner } from '@/diary/diary-ui';
import { InstallCard, MessengerWarning } from '@/diary/InstallCard';
import type { DiaryShareStatus } from '@/features/diary/diary-merge';
import {
  activePlanItems,
  type DiaryEntry,
  type DiaryResults,
  describeDiaryEntry,
} from '@/features/diary/diary-model';
import type { DiaryStore } from '@/features/diary/diary-storage';

export interface SavedEntry {
  readonly entry: DiaryEntry;
  readonly kind: 'new' | 'edited';
}

/**
 * The first screen of a diary: whose diary it is, what the doctor asked for, and the three things
 * the patient does here — write down a reading, look at the records, send them to the doctor —
 * as whole-width buttons that say in words where things stand. Everything else is under «Ещё».
 */
export function DiaryHome(props: {
  readonly store: DiaryStore;
  readonly results: DiaryResults;
  readonly status: DiaryShareStatus;
  /** What happened when the link was opened, until the patient dismisses it. */
  readonly notice: string | undefined;
  readonly saved: SavedEntry | undefined;
  readonly error: string;
  /** Other diaries exist: show the way back to the list. */
  readonly hasOtherDiaries: boolean;
  readonly onWrite: () => void;
  readonly onRecords: () => void;
  readonly onSend: () => void;
  readonly onMore: () => void;
  readonly onDismissNotice: () => void;
  readonly onList: () => void;
}): JSX.Element {
  let title: HTMLHeadingElement | undefined;
  onMount(() => title?.focus({ preventScroll: true }));
  const invitation = () => props.results.invitation;
  const now = () => new Date();
  const send = () => sendSummary(props.status);
  const planItems = () => activePlanItems(invitation());

  return (
    <main class="diary-page diary-page--home">
      <MessengerWarning />
      <Show when={props.error}>
        <p class="diary-error" role="alert">
          {props.error}
        </p>
      </Show>
      <div class="diary-home">
        <div class="diary-home__info">
          <Show when={props.hasOtherDiaries}>
            <Button
              class="diary-screen__back"
              type="button"
              variant="quiet"
              icon={<AppGlyph name="arrow-left" class="diary-screen__back-icon" />}
              onClick={props.onList}
            >
              Мои дневники
            </Button>
          </Show>
          <header class="diary-header">
            <h1 class="diary-header__title" tabindex="-1" ref={title}>
              {invitation().title}
            </h1>
            <Show when={invitation().doctor}>
              <p class="diary-header__meta">Врач: {invitation().doctor}</p>
            </Show>
          </header>
          <Show when={invitation().note}>
            <section class="diary-instruction" aria-label="Что просит врач">
              <h2 class="diary-instruction__title">Что просит врач</h2>
              <p class="diary-header__note">{invitation().note}</p>
            </section>
          </Show>
        </div>
        <section class="diary-home__actions" aria-label="Что сделать">
          <Show when={props.saved}>
            {(saved) => (
              <SavedBanner
                heading={saved().kind === 'new' ? 'Запись сохранена' : 'Запись изменена'}
                line={describeDiaryEntry(invitation(), saved().entry)}
                when={`Время: ${whenLabel(saved().entry.at, now())}. Хранится на этом устройстве.`}
                hint={send().pending > 0 ? 'Перед визитом отправьте записи врачу.' : undefined}
              />
            )}
          </Show>
          <ActionCard
            primary
            icon="edit"
            title="Записать показания"
            status={todaySummary(props.results.entries, now())}
            onClick={props.onWrite}
          />
          <ActionCard
            icon="list-bullets"
            title={`Мои записи (${props.results.entries.length})`}
            status={lastEntrySummary(props.results.entries, now())}
            onClick={props.onRecords}
          />
          <ActionCard
            icon="envelope-simple"
            title="Отправить врачу"
            status={send().text}
            tone={send().tone}
            onClick={props.onSend}
          />
          <Button
            class="diary-more-link"
            type="button"
            icon={<AppGlyph name="dots-three" class="diary-more-link__icon" />}
            onClick={props.onMore}
          >
            Ещё: печать, копия, справка
          </Button>
        </section>
        <div class="diary-home__aside">
          <Show when={planItems().length > 0}>
            <section class="diary-plan-list" aria-label="Назначение врача">
              <h2 class="diary-plan-list__title">{invitation().planTitle ?? 'Назначение врача'}</h2>
              <ul class="diary-plan-list__items">
                <For each={planItems()}>
                  {(item) => (
                    <li class="diary-plan-list__item">
                      <strong class="diary-plan-list__name">{item.name}</strong>
                      <Show when={item.dose || item.schedule}>
                        <span class="diary-plan-list__detail">
                          {[item.dose, item.schedule].filter(Boolean).join(' · ')}
                        </span>
                      </Show>
                    </li>
                  )}
                </For>
              </ul>
            </section>
          </Show>
          <Show when={props.notice}>
            <section class="diary-notice" role="status" aria-label="Сообщение">
              <p class="diary-notice__text">{props.notice}</p>
              <Button class="diary-button" type="button" onClick={props.onDismissNotice}>
                Понятно
              </Button>
            </section>
          </Show>
          <InstallCard store={props.store} entries={props.results.entries.length} variant="tip" />
          <p class="diary-header__privacy">
            Записи хранятся только на этом устройстве, в браузере. Не очищайте данные сайта до
            визита к врачу.
          </p>
        </div>
      </div>
    </main>
  );
}
