/**
 * The draft of «Сохранить в карточку пациента» under an assessment result: the chosen card and the
 * name typed for a new card. It is kept per result in the browser's own storage as soon as it
 * changes (the card it ends in lives in the same storage), so a reload brings the panel back as it
 * was; saving or cancelling removes it.
 */
export const ASSESSMENT_NOTE_DRAFTS_KEY = 'minimed.assessment-note-drafts.v1';
/** Results whose draft is kept; the oldest go first. */
const MAX_DRAFTS = 20;

export interface AssessmentNoteDraft {
  /** The existing card chosen, or empty for a new one. */
  readonly cardId: string;
  /** The name typed for a new card. */
  readonly newCardTitle: string;
  readonly savedAt: string;
}

function isDraft(value: unknown): value is AssessmentNoteDraft {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['cardId'] === 'string' &&
    typeof candidate['newCardTitle'] === 'string' &&
    typeof candidate['savedAt'] === 'string'
  );
}

function readAll(): Record<string, AssessmentNoteDraft> {
  try {
    const raw = window.localStorage.getItem(ASSESSMENT_NOTE_DRAFTS_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => isDraft(value)));
  } catch {
    return {};
  }
}

function writeAll(drafts: Record<string, AssessmentNoteDraft>): void {
  try {
    if (Object.keys(drafts).length === 0) {
      window.localStorage.removeItem(ASSESSMENT_NOTE_DRAFTS_KEY);
    } else {
      window.localStorage.setItem(ASSESSMENT_NOTE_DRAFTS_KEY, JSON.stringify(drafts));
    }
  } catch (cause) {
    // Storage full or blocked: the panel works, only the reload safety is missing.
    console.warn(
      'Assessment note draft not stored:',
      cause instanceof Error ? cause.message : 'storage error',
    );
  }
}

export function readAssessmentNoteDraft(recordId: string): AssessmentNoteDraft | undefined {
  return readAll()[recordId];
}

export function clearAssessmentNoteDraft(recordId: string): void {
  const drafts = readAll();
  if (!(recordId in drafts)) return;
  delete drafts[recordId];
  writeAll(drafts);
}

/** Stores the draft of one result; a draft with nothing typed or chosen is no draft. */
export function writeAssessmentNoteDraft(
  recordId: string,
  draft: { readonly cardId: string; readonly newCardTitle: string },
): void {
  if (!draft.cardId && !draft.newCardTitle.trim()) {
    clearAssessmentNoteDraft(recordId);
    return;
  }
  const drafts = { ...readAll(), [recordId]: { ...draft, savedAt: new Date().toISOString() } };
  const newestFirst = Object.entries(drafts).toSorted(([, left], [, right]) =>
    right.savedAt.localeCompare(left.savedAt),
  );
  writeAll(Object.fromEntries(newestFirst.slice(0, MAX_DRAFTS)));
}
