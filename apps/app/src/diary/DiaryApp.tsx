import QRCode from 'qrcode';
import { createEffect, createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';

import { Button } from '@/components/Button';
import { TextField } from '@/components/TextField';
import { encodeDiaryResults, readInvitationFragment } from '@/features/diary/diary-codec';
import { diaryToFhirBundle } from '@/features/diary/diary-fhir';
import {
  BLOOD_PRESSURE_LIMITS,
  createDiaryId,
  DIARY_KIND_TITLE,
  type DiaryEntry,
  type DiaryInvitation,
  type DiaryResults,
  describeDiaryEntry,
  GLUCOSE_CONTEXT_LABEL,
  GLUCOSE_CONTEXTS,
  type GlucoseContext,
  parseDiaryEntry,
} from '@/features/diary/diary-model';
import {
  createDiaryStore,
  type DiaryStore,
  withEntry,
  withoutEntry,
} from '@/features/diary/diary-storage';

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

function localDateTimeValue(date = new Date()): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function entryId(): string {
  return createDiaryId().slice(0, 10);
}

function EntryForm(props: {
  readonly invitation: DiaryInvitation;
  readonly onAdd: (value: Record<string, unknown>) => void;
}): JSX.Element {
  const [at, setAt] = createSignal(localDateTimeValue());
  const [systolic, setSystolic] = createSignal('');
  const [diastolic, setDiastolic] = createSignal('');
  const [pulse, setPulse] = createSignal('');
  const [mmol, setMmol] = createSignal('');
  const [context, setContext] = createSignal<GlucoseContext>('fasting');
  const [note, setNote] = createSignal('');

  const submit = (event: SubmitEvent): void => {
    event.preventDefault();
    const base = {
      id: entryId(),
      at: new Date(at()).toISOString(),
      ...(note().trim() ? { note: note().trim() } : {}),
    };
    if (props.invitation.kind === 'blood-pressure') {
      props.onAdd({
        ...base,
        systolic: Number(systolic()),
        diastolic: Number(diastolic()),
        ...(pulse().trim() ? { pulse: Number(pulse()) } : {}),
      });
      setSystolic('');
      setDiastolic('');
      setPulse('');
    } else {
      props.onAdd({ ...base, mmol: Number(mmol().replace(',', '.')), context: context() });
      setMmol('');
    }
    setNote('');
    setAt(localDateTimeValue());
  };

  return (
    <form class="diary-form" onSubmit={submit}>
      <Show
        when={props.invitation.kind === 'blood-pressure'}
        fallback={
          <div class="diary-form__row">
            <TextField
              class="diary-form__field"
              inputClass="diary-form__input"
              label="Глюкоза, ммоль/л"
              inputmode="decimal"
              required
              value={mmol()}
              pattern="[0-9]+([.,][0-9])?"
              onInput={(event) => setMmol(event.currentTarget.value)}
            />
            <label class="diary-form__field">
              <span class="diary-form__label">Когда</span>
              <select
                class="diary-form__input"
                value={context()}
                onChange={(event) => setContext(event.currentTarget.value as GlucoseContext)}
              >
                <For each={GLUCOSE_CONTEXTS}>
                  {(option) => <option value={option}>{GLUCOSE_CONTEXT_LABEL[option]}</option>}
                </For>
              </select>
            </label>
          </div>
        }
      >
        <div class="diary-form__row">
          <TextField
            class="diary-form__field"
            inputClass="diary-form__input"
            label="Верхнее"
            type="number"
            inputmode="numeric"
            required
            min={BLOOD_PRESSURE_LIMITS.systolic[0]}
            max={BLOOD_PRESSURE_LIMITS.systolic[1]}
            value={systolic()}
            onInput={(event) => setSystolic(event.currentTarget.value)}
          />
          <TextField
            class="diary-form__field"
            inputClass="diary-form__input"
            label="Нижнее"
            type="number"
            inputmode="numeric"
            required
            min={BLOOD_PRESSURE_LIMITS.diastolic[0]}
            max={BLOOD_PRESSURE_LIMITS.diastolic[1]}
            value={diastolic()}
            onInput={(event) => setDiastolic(event.currentTarget.value)}
          />
          <TextField
            class="diary-form__field"
            inputClass="diary-form__input"
            label="Пульс"
            type="number"
            inputmode="numeric"
            min={BLOOD_PRESSURE_LIMITS.pulse[0]}
            max={BLOOD_PRESSURE_LIMITS.pulse[1]}
            value={pulse()}
            onInput={(event) => setPulse(event.currentTarget.value)}
          />
        </div>
      </Show>
      <div class="diary-form__row">
        <TextField
          class="diary-form__field"
          inputClass="diary-form__input"
          label="Дата и время"
          type="datetime-local"
          required
          value={at()}
          onInput={(event) => setAt(event.currentTarget.value)}
        />
      </div>
      <TextField
        class="diary-form__field"
        inputClass="diary-form__input"
        label="Комментарий"
        maxLength={200}
        value={note()}
        placeholder="Например: болела голова"
        onInput={(event) => setNote(event.currentTarget.value)}
      />
      <Button class="diary-button" type="submit" variant="primary">
        Записать
      </Button>
    </form>
  );
}

function MedicationButtons(props: {
  readonly invitation: DiaryInvitation;
  readonly onAdd: (value: Record<string, unknown>) => void;
}): JSX.Element {
  const mark = (medication: number, taken: boolean): void =>
    props.onAdd({ id: entryId(), at: new Date().toISOString(), medication, taken });
  return (
    <ul class="diary-medications">
      <For each={props.invitation.medications ?? []}>
        {(medication, index) => (
          <li class="diary-medications__item">
            <div class="diary-medications__info">
              <strong class="diary-medications__name">{medication.name}</strong>
              <Show when={medication.dose || medication.schedule}>
                <span class="diary-medications__dose">
                  {[medication.dose, medication.schedule].filter(Boolean).join(' · ')}
                </span>
              </Show>
            </div>
            <div class="diary-medications__actions">
              <Button
                class="diary-button"
                type="button"
                variant="primary"
                onClick={() => mark(index(), true)}
              >
                Принял сейчас
              </Button>
              <Button class="diary-button" type="button" onClick={() => mark(index(), false)}>
                Пропустил
              </Button>
            </div>
          </li>
        )}
      </For>
    </ul>
  );
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

  const add = (value: Record<string, unknown>): void => {
    setError('');
    try {
      commit(withEntry(results(), parseDiaryEntry(props.invitation, value)));
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
        <h1 class="diary-header__title">{DIARY_KIND_TITLE[props.invitation.kind]}</h1>
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
        <Show
          when={props.invitation.kind === 'medication'}
          fallback={<EntryForm invitation={props.invitation} onAdd={add} />}
        >
          <MedicationButtons invitation={props.invitation} onAdd={add} />
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
                  <Button
                    class="diary-entries__remove"
                    type="button"
                    variant="quiet"
                    aria-label="Удалить запись"
                    onClick={() => remove(entry)}
                  >
                    ×
                  </Button>
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
                            {DIARY_KIND_TITLE[diary.kind]}
                            <span class="diary-list__meta">
                              выдан {new Date(diary.issuedAt).toLocaleDateString('ru-RU')}
                            </span>
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
