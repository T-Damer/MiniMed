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

/**
 * The one meta line under a document's title: what kind of document it is, its edition and whom it
 * is for. Everything else about the source (verification, publication links, catalogue fields) is
 * reference data and stays at the bottom of the document.
 */
export function readerMetaParts(
  document: Pick<MedicalDocumentSummary, 'sourceType' | 'metadata' | 'versionLabel'>,
): readonly string[] {
  const metadata = (document.metadata ?? {}) as Readonly<Record<string, unknown>>;
  const type = searchResultDocumentType(document);
  const edition =
    text(metadata['edition']) ??
    (type === 'clinical-recommendation' ? documentVersionLabel(document.versionLabel) : undefined);
  return [RESULT_TYPE_VISUALS[type].label, edition, audience(metadata)].filter(
    (part): part is string => part !== undefined,
  );
}
