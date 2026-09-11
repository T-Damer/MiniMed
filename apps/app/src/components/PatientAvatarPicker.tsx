import { Popover } from '@kobalte/core/popover';
import { createSignal, type JSX, onCleanup, Show } from 'solid-js';
import { AppGlyph } from '@/components/AppGlyph';
import { PatientAvatar } from '@/components/PatientAvatar';
import { PatientEmojiPicker } from '@/components/PatientEmojiPicker';
import { type PatientAvatar as Avatar, patientAvatarFromFile } from '@/state/patientAvatar';

export function PatientAvatarPicker(props: {
  readonly name: string;
  readonly value: Avatar | undefined;
  readonly onBusyChange?: (busy: boolean) => void;
  readonly onChange: (value: Avatar | undefined) => void | Promise<void>;
}): JSX.Element {
  const [emojiOpen, setEmojiOpen] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const working = (value: boolean): void => {
    setBusy(value);
    props.onBusyChange?.(value);
  };
  const [error, setError] = createSignal('');
  let fileInput: HTMLInputElement | undefined;
  let current = true;
  onCleanup(() => {
    current = false;
  });
  const change = async (value: Avatar | undefined): Promise<void> => {
    setError('');
    try {
      const pending = props.onChange(value);
      if (pending) {
        working(true);
        await pending;
      }
    } catch (cause) {
      if (current)
        setError(cause instanceof Error ? cause.message : 'Не удалось сохранить значок.');
    } finally {
      if (current) working(false);
    }
  };
  const photo = async (file: File): Promise<void> => {
    setError('');
    working(true);
    try {
      const avatar = await patientAvatarFromFile(file);
      if (current) await props.onChange(avatar);
    } catch (cause) {
      if (current) setError(cause instanceof Error ? cause.message : 'Не удалось прочитать фото.');
    } finally {
      if (current) working(false);
    }
  };
  return (
    <div class="patient-avatar-picker">
      <div class="patient-avatar-picker__actions">
        <button
          type="button"
          class="patient-avatar-picker__trigger"
          aria-label="Выбрать фото пациента"
          disabled={busy()}
          onClick={() => fileInput?.click()}
        >
          <span class="patient-avatar-picker__stack">
            <Show
              when={props.value}
              fallback={
                <span class="patient-avatar-picker__empty">
                  <AppGlyph name="image" class="patient-avatar-picker__photo-icon" />
                  <span class="patient-avatar-picker__empty-label">+ фото</span>
                </span>
              }
            >
              <PatientAvatar name={props.name} avatar={props.value} portrait />
            </Show>
          </span>
        </button>
        <Show
          when={!props.value}
          fallback={
            <button
              type="button"
              class="patient-avatar-picker__emoji-trigger"
              aria-label="Удалить фото или эмодзи"
              title="Удалить фото или эмодзи"
              disabled={busy()}
              onClick={() => void change(undefined)}
            >
              <AppGlyph name="trash" class="patient-avatar-picker__action-icon" />
            </button>
          }
        >
          <Popover
            open={emojiOpen()}
            onOpenChange={setEmojiOpen}
            modal={false}
            fitViewport
            gutter={8}
            placement="bottom-start"
          >
            <Popover.Trigger
              class="patient-avatar-picker__emoji-trigger"
              aria-label="Выбрать эмодзи пациента"
              title="Выбрать эмодзи"
              disabled={busy()}
            >
              ☺
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                class="patient-avatar-picker__popover"
                onOpenAutoFocus={(event) => event.preventDefault()}
              >
                <Popover.CloseButton
                  class="patient-avatar-picker__close"
                  aria-label="Закрыть выбор эмодзи"
                >
                  ×
                </Popover.CloseButton>
                <PatientEmojiPicker
                  onSelect={(avatar) => {
                    setEmojiOpen(false);
                    void change(avatar);
                  }}
                />
              </Popover.Content>
            </Popover.Portal>
          </Popover>
        </Show>
      </div>
      <input
        class="patient-avatar-picker__file"
        ref={fileInput}
        hidden
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        disabled={busy()}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) void photo(file);
        }}
      />
      <Show when={error()}>
        <p class="patient-avatar-picker__error" role="alert">
          {error()}
        </p>
      </Show>
    </div>
  );
}
