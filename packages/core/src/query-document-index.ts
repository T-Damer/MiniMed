import { normalizeSurfaceText, searchSubjectText } from '@localmed/search-lexical';
import type { SearchDocumentDescriptor } from '@localmed/storage';

/** Immutable per-core projection; never shared across installed corpus generations. */
export class QueryDocumentIndex {
  readonly byId: ReadonlyMap<string, SearchDocumentDescriptor>;
  readonly availableIds: ReadonlySet<string>;
  private readonly aliases = new Map<string, Set<string>>();
  private readonly strictIdentities = new Map<string, Set<string>>();

  constructor(documents: readonly SearchDocumentDescriptor[]) {
    this.byId = new Map(documents.map((document) => [document.id, document]));
    this.availableIds = new Set(this.byId.keys());
    for (const document of documents) {
      this.addIdentity(document.title, document.id, this.strictIdentities);
      for (const key of ['declaredAliases', 'navigationAliases'] as const) {
        const names = document.metadata[key];
        if (!Array.isArray(names)) continue;
        for (const name of names) {
          if (typeof name !== 'string') continue;
          this.addIdentity(name, document.id, this.aliases);
          if (key === 'navigationAliases') {
            this.addIdentity(name, document.id, this.strictIdentities);
          }
        }
      }
    }
  }

  exactAliasIds(query: string): ReadonlySet<string> {
    return this.aliases.get(searchSubjectText(query)) ?? new Set();
  }

  exactIdentityIds(query: string): ReadonlySet<string> {
    return this.strictIdentities.get(searchSubjectText(query)) ?? new Set();
  }

  private addIdentity(value: string, documentId: string, index: Map<string, Set<string>>): void {
    const normalized = normalizeSurfaceText(value);
    let ids = index.get(normalized);
    if (!ids) {
      ids = new Set();
      index.set(normalized, ids);
    }
    ids.add(documentId);
  }
}
