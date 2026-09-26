import {
  createMemo,
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { toast } from 'solid-sonner';

import { Button } from '@/components/Button';
import { ConfirmationDialog } from '@/components/ConfirmationDialog';
import { TextArea } from '@/components/TextArea';
import { TextField } from '@/components/TextField';
import { isAsrReady } from '@/features/asr/asr-models';
import type { NoteFile } from '@/state/note-files';
import {
  deleteTranscript,
  isTranscriptionQueued,
  loadTranscript,
  NOTE_TRANSCRIPTS_EVENT,
  type NoteTranscript,
  queueTranscription,
  updateTranscript,
} from '@/state/note-transcription';

function timeLabel(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1_000));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const rest = seconds % 60;
  const body = `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
  return hours > 0 ? `${String(hours).padStart(2, '0')}:${body}` : body;
}

function defaultSpeakerLabels(transcript: NoteTranscript | null): ReadonlyMap<string, string> {
  const labels = new Map<string, string>();
  for (const segment of transcript?.segments ?? []) {
    if (!labels.has(segment.speakerId)) {
      labels.set(segment.speakerId, `Спикер ${labels.size + 1}`);
    }
  }
  return labels;
}

export function NoteTranscriptPanel(props: {
  readonly file: NoteFile;
  readonly onInsertText?: (text: string) => void;
}): JSX.Element {
  const [transcript, setTranscript] = createSignal<NoteTranscript | null>(null);
  const [draft, setDraft] = createSignal('');
  const [speakerNames, setSpeakerNames] = createSignal<Readonly<Record<string, string>>>({});
  const [loading, setLoading] = createSignal(true);
  const [loadError, setLoadError] = createSignal<string | null>(null);
  const [saving, setSaving] = createSignal(false);
  const [deleting, setDeleting] = createSignal(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = createSignal(false);

  const refresh = async (): Promise<void> => {
    try {
      const current = await loadTranscript(props.file.id);
      setTranscript(current);
      setDraft(current?.text ?? '');
      setSpeakerNames(current?.speakerNames ?? {});
      setLoadError(null);
    } catch (cause) {
      setLoadError(
        cause instanceof Error ? cause.message : 'Не удалось загрузить локальную расшифровку.',
      );
    } finally {
      setLoading(false);
    }
  };

  onMount(() => {
    void refresh();
    const listener = (event: Event): void => {
      if (
        event instanceof CustomEvent &&
        typeof event.detail?.fileId === 'string' &&
        event.detail.fileId !== props.file.id
      ) {
        return;
      }
      void refresh();
    };
    window.addEventListener(NOTE_TRANSCRIPTS_EVENT, listener);
    onCleanup(() => window.removeEventListener(NOTE_TRANSCRIPTS_EVENT, listener));
  });

  const queued = (): boolean => isTranscriptionQueued(props.file.id);
  const labels = createMemo(() => defaultSpeakerLabels(transcript()));
  const speakerIds = createMemo(() => (transcript()?.diarized ? [...labels().keys()] : []));
  const speakerLabel = (id: string): string =>
    transcript()?.diarized
      ? speakerNames()[id]?.trim() || labels().get(id) || id
      : 'Речь';

  const setSpeakerRole = (speakerId: string, label: string): void => {
    setSpeakerNames((current) => ({
      ...current,
      [speakerId]: label,
    }));
  };

  const speakerNamesEqual = (
    left: Readonly<Record<string, string>>,
    right: Readonly<Record<string, string>>,
  ): boolean => {
    const leftEntries = Object.entries(left)
      .filter(([, label]) => label.trim().length > 0)
      .toSorted(([leftId], [rightId]) => leftId.localeCompare(rightId));
    const rightEntries = Object.entries(right)
      .filter(([, label]) => label.trim().length > 0)
      .toSorted(([leftId], [rightId]) => leftId.localeCompare(rightId));
    return JSON.stringify(leftEntries) === JSON.stringify(rightEntries);
  };
  const hasUnsavedEdits = (): boolean => {
    const current = transcript();
    if (!current || current.status !== 'done') return false;
    return (
      draft() !== current.text ||
      !speakerNamesEqual(speakerNames(), current.speakerNames ?? {})
    );
  };

  const start = (force = false): void => {
    if (saving() || deleting()) return;
    if (
      force &&
      hasUnsavedEdits() &&
      !window.confirm(
        'Есть несохранённые правки расшифровки. Повторное распознавание заменит их. Продолжить?',
      )
    ) {
      return;
    }
    queueTranscription({
      fileId: props.file.id,
      noteId: props.file.noteId,
      blob: props.file.blob,
      ...(force ? { force: true } : {}),
    });
    void refresh();
  };

  const copy = async (value: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success('Скопировано.');
    } catch {
      toast.error('Не удалось скопировать расшифровку.');
    }
  };

  const speakerTranscript = (): string =>
    (transcript()?.segments ?? [])
      .map(
        (segment) =>
          `[${timeLabel(segment.startMs)}–${timeLabel(segment.endMs)}] ${speakerLabel(
            segment.speakerId,
          )}: ${segment.text}`,
      )
      .join('\n\n');

  const exportTranscript = (): void => {
    const value =
      (transcript()?.segments?.length ?? 0) > 0 ? speakerTranscript().trim() : draft().trim();
    if (!value) {
      toast.error('Расшифровка пустая.');
      return;
    }
    const baseName = props.file.name.replace(/\.[^.]+$/u, '').trim() || 'Расшифровка';
    const blob = new Blob([value, '\n'], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${baseName} — расшифровка.txt`;
    anchor.rel = 'noopener';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const save = async (): Promise<void> => {
    const current = transcript();
    if (!current) return;
    setSaving(true);
    try {
      const saved = await updateTranscript({
        fileId: current.fileId,
        text: draft(),
        speakerNames: speakerNames(),
      });
      setTranscript(saved);
      toast.success('Расшифровка сохранена.');
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Не удалось сохранить расшифровку.');
    } finally {
      setSaving(false);
    }
  };

  const removeTranscript = async (): Promise<void> => {
    setDeleting(true);
    try {
      await deleteTranscript(props.file.id);
      setTranscript(null);
      setDraft('');
      setSpeakerNames({});
      setLoadError(null);
      setDeleteConfirmOpen(false);
      toast.success('Расшифровка удалена. Аудиозапись сохранена.');
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Не удалось удалить расшифровку.');
    } finally {
      setDeleting(false);
    }
  };

  const statusText = (): string => {
    if (queued() && transcript()?.status !== 'running') return 'В очереди';
    switch (transcript()?.status) {
      case 'running':
        return 'Распознаём речь…';
      case 'done':
        return 'Готово';
      case 'failed':
        return 'Ошибка распознавания';
      case 'unsupported':
        return 'Модель не активирована';
      default:
        return loading() ? 'Загрузка…' : 'Расшифровки пока нет';
    }
  };

  return (
    <section class="note-transcript" aria-label="Расшифровка аудио">
      <header class="note-transcript__header">
        <strong class="note-transcript__title">Расшифровка</strong>
        <span class="note-transcript__status" aria-live="polite">
          {statusText()}
        </span>
      </header>

      <Show when={loadError()}>
        {(message) => (
          <p class="note-transcript__error" role="alert">
            {message()}
          </p>
        )}
      </Show>

      <Show when={transcript()?.status === 'failed'}>
        <p class="note-transcript__error">{transcript()?.error ?? 'Не удалось распознать запись.'}</p>
      </Show>

      <Show when={transcript()?.status === 'unsupported'}>
        <Show
          when={isAsrReady()}
          fallback={
            <>
              <p class="note-transcript__hint">
                Сначала активируйте Whisper Base или Whisper Small в настройках. После первой
                загрузки модель работает офлайн.
              </p>
              <Button type="button" onClick={() => (window.location.hash = '#/settings')}>
                Открыть настройки
              </Button>
            </>
          }
        >
          <p class="note-transcript__hint">Модель уже активна — запись можно отправить повторно.</p>
          <Button type="button" variant="primary" onClick={() => start(true)}>
            Расшифровать
          </Button>
        </Show>
      </Show>

      <Show when={!loading() && transcript()?.status !== 'running' && !queued()}>
        <Show when={transcript()?.status !== 'done' && transcript()?.status !== 'unsupported'}>
          <Button type="button" variant="primary" onClick={() => start()}>
            {transcript()?.status === 'failed' ? 'Повторить' : 'Расшифровать'}
          </Button>
        </Show>
      </Show>

      <Show when={transcript()?.status === 'done'}>
        <Show
          when={
            transcript()?.diarized !== true && (transcript()?.segments?.length ?? 0) > 0
          }
        >
          <p class="note-transcript__hint">
            Таймкоды получены из Whisper. Разделение спикеров в браузере ещё не включено.
          </p>
        </Show>

        <Show when={transcript()?.diarized === true && speakerIds().length > 0}>
          <div class="note-transcript__speakers">
            <For each={speakerIds()}>
              {(speakerId) => (
                <div class="note-transcript__speaker-editor">
                  <TextField
                    label={labels().get(speakerId) ?? speakerId}
                    value={speakerNames()[speakerId] ?? ''}
                    placeholder={labels().get(speakerId) ?? speakerId}
                    onInput={(event) =>
                      setSpeakerNames((current) => ({
                        ...current,
                        [speakerId]: event.currentTarget.value,
                      }))
                    }
                  />
                  <div class="note-transcript__speaker-actions">
                    <Button
                      type="button"
                      class="note-transcript__speaker-role"
                      variant="quiet"
                      onClick={() => setSpeakerRole(speakerId, 'Врач')}
                    >
                      Врач
                    </Button>
                    <Button
                      type="button"
                      class="note-transcript__speaker-role"
                      variant="quiet"
                      onClick={() => setSpeakerRole(speakerId, 'Пациент')}
                    >
                      Пациент
                    </Button>
                    <Button
                      type="button"
                      class="note-transcript__speaker-role"
                      variant="quiet"
                      onClick={() => setSpeakerRole(speakerId, '')}
                    >
                      Сбросить
                    </Button>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>

        <Show when={(transcript()?.segments?.length ?? 0) > 0}>
          <div class="note-transcript__segments">
            <For each={transcript()?.segments ?? []}>
              {(segment) => (
                <div class="note-transcript__segment">
                  <span class="note-transcript__time">
                    {timeLabel(segment.startMs)}–{timeLabel(segment.endMs)}
                  </span>
                  <strong class="note-transcript__speaker">{speakerLabel(segment.speakerId)}</strong>
                  <span class="note-transcript__segment-text">{segment.text}</span>
                </div>
              )}
            </For>
          </div>
        </Show>

        <TextArea
          label="Текст расшифровки"
          value={draft()}
          rows={7}
          onInput={(event) => setDraft(event.currentTarget.value)}
        />
        <div class="note-transcript__actions">
          <Button
            type="button"
            variant="primary"
            disabled={saving() || deleting()}
            onClick={() => void save()}
          >
            {saving() ? 'Сохранение…' : 'Сохранить правки'}
          </Button>
          <Show when={props.onInsertText && draft().trim()}>
            <Button
              type="button"
              onClick={() => {
                const value = draft().trim();
                if (value) props.onInsertText?.(value);
              }}
            >
              Вставить в заметку
            </Button>
          </Show>
          <Button type="button" onClick={() => void copy(draft())}>
            Копировать текст
          </Button>
          <Show when={(transcript()?.segments?.length ?? 0) > 0}>
            <Show when={props.onInsertText}>
              <Button
                type="button"
                onClick={() => {
                  const value = speakerTranscript();
                  if (value) props.onInsertText?.(value);
                }}
              >
                Вставить с таймкодами
              </Button>
            </Show>
            <Button type="button" onClick={() => void copy(speakerTranscript())}>
              Копировать с таймкодами
            </Button>
          </Show>
          <Button type="button" disabled={deleting()} onClick={exportTranscript}>
            Скачать .txt
          </Button>
          <Button
            type="button"
            disabled={deleting() || saving()}
            onClick={() => start(true)}
          >
            Распознать заново
          </Button>
        </div>
      </Show>

      <Show when={transcript() && transcript()?.status !== 'running'}>
        <div class="note-transcript__retention-actions">
          <Button
            type="button"
            variant="danger"
            disabled={deleting() || saving()}
            onClick={() => setDeleteConfirmOpen(true)}
          >
            {deleting() ? 'Удаление…' : 'Удалить расшифровку'}
          </Button>
        </div>
      </Show>

      <ConfirmationDialog
        open={deleteConfirmOpen()}
        title="Удалить расшифровку?"
        description={
          <>
            Текст, таймкоды и имена спикеров будут удалены с этого устройства. Исходная
            аудиозапись останется в заметке.
          </>
        }
        confirmLabel="Удалить расшифровку"
        danger
        onConfirm={() => void removeTranscript()}
        onOpenChange={setDeleteConfirmOpen}
      />
    </section>
  );
}
