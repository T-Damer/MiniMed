import { createMemo, createResource, For, type JSX, onCleanup, Show } from 'solid-js';

import { AudioWaveformPlayer } from '@/components/AudioWaveformPlayer';
import { loadVoiceClip } from '@/diary/voice-store';
import type { DiarySpoken } from '@/features/diary/diary-model';

/** One recording kept on this phone: played from the phone's own storage, never from the server. */
function LocalClip(props: { readonly clip: string }): JSX.Element {
  const [record] = createResource(
    () => props.clip,
    (id) => loadVoiceClip(id),
  );
  // One object URL per loaded recording, released when it changes or the sheet closes.
  const source = createMemo((previous: string | undefined) => {
    if (previous) URL.revokeObjectURL(previous);
    const found = record();
    return found ? URL.createObjectURL(found.blob) : undefined;
  });
  onCleanup(() => {
    const current = source();
    if (current) URL.revokeObjectURL(current);
  });
  return (
    <Show when={source()}>
      {(src) => (
        <AudioWaveformPlayer
          src={src()}
          label={`Ваша запись, ${record()?.seconds ?? 0} с`}
          compact
        />
      )}
    </Show>
  );
}

/**
 * The patient's own recordings behind an entry's dictated texts, when this phone still has them
 * (another phone, a cleared browser: nothing shows). The doctor never sees these.
 */
export function LocalVoiceClips(props: { readonly spoken: readonly DiarySpoken[] | undefined }) {
  const clips = (): string[] => [
    ...new Set((props.spoken ?? []).flatMap((mark) => (mark.clip ? [mark.clip] : []))),
  ];
  return (
    <Show when={clips().length}>
      <div class="diary-voice__clips">
        <For each={clips()}>{(clip) => <LocalClip clip={clip} />}</For>
      </div>
    </Show>
  );
}
