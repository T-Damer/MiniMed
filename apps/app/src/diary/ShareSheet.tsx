import QRCode from 'qrcode';
import { createEffect, createSignal, type JSX, onCleanup, onMount, Show } from 'solid-js';

import { Button } from '@/components/Button';
import { formatDateTime } from '@/diary/diary-format';
import { encodeDiaryResults, encodeDiaryResultsText } from '@/features/diary/diary-codec';
import type { DiaryShareStatus } from '@/features/diary/diary-merge';
import type { DiaryResults } from '@/features/diary/diary-model';

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

/** One sentence about what the doctor has and has not received yet. */
export function shareStatusText(status: DiaryShareStatus): string {
  if (status.total === 0) return 'Записей пока нет — передавать нечего.';
  const when = status.sentAt ? ` (${formatDateTime(status.sentAt)})` : '';
  if (!status.sentAt) return `Врачу ещё ничего не передано. Записей: ${status.total}.`;
  if (status.unsent === 0 && status.changed === 0) return `Всё передано врачу${when}.`;
  const parts = [
    status.unsent > 0 ? `новых: ${status.unsent}` : '',
    status.changed > 0 ? `изменённых после передачи: ${status.changed}` : '',
  ].filter(Boolean);
  const done = status.total - status.unsent;
  return `Передано врачу${when}: ${done} из ${status.total}. Не передано — ${parts.join(', ')}.`;
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

/**
 * Hands the diary to the doctor: on the screen as QR codes, as a file (a messenger or the
 * downloads folder) or as text. The patient confirms when the doctor has it, so the diary can say
 * honestly what was and was not handed over.
 */
export function ShareSheet(props: {
  readonly results: DiaryResults;
  readonly status: DiaryShareStatus;
  readonly onSent: () => void;
  readonly onClose: () => void;
}): JSX.Element {
  const [showCodes, setShowCodes] = createSignal(false);
  const [used, setUsed] = createSignal(false);
  const [message, setMessage] = createSignal('');
  const [error, setError] = createSignal('');

  const sendFile = async (): Promise<void> => {
    setError('');
    setMessage('');
    try {
      const file = await resultsFile(props.results);
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: props.results.invitation.title });
          setMessage('Файл отправлен. Когда врач получит его, нажмите «Врач получил».');
        } catch (cause) {
          // Closing the share sheet is a normal outcome, not a failure.
          if (cause instanceof DOMException && cause.name === 'AbortError') return;
          throw cause;
        }
      } else {
        downloadFile(file);
        setMessage('Файл сохранён в загрузках. Отправьте его врачу и нажмите «Врач получил».');
      }
      setUsed(true);
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
      setUsed(true);
    } catch (cause) {
      setError(errorMessage(cause, 'Не удалось скопировать. Отправьте файлом.'));
    }
  };

  return (
    <section class="diary-share" aria-label="Передать врачу">
      <h2 class="diary-share__title">Передать врачу</h2>
      <p class="diary-share__status">{shareStatusText(props.status)}</p>
      <div class="diary-share__methods">
        <Button
          class="diary-button"
          type="button"
          variant="primary"
          aria-expanded={showCodes()}
          onClick={() => {
            setShowCodes((value) => !value);
            setUsed(true);
          }}
        >
          {showCodes() ? 'Скрыть коды' : 'Показать коды на экране'}
        </Button>
        <Button class="diary-button" type="button" onClick={() => void sendFile()}>
          Отправить файлом
        </Button>
        <Button class="diary-button" type="button" onClick={() => void copyText()}>
          Скопировать текстом
        </Button>
      </div>
      <Show when={showCodes()}>
        <QrCarousel results={props.results} />
      </Show>
      <Show when={message()}>
        <p class="diary-share__hint" role="status">
          {message()}
        </p>
      </Show>
      <Show when={error()}>
        <p class="diary-error" role="alert">
          {error()}
        </p>
      </Show>
      <Show when={used()}>
        <div class="diary-share__confirm">
          <p class="diary-share__hint">Врач получил все записи?</p>
          <div class="diary-share__answers">
            <Button
              class="diary-button"
              type="button"
              variant="primary"
              onClick={() => {
                props.onSent();
                setUsed(false);
                setMessage('Отмечено: всё передано врачу.');
              }}
            >
              Врач получил
            </Button>
            <Button class="diary-button" type="button" onClick={() => setUsed(false)}>
              Ещё нет
            </Button>
          </div>
        </div>
      </Show>
      <Button class="diary-button" type="button" variant="quiet" onClick={props.onClose}>
        Назад к дневнику
      </Button>
    </section>
  );
}
