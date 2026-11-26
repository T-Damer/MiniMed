import { DIARY_MEDIA_WINDOW_MS } from '@localmed/contracts';
import { randomId } from '@localmed/diary-sync';
import { createEffect, createSignal, For, type JSX, on, onCleanup, onMount, Show } from 'solid-js';
import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { formatTime } from '@/diary/diary-format';
import { DiaryApiError } from '@/features/diary/connected/diary-api';
import type { DoctorDiaries } from '@/features/diary/connected/doctor-workspace';
import {
  DiaryMediaPeer,
  mediaAccept,
  mediaSelectionValid,
} from '@/features/diary/connected/media-channel';
import type { MediaOffer } from '@/features/diary/connected/media-signaling';
import type { PatientConnection } from '@/features/diary/connected/patient-connection';
import '@/diary/diary-media.css';

function errorText(cause: unknown): string {
  if (cause instanceof DiaryApiError) {
    if (cause.status === 409 || cause.status === 410)
      return 'Запрос уже использован или истёк. Попросите врача открыть новый.';
    if (cause.status === 403) return 'Доступ к передаче закрыт.';
    if (cause.status === 404) return 'Сервис дневников пока не поддерживает передачу файлов.';
  }
  return 'Связь прервалась. Для повторной передачи нужен новый запрос врача.';
}

function TransferProgress(props: { readonly value: number; readonly label: string }): JSX.Element {
  return (
    <div class="diary-media__progress" role="status">
      <span>{props.label}</span>
      <progress class="diary-media__meter" aria-label={props.label} max={100} value={props.value} />
    </div>
  );
}

function MediaPreview(props: {
  readonly file: Blob;
  readonly label: string;
  readonly playable?: boolean;
}) {
  const url = URL.createObjectURL(props.file);
  const [failed, setFailed] = createSignal(false);
  const [imageSource, setImageSource] = createSignal(url);
  let active = true;
  onCleanup(() => {
    active = false;
    URL.revokeObjectURL(url);
  });
  const recoverImage = async () => {
    if (imageSource() !== url || !/^image\/hei[cf]$/u.test(props.file.type)) {
      setFailed(true);
      return;
    }
    try {
      const { previewExtractor } = await import('@/state/thumbnails');
      const thumbnail = await previewExtractor.forFile(props.file, props.file.type);
      if (!active) return;
      if (thumbnail) setImageSource(thumbnail);
      else setFailed(true);
    } catch {
      if (active) setFailed(true);
    }
  };
  return (
    <Show
      when={!failed()}
      fallback={
        <div class="diary-media__preview-fallback" role="img" aria-label={props.label}>
          <AppGlyph name="image" class="diary-media__glyph" />
        </div>
      }
    >
      <Show
        when={props.file.type.startsWith('video/')}
        fallback={
          <img
            class="diary-media__preview"
            classList={{ 'diary-media__preview--draft': !props.playable }}
            loading="lazy"
            src={imageSource()}
            alt={props.label}
            onError={() => void recoverImage()}
          />
        }
      >
        <div class="diary-media__video">
          <video
            class="diary-media__preview"
            classList={{ 'diary-media__preview--draft': !props.playable }}
            aria-label={props.label}
            src={props.playable ? url : `${url}#t=0.1`}
            preload={props.playable ? 'metadata' : 'auto'}
            controls={props.playable}
            controlslist="nodownload"
            muted={!props.playable}
            playsinline
            onError={() => setFailed(true)}
          />
          <Show when={!props.playable}>
            <AppGlyph name="play" class="diary-media__play" />
          </Show>
        </div>
      </Show>
    </Show>
  );
}

