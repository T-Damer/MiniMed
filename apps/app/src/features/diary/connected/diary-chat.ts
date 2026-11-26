import { DIARY_CHAT_RECORD, DiaryChatTextSchema } from '@localmed/contracts';
import { sealRecord } from '@localmed/diary-sync';
import { type DiaryApi, DiaryApiError, diaryRecords } from '@/features/diary/connected/diary-api';
import type { DiaryRecordRevision } from '@/features/diary/connected/diary-replica';
import type { Keyring } from '@/features/diary/connected/diary-session';

export interface DiaryChatMessage {
  readonly id: string;
  readonly at: string;
  readonly author: string;
  readonly text: string;
}

export function mergeDiaryChat(
  previous: readonly DiaryChatMessage[],
  incoming: readonly DiaryRecordRevision[],
): readonly DiaryChatMessage[] {
  const next = new Map(previous.map((message) => [message.id, message]));
  for (const revision of incoming) {
    if (!DIARY_CHAT_RECORD.test(revision.id) || revision.rev !== 1 || next.has(revision.id))
      continue;
    const parsed = DiaryChatTextSchema.safeParse(revision.payload);
    if (parsed.success)
      next.set(revision.id, {
        id: revision.id,
        at: revision.at,
        author: revision.author,
        text: parsed.data.text,
      });
  }
  return next.size === previous.length
    ? previous
    : [...next.values()].sort((a, b) => a.at.localeCompare(b.at)).slice(-200);
}

export async function writeDiaryChat(
  api: DiaryApi,
  peer: {
    readonly patientId: string;
    readonly author: string;
    readonly signKey: CryptoKey;
    readonly keyring: Keyring;
  },
  recordId: string,
  text: string,
): Promise<void> {
  const key = peer.keyring.keys.get(peer.keyring.current);
  if (!key) throw new DiaryApiError(409, 'Обновите ключ дневника.');
  const record = await sealRecord(
    {
      patientId: peer.patientId,
      id: `chat-${recordId}`,
      rev: 1,
      epoch: peer.keyring.current,
      author: peer.author,
    },
    DiaryChatTextSchema.parse({ kind: 'chat', text }),
    key,
    peer.signKey,
  );
  try {
    await diaryRecords.push(api, peer.patientId, [record]);
  } catch (cause) {
    if (!(cause instanceof DiaryApiError) || cause.code !== 'duplicate-chat') throw cause;
  }
}
