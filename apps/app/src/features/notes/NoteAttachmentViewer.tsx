import { createEffect, createSignal, type JSX, Match, Show, Switch } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { SafeMarkdown } from '@/features/library/SafeMarkdown';
import { NoteTranscriptPanel } from '@/features/notes/NoteTranscriptPanel';
import {
  recordToViewerState,
  type ViewerState,
} from '@/features/notes/note-attachment-viewer-state';
import { downloadNoteFile } from '@/state/note-files';

export {
  recordToViewerState,
  type ViewerState,
} from '@/features/notes/note-attachment-viewer-state';

async function readTextBlob(blob: Blob): Promise<string> {
  try {
    return await blob.slice(0, 256 * 1024).text();
  } catch {
    return 'Не удалось прочитать файл.';
  }
}

function isMarkdownAttachment(name: string, mimeType?: string): boolean {
  return mimeType === 'text/markdown' || /\.(?:md|markdown)$/iu.test(name);
}

function TextPreviewBody(props: {
  readonly name: string;
  readonly mimeType: string | undefined;
  readonly blob: Blob;
}): JSX.Element {
  const [content, setContent] = createSignal('');
  const isMarkdown = isMarkdownAttachment(props.name, props.mimeType);
  const [readingMode, setReadingMode] = createSignal(isMarkdown);
  createEffect(() => {
    void readTextBlob(props.blob).then(setContent);
  });
  return (
    <div class="note-attachment-viewer__text-body">
      <Show when={isMarkdown}>
        <div
          class="note-attachment-viewer__text-toolbar"
          role="toolbar"
          aria-label="Режим просмотра"
        >
          <Button
            type="button"
            class="note-attachment-viewer__mode-toggle"
            variant="quiet"
            aria-pressed={readingMode()}
            aria-label={readingMode() ? 'Показать исходный Markdown' : 'Включить режим чтения'}
            onClick={() => setReadingMode((active) => !active)}
            icon={
              <AppGlyph
                name={readingMode() ? 'file-text' : 'book-open'}
                class="note-attachment-viewer__mode-toggle-icon"
              />
            }
          >
            {readingMode() ? 'Исходник' : 'Читать'}
          </Button>
        </div>
      </Show>
      <Show
        when={isMarkdown && readingMode()}
        fallback={<pre class="note-attachment-viewer__text">{content()}</pre>}
      >
        <SafeMarkdown class="note-attachment-viewer__markdown" markdown={content()} />
      </Show>
    </div>
  );
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
        <Button type="button" variant="primary" onClick={props.onConfirm}>
          Да
        </Button>
        <Button type="button" onClick={props.onCancel}>
          Нет
        </Button>
      </div>
    </div>
  );
}

export function AttachmentViewerDialog(props: {
  readonly state: ViewerState | null;
  readonly onClose: () => void;
  readonly onInsertTranscript?: (text: string) => void;
}): JSX.Element {
  return (
    <Show when={props.state} keyed>
      {(current) => {
        const downloadable = 'record' in current ? current.record : undefined;
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
                  <div class="note-attachment-viewer__audio-body">
                    <audio
                      class="note-attachment-viewer__audio"
                      src={(current as { readonly src: string }).src}
                      controls
                    >
                      <track kind="captions" label="Без субтитров" />
                    </audio>
                    <Show
                      when={(current as Extract<ViewerState, { readonly kind: 'audio' }>).record}
                    >
                      {(record) => (
                        <NoteTranscriptPanel
                          file={record()}
                          {...(props.onInsertTranscript
                            ? { onInsertText: props.onInsertTranscript }
                            : {})}
                        />
                      )}
                    </Show>
                  </div>
                </Match>
                <Match when={current.kind === 'text'}>
                  <TextPreviewBody
                    name={current.name}
                    mimeType={(current as { readonly mimeType?: string }).mimeType}
                    blob={(current as { readonly blob: Blob }).blob}
                  />
                </Match>
              </Switch>
            </div>
          </div>
        );
      }}
    </Show>
  );
}
