import { matchesFuzzyQuery } from '@/state/fuzzy-text';

export function matchesCatalogQuery(query: string, values: readonly string[]): boolean {
  return matchesFuzzyQuery(query, values);
}

interface OpenCatalogDocumentOptions {
  readonly installed: boolean;
  readonly install: () => Promise<boolean>;
  readonly open: () => void;
}

export async function openCatalogDocument(options: OpenCatalogDocumentOptions): Promise<boolean> {
  if (!options.installed && !(await options.install())) return false;
  options.open();
  return true;
}
