import QRCode from 'qrcode';
import { createEffect, createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { formatLongDateTime } from '@/diary/diary-format';
import { sendDescription, sendSummary } from '@/diary/diary-home';
import { ActionCard, ScreenHeader } from '@/diary/diary-ui';
import { encodeDiaryResults, encodeDiaryResultsText } from '@/features/diary/diary-codec';
import type { DiaryShareStatus } from '@/features/diary/diary-merge';
import { type DiaryResults, describeDiaryEntry } from '@/features/diary/diary-model';

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

function QrCarousel(props: { readonly results: DiaryResults }): JSX.Element {
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
    <div class="diary-share__qr">
      <p class="diary-share__hint">
        Держите экран перед камерой врача: коды меняются сами. Врач сканирует их в приложении
        MiniMed. Данные не отправляются через интернет.
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
              class="diary-button diary-share__control"
              type="button"
              onClick={() =>
                setIndex((current) => (current - 1 + images().length) % images().length)
              }
            >
              Назад
            </Button>
            <Button
              class="diary-button diary-share__control"
              type="button"
              onClick={() => setPaused((value) => !value)}
            >
              {paused() ? 'Продолжить' : 'Пауза'}
            </Button>
            <Button
              class="diary-button diary-share__control"
              type="button"
              onClick={() => setIndex((current) => (current + 1) % images().length)}
            >
              Дальше
            </Button>
          </div>
        </Show>
      </Show>
    </div>
  );
}

async function resultsFile(results: DiaryResults): Promise<File> {
  const text = await encodeDiaryResultsText(results);
  const header = [
    `Дневник MiniMed: ${results.invitation.title}.`,
    `Записей: ${results.entries.length}.`,
    'Откройте этот файл в MiniMed у врача: «Принять данные» → «Выбрать файл».',
    'Файл можно хранить как копию своих записей.',
    '',
  ].join('\n');
  return new File([`${header}${text}\n`], `дневник-${results.invitation.id}.txt`, {
    type: 'text/plain',
  });
}

