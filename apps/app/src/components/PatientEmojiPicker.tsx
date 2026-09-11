import { createSignal, type JSX, onCleanup, onMount, Show } from 'solid-js';
import { normalizePatientAvatar, type PatientAvatar } from '@/state/patientAvatar';

export function PatientEmojiPicker(props: {
  readonly onSelect: (avatar: PatientAvatar) => void;
}): JSX.Element {
  const [error, setError] = createSignal('');
  let host: HTMLDivElement | undefined;
  let current = true;
  onCleanup(() => {
    current = false;
  });
  onMount(async () => {
    try {
      const [{ Picker }, { default: data }, { default: i18n }] = await Promise.all([
        import('emoji-mart'),
        import('@emoji-mart/data'),
        import('@emoji-mart/data/i18n/ru.json'),
      ]);
      if (!current || !host) return;
      const picker = new Picker({
        data,
        i18n,
        locale: 'ru',
        set: 'native',
        emojiVersion: 15,
        dynamicWidth: true,
        autoFocus: false,
        previewPosition: 'none',
        skinTonePosition: 'search',
        emojiButtonRadius: '8px',
        maxFrequentRows: 1,
        onEmojiSelect: (emoji: unknown) => {
          if (!emoji || typeof emoji !== 'object' || !('native' in emoji)) return;
          props.onSelect(normalizePatientAvatar({ kind: 'symbol', value: emoji.native }));
        },
      });
      if (!(picker instanceof HTMLElement)) throw new Error('Не удалось открыть список эмодзи.');
      picker.className = 'patient-emoji-picker__widget';
      host.append(picker);
      const probe = document.createElement('span');
      host.append(probe);
      for (const [key, token] of Object.entries({
        color: 'text',
        accent: 'accent',
        background: 'surface-raised',
        input: 'surface',
      })) {
        probe.style.color = `var(--theme-${token})`;
        picker.style.setProperty(
          `--rgb-${key}`,
          getComputedStyle(probe).color.match(/\d+/gu)?.slice(0, 3).join(',') ?? '0,0,0',
        );
      }
      probe.remove();
    } catch (cause) {
      if (current)
        setError(cause instanceof Error ? cause.message : 'Не удалось открыть список эмодзи.');
    }
  });
  return (
    <div class="patient-emoji-picker" ref={host}>
      <Show when={error()}>
        <p class="patient-avatar-picker__error" role="alert">
          {error()}
        </p>
      </Show>
    </div>
  );
}
