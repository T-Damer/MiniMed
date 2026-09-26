import QRCode from 'qrcode';
import { createEffect, createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';

import { Button } from '@/components/Button';
import { DiaryEntryForm } from '@/features/diary/DiaryEntryForm';
import { encodeDiaryResults, readInvitationFragment } from '@/features/diary/diary-codec';
import { diaryToFhirBundle } from '@/features/diary/diary-fhir';
import {
  type DiaryEntry,
  type DiaryInvitation,
  type DiaryResults,
  describeDiaryEntry,
  parseDiaryEntry,
} from '@/features/diary/diary-model';
import { diaryPrintHtml, printHtmlInFrame } from '@/features/diary/diary-print';
import {
  createDiaryStore,
  type DiaryStore,
  withEntry,
  withoutEntry,
} from '@/features/diary/diary-storage';

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function ShareCodes(props: {
  readonly results: DiaryResults;
  readonly onClose: () => void;
}): JSX.Element {
  const [images, setImages] = createSignal<readonly string[]>([]);
  const [index, setIndex] = createSignal(0);
  const [paused, setPaused] = createSignal(false);
  const [error, setError] = createSignal('');

  onMount(() => {
    void encodeDiaryResults(props.results)
      .then((parts) =>
        Promise.all(
          parts.map((part) =>
            QRCode.toDataURL(part, { errorCorrectionLevel: 'M', margin: 2, width: 360 }),
          ),
        ),
      )
      .then(setImages)
      .catch((cause: unknown) => setError(errorMessage(cause, 'Не удалось подготовить коды.')));
  });

  createEffect(() => {
    const count = images().length;
    if (count < 2 || paused()) return;
    const timer = window.setInterval(() => setIndex((current) => (current + 1) % count), 1600);
    onCleanup(() => window.clearInterval(timer));
  });

  return (
    <section class="diary-share" aria-label="Коды для врача">
      <h2 class="diary-share__title">Покажите экран врачу</h2>
      <p class="diary-share__hint">
        Врач сканирует коды камерой в приложении MiniMed. Данные не отправляются через интернет.
      </p>
      <Show when={error()}>
        <p class="diary-error" role="alert">
          {error()}
        </p>
      </Show>
      <Show when={images().length > 0} fallback={<p class="diary-share__hint">Готовим коды…</p>}>
        <img
          class="diary-share__code"
          src={images()[index()]}
          alt={`Код ${index() + 1} из ${images().length}`}
        />
        <p class="diary-share__counter" aria-live="polite">
          Код {index() + 1} из {images().length}
        </p>
        <Show when={images().length > 1}>
          <div class="diary-share__controls">
            <Button
              class="diary-button"
              type="button"
              onClick={() =>
                setIndex((current) => (current - 1 + images().length) % images().length)
              }
            >
              Назад
            </Button>
            <Button class="diary-button" type="button" onClick={() => setPaused((value) => !value)}>
              {paused() ? 'Продолжить' : 'Пауза'}
            </Button>
            <Button
              class="diary-button"
              type="button"
              onClick={() => setIndex((current) => (current + 1) % images().length)}
            >
              Дальше
            </Button>
          </div>
        </Show>
      </Show>
      <Button class="diary-button" type="button" variant="primary" onClick={props.onClose}>
        Готово
      </Button>
    </section>
  );
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

function DiaryView(props: {
  readonly store: DiaryStore;
  readonly invitation: DiaryInvitation;
  readonly initial: DiaryResults;
}) {
  const [results, setResults] = createSignal<DiaryResults>(props.initial);
  const [error, setError] = createSignal('');
  const [sharing, setSharing] = createSignal(false);

  const commit = (next: DiaryResults): void => {
    props.store.save(next);
    setResults(next);
  };

  const [editing, setEditing] = createSignal<DiaryEntry | null>(null);

  const save = (value: Record<string, unknown>): void => {
    setError('');
    try {
      const entry = parseDiaryEntry(props.invitation, value);
      commit(withEntry(withoutEntry(results(), entry.id), entry));
      setEditing(null);
    } catch (cause) {
      setError(errorMessage(cause, 'Не удалось сохранить запись.'));
    }
  };

  const remove = (entry: DiaryEntry): void => {
    if (!window.confirm('Удалить запись?')) return;
    try {
      commit(withoutEntry(results(), entry.id));
    } catch (cause) {
      setError(errorMessage(cause, 'Не удалось удалить запись.'));
    }
  };

  return (
    <main class="diary-page">
      <header class="diary-header">
        <h1 class="diary-header__title">{props.invitation.title}</h1>
        <Show when={props.invitation.doctor}>
          <p class="diary-header__meta">Врач: {props.invitation.doctor}</p>
        </Show>
        <Show when={props.invitation.note}>
          <p class="diary-header__note">{props.invitation.note}</p>
        </Show>
        <p class="diary-header__privacy">
          Записи хранятся только в этом браузере. Не очищайте данные сайта до визита к врачу.
        </p>
      </header>
      <Show when={error()}>
        <p class="diary-error" role="alert">
          {error()}
        </p>
      </Show>
      <Show
        when={!sharing()}
        fallback={<ShareCodes results={results()} onClose={() => setSharing(false)} />}
      >
        <Show when={props.invitation.plan?.length}>
          <section class="diary-plan-list" aria-label="Назначение врача">
            <h2 class="diary-entries__title">{props.invitation.planTitle ?? 'Назначение врача'}</h2>
            <ul class="diary-plan-list__items">
              <For each={props.invitation.plan ?? []}>
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
        <Show
          when={editing()}
          fallback={<DiaryEntryForm invitation={props.invitation} onSave={save} />}
        >
          {(entry) => (
            <DiaryEntryForm
              invitation={props.invitation}
              entry={entry()}
              onSave={save}
              onCancel={() => setEditing(null)}
            />
          )}
        </Show>
        <div class="diary-actions">
          <Button
            class="diary-button"
            type="button"
            variant="primary"
            disabled={results().entries.length === 0}
            onClick={() => setSharing(true)}
          >
            Показать врачу
          </Button>
          <Button
            class="diary-button"
            type="button"
            disabled={results().entries.length === 0}
            onClick={() => downloadFhir(results())}
          >
            Сохранить файл
          </Button>
          <Button
            class="diary-button"
            type="button"
            onClick={() =>
              printHtmlInFrame(diaryPrintHtml(props.invitation, results().entries, 10))
            }
          >
            Распечатать
          </Button>
        </div>
        <section class="diary-entries" aria-label="Записи">
          <h2 class="diary-entries__title">Записи: {results().entries.length}</h2>
          <ul class="diary-entries__list">
            <For each={[...results().entries].reverse()}>
              {(entry) => (
                <li class="diary-entries__item">
                  <span class="diary-entries__time">{formatDateTime(entry.at)}</span>
                  <span class="diary-entries__value">
                    {describeDiaryEntry(props.invitation, entry)}
                  </span>
                  <Show when={entry.note}>
                    <span class="diary-entries__note">{entry.note}</span>
                  </Show>
                  <div class="diary-entries__actions">
                    <Button
                      class="diary-entries__edit"
                      type="button"
                      variant="quiet"
                      aria-label="Изменить запись"
                      onClick={() => {
                        setEditing(entry);
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
      </Show>
    </main>
  );
}

export function DiaryApp(): JSX.Element {
  const [state, setState] = createSignal<
    | { readonly kind: 'loading' }
    | { readonly kind: 'error'; readonly message: string }
    | {
        readonly kind: 'diary';
        readonly store: DiaryStore;
        readonly invitation: DiaryInvitation;
        readonly initial: DiaryResults;
      }
    | {
        readonly kind: 'list';
        readonly store: DiaryStore;
        readonly diaries: readonly DiaryInvitation[];
      }
  >({ kind: 'loading' });

  const open = async (): Promise<void> => {
    try {
      const store = createDiaryStore(window.localStorage);
      const invitation = await readInvitationFragment(window.location.hash);
      if (invitation) {
        setState({ kind: 'diary', store, invitation, initial: store.load(invitation) });
      } else {
        setState({ kind: 'list', store, diaries: store.list() });
      }
    } catch (cause) {
      setState({ kind: 'error', message: errorMessage(cause, 'Не удалось открыть дневник.') });
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
          case 'error':
            return (
              <main class="diary-page">
                <p class="diary-error" role="alert">
                  {current.message}
                </p>
                <p class="diary-header__privacy">
                  Попросите врача заново показать QR-код дневника.
                </p>
              </main>
            );
          case 'list':
            return (
              <main class="diary-page">
                <h1 class="diary-header__title">Дневники самоконтроля</h1>
                <Show
                  when={current.diaries.length > 0}
                  fallback={
                    <p class="diary-header__privacy">
                      Здесь пока нет дневников. Отсканируйте QR-код, который покажет врач.
                    </p>
                  }
                >
                  <ul class="diary-list">
                    <For each={current.diaries}>
                      {(diary) => (
                        <li class="diary-list__item">
                          <Button
                            class="diary-button diary-list__open"
                            type="button"
                            onClick={() => {
                              try {
                                setState({
                                  kind: 'diary',
                                  store: current.store,
                                  invitation: diary,
                                  initial: current.store.load(diary),
                                });
                              } catch (cause) {
                                setState({
                                  kind: 'error',
                                  message: errorMessage(cause, 'Не удалось открыть дневник.'),
                                });
                              }
                            }}
                          >
                            <span class="diary-list__open-content">
                              {diary.title}
                              <span class="diary-list__meta">
                                выдан {new Date(diary.issuedAt).toLocaleDateString('ru-RU')}
                              </span>
                            </span>
                          </Button>
                          <Button
                            class="diary-list__delete"
                            type="button"
                            variant="danger"
                            aria-label={`Удалить: ${diary.title}`}
                            title="Удалить дневник с этого устройства"
                            onClick={() => {
                              if (
                                !window.confirm(
                                  'Удалить этот дневник и все его локальные записи с этого устройства?',
                                )
                              ) {
                                return;
                              }
                              try {
                                current.store.remove(diary.id);
                                setState({
                                  kind: 'list',
                                  store: current.store,
                                  diaries: current.store.list(),
                                });
                              } catch (cause) {
                                window.alert(errorMessage(cause, 'Не удалось удалить дневник.'));
                              }
                            }}
                          >
                            Удалить
                          </Button>
                        </li>
                      )}
                    </For>
                  </ul>
                </Show>
              </main>
            );
          case 'diary':
            return (
              <DiaryView
                store={current.store}
                invitation={current.invitation}
                initial={current.initial}
              />
            );
        }
      })()}
    </>
  );
}