function downloadFile(file: File): void {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

type Method = 'codes' | 'file' | 'text';

/**
 * Hands the diary to the doctor in three plain steps: what goes, how it goes (codes on the screen,
 * a file, text) and, once the patient has used a way, whether the doctor really has it. Showing
 * codes is not proof, so nothing is marked as sent until the patient says so.
 */
export function DiarySend(props: {
  readonly results: DiaryResults;
  readonly status: DiaryShareStatus;
  readonly onSent: () => void;
  readonly onBack: () => void;
  readonly onWrite: () => void;
}): JSX.Element {
  const [showCodes, setShowCodes] = createSignal(false);
  const [used, setUsed] = createSignal(false);
  const [declined, setDeclined] = createSignal(false);
  const [done, setDone] = createSignal(false);
  const [message, setMessage] = createSignal('');
  const [error, setError] = createSignal('');
  const invitation = () => props.results.invitation;
  const sorted = () => props.results.entries.toSorted((a, b) => b.at.localeCompare(a.at));

  const use = (method: Method): void => {
    setUsed(true);
    setDeclined(false);
    if (method !== 'codes') setShowCodes(false);
  };

  const sendFile = async (): Promise<void> => {
    setError('');
    setMessage('');
    try {
      const file = await resultsFile(props.results);
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: invitation().title });
          setMessage('Файл отправлен. Когда врач получит его, нажмите «Да, врач получил».');
        } catch (cause) {
          // Closing the share sheet is a normal outcome, not a failure.
          if (cause instanceof DOMException && cause.name === 'AbortError') return;
          throw cause;
        }
      } else {
        downloadFile(file);
        setMessage('Файл сохранён в загрузках. Отправьте его врачу и нажмите «Да, врач получил».');
      }
      use('file');
    } catch (cause) {
      setError(errorMessage(cause, 'Не удалось подготовить файл.'));
    }
  };

  const copyText = async (): Promise<void> => {
    setError('');
    setMessage('');
    try {
      await navigator.clipboard.writeText(await encodeDiaryResultsText(props.results));
      setMessage('Текст скопирован. Вставьте его в сообщение врачу.');
      use('text');
    } catch (cause) {
      setError(errorMessage(cause, 'Не удалось скопировать. Отправьте файлом.'));
    }
  };

  return (
    <main class="diary-page diary-page--send">
      <ScreenHeader title="Отправить врачу" subtitle={invitation().title} onBack={props.onBack} />
      <Show
        when={props.results.entries.length > 0}
        fallback={
          <section class="diary-card" aria-label="Отправлять пока нечего">
            <h2 class="diary-card__title">Отправлять пока нечего</h2>
            <p class="diary-card__text">
              Сначала запишите показания: после этого их можно будет отправить врачу.
            </p>
            <Button
              class="diary-button"
              type="button"
              variant="primary"
              icon={<AppGlyph name="edit" class="diary-send__icon" />}
              onClick={props.onWrite}
            >
              Записать показания
            </Button>
          </section>
        }
      >
        <Show
          when={!done()}
          fallback={
            <section class="diary-done" role="status" aria-label="Готово">
              <AppGlyph name="check" class="diary-done__icon" />
              <h2 class="diary-done__title">Готово</h2>
              <p class="diary-done__text">{sendSummary(props.status).text}</p>
              <p class="diary-done__text">
                Если появятся новые записи, дневник напомнит, что их нужно отправить.
              </p>
              <Button class="diary-button" type="button" variant="primary" onClick={props.onBack}>
                Вернуться к дневнику
              </Button>
            </section>
          }
        >
          <section class="diary-step" aria-labelledby="diary-step-1">
            <h2 class="diary-step__title" id="diary-step-1">
              <span class="diary-step__number" aria-hidden="true">
                1
              </span>
              Что будет отправлено
            </h2>
            <p class="diary-send__status">{sendDescription(props.status, props.results.entries)}</p>
            <details class="diary-fold">
              <summary class="diary-fold__summary">Показать записи, которые уйдут врачу</summary>
              <ul class="diary-fold__list">
                <For each={sorted()}>
                  {(entry) => (
                    <li class="diary-fold__item">
                      <span class="diary-fold__time">{formatLongDateTime(entry.at)}</span>
                      <span class="diary-fold__value">
                        {describeDiaryEntry(invitation(), entry)}
                      </span>
                    </li>
                  )}
                </For>
              </ul>
            </details>
            <p class="diary-step__hint">
              Врач увидит название дневника и эти записи. Ваше имя и другие данные не отправляются.
            </p>
          </section>
          <section class="diary-step diary-share" aria-labelledby="diary-step-2">
            <h2 class="diary-step__title" id="diary-step-2">
              <span class="diary-step__number" aria-hidden="true">
                2
              </span>
              Выберите, как отправить
            </h2>
            <div class="diary-share__methods">
              <ActionCard
                primary
                chevron={false}
                icon="camera"
                title="Показать врачу на экране"
                status="Врач сканирует коды камерой в приложении MiniMed. Интернет не нужен."
                expanded={showCodes()}
                onClick={() => {
                  setShowCodes((value) => !value);
                  use('codes');
                }}
              />
              <Show when={showCodes()}>
                <QrCarousel results={props.results} />
              </Show>
              <ActionCard
                chevron={false}
                icon="share-fat"
                title="Отправить файлом"
                status="Файл уйдёт в мессенджер или почту, а если их нет — сохранится в загрузках."
                onClick={() => void sendFile()}
              />
              <ActionCard
                chevron={false}
                icon="file-text"
                title="Скопировать текстом"
                status="Текст можно вставить в сообщение врачу."
                onClick={() => void copyText()}
              />
            </div>
            <Show when={message()}>
              <p class="diary-send__message" role="status">
                {message()}
              </p>
            </Show>
            <Show when={error()}>
              <p class="diary-error" role="alert">
                {error()}
              </p>
            </Show>
          </section>
          <Show when={used()}>
            <section class="diary-dock diary-dock--confirm" aria-label="Врач получил записи?">
              <Show
                when={!declined()}
                fallback={
                  <>
                    <p class="diary-dock__question">
                      Хорошо. Когда врач получит записи, отметьте это здесь.
                    </p>
                    <Button
                      class="diary-button diary-dock__primary"
                      type="button"
                      variant="primary"
                      onClick={() => {
                        props.onSent();
                        setDone(true);
                      }}
                    >
                      Да, врач получил
                    </Button>
                  </>
                }
              >
                <h2 class="diary-dock__question">Врач получил все записи?</h2>
                <Button
                  class="diary-button diary-dock__primary"
                  type="button"
                  variant="primary"
                  onClick={() => {
                    props.onSent();
                    setDone(true);
                  }}
                >
                  Да, врач получил
                </Button>
                <Button
                  class="diary-button diary-dock__secondary"
                  type="button"
                  onClick={() => setDeclined(true)}
                >
                  Ещё нет
                </Button>
              </Show>
            </section>
          </Show>
        </Show>
      </Show>
    </main>
  );
}