export function PatientMediaRequest(props: {
  readonly offer: MediaOffer | undefined;
  readonly connection: PatientConnection;
  readonly onReview: () => void;
}): JSX.Element {
  const [selected, setSelected] = createSignal<readonly File[]>([]);
  const [active, setActive] = createSignal<MediaOffer>();
  const [dismissed, setDismissed] = createSignal<string>();
  const [problem, setProblem] = createSignal('');
  const [progress, setProgress] = createSignal(0);
  const [sending, setSending] = createSignal(false);
  const [sent, setSent] = createSignal(false);
  const [expired, setExpired] = createSignal(false);
  let picker: HTMLInputElement | undefined;
  let peer: DiaryMediaPeer | undefined;
  let attempt: AbortController | undefined;
  let mounted = true;
  const current = () => active() ?? props.offer;
  createEffect(
    on(
      () => current()?.requestId,
      () => {
        const offer = current();
        setExpired(false);
        if (!offer) return;
        setSelected([]);
        setProblem('');
        const timer = setTimeout(() => setExpired(true), Math.max(0, offer.expiresAt - Date.now()));
        onCleanup(() => clearTimeout(timer));
      },
    ),
  );
  onCleanup(() => {
    mounted = false;
    attempt?.abort();
    peer?.close();
  });

  const send = async () => {
    const offer = current();
    const files = selected();
    if (!offer || sending() || expired() || !mediaSelectionValid(files)) return;
    setSending(true);
    setActive(offer);
    setProblem('');
    attempt = new AbortController();
    const { signal } = attempt;
    try {
      const configuration = await props.connection.mediaIce();
      if (signal.aborted) return;
      peer = new DiaryMediaPeer(configuration);
      await peer.send(
        offer.sdp,
        files,
        (sdp) => props.connection.answerMedia(offer, sdp),
        (bytes, total) => {
          setProgress(Math.round((bytes / total) * 100));
        },
      );
      if (!signal.aborted) setSent(true);
    } catch (cause) {
      if (!signal.aborted) setProblem(errorText(cause));
    } finally {
      peer?.close();
      peer = undefined;
      attempt = undefined;
      if (mounted) {
        setSelected([]);
        setSending(false);
      }
    }
  };
  const cancel = () => {
    attempt?.abort();
    peer?.close();
    setProblem('Передача отменена.');
  };
  const dismiss = () => {
    setDismissed(current()?.requestId);
    setActive(undefined);
    setSent(false);
    setProgress(0);
    setProblem('');
  };
  return (
    <Show when={current() && current()?.requestId !== dismissed()}>
      <section class="diary-media" aria-label="Запрос файлов от врача">
        <div class="diary-media__heading">
          <AppGlyph name="image" class="diary-media__glyph" />
          <strong class="diary-media__title">Врач просит прислать фото или видео</strong>
          <Show when={!sending()}>
            <Button
              variant="icon"
              aria-label="Закрыть запрос"
              onClick={dismiss}
              icon={<AppGlyph name="close" />}
            />
          </Show>
        </div>
        <Show when={!sent() && !sending() && !expired() && !active()}>
          <input
            type="file"
            hidden
            multiple
            accept={mediaAccept}
            ref={picker}
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? []);
              event.currentTarget.value = '';
              if (!files.length) return;
              if (!mediaSelectionValid(files)) {
                setProblem('Выберите до 8 фото или видео. До 32 МБ на файл и до 48 МБ всего.');
                return;
              }
              setSelected(files);
              setProblem('');
              props.onReview();
            }}
          />
          <Show
            when={selected().length}
            fallback={
              <p class="diary-media__copy">Выберите файлы, которые хотите передать врачу.</p>
            }
          >
            <ul class="diary-media__files diary-media__files--draft" aria-label="Выбранные файлы">
              <For each={selected()}>
                {(file) => (
                  <li class="diary-media__filename">
                    <MediaPreview file={file} label={file.name} />
                  </li>
                )}
              </For>
            </ul>
          </Show>
          <div class="diary-media__actions">
            <Button
              variant={selected().length ? 'quiet' : 'secondary'}
              onClick={() => picker?.click()}
            >
              {selected().length ? 'Выбрать другие' : 'Выбрать файлы'}
            </Button>
            <Show when={selected().length}>
              <Button variant="primary" onClick={() => void send()}>
                Отправить врачу
              </Button>
            </Show>
          </div>
        </Show>
        <Show when={sending()}>
          <TransferProgress value={progress()} label="Передаём врачу" />
          <Button onClick={cancel}>Отменить передачу</Button>
        </Show>
        <Show when={problem()}>
          <p class="diary-media__copy" role="alert">
            {problem()}
          </p>
        </Show>
        <Show when={sent()}>
          <p class="diary-media__copy" role="status">
            Файлы доставлены врачу.
          </p>
        </Show>
        <Show when={expired() && !sending() && !sent() && !problem()}>
          <p class="diary-media__copy">Запрос истёк.</p>
        </Show>
      </section>
    </Show>
  );
}

