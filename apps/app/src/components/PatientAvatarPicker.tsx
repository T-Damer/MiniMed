import { createSignal, type JSX, onCleanup, Show } from 'solid-js';
import { AppGlyph } from '@/components/AppGlyph';
import { PatientAvatar } from '@/components/PatientAvatar';
import { PatientEmojiPicker } from '@/components/PatientEmojiPicker';
import { SheetPopover } from '@/components/SheetPopover';
import { type PatientAvatar as Avatar, patientAvatarFromFile } from '@/state/patientAvatar';

/**
 * A round avatar that is also the button to change it: the panel under it offers a photo, an emoji
 * or removing the current picture (a popover on wide screens, a sheet on phones).
 */
export function PatientAvatarPicker(props: {
  readonly name: string;
  readonly value: Avatar | undefined;
  readonly onBusyChange?: (busy: boolean) => void;
  readonly onChange: (value: Avatar | undefined) => void | Promise<void>;
}): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const [emojiView, setEmojiView] = createSignal(false);
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
  const setPanelOpen = (value: boolean): void => {
    setOpen(value);
    if (!value) setEmojiView(false);
  };
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
      <SheetPopover
        open={open()}
        onOpenChange={setPanelOpen}
        title="Фото пациента"
        triggerClass="patient-avatar-picker__trigger"
        triggerLabel="Фото или эмодзи пациента"
        triggerTitle="Фото или эмодзи"
        trigger={
          <>
            <PatientAvatar
              name={props.name}
              avatar={props.value}
              class="patient-avatar-picker__avatar"
            />
            <span class="patient-avatar-picker__badge" aria-hidden="true">
              <AppGlyph name="camera" class="patient-avatar-picker__badge-icon" />
            </span>
          </>
        }
        contentClass="patient-avatar-picker__popover"
        placement="bottom-start"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <Show
          when={!emojiView()}
          fallback={
            <PatientEmojiPicker
              onSelect={(avatar) => {
                setPanelOpen(false);
                void change(avatar);
              }}
            />
          }
        >
          <div class="patient-avatar-picker__menu">
            <button
              type="button"
              class="patient-avatar-picker__option"
              aria-label="Выбрать фото пациента"
              disabled={busy()}
              onClick={() => {
                setPanelOpen(false);
                fileInput?.click();
              }}
            >
              <AppGlyph name="image" class="patient-avatar-picker__option-icon" />
              Фото
            </button>
            <button
              type="button"
              class="patient-avatar-picker__option"
              aria-label="Выбрать эмодзи пациента"
              disabled={busy()}
              onClick={() => setEmojiView(true)}
            >
              <span class="patient-avatar-picker__option-emoji" aria-hidden="true">
                ☺
              </span>
              Эмодзи
            </button>
            <Show when={props.value}>
              <button
                type="button"
                class="patient-avatar-picker__option patient-avatar-picker__option--danger"
                aria-label="Удалить фото или эмодзи"
                disabled={busy()}
                onClick={() => {
                  setPanelOpen(false);
                  void change(undefined);
                }}
              >
                <AppGlyph name="trash" class="patient-avatar-picker__option-icon" />
                Убрать
              </button>
            </Show>
          </div>
        </Show>
      </SheetPopover>
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
