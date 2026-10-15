import type { SearchScope } from '@/features/search/ScopedMedicalCore';
import { hashPath } from '@/features/search/search-query-route';

const SECTION_ROUTE = /^#\/search\/section\/([a-z0-9-]+)\/?$/u;

/** `#/search/section/<id>`: an open section of the search page, a place of its own in history. */
export function searchSectionHash(scope: SearchScope): string {
  return `#/search/section/${scope}`;
}

/** The section a hash names, or undefined for any other route (including the section list). */
export function searchSectionFromHash(
  hash: string,
  isSection: (value: string) => value is SearchScope,
): SearchScope | undefined {
  // The address may carry the search query (`?q=…`, search-query-route.ts).
  const id = SECTION_ROUTE.exec(hashPath(hash))?.[1];
  // «all» is the section list itself, and the clinical analysis is a switch, not a place.
  return id && id !== 'all' && id !== 'diagnosis' && isSection(id) ? id : undefined;
}
