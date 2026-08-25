import { createEffect, createSignal, type JSX, Match, Show, Switch } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { downloadNoteFile, type NoteFile, noteFileSrc } from '@/state/note-files';
import { queueTranscription } from '@/state/note-transcription';
import { attachmentViewerKind } from '@/state/thumbnails';

export type ViewerState =
  | { readonly kind: 'image'; readonly name: string; readonly src: string }
  | {
      readonly kind: 'video';
      readonly name: string;
      readonly src: string;
      readonly poster?: string;
    }
  | { readonly kind: 'audio'; readonly name: string; readonly src: string }
  | { readonly kind: 'text'; readonly name: string; readonly blob: Blob }
  | { readonly kind: 'pdf'; readonly name: string; readonly record: NoteFile }
  | { readonly kind: 'download'; readonly name: string; readonly record: NoteFile };

export function recordToViewerState(record: NoteFile): ViewerState {
  const kind = attachmentViewerKind(record.mimeType);
  if (kind === 'image') {
    return {
      kind: 'image',
      name: record.name,
      src: record.thumbnailDataUrl ?? noteFileSrc(record),
    };
  }
  if (kind === 'video' || kind === 'audio') {
    return {
      kind,
      name: record.name,
      src: noteFileSrc(record),
      ...(kind === 'video' && record.thumbnailDataUrl ? { poster: record.thumbnailDataUrl } : {}),
    };
  }
  if (kind === 'text') {
    return { kind: 'text', name: record.name, blob: record.blob };
  }
  return { kind: 'pdf', name: record.name, record };
}

async function readTextBlob(blob: Blob): Promise<string> {
  try {
    return await blob.slice(0, 256 * 1024).text();
  } catch {
    return 'Не удалось прочитать файл.';
  }
}

function TextPreviewBody(props: { readonly blob: Blob }): JSX.Element {
  const [content, setContent] = createSignal('');
  createEffect(() => {
    void readTextBlob(props.blob).then(setContent);
  });
  return <pre class="note-attachment-viewer__text">{content()}</pre>;
}

function DownloadPromptBody(props: {
  readonly name: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}): JSX.Element {
  return (
    <div class="note-attachment-viewer__prompt">
      <p>Этот тип файла нельзя показать в заметке.</p>
      <p>Сохранить «{props.name}» на устройство?</p>
      <div class="note-attachment-viewer__prompt-actions">
        <button
          type="button"
          class="patient-note-action patient-note-action--primary"
          onClick={props.onConfirm}
        >
          Да
        </button>
        <button type="button" onClick={props.onCancel}>
          Нет
        </button>
      </div>
    </div>
  );
}

export function AttachmentViewerDialog(props: {
  readonly state: ViewerState | null;
  readonly onClose: () => void;
}): JSX.Element {
  return (
    <Show when={props.state} keyed>
      {(current) => {
        const downloadable = 'record' in current ? current.record : undefined;
        const transcribable =
          downloadable && attachmentViewerKind(downloadable.mimeType) === 'audio';
        return (
          <div
            class="note-attachment-viewer"
            role="dialog"
            aria-modal="true"
            aria-label={current.name}
          >
            <button
              type="button"
              class="note-image-preview__zoom-backdrop"
              aria-label="Закрыть просмотр"
              onClick={props.onClose}
            />
            <div class="note-attachment-viewer__panel">
              <header class="note-attachment-viewer__header">
                <span class="note-attachment-viewer__name">{current.name}</span>
                <Show when={transcribable && downloadable}>
                  <button
                    type="button"
                    class="note-attachment-viewer__transcribe"
                    aria-label="Расшифровать аудио"
                    title="Расшифровать речь"
                    onClick={() => {
                      if (!downloadable) return;
                      queueTranscription({
                        fileId: downloadable.id,
                        noteId: downloadable.noteId,
                        blob: downloadable.blob,
                      });
                    }}
                  >
                    <AppGlyph name="text-aa" class="note-image-preview__icon" />
                  </button>
                </Show>
                <button
                  type="button"
                  class="note-attachment-viewer__close"
                  aria-label="Закрыть просмотр"
                  onClick={props.onClose}
                >
                  <AppGlyph name="close" class="note-image-preview__icon" />
                </button>
              </header>
              <Switch
                fallback={
                  <DownloadPromptBody
                    name={current.name}
                    onConfirm={() => {
                      if (downloadable) downloadNoteFile(downloadable);
                      props.onClose();
                    }}
                    onCancel={props.onClose}
                  />
                }
              >
                <Match when={current.kind === 'image'}>
                  <img
                    class="note-attachment-viewer__image"
                    src={(current as { readonly src: string }).src}
                    alt={current.name}
                  />
                </Match>
                <Match when={current.kind === 'video'}>
                  <video
                    class="note-attachment-viewer__media"
                    src={(current as { readonly src: string }).src}
                    controls
                    autoplay
                    playsinline
                  >
                    <track kind="captions" label="Без субтитров" />
                  </video>
                </Match>
                <Match when={current.kind === 'audio'}>
                  <audio
                    class="note-attachment-viewer__audio"
                    src={(current as { readonly src: string }).src}
                    controls
                  >
                    <track kind="captions" label="Без субтитров" />
                  </audio>
                </Match>
                <Match when={current.kind === 'text'}>
                  <TextPreviewBody blob={(current as { readonly blob: Blob }).blob} />
                </Match>
              </Switch>
            </div>
          </div>
        );
      }}
    </Show>
  );
}
