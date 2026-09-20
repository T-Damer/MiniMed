import { createHash } from 'node:crypto';

import type { MedicalDocumentSummary } from '@localmed/contracts';
import { normalizeSurfaceText, tokenize } from '@localmed/search-lexical';

export type LookupSurfaceKind = 'title' | 'navigation-alias' | 'declared-alias';

export interface LookupQualityCase {
  readonly id: string;
  readonly query: string;
  readonly normalizedQuery: string;
  /** Empty for discovery-only surfaces such as declaredAliases without a stronger identity surface. */
  readonly expectedTop1DocumentIds: readonly string[];
  readonly exactSurfaceDocumentIds: readonly string[];
  readonly kinds: readonly LookupSurfaceKind[];
}

interface SurfaceEntry {
  readonly documentId: string;
  readonly query: string;
  readonly normalizedQuery: string;
  readonly kind: LookupSurfaceKind;
  /** 3=title, 2=editorial navigation alias, 1=search-expansion alias. */
  readonly priority: 1 | 2 | 3;
}

function strings(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function eligibleSurface(value: string): boolean {
  const normalized = normalizeSurfaceText(value).trim();
  if (normalized.length < 3 || normalized.length > 120) return false;
  const terms = tokenize(normalized);
  return terms.length > 0 && terms.length <= 16 && /[0-9a-zа-я]/u.test(normalized);
}

function stableCaseId(normalizedQuery: string): string {
  return `lookup.${createHash('sha256').update(normalizedQuery).digest('hex').slice(0, 20)}`;
}

function pushSurface(
  entries: SurfaceEntry[],
  documentId: string,
  query: string,
  kind: LookupSurfaceKind,
  priority: 1 | 2 | 3,
): void {
  if (!eligibleSurface(query)) return;
  entries.push({
    documentId,
    query,
    normalizedQuery: normalizeSurfaceText(query),
    kind,
    priority,
  });
}

export function buildLookupQualityCases(
  documents: readonly MedicalDocumentSummary[],
): readonly LookupQualityCase[] {
  const entries: SurfaceEntry[] = [];
  for (const document of documents) {
    if (document.status !== 'active') continue;
    pushSurface(entries, document.id, document.title, 'title', 3);
    for (const alias of strings(document.metadata?.['navigationAliases'])) {
      pushSurface(entries, document.id, alias, 'navigation-alias', 2);
    }
    for (const alias of strings(document.metadata?.['declaredAliases'])) {
      pushSurface(entries, document.id, alias, 'declared-alias', 1);
    }
  }

  const bySurface = new Map<string, SurfaceEntry[]>();
  for (const entry of entries) {
    const group = bySurface.get(entry.normalizedQuery) ?? [];
    group.push(entry);
    bySurface.set(entry.normalizedQuery, group);
  }

  return [...bySurface.entries()]
    .map(([normalizedQuery, group]): LookupQualityCase => {
      const identityEntries = group.filter((entry) => entry.priority >= 2);
      const strongestIdentityPriority =
        identityEntries.length > 0 ? Math.max(...identityEntries.map((entry) => entry.priority)) : null;
      const strongestIdentity =
        strongestIdentityPriority === null
          ? []
          : identityEntries.filter((entry) => entry.priority === strongestIdentityPriority);
      const representativeEntries =
        strongestIdentity.length > 0
          ? strongestIdentity
          : group.filter(
              (entry) => entry.priority === Math.max(...group.map((candidate) => candidate.priority)),
            );
      const representative = representativeEntries
        .map((entry) => entry.query)
        .toSorted((left, right) => left.length - right.length || left.localeCompare(right))[0];
      if (!representative) throw new Error('Lookup quality group cannot be empty.');

      return {
        id: stableCaseId(normalizedQuery),
        query: representative,
        normalizedQuery,
        expectedTop1DocumentIds: [
          ...new Set(strongestIdentity.map((entry) => entry.documentId)),
        ].toSorted(),
        exactSurfaceDocumentIds: [...new Set(group.map((entry) => entry.documentId))].toSorted(),
        kinds: [...new Set(group.map((entry) => entry.kind))].toSorted(),
      };
    })
    .toSorted((left, right) => {
      const leftHash = createHash('sha256').update(left.normalizedQuery).digest('hex');
      const rightHash = createHash('sha256').update(right.normalizedQuery).digest('hex');
      return leftHash.localeCompare(rightHash);
    });
}
