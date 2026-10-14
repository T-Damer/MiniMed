import {
  applyDiagnosisDraft,
  applyFormDraft,
  type DiagnosisDraftErrors,
  type PatientFormDraft,
  type PatientFormDraftErrors,
  parseDiagnosisDraft,
  parseFormDraft,
  serializeDiagnosisDraft,
  serializeFormDraft,
} from '@/features/notes/patient-form-data';
import {
  createDraftAutosave,
  createDraftWriteAheadStore,
  type DraftAutosave,
  ensureVaultOpen,
} from '@/state/draft-write-ahead';
import type { PatientVaultSnapshot } from '@/state/patient-domain';
import { updatePatientVault } from '@/state/patient-vault';
import { recoverVisitNotes } from '@/state/patient-visit-note';

/**
 * Autosaved drafts of the patient card's two structured editors: «Данные для справок и форм» (one
 * draft per patient) and «Диагноз осмотра» / «Код МКБ-10» (one draft per visit). Both use the
 * machinery of `draft-write-ahead.ts`: a sealed write-ahead copy at once, the vault write after
 * the typing pauses, a flush on page events.
 *
 * Validation never blocks a draft. The valid part is saved (see `applyFormDraft`,
 * `applyDiagnosisDraft`); what cannot be applied yet stays in the copy and the editor shows it back
 * with its inline error, also after a reload (`readFormDraft`, `readDiagnosisDraft`).
 */
export const FORM_DATA_WRITE_AHEAD_KEY = 'minimed.patient-form-data-ahead.v1';
export const DIAGNOSIS_WRITE_AHEAD_KEY = 'minimed.episode-diagnosis-ahead.v1';

export const formDataDrafts = createDraftWriteAheadStore({
  storageKey: FORM_DATA_WRITE_AHEAD_KEY,
  sealType: 'patient-form-ahead',
  label: 'Patient form data',
});

export const diagnosisDrafts = createDraftWriteAheadStore({
  storageKey: DIAGNOSIS_WRITE_AHEAD_KEY,
  sealType: 'episode-diagnosis-ahead',
  label: 'Visit diagnosis',
});

/** Typed text of «Новая карточка пациента»: the copy is its only home until the card is created. */
export const NEW_PATIENT_WRITE_AHEAD_KEY = 'minimed.new-patient-ahead.v1';
export const NEW_PATIENT_DRAFT_SCOPE = 'new-patient';

export const newPatientDrafts = createDraftWriteAheadStore({
  storageKey: NEW_PATIENT_WRITE_AHEAD_KEY,
  sealType: 'new-patient-ahead',
  label: 'New patient form',
});

/** Idle time before a form or diagnosis draft reaches the vault (each write seals the vault). */
export const STRUCTURED_DRAFT_DELAY_MS = 600;

interface SaverCallbacks<Errors> {
  readonly onSnapshot: (snapshot: PatientVaultSnapshot) => void;
  readonly onError: (error: unknown) => void;
  readonly onPendingChange?: (pending: boolean) => void;
  /** Called with the inline errors of every save that landed, and the record it was saved for. */
  readonly onValidation: (errors: Errors, target: string | undefined) => void;
  readonly delayMs?: number;
}

export function createFormDataSaver(
  options: { readonly patientId: string } & SaverCallbacks<PatientFormDraftErrors>,
): DraftAutosave<PatientFormDraft> {
  return createDraftAutosave<PatientFormDraft>({
    store: formDataDrafts,
    patientId: options.patientId,
    target: () => undefined,
    serialize: serializeFormDraft,
    delayMs: options.delayMs ?? STRUCTURED_DRAFT_DELAY_MS,
    onError: options.onError,
    ...(options.onPendingChange ? { onPendingChange: options.onPendingChange } : {}),
    save: async (draft) => {
      await ensureVaultOpen();
      let errors: PatientFormDraftErrors = {};
      const snapshot = await updatePatientVault((current) => {
        const applied = applyFormDraft(current, options.patientId, draft);
        errors = applied.errors;
        return applied.snapshot;
      });
      options.onSnapshot(snapshot);
      options.onValidation(errors, undefined);
      return { complete: Object.keys(errors).length === 0 };
    },
  });
}

