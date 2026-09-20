import { createHash } from 'node:crypto';

import type { MedicalDocumentSummary } from '@localmed/contracts';
import { normalizeSurfaceText, tokenize } from '@localmed/search-lexical';

export type LookupSurfaceKind = 'title' | 'declared-alias';

export interface LookupQualityCase {
  readonly id: string;
  readonly query: string;
  readonly normalizedQuery: string;
  readonly expectedTop1DocumentIds: readonly string[];
  readonly exactSurfaceDocumentIds: readonly string[];
  readonly kinds: readonly LookupSurfaceKind[];
}

interface SurfaceEntry {
  readonly documentId: string;
  readonly query: string;
  readonly normalizedQuery: string;
  readonly kind: LookupSurfaceKind;
  readonly priority: number;
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

export function buildLookupQualityCases(
  documents: readonly MedicalDocumentSummary[],
): readonly LookupQualityCase[] {
  const entries: SurfaceEntry[] = [];
  for (const document of documents) {
    if (document.status !== 'active') continue;
    if (eligibleSurface(document.title)) {
      entries.push({
        documentId: document.id,
        query: document.title,
        normalizedQuery: normalizeSurfaceText(document.title),
        kind: 'title',
        priority: 2,
      });
    }
    for (const alias of strings(document.metadata?.['declaredAliases'])) {
      if (!eligibleSurface(alias)) continue;
      entries.push({
        documentId: document.id,
        query: alias,
        normalizedQuery: normalizeSurfaceText(alias),
        kind: 'declared-alias',
        priority: 1,
      });
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
      const strongestPriority = Math.max(...group.map((entry) => entry.priority));
      const strongest = group.filter((entry) => entry.priority === strongestPriority);
      const representative = strongest
        .map((entry) => entry.query)
        .toSorted((left, right) => left.length - right.length || left.localeCompare(right))[0];
      if (!representative) throw new Error('Lookup quality group cannot be empty.');
      return {
        id: stableCaseId(normalizedQuery),
        query: representative,
        normalizedQuery,
        expectedTop1DocumentIds: [...new Set(strongest.map((entry) => entry.documentId))].toSorted(),
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
