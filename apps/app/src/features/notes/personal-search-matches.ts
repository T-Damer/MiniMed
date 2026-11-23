import type { PatientProfile } from '@/state/patient-domain';
import type { PatientNoteMatch } from '@/state/patient-notes';
import { personalMatchScore, personalQueryStems } from '@/state/personal-stem-match';
import type { UserLibraryMatch } from '@/state/user-library';

export interface PatientProfileSearchMatch {
  readonly profile: PatientProfile;
  readonly score: number;
  readonly snippet: string;
}

export type PersonalHit =
  | { readonly kind: 'patient'; readonly match: PatientProfileSearchMatch }
  | { readonly kind: 'note'; readonly match: PatientNoteMatch }
  | { readonly kind: 'library'; readonly match: UserLibraryMatch };

function normalizeTitleKey(value: string): string {
  return value.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е').replace(/\s+/gu, ' ').trim();
}

/**
 * True when the search query already matches inside the item's title/name (so no extra
 * body-snippet accordion is needed).
 */
export function personalHitMatchedInTitle(query: string, title: string): boolean {
  const stems = personalQueryStems(query);
  if (stems.length === 0) return false;
  return personalMatchScore(stems, title) > 0;
}

/**
 * Combines patient profiles, notes, and user-library hits while deduplicating notes that are
 * mirrored in `user-library` (`source.kind === 'note'`). Prefers the library mirror when both
 * exist so tapping opens the note directly in the reader.
 */
export function combineAndDeduplicatePersonalHits(
  patientMatches: readonly PatientProfileSearchMatch[],
  noteMatches: readonly PatientNoteMatch[],
  libraryMatches: readonly UserLibraryMatch[],
  limit = 5,
): readonly PersonalHit[] {
  const mirroredNoteIds = new Set<string>();
  const mirroredNoteTitles = new Set<string>();

  for (const match of libraryMatches) {
    const source = match.document.source;
    if (source?.kind === 'note') {
      mirroredNoteIds.add(source.noteId);
      mirroredNoteTitles.add(normalizeTitleKey(match.document.title));
    }
  }

  const dedupedNotes = noteMatches.filter((match) => {
    if (match.note && mirroredNoteIds.has(match.note.id)) return false;
    const cardTitle = normalizeTitleKey(match.card.title);
    const fullTitle = match.note?.title.trim()
      ? normalizeTitleKey(`${match.card.title} — ${match.note.title.trim()}`)
      : cardTitle;
    if (mirroredNoteTitles.has(fullTitle) || mirroredNoteTitles.has(cardTitle)) return false;
    return true;
  });

  const hits: PersonalHit[] = [
    ...patientMatches.map((match) => ({ kind: 'patient' as const, match })),
    ...dedupedNotes.map((match) => ({ kind: 'note' as const, match })),
    ...libraryMatches.map((match) => ({ kind: 'library' as const, match })),
  ];

  return hits.toSorted((left, right) => right.match.score - left.match.score).slice(0, limit);
}
