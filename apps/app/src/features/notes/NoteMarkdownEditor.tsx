import type { MedicalDocumentSummary } from '@localmed/contracts';
import { createMemo, createSignal, For, type JSX, Show } from 'solid-js';
import { Portal } from 'solid-js/web';

import { AppGlyph } from '@/components/AppGlyph';
import { SafeMarkdown } from '@/features/library/SafeMarkdown';
import { buildOfficialDocumentHash } from '@/state/document-route';
import '@/styles/note-markdown-editor.css';

interface MentionState {
  readonly start: number;
  readonly end: number;
  readonly query: string;
}

interface NoteMarkdownEditorProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly documents: readonly MedicalDocumentSummary[];
  readonly priorityDocumentIds?: readonly string[];
  readonly placeholder?: string;
  readonly disabled?: boolean;
}

function mentionAtCaret(value: string, caret: number): MentionState | null {
  const beforeCaret = value.slice(0, caret);
  const lineStart = beforeCaret.lastIndexOf('\n') + 1;
  const line = beforeCaret.slice(lineStart);
  const match = /(^|\s)[@/]([^@/\n]*)$/u.exec(line);
  if (!match) return null;
  const query = (match[2] ?? '').trimStart();
  const triggerIndex = line.lastIndexOf(match[0].trimStart()[0] ?? '@');
  if (triggerIndex < 0) return null;
  return {
    start: lineStart + triggerIndex,
    end: caret,
    query,
  };
}

function sanitizeLinkLabel(value: string): string {
  return value.replaceAll('[', '').replaceAll(']', '').trim();
}

