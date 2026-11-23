import { createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { toast } from 'solid-sonner';
import { AppGlyph } from '@/components/AppGlyph';
import type { HighlightPopupPlacement } from '@/features/library/highlight-popup-placement';
import { USER_HIGHLIGHT_COLORS, type UserHighlightColor } from '@/state/user-library-highlights';

export function UserHighlightPopup(props: {
  readonly x: number;
  readonly y: number;
  /** Over the text (mouse), under it clear of the system selection menu (touch), or docked. */
  readonly placement?: HighlightPopupPlacement | undefined;
  readonly onAdd?: ((color: UserHighlightColor) => Promise<void>) | undefined;
  readonly onRemove?: (() => Promise<void>) | undefined;
  /** «Найти в словаре» for the selected word or phrase; the caller opens the dictionary sheet. */
  readonly onLookup?: (() => void) | undefined;
  /** «Спросить ИИ» when online and an external provider is configured (Wave 3.2). */
  readonly onAskAi?: (() => void) | undefined;
  /** Optional personal note already attached to a tapped highlight (Wave 2.2). */
  readonly initialHighlightNote?: string | undefined;
  /** Saves a personal note onto the tapped highlight. */
  readonly onSaveNote?: ((note: string) => Promise<void>) | undefined;
  /** How the highlight got here when not by selecting it (carried over, reworded, …). */
  readonly note?: string | undefined;
  readonly onClose: () => void;
}): JSX.Element {
  let root!: HTMLFieldSetElement;
  const [saving, setSaving] = createSignal(false);
  const [editingNote, setEditingNote] = createSignal(false);
  const [draftNote, setDraftNote] = createSignal(props.initialHighlightNote ?? '');
  const run = (action: () => Promise<void>): void => {
    if (saving()) return;
    setSaving(true);
    void action()
      .catch(() => toast.error('Не удалось сохранить выделение. Попробуйте ещё раз.'))
      .finally(() => setSaving(false));
  };
  onMount(() => {
    const outside = (event: PointerEvent): void => {
      if (!root.contains(event.target as Node)) props.onClose();
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') props.onClose();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', closeOnEscape);
    onCleanup(() => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', closeOnEscape);
    });
  });
  return (
    <Portal>
      <fieldset
        ref={root}
        class="user-highlight-popup"
        classList={{
          'user-highlight-popup--below': props.placement === 'below',
          'user-highlight-popup--dock': props.placement === 'dock',
          'user-highlight-popup--editing': editingNote(),
        }}
        aria-label="Выделение текста"
        style={
          props.placement === 'dock'
            ? undefined
            : {
                left: `clamp(8rem, ${props.x}px, calc(100vw - 8rem))`,
                // Two rows (colours, then the lookup) need more room above the selection.
                top: `clamp(${props.onLookup && (props.onAdd || props.onRemove) ? '7.25rem' : '4rem'}, ${props.y}px, calc(100dvh - 0.5rem))`,
              }
        }
        onPointerDown={(event) => {
          const target = event.target as HTMLElement | null;
          if (target?.closest('.user-highlight-popup__note-editor')) return;
          event.preventDefault();
        }}
      >
        <Show when={props.onAdd}>
          {(add) => (
            <For each={USER_HIGHLIGHT_COLORS}>
              {(color) => (
                <button
                  type="button"
                  disabled={saving()}
                  class="user-highlight-popup__color"
                  style={{ '--highlight-color': color.fill }}
                  aria-label={`Выделить: ${color.label.toLowerCase()}`}
                  title={color.label}
                  onClick={() => run(() => add()(color.id))}
                >
                  <span class="user-highlight-popup__swatch" />
                </button>
              )}
            </For>
          )}
        </Show>
        <Show when={props.onLookup}>
          {(lookup) => (
            <button
              type="button"
              class="user-highlight-popup__action user-highlight-popup__action--lookup"
              data-testid="selection-lookup"
              onClick={() => lookup()()}
            >
              <AppGlyph name="book-open" class="user-highlight-popup__icon" />
              Найти в словаре
            </button>
          )}
        </Show>
        <Show when={props.onAskAi}>
          {(askAi) => (
            <button
              type="button"
              class="user-highlight-popup__action user-highlight-popup__action--lookup"
              data-testid="selection-ask-ai"
              onClick={() => askAi()()}
            >
              <AppGlyph name="chat" class="user-highlight-popup__icon" />
              Спросить ИИ
            </button>
          )}
        </Show>
        <Show when={props.onSaveNote && !editingNote()}>
          <button
            type="button"
            disabled={saving()}
            class="user-highlight-popup__action"
            onClick={() => {
              setDraftNote(props.initialHighlightNote ?? '');
              setEditingNote(true);
            }}
          >
            <AppGlyph name="note-pencil" class="user-highlight-popup__icon" />
            {props.initialHighlightNote ? 'Изменить заметку' : 'Заметка'}
          </button>
        </Show>
        <Show when={props.onRemove}>
          {(remove) => (
            <button
              type="button"
              disabled={saving()}
              class="user-highlight-popup__action user-highlight-popup__action--remove"
              onClick={() => run(remove())}
            >
              <AppGlyph name="trash" class="user-highlight-popup__icon" />
              Убрать выделение
            </button>
          )}
        </Show>
        <Show when={props.initialHighlightNote && !editingNote()}>
          {(savedNote) => <p class="user-highlight-popup__saved-note">{savedNote()}</p>}
        </Show>
        <Show when={editingNote() && props.onSaveNote}>
          {(saveNote) => (
            <div class="user-highlight-popup__note-editor">
              <textarea
                class="user-highlight-popup__textarea"
                rows={3}
                placeholder="Запишите комментарий к фрагменту"
                value={draftNote()}
                onInput={(event) => setDraftNote(event.currentTarget.value)}
              />
              <div class="user-highlight-popup__note-actions">
                <button
                  type="button"
                  class="user-highlight-popup__action"
                  onClick={() => setEditingNote(false)}
                >
                  Отмена
                </button>
                <button
                  type="button"
                  disabled={saving()}
                  class="user-highlight-popup__action user-highlight-popup__action--save"
                  onClick={() =>
                    run(async () => {
                      await saveNote()(draftNote());
                      setEditingNote(false);
                    })
                  }
                >
                  Сохранить
                </button>
              </div>
            </div>
          )}
        </Show>
        <Show when={props.note}>
          {(note) => <p class="user-highlight-popup__note">{note()}</p>}
        </Show>
      </fieldset>
    </Portal>
  );
}
