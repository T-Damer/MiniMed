import { createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';
import { toast } from 'solid-sonner';

import { Button } from '@/components/Button';
import { ConfirmationDialog } from '@/components/ConfirmationDialog';
import {
  conversationSession,
  conversationTitle,
  removeConversation,
} from '@/features/conversations/conversation-session';
import {
  CONVERSATION_RECORDINGS_EVENT,
  type ConversationRecording,
  listConversationRecordings,
} from '@/state/conversation-recordings';

import './conversation-recorder.css';

function statusLabel(recording: ConversationRecording): string {
  if (recording.attachedTo) return 'В карте пациента';
  if (recording.status === 'interrupted') return 'Прервана — сохранена часть';
  if (recording.status === 'recording') return 'Идёт запись';
  return 'Ждёт, к кому добавить';
}

/** Conversation recordings kept on this device until the doctor files or deletes them. */
export function ConversationInbox(): JSX.Element {
  const [recordings, setRecordings] = createSignal<readonly ConversationRecording[]>([]);
  const [deleting, setDeleting] = createSignal<ConversationRecording | null>(null);
  const refresh = (): void => {
    void listConversationRecordings()
      .then(setRecordings)
      .catch(() => setRecordings([]));
  };
  onMount(() => {
    refresh();
    window.addEventListener(CONVERSATION_RECORDINGS_EVENT, refresh);
    onCleanup(() => window.removeEventListener(CONVERSATION_RECORDINGS_EVENT, refresh));
  });
  const visible = () => recordings().filter((recording) => recording.status !== 'recording');
  return (
    <Show when={visible().length > 0}>
      <section class="conversation-inbox paper-card" aria-labelledby="conversation-inbox-title">
        <h2 id="conversation-inbox-title" class="conversation-inbox__title">
          Записи бесед
        </h2>
        <ul class="conversation-inbox__list">
          <For each={visible()}>
            {(recording) => (
              <li class="conversation-inbox__item">
                <span class="conversation-inbox__copy">
                  <span class="conversation-inbox__name">{conversationTitle(recording)}</span>
                  <span
                    class="conversation-inbox__meta"
                    classList={{
                      'conversation-inbox__meta--warning':
                        recording.status === 'interrupted' && !recording.attachedTo,
                    }}
                  >
                    {new Date(recording.startedAt).toLocaleString('ru-RU', {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}{' '}
                    · {statusLabel(recording)}
                  </span>
                </span>
                <span class="conversation-inbox__actions">
                  <Button
                    variant={recording.attachedTo ? 'quiet' : 'primary'}
                    onClick={() => conversationSession.openFinished(recording)}
                  >
                    {recording.attachedTo ? 'Открыть' : 'Добавить'}
                  </Button>
                  <Button variant="quiet" onClick={() => setDeleting(recording)}>
                    Удалить
                  </Button>
                </span>
              </li>
            )}
          </For>
        </ul>
        <ConfirmationDialog
          open={deleting() !== null}
          title="Удалить запись беседы?"
          description={
            deleting()?.attachedTo
              ? 'Копия в карте пациента останется. Удалится только запись на этом устройстве.'
              : 'Запись ещё не добавлена к пациенту и будет удалена безвозвратно.'
          }
          confirmLabel="Удалить"
          danger
          onConfirm={() => {
            const target = deleting();
            setDeleting(null);
            if (target) {
              removeConversation(target).catch(() =>
                toast.error('Не удалось полностью удалить запись беседы.'),
              );
            }
          }}
          onOpenChange={(open) => {
            if (!open) setDeleting(null);
          }}
        />
      </section>
    </Show>
  );
}
