import {
  DIARY_MEDIA_RECORD,
  DIARY_MEDIA_WINDOW_MS,
  DiaryMediaIceSchema,
  type DiaryMediaSignal,
  DiaryMediaSignalSchema,
  DiaryRecordsPushResponseSchema,
} from '@localmed/contracts';
import { sealRecord } from '@localmed/diary-sync';
import { type DiaryApi, DiaryApiError } from '@/features/diary/connected/diary-api';
import type { DiaryRecordRevision } from '@/features/diary/connected/diary-replica';
import type { Keyring } from '@/features/diary/connected/diary-session';

export type LiveMediaSignal = DiaryMediaSignal & {
  readonly requestId: string;
  readonly author: string;
  readonly seq: number;
  readonly expiresAt: number;
};
export type MediaOffer = Extract<LiveMediaSignal, { kind: 'offer' }>;

export function readMediaSignal(revision: DiaryRecordRevision): LiveMediaSignal | undefined {
  const match = DIARY_MEDIA_RECORD.exec(revision.id);
  const expiresAt = Date.parse(revision.at) + DIARY_MEDIA_WINDOW_MS;
  if (!match || !revision.seq || revision.rev !== 1 || !(expiresAt > Date.now())) return;
  const [, kind, requestId] = match;
  if (!requestId || !revision.author.startsWith(kind === 'answer' ? 'p:' : 'd:')) return;
  const signal = DiaryMediaSignalSchema.safeParse(revision.payload);
  if (signal.success && signal.data.kind === kind) {
    return { ...signal.data, author: revision.author, requestId, seq: revision.seq, expiresAt };
  }
  return undefined;
}

export async function diaryMediaIce(api: DiaryApi, patientId: string): Promise<RTCConfiguration> {
  const result = await api.call('GET', `/api/patients/${patientId}/media-ice`, DiaryMediaIceSchema);
  return {
    iceServers: result.iceServers.map(({ urls, username, credential }) => ({
      urls,
      ...(username && credential ? { username, credential } : {}),
    })),
  };
}

export async function pushMediaSignal(
  api: DiaryApi,
  peer: {
    readonly patientId: string;
    readonly author: string;
    readonly signKey: CryptoKey;
    readonly keyring: Keyring;
  },
  requestId: string,
  payload: DiaryMediaSignal,
  mediaOfferSeq?: number,
): Promise<number> {
  const key = peer.keyring.keys.get(peer.keyring.current);
  if (!key) throw new DiaryApiError(409, 'Обновите ключ дневника.');
  const record = await sealRecord(
    {
      patientId: peer.patientId,
      id: `media-${payload.kind}-${requestId}`,
      rev: 1,
      epoch: peer.keyring.current,
      author: peer.author,
    },
    DiaryMediaSignalSchema.parse(payload),
    key,
    peer.signKey,
  );
  const pushed = await api.call(
    'POST',
    `/api/patients/${peer.patientId}/records`,
    DiaryRecordsPushResponseSchema,
    {
      records: [record],
      ...(mediaOfferSeq === undefined ? {} : { mediaOfferSeq }),
    },
  );
  const seq = pushed.seqs[0];
  if (!seq) throw new DiaryApiError(502, 'Сигнал передачи не принят.');
  return seq;
}