export function DoctorMediaMessage(props: {
  readonly requestAt: number;
  readonly patientId: string;
  readonly workspace: DoctorDiaries;
  readonly onClose: () => void;
  readonly onReceived: () => void;
}): JSX.Element {
  const requestId = randomId();
  const requestTime = new Date(props.requestAt).toISOString();
  const [state, setState] = createSignal<
    'opening' | 'waiting' | 'receiving' | 'received' | 'failed'
  >('opening');
  const [progress, setProgress] = createSignal(0);
  const [problem, setProblem] = createSignal('');
  const [files, setFiles] = createSignal<readonly Blob[]>([]);
  let closed = false;
  let peer: DiaryMediaPeer | undefined;
  let seq: number | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let unlisten: (() => void) | undefined;
  const stop = () => {
    clearTimeout(timeout);
    unlisten?.();
    peer?.close();
  };
  const cancelOffer = (offerSeq: number) => {
    void props.workspace
      .signalMedia(props.patientId, requestId, { kind: 'cancel' }, offerSeq)
      .catch(() => {
        // The peer has closed and the request expires on both clients even if offline.
      });
  };
  const fail = (text: string) => {
    if (closed || state() === 'received') return;
    setProblem(text);
    setState('failed');
    stop();
  };
  onMount(() => {
    const start = async () => {
      try {
        const configuration = await props.workspace.mediaIce(props.patientId);
        if (closed) return;
        const connection = new DiaryMediaPeer(configuration);
        peer = connection;
        let answered = false;
        unlisten = props.workspace.listenMedia(props.patientId, requestId, (signal) => {
          if (signal.kind !== 'answer' || answered || closed || state() === 'failed') return;
          answered = true;
          void connection.accept(signal.sdp).catch((cause: unknown) => fail(errorText(cause)));
        });
        const sdp = await connection.offer(
          (bytes, total) => {
            setState('receiving');
            setProgress(total ? Math.round((bytes / total) * 100) : 0);
          },
          (received) => {
            if (closed) return;
            clearTimeout(timeout);
            setFiles(received.map(({ blob }) => blob));
            setState('received');
            props.onReceived();
          },
          () => fail(errorText(undefined)),
        );
        if (closed) return;
        seq = await props.workspace.signalMedia(props.patientId, requestId, { kind: 'offer', sdp });
        if (closed) {
          cancelOffer(seq);
          return;
        }
        if (state() === 'opening') setState('waiting');
        timeout = setTimeout(
          () => fail('Запрос истёк. Можно отправить новый.'),
          DIARY_MEDIA_WINDOW_MS,
        );
      } catch (cause) {
        fail(errorText(cause));
      }
    };
    void start();
  });
  onCleanup(() => {
    closed = true;
    stop();
    if (seq && state() !== 'received') cancelOffer(seq);
  });
  return (
    <section class="diary-media-stream" aria-label="Передача файлов в чате">
      <div class="diary-media diary-media--doctor">
        <strong class="diary-media__title">Запрос фото или видео</strong>
        <Show when={state() === 'opening' || state() === 'waiting'}>
          <p class="diary-media__copy" role="status">
            {state() === 'opening' ? 'Открываем канал передачи…' : 'Ждём файлы от пациента'}
          </p>
          <Button variant="quiet" onClick={props.onClose}>
            Отменить запрос
          </Button>
        </Show>
        <Show when={state() === 'receiving'}>
          <TransferProgress value={progress()} label="Получаем файлы" />
        </Show>
        <Show when={state() === 'failed'}>
          <p class="diary-media__copy" role="alert">
            {problem()}
          </p>
          <Button variant="quiet" onClick={props.onClose}>
            Закрыть запрос
          </Button>
        </Show>
        <time class="companion-chat__time" dateTime={requestTime}>
          {formatTime(requestTime)}
        </time>
      </div>
      <Show when={state() === 'received'}>
        <div class="diary-media diary-media--incoming">
          <p class="diary-media__copy" role="status">
            Пациент прислал вложения
          </p>
          <ul class="diary-media__files diary-media__files--received">
            <For each={files()}>
              {(file, index) => (
                <li class="diary-media__received">
                  <MediaPreview
                    file={file}
                    label={`${file.type.startsWith('video/') ? 'Видео' : 'Фото'} ${index() + 1}`}
                    playable
                  />
                </li>
              )}
            </For>
          </ul>
        </div>
      </Show>
    </section>
  );
}
