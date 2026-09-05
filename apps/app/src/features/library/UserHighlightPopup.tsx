import { createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { toast } from 'solid-sonner';
import { AppGlyph } from '@/components/AppGlyph';
import { USER_HIGHLIGHT_COLORS, type UserHighlightColor } from '@/state/user-library-highlights';

export function UserHighlightPopup(props: {
  readonly x: number;
  readonly y: number;
  readonly onAdd?: ((color: UserHighlightColor) => Promise<void>) | undefined;
  readonly onRemove?: (() => Promise<void>) | undefined;
  readonly onClose: () => void;
}): JSX.Element {
  let root!: HTMLFieldSetElement;
  const [saving, setSaving] = createSignal(false);
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
        aria-label="Выделение текста"
        style={{
          left: `clamp(8rem, ${props.x}px, calc(100vw - 8rem))`,
          top: `clamp(4rem, ${props.y}px, calc(100dvh - 0.5rem))`,
        }}
        onPointerDown={(event) => event.preventDefault()}
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
      </fieldset>
    </Portal>
  );
}
