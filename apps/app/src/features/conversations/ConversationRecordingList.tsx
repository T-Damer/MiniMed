import { type Accessor, createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';

import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { ListGroup, ListRow } from '@/components/ListRow';
import { formatRecordingDuration } from '@/features/asr/visit-recording';
import { conversationSession } from '@/features/conversations/conversation-session';
import { patientName, usePatientSnapshot } from '@/features/conversations/use-patient-snapshot';
import {
  CONVERSATION_RECORDINGS_EVENT,
  type ConversationRecording,
  listConversationRecordings,
} from '@/state/conversation-recordings';

/** The finished recordings on this device, kept current as recordings are made, filed or deleted. */
export function useConversationRecordings(): Accessor<readonly ConversationRecording[]> {
  const [recordings, setRecordings] = createSignal<readonly ConversationRecording[]>([]);
  const refresh = (): void => {
    void listConversationRecordings()
      .then((all) => setRecordings(all.filter((recording) => recording.status !== 'recording')))
      .catch(() => setRecordings([]));
  };
  onMount(() => {
    refresh();
    window.addEventListener(CONVERSATION_RECORDINGS_EVENT, refresh);
    onCleanup(() => window.removeEventListener(CONVERSATION_RECORDINGS_EVENT, refresh));
  });
  return recordings;
}

function startedLabel(recording: ConversationRecording): string {
  return new Date(recording.startedAt).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Conversation recordings as rows (REC1): «Файлы» → «Записи бесед», and a patient's card (only
 * theirs). A row says when, how long and whose; a tap opens the recording's sheet.
 */
export function ConversationRecordingList(props: {
  /** Only this patient's recordings (chosen while recording, or added to the card). */
  readonly patientId?: string;
  /** Only recordings not yet in a patient's card (the notes screen's inbox). */
  readonly unfiled?: boolean;
  readonly heading?: string;
  /** No recordings: the centred empty state (a page of its own) or nothing (inside a card). */
  readonly empty?: 'state' | 'none';
}): JSX.Element {
  const all = useConversationRecordings();
  const patients = usePatientSnapshot(() => undefined);
  const recordings = (): readonly ConversationRecording[] =>
    props.unfiled
      ? all().filter((recording) => !recording.attachedTo)
      : props.patientId
        ? all().filter(
            (recording) =>
              recording.attachedTo?.patientId === props.patientId ||
              recording.patientId === props.patientId,
          )
        : all();
  const owner = (recording: ConversationRecording): string => {
    const id = recording.attachedTo?.patientId ?? recording.patientId;
    if (!id || props.patientId) return '';
    return patientName(patients.snapshot(), id);
  };
  return (
    <Show
      when={recordings().length > 0}
      fallback={
        <Show when={(props.empty ?? 'state') === 'state'}>
          <EmptyState
            glyph="microphone"
            title="Записей бесед пока нет"
            text="Запись идёт, пока вы пользуетесь приложением."
            actions={
              <Button variant="primary" onClick={() => conversationSession.prepare()}>
                Новая запись
              </Button>
            }
          />
        </Show>
      }
    >
      <ListGroup heading={props.heading} class="conversation-recordings">
        <For each={recordings()}>
          {(recording) => (
            <ListRow
              class="conversation-recordings__row"
              data-testid="conversation-recording-row"
              icon="waveform"
              tone="orange"
              title={startedLabel(recording)}
              subtitle={
                [owner(recording), recording.status === 'interrupted' ? 'прервалась' : '']
                  .filter(Boolean)
                  .join(' · ') || undefined
              }
              value={formatRecordingDuration(recording.durationMs)}
              aria-label={`Запись беседы ${startedLabel(recording)}, ${formatRecordingDuration(recording.durationMs)}`}
              onClick={() => conversationSession.openFinished(recording)}
            />
          )}
        </For>
      </ListGroup>
    </Show>
  );
}
