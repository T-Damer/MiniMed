import type { MedicalDocumentSummary } from '@localmed/contracts';
import { isSameDocumentFamily } from '@localmed/core';

import { displayDocumentTitle } from '@/features/library/document-display';

/**
 * «Другие» in the reader (owner 2026-11-06): the other documents that carry the same name — a
 * clinical recommendation, a reference article and a definition of «Шизофрения» — so the reader can
 * step to them without going back to search. A module pointer counts as the document it opens.
 */

type Summary = Pick<
  MedicalDocumentSummary,
  'id' | 'title' | 'shortTitle' | 'sourceType' | 'metadata'
>;

/** Case, «ё» and spacing do not make two names different. */
export function sameTitleKey(title: string): string {
  return title
    .toLocaleLowerCase('ru')
    .replaceAll('ё', 'е')
    .replace(/[\s\u00a0]+/gu, ' ')
    .trim()
    .replace(/[.,;:!?…]+$/u, '');
}

function pointerTarget(document: Summary): string | null {
  const target = document.metadata?.['targetDocumentId'];
  return typeof target === 'string' && target.trim() ? target : null;
}

const indexes = new WeakMap<readonly Summary[], ReadonlyMap<string, readonly Summary[]>>();

function titleIndex(documents: readonly Summary[]): ReadonlyMap<string, readonly Summary[]> {
  let index = indexes.get(documents);
  if (index) return index;
  const built = new Map<string, Summary[]>();
  for (const document of documents) {
    const key = sameTitleKey(displayDocumentTitle(document));
    if (!key) continue;
    const list = built.get(key);
    if (list) list.push(document);
    else built.set(key, [document]);
  }
  index = built;
  indexes.set(documents, index);
  return index;
}

/** The documents named like `current`, its own family (editions, pointer, full text) left out. */
export function sameTitleDocuments<T extends Summary>(
  documents: readonly T[],
  current: Summary,
): readonly T[] {
  const key = sameTitleKey(displayDocumentTitle(current));
  if (!key) return [];
  const candidates = (titleIndex(documents).get(key) ?? []) as readonly T[];
  const own = (document: Summary): boolean => {
    const ids = [document.id, pointerTarget(document)].filter((id): id is string => id !== null);
    return ids.some((id) => isSameDocumentFamily(id, current.id));
  };
  // A pointer and the document it opens are one entry: the installed document wins.
  const installed = new Set(candidates.map((document) => document.id));
  const seen = new Set<string>();
  const result: T[] = [];
  for (const document of candidates) {
    if (own(document)) continue;
    const target = pointerTarget(document);
    if (target && installed.has(target)) continue;
    const identity = target ?? document.id;
    if (seen.has(identity)) continue;
    seen.add(identity);
    result.push(document);
  }
  return result;
}
