import { normalizeSurfaceText, searchSubjectText } from '@localmed/search-lexical';
import type { SearchDocumentDescriptor } from '@localmed/storage';

/** Immutable per-core projection; never shared across installed corpus generations. */
export class QueryDocumentIndex {
  readonly byId: ReadonlyMap<string, SearchDocumentDescriptor>;
  readonly availableIds: ReadonlySet<string>;
  private readonly aliases = new Map<string, Set<string>>();

  constructor(documents: readonly SearchDocumentDescriptor[]) {
    this.byId = new Map(documents.map((document) => [document.id, document]));
    this.availableIds = new Set(this.byId.keys());
    for (const document of documents) {
      for (const key of ['declaredAliases', 'navigationAliases']) {
        const names = document.metadata[key];
        if (!Array.isArray(names)) continue;
        for (const name of names) {
          if (typeof name !== 'string') continue;
          const normalized = normalizeSurfaceText(name);
          let ids = this.aliases.get(normalized);
          if (!ids) {
            ids = new Set();
            this.aliases.set(normalized, ids);
          }
          ids.add(document.id);
        }
      }
    }
  }

  exactAliasIds(query: string): ReadonlySet<string> {
    return this.aliases.get(searchSubjectText(query)) ?? new Set();
  }
}
