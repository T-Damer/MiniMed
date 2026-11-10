/**
 * «Прошлое лечение» typed on «Новый пациент» is a draft until the patient exists: its records need the
 * patient's id, so they are written right after `createPatient` succeeds. If a write fails the
 * patient already exists, so the answer names what is left; a retry writes only the rest.
 */
import type { PastMedication } from '@/features/diary/diary-med-history';

export type PastMedsWritten =
  | { readonly kind: 'written' }
  | { readonly kind: 'failed'; readonly reason: string; readonly left: number };

/**
 * Writes each past medicine not yet in `written` (their ids), in order, stopping at the first
 * failure. `written` is updated as items go through, so calling again continues where it stopped.
 */
export async function writePastMeds(
  save: (patientId: string, item: PastMedication) => Promise<void>,
  patientId: string,
  items: readonly PastMedication[],
  written: Set<string>,
): Promise<PastMedsWritten> {
  for (const item of items) {
    if (written.has(item.id)) continue;
    try {
      await save(patientId, item);
    } catch (cause) {
      return {
        kind: 'failed',
        reason: cause instanceof Error ? cause.message : 'не удалось записать',
        left: items.filter((one) => !written.has(one.id)).length,
      };
    }
    written.add(item.id);
  }
  return { kind: 'written' };
}