export interface DiagnosisDraft {
  readonly text: string;
  readonly icd10: string;
}

export function createDiagnosisSaver(
  options: {
    readonly patientId: string;
    /** The visit the editor shows, fixed with every change. */
    readonly episodeId: () => string;
  } & SaverCallbacks<DiagnosisDraftErrors>,
): DraftAutosave<DiagnosisDraft> {
  return createDraftAutosave<DiagnosisDraft>({
    store: diagnosisDrafts,
    patientId: options.patientId,
    target: options.episodeId,
    serialize: (draft) => serializeDiagnosisDraft(draft.text, draft.icd10),
    delayMs: options.delayMs ?? STRUCTURED_DRAFT_DELAY_MS,
    onError: options.onError,
    ...(options.onPendingChange ? { onPendingChange: options.onPendingChange } : {}),
    save: async (draft, episodeId) => {
      if (!episodeId) throw new Error('Осмотр не найден.');
      await ensureVaultOpen();
      let errors: DiagnosisDraftErrors = {};
      const snapshot = await updatePatientVault((current) => {
        const applied = applyDiagnosisDraft(current, episodeId, draft.text, draft.icd10);
        errors = applied.errors;
        return applied.snapshot;
      });
      options.onSnapshot(snapshot);
      options.onValidation(errors, episodeId);
      return { complete: Object.keys(errors).length === 0 };
    },
  });
}

/** The form-data draft a reload left behind (typed text the vault could not take yet). */
export async function readFormDraft(patientId: string): Promise<PatientFormDraft | undefined> {
  const copy = await formDataDrafts.read(patientId, null);
  return copy ? parseFormDraft(copy.text) : undefined;
}

/** The diagnosis draft a reload left behind for one visit. */
export async function readDiagnosisDraft(
  patientId: string,
  episodeId: string,
): Promise<DiagnosisDraft | undefined> {
  const copy = await diagnosisDrafts.read(patientId, episodeId);
  return copy ? parseDiagnosisDraft(copy.text) : undefined;
}

function recoverFormDrafts(): Promise<PatientVaultSnapshot | undefined> {
  return formDataDrafts.recover((snapshot, copy) => {
    const draft = parseFormDraft(copy.text);
    if (!draft || !snapshot.profiles.some((profile) => profile.id === copy.patientId)) {
      return { snapshot };
    }
    const applied = applyFormDraft(snapshot, copy.patientId, draft);
    return { snapshot: applied.snapshot, keep: Object.keys(applied.errors).length > 0 };
  });
}

function recoverDiagnosisDrafts(): Promise<PatientVaultSnapshot | undefined> {
  return diagnosisDrafts.recover((snapshot, copy) => {
    const draft = parseDiagnosisDraft(copy.text);
    const episode = snapshot.episodes.find((candidate) => candidate.id === copy.targetId);
    if (!draft || !episode || episode.patientId !== copy.patientId) return { snapshot };
    const applied = applyDiagnosisDraft(snapshot, episode.id, draft.text, draft.icd10);
    return { snapshot: applied.snapshot, keep: Object.keys(applied.errors).length > 0 };
  });
}

/**
 * Applies everything typed in an earlier session (visit notes, form data, diagnoses) to the open
 * vault. Resolves with the newest snapshot, or `undefined` when there was nothing to apply or the
 * vault is locked.
 */
export async function recoverPatientDrafts(): Promise<PatientVaultSnapshot | undefined> {
  const notes = await recoverVisitNotes();
  const forms = await recoverFormDrafts();
  const diagnoses = await recoverDiagnosisDrafts();
  return diagnoses ?? forms ?? notes;
}
