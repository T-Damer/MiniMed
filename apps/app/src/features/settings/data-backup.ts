import { saveBlobAsFile } from '@/state/native-share';
import {
  exportPatientVaultBackup,
  isPatientVaultUnlocked,
  unlockPatientVault,
} from '@/state/patient-vault';
import { exportPersonalNotesBackup } from '@/state/personal-notes-backup';

/** What a backup leaves unprotected; asked before the patient cards are written to a plain file. */
export const PATIENT_BACKUP_CONFIRMATION =
  'Копия содержит карточки пациентов, осмотры, события и файлы без шифрования. ' +
  'Личные заметки, голосовые вложения и расшифровки в неё не входят. Продолжить?';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function saveJson(value: unknown, fileName: string): Promise<void> {
  const blob = new Blob([JSON.stringify(value)], { type: 'application/json;charset=utf-8' });
  return saveBlobAsFile(blob, fileName);
}

/** Saves every personal note with its attachments as one JSON file. */
export async function saveNotesBackup(): Promise<void> {
  await saveJson(await exportPersonalNotesBackup(), `MiniMed — личные заметки — ${today()}.json`);
}

/** Saves the patient cards with their files as one JSON file; opens the vault first when needed. */
export async function savePatientsBackup(): Promise<void> {
  if (!isPatientVaultUnlocked()) await unlockPatientVault();
  await saveJson(await exportPatientVaultBackup(), `MiniMed — пациенты — ${today()}.json`);
}
