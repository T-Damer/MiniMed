import type { MedicalDocumentSummary } from '@localmed/contracts';

import { documentVersionLabel } from '@/features/library/document-version-label';
import { searchResultDocumentType } from '@/features/search/ScopedMedicalCore';
import { RESULT_TYPE_VISUALS } from '@/features/search/searchResultKindVisuals';

const CYRILLIC = /[а-яё]/iu;

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** Audience as words: «взрослые, дети». Slugs in other languages are not shown. */
function audience(metadata: Readonly<Record<string, unknown>>): string | undefined {
  const label = text(metadata['audienceLabel']);
  if (label) return label;
  const groups = metadata['ageGroups'];
  if (!Array.isArray(groups)) return undefined;
  const words = groups
    .filter((group): group is string => typeof group === 'string' && CYRILLIC.test(group))
    .map((group) => group.trim().toLocaleLowerCase('ru-RU'));
  return words.length > 0 ? [...new Set(words)].join(', ') : undefined;
}

/** The document's edition as a short line («ред. 3», an act's amendment line), when it has one. */
export function readerEdition(
  document: Pick<MedicalDocumentSummary, 'sourceType' | 'metadata' | 'versionLabel'>,
): string | undefined {
  const metadata = (document.metadata ?? {}) as Readonly<Record<string, unknown>>;
  return (
    text(metadata['edition']) ??
    (searchResultDocumentType(document) === 'clinical-recommendation'
      ? documentVersionLabel(document.versionLabel)
      : undefined)
  );
}

/** Whom the document is for, as words; undefined when the source does not say it in Russian. */
export function readerAudience(
  document: Pick<MedicalDocumentSummary, 'metadata'>,
): string | undefined {
  return audience((document.metadata ?? {}) as Readonly<Record<string, unknown>>);
}

/**
 * The one meta line under a document's title: what kind of document it is and whom it is for.
 * Editions, dates and sources are not the subject (owner 2026-10-20): they are under «⋯» →
 * «Информация».
 */
export function readerMetaParts(
  document: Pick<MedicalDocumentSummary, 'sourceType' | 'metadata' | 'versionLabel'>,
): readonly string[] {
  const type = searchResultDocumentType(document);
  return [RESULT_TYPE_VISUALS[type].label, readerAudience(document)].filter(
    (part): part is string => part !== undefined,
  );
}
