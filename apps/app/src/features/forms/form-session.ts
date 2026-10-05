import type { FormValue } from '@/features/forms/form-values';

/**
 * Values a person typed into a form, kept in memory only while the app is open so that leaving the
 * screen (to look at a patient card, say) does not lose them. They hold patient data, so they never
 * reach storage and are dropped the moment the patient vault locks.
 */
const sessions = new Map<string, Readonly<Record<string, FormValue>>>();

export function formSessionKey(
  formId: string,
  patientId: string | undefined,
  episodeId: string | undefined,
): string {
  return JSON.stringify([formId, patientId ?? '', episodeId ?? '']);
}

export function readFormSession(key: string): Readonly<Record<string, FormValue>> {
  return sessions.get(key) ?? {};
}

export function writeFormSession(key: string, edits: Readonly<Record<string, FormValue>>): void {
  if (Object.keys(edits).length === 0) sessions.delete(key);
  else sessions.set(key, edits);
}

export function clearFormSessions(): void {
  sessions.clear();
}
