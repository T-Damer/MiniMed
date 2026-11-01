import { createMemo, type JSX, onCleanup } from 'solid-js';

import { AudioWaveformPlayer } from '@/components/AudioWaveformPlayer';
import type { DiaryVoice } from '@/features/diary/diary-model';

/** A diary entry's voice recording (DiaryEntry.voice) as the app's waveform player. */
export function VoiceClip(props: { readonly voice: DiaryVoice }): JSX.Element {
  // An object URL, not a data: URL: the player decodes it for the waveform and seeks within it.
  const url = createMemo((previous: string | undefined) => {
    if (previous) URL.revokeObjectURL(previous);
    const binary = atob(props.voice.data);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return URL.createObjectURL(new Blob([bytes], { type: props.voice.mime }));
  });
  onCleanup(() => URL.revokeObjectURL(url()));
  return (
    <AudioWaveformPlayer src={url()} label={`Голосовая запись, ${props.voice.seconds} с`} compact />
  );
}
