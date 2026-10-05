import {
  DiaryFormatError,
  type DiaryInvitation,
  parseDiaryInvitation,
} from '@/features/diary/diary-model';
import { addPatientBlob, readPatientBlob } from '@/state/patient-vault';

/**
 * The doctor's record of the diaries issued from one patient card. It lets the doctor show a link
 * or QR code again, send an updated version of the same diary, and notice when results of a diary
 * issued to another patient are about to be saved into this card. Stored as an encrypted-at-rest
 * patient file, so it is removed with the card and travels with the card backup.
 */
export interface IssuedDiary {
  readonly invitation: DiaryInvitation;
  /** ISO time the diary was first issued (the invitation's own time moves with every update). */
  readonly firstIssuedAt: string;
  readonly lastImport?: { readonly at: string; readonly entries: number };
}

const MAX_ISSUED = 200;
const MIME = 'application/json';

export function ledgerBlobId(patientId: string): string {
  return `diary-ledger-${patientId}`;
}

export function parseLedger(text: string, now = Date.now()): readonly IssuedDiary[] {
  const value = JSON.parse(text) as unknown;
  if (!Array.isArray(value) || value.length > MAX_ISSUED) {
    throw new DiaryFormatError('Список выданных дневников повреждён.');
  }
  return value.map((item): IssuedDiary => {
    if (typeof item !== 'object' || item === null) {
      throw new DiaryFormatError('Список выданных дневников повреждён.');
    }
    const source = item as Record<string, unknown>;
    const invitation = parseDiaryInvitation(source['invitation'], now);
    const imported = source['lastImport'] as Record<string, unknown> | undefined;
    return {
      invitation,
      firstIssuedAt:
        typeof source['firstIssuedAt'] === 'string' ? source['firstIssuedAt'] : invitation.issuedAt,
      ...(imported && typeof imported['at'] === 'string' && typeof imported['entries'] === 'number'
        ? { lastImport: { at: imported['at'], entries: imported['entries'] } }
        : {}),
    };
  });
}

/** Records a new or updated invitation; an update keeps the first issue time and last import. */
export function withIssued(
  ledger: readonly IssuedDiary[],
  invitation: DiaryInvitation,
): readonly IssuedDiary[] {
  const known = ledger.find((item) => item.invitation.id === invitation.id);
  const entry: IssuedDiary = {
    invitation,
    firstIssuedAt: known?.firstIssuedAt ?? invitation.issuedAt,
    ...(known?.lastImport ? { lastImport: known.lastImport } : {}),
  };
  const others = ledger.filter((item) => item.invitation.id !== invitation.id);
  return [entry, ...others].slice(0, MAX_ISSUED);
}

export function withImport(
  ledger: readonly IssuedDiary[],
  diaryId: string,
  at: string,
  entries: number,
): readonly IssuedDiary[] {
  return ledger.map((item) =>
    item.invitation.id === diaryId ? { ...item, lastImport: { at, entries } } : item,
  );
}

export function withoutIssued(
  ledger: readonly IssuedDiary[],
  diaryId: string,
): readonly IssuedDiary[] {
  return ledger.filter((item) => item.invitation.id !== diaryId);
}

export async function loadLedger(patientId: string): Promise<readonly IssuedDiary[]> {
  const blob = await readPatientBlob(ledgerBlobId(patientId));
  if (!blob) return [];
  return parseLedger(new TextDecoder().decode(blob.bytes));
}

export async function saveLedger(patientId: string, ledger: readonly IssuedDiary[]): Promise<void> {
  await addPatientBlob({
    id: ledgerBlobId(patientId),
    patientId,
    mimeType: MIME,
    bytes: new TextEncoder().encode(JSON.stringify(ledger)),
  });
}

/** Another card of this vault that was issued the diary, if any. */
export async function findLedgerOwner(
  patientIds: readonly string[],
  diaryId: string,
): Promise<string | undefined> {
  for (const patientId of patientIds) {
    const ledger = await loadLedger(patientId).catch(() => []);
    if (ledger.some((item) => item.invitation.id === diaryId)) return patientId;
  }
  return undefined;
}