export function NoteMarkdownEditor(props: NoteMarkdownEditorProps): JSX.Element {
  const [fullscreen, setFullscreen] = createSignal(false);
  const [mention, setMention] = createSignal<MentionState | null>(null);
  let textarea: HTMLTextAreaElement | undefined;

  const priorityIds = createMemo(() => new Set(props.priorityDocumentIds ?? []));
  const suggestions = createMemo(() => {
    const state = mention();
    if (!state) return [];
    const query = state.query.toLocaleLowerCase('ru-RU').trim();
    return props.documents
      .filter((document) => !query || document.title.toLocaleLowerCase('ru-RU').includes(query))
      .toSorted((left, right) => {
        const leftPriority = priorityIds().has(left.id);
        const rightPriority = priorityIds().has(right.id);
        if (leftPriority !== rightPriority) return leftPriority ? -1 : 1;
        return left.title.localeCompare(right.title, 'ru-RU');
      })
      .slice(0, 5);
  });

  const refreshMention = (target = textarea): void => {
    if (!target || props.disabled) {
      setMention(null);
      return;
    }
    setMention(mentionAtCaret(target.value, target.selectionStart ?? target.value.length));
  };

  const updateValue = (value: string, caret?: number): void => {
    props.onChange(value);
    queueMicrotask(() => {
      if (!textarea) return;
      if (caret !== undefined) textarea.setSelectionRange(caret, caret);
      textarea.focus();
      refreshMention();
    });
  };

  const replaceSelection = (
    before: string,
    after: string,
    placeholder: string,
    linePrefix = false,
  ): void => {
    if (!textarea || props.disabled) return;
    const start = textarea.selectionStart ?? props.value.length;
    const end = textarea.selectionEnd ?? start;
    const selected = props.value.slice(start, end) || placeholder;
    if (linePrefix) {
      const lineStart = props.value.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
      const next = `${props.value.slice(0, lineStart)}${before}${props.value.slice(lineStart)}`;
      updateValue(next, start + before.length);
      return;
    }
    const replacement = `${before}${selected}${after}`;
    const next = `${props.value.slice(0, start)}${replacement}${props.value.slice(end)}`;
    const selectionStart = start + before.length;
    props.onChange(next);
    queueMicrotask(() => {
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(selectionStart, selectionStart + selected.length);
      refreshMention();
    });
  };

  const startMention = (): void => {
    if (!textarea || props.disabled) return;
    const start = textarea.selectionStart ?? props.value.length;
    const end = textarea.selectionEnd ?? start;
    const prefix = start > 0 && !/\s/u.test(props.value[start - 1] ?? '') ? ' @' : '@';
    const next = `${props.value.slice(0, start)}${prefix}${props.value.slice(end)}`;
    updateValue(next, start + prefix.length);
  };

  const insertDocument = (document: MedicalDocumentSummary): void => {
    const state = mention();
    if (!state) return;
    const title = sanitizeLinkLabel(document.title) || 'Документ';
    const link = `[${title}](${buildOfficialDocumentHash(document.id)})`;
    const next = `${props.value.slice(0, state.start)}${link} ${props.value.slice(state.end)}`;
    setMention(null);
    updateValue(next, state.start + link.length + 1);
  };

  const editor = (): JSX.Element => (
    <section
      class="note-markdown-editor"
      classList={{ 'note-markdown-editor--fullscreen': fullscreen() }}
    >
      <div class="note-markdown-editor__workspace">
        <div class="note-markdown-editor__field">
          <textarea
            ref={textarea}
            class="note-markdown-editor__textarea"
            aria-label={props.label}
            value={props.value}
            placeholder={props.placeholder}
            disabled={props.disabled}
            rows={fullscreen() ? 16 : 7}
            onInput={(event) => {
              props.onChange(event.currentTarget.value);
              refreshMention(event.currentTarget);
            }}
            onClick={(event) => refreshMention(event.currentTarget)}
            onKeyUp={(event) => refreshMention(event.currentTarget)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && mention()) {
                event.preventDefault();
                setMention(null);
              }
            }}
          />
          <div
            class="note-markdown-editor__toolbar"
            role="toolbar"
            aria-label="Форматирование заметки"
          >
            <button
              type="button"
              aria-label="Заголовок"
              title="Заголовок"
              disabled={props.disabled}
              onClick={() => replaceSelection('## ', '', 'Раздел', true)}
            >
              H
            </button>
            <button
              type="button"
              aria-label="Жирный текст"
              title="Жирный текст"
              disabled={props.disabled}
              onClick={() => replaceSelection('**', '**', 'текст')}
            >
              B
            </button>
            <button
              type="button"
              aria-label="Маркированный список"
              title="Список"
              disabled={props.disabled}
              onClick={() => replaceSelection('- ', '', 'пункт', true)}
            >
              ≡
            </button>
            <button
              type="button"
              aria-label="Формула LaTeX"
              title="LaTeX"
              disabled={props.disabled}
              onClick={() => replaceSelection('$', '$', 'x = y')}
            >
              ∑
            </button>
            <button
              type="button"
              aria-label="Упомянуть документ"
              title="Документ (@ или /)"
              disabled={props.disabled}
              onClick={startMention}
            >
              @
            </button>
            <button
              type="button"
              aria-label={fullscreen() ? 'Выйти из полноэкранного режима' : 'На весь экран'}
              title={fullscreen() ? 'Свернуть' : 'На весь экран'}
              onClick={() => setFullscreen((value) => !value)}
            >
              <AppGlyph name={fullscreen() ? 'close' : 'arrows-out'} />
            </button>
          </div>
          <Show when={mention() && suggestions().length > 0}>
            <div class="note-markdown-editor__mentions" role="listbox">
              <For each={suggestions()}>
                {(document) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected="false"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => insertDocument(document)}
                  >
                    <span>{document.title}</span>
                    <Show when={priorityIds().has(document.id)}>
                      <small>из заметки</small>
                    </Show>
                  </button>
                )}
              </For>
            </div>
          </Show>
        </div>
        <section class="note-markdown-editor__preview" aria-label="Предпросмотр Markdown">
          <div class="note-markdown-editor__preview-heading">
            <span>Предпросмотр</span>
            <small>Markdown · LaTeX</small>
          </div>
          <Show
            when={props.value.trim()}
            fallback={
              <p class="note-markdown-editor__preview-empty">Предпросмотр появится здесь.</p>
            }
          >
            <SafeMarkdown markdown={props.value} />
          </Show>
        </section>
      </div>
    </section>
  );

  return (
    <Show when={fullscreen()} fallback={editor()}>
      <Portal>{editor()}</Portal>
    </Show>
  );
}
