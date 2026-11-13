import type { JSX } from 'solid-js';

import { ConversationRecordingList } from '@/features/conversations/ConversationRecordingList';

/**
 * The notes screen's inbox: recordings that are not in a patient's card yet. All recordings are in
 * «Файлы» → «Записи бесед», and each patient's on their card (REC1).
 */
export function ConversationInbox(): JSX.Element {
  return (
    <section class="conversation-inbox" aria-label="Записи бесед">
      <ConversationRecordingList unfiled heading="Записи бесед" empty="none" />
    </section>
  );
}
