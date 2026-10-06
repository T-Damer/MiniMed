import { createSignal, For, type JSX, onMount, Show } from 'solid-js';

import { Button } from '@/components/Button';
import { entriesLabel, formatDateTime, formatTime, isSameLocalDay } from '@/diary/diary-format';
import { InstallCard, MessengerWarning } from '@/diary/InstallCard';
import { RestoreCard } from '@/diary/RestoreCard';
import { ShareSheet, shareStatusText } from '@/diary/ShareSheet';
import { DiaryEntryForm } from '@/features/diary/DiaryEntryForm';
import { diaryToFhirBundle } from '@/features/diary/diary-fhir';
import { entryFingerprint, markAllSent, shareStatus } from '@/features/diary/diary-merge';
import {
  activePlanItems,
  type DiaryEntry,
  type DiaryResults,
  describeDiaryEntry,
  parseDiaryEntry,
} from '@/features/diary/diary-model';
import { diaryPrintHtml, printHtmlInFrame } from '@/features/diary/diary-print';
import { type DiaryStore, withEntry, withoutEntry } from '@/features/diary/diary-storage';

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

export function DiaryView(props: {
  readonly store: DiaryStore;
  readonly initial: DiaryResults;
  /** What happened when the link was opened (a new diary, an update, an older link…). */
  readonly notice?: string | undefined;
  readonly onBack: () => void;
}): JSX.Element {
  const [results, setResults] = createSignal<DiaryResults>(props.initial);
  const [sent, setSent] = createSignal(props.store.meta(props.initial.invitation.id).sent);
  const [error, setError] = createSignal('');
  const [saved, setSaved] = createSignal('');
  // The «diary added / updated» message is for the first look; it goes once the patient writes.
  const [noticeShown, setNoticeShown] = createSignal(true);
  const [sharing, setSharing] = createSignal(false);
  const [editing, setEditing] = createSignal<DiaryEntry | null>(null);
  const invitation = () => results().invitation;

  onMount(() => {
    props.store.setMeta(invitation().id, { lastOpenedAt: new Date().toISOString() });
    props.store.setUi({ lastOpenedId: invitation().id });
  });

  const commit = (next: DiaryResults): void => {
    props.store.save(next);
    setResults(next);
    requestPersistentStorage();
  };

  const status = () => shareStatus(results().entries, sent());
  const today = () =>
    results().entries.filter((entry) => isSameLocalDay(new Date(entry.at), new Date()));

  const save = (value: Record<string, unknown>): void => {
    setError('');
    setSaved('');
    try {
      const entry = parseDiaryEntry(invitation(), value);
      commit(withEntry(withoutEntry(results(), entry.id), entry));
      setEditing(null);
      setNoticeShown(false);
      setSaved(`Запись сохранена на этом устройстве (${formatTime(entry.at)}).`);
    } catch (cause) {
      setError(errorMessage(cause, 'Не удалось сохранить запись.'));
    }
  };

  const remove = (entry: DiaryEntry): void => {
    if (!window.confirm('Удалить запись?')) return;
    try {
      commit(withoutEntry(results(), entry.id));
      setSaved('');
    } catch (cause) {
      setError(errorMessage(cause, 'Не удалось удалить запись.'));
    }
  };

  const confirmSent = (): void => {
    const next = markAllSent(results().entries, new Date().toISOString());
    props.store.setMeta(invitation().id, { sent: next });
    setSent(next);
  };

  const entryBadge = (entry: DiaryEntry): string | undefined => {
    const known = sent()?.entries[entry.id];
    if (known === undefined) return 'Не передана врачу';
    return known === entryFingerprint(entry) ? undefined : 'Изменена после передачи';
  };

  const planItems = () => activePlanItems(invitation());

  return (
    <main class="diary-page">
      <nav class="diary-nav" aria-label="Навигация">
        <Button class="diary-nav__back" type="button" variant="quiet" onClick={props.onBack}>
          ← Мои дневники
        </Button>
      </nav>
      <header class="diary-header">
        <h1 class="diary-header__title">{invitation().title}</h1>
        <Show when={invitation().doctor}>
          <p class="diary-header__meta">Врач: {invitation().doctor}</p>
        </Show>
        <Show when={invitation().note}>
          <p class="diary-header__note">{invitation().note}</p>
        </Show>
      </header>
      <Show when={props.notice && noticeShown()}>
        <p class="diary-notice" role="status">
          {props.notice}
        </p>
      </Show>
      <MessengerWarning />
      <Show when={error()}>
        <p class="diary-error" role="alert">
          {error()}
        </p>
      </Show>
      <Show
        when={!sharing()}
        fallback={
          <ShareSheet
            results={results()}
            status={status()}
            onSent={confirmSent}
            onClose={() => setSharing(false)}
          />
        }
      >
        <InstallCard store={props.store} entries={results().entries.length} />
        <Show when={planItems().length > 0}>
          <section class="diary-plan-list" aria-label="Назначение врача">
            <h2 class="diary-entries__title">{invitation().planTitle ?? 'Назначение врача'}</h2>
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
        <section class="diary-today" aria-label="Новая запись">
          <h2 class="diary-today__title">{editing() ? 'Изменить запись' : 'Новая запись'}</h2>
          <p class="diary-today__status">
            {today().length === 0
              ? 'Сегодня записей ещё нет.'
              : `Сегодня: ${entriesLabel(today().length)}, последняя в ${formatTime(today().at(-1)?.at ?? new Date().toISOString())}.`}
          </p>
          <Show when={saved()}>
            <p class="diary-saved" role="status">
              {saved()}
            </p>
          </Show>
          <Show
            when={editing()}
            fallback={<DiaryEntryForm invitation={invitation()} onSave={save} />}
          >
            {(entry) => (
              <DiaryEntryForm
                invitation={invitation()}
                entry={entry()}
                onSave={save}
                onCancel={() => setEditing(null)}
              />
            )}
          </Show>
        </section>
        <Show when={results().entries.length > 0}>
          <section class="diary-send" aria-label="Передать врачу">
            <h2 class="diary-entries__title">Передать врачу</h2>
            <p class="diary-send__status">{shareStatusText(status())}</p>
            <Button
              class="diary-button"
              type="button"
              variant={status().unsent + status().changed > 0 ? 'primary' : 'secondary'}
              onClick={() => setSharing(true)}
            >
              Передать врачу
            </Button>
          </section>
        </Show>
        <section class="diary-entries" aria-label="Записи">
          <h2 class="diary-entries__title">Записи: {results().entries.length}</h2>
          <ul class="diary-entries__list">
            <For each={[...results().entries].reverse()}>
              {(entry) => (
                <li class="diary-entries__item">
                  <span class="diary-entries__time">{formatDateTime(entry.at)}</span>
                  <span class="diary-entries__value">
                    {describeDiaryEntry(invitation(), entry)}
                  </span>
                  <Show when={entry.note}>
                    <span class="diary-entries__note">{entry.note}</span>
                  </Show>
                  <Show when={entryBadge(entry)}>
                    {(badge) => <span class="diary-entries__badge">{badge()}</span>}
                  </Show>
                  <div class="diary-entries__actions">
                    <Button
                      class="diary-entries__edit"
                      type="button"
                      variant="quiet"
                      aria-label="Изменить запись"
                      onClick={() => {
                        setEditing(entry);
                        setSaved('');
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                    >
                      Изменить
                    </Button>
                    <Button
                      class="diary-entries__remove"
                      type="button"
                      variant="quiet"
                      aria-label="Удалить запись"
                      onClick={() => remove(entry)}
                    >
                      ×
                    </Button>
                  </div>
                </li>
              )}
            </For>
          </ul>
        </section>
        <details class="diary-card diary-more">
          <summary class="diary-more__summary">Печать, файлы и копия</summary>
          <div class="diary-actions">
            <Button
              class="diary-button"
              type="button"
              onClick={() => printHtmlInFrame(diaryPrintHtml(invitation(), results().entries, 10))}
            >
              Распечатать
            </Button>
            <Button
              class="diary-button"
              type="button"
              disabled={results().entries.length === 0}
              onClick={() => downloadFhir(results())}
            >
              Файл для другой программы (FHIR)
            </Button>
          </div>
          <RestoreCard
            store={props.store}
            onRestored={(id) => {
              if (id === invitation().id) setResults(props.store.read(id) ?? results());
            }}
          />
        </details>
        <p class="diary-header__privacy">
          Записи хранятся только на этом устройстве, в браузере. Не очищайте данные сайта до визита
          к врачу.
        </p>
      </Show>
    </main>
  );
}
