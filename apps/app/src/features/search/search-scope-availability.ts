import type { SearchScope } from '@/features/search/ScopedMedicalCore';

export function canSelectSearchScope(
  scope: SearchScope,
  documentCountsLoaded: boolean,
  documentCount: number,
): boolean {
  return scope === 'medications' || !documentCountsLoaded || documentCount > 0;
}
