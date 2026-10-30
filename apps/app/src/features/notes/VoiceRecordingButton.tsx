import { type JSX, Show } from 'solid-js';
import { AppGlyph } from '@/components/AppGlyph';
import { createVoiceCapture } from '@/features/notes/voice-capture';

/**
 * Toolbar microphone button: captures a voice note through MediaRecorder and
 * hands the resulting file to the caller (stored as a note attachment).
 */
export function VoiceRecordingButton(props: {
  readonly onComplete: (file: File) => void;
  readonly onStart?: () => void;
  readonly onError?: (message: string, openSettings?: boolean) => void;
  readonly disabled?: boolean;
}): JSX.Element {
  const { recording, seconds, level, start, stop } = createVoiceCapture({
    onComplete: (file) => props.onComplete(file),
    onStart: () => props.onStart?.(),
    onError: (message, openSettings) => props.onError?.(message, openSettings),
  });

  const durationLabel = (): string => {
    const hours = Math.floor(seconds() / 3_600);
    const minutes = Math.floor((seconds() % 3_600) / 60);
    const rest = seconds() % 60;
    const body = `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
    return hours > 0 ? `${hours}:${body}` : body;
  };

  return (
    <button
      type="button"
      class={`note-markdown-editor__tool note-voice-button${recording() ? ' note-voice-button--recording' : ''}`}
      data-note-voice-button="true"
      aria-label={recording() ? `Остановить запись (${durationLabel()})` : 'Записать голос'}
      title={recording() ? `Остановить запись · ${durationLabel()}` : 'Голосовая заметка'}
      disabled={props.disabled}
      onClick={() => void (recording() ? stop() : start())}
    >
      <Show
        when={recording()}
        fallback={<AppGlyph name="microphone" class="note-markdown-editor__tool-icon" />}
      >
        <span
          class="note-voice-button__halo"
          style={{ '--voice-level': `${Math.round(level() * 100)}%` }}
          aria-hidden="true"
        />
        <AppGlyph name="stop-circle" class="note-voice-button__stop-icon" />
        <span class="note-voice-button__time">{durationLabel()}</span>
      </Show>
    </button>
  );
}
