import type { ChunkContext, LocalMedError } from '@localmed/contracts';
import type { ChunkRecord, SectionRecord } from '@localmed/domain';
import type { MedicalStore } from '@localmed/storage';

import { resolveReadableDocumentId, summaryDocumentId } from './document-siblings';

export interface SearchResultContextHint {
  readonly chunkId: string;
  readonly documentId: string;
  readonly sectionId: string;
  readonly anchor: string;
  readonly title: string;
  readonly sectionPath: readonly string[];
  readonly sectionType: string | null;
}

function normalizeMatchText(value: string): string {
  return value.trim().toLocaleLowerCase('ru-RU').replace(/\s+/gu, ' ');
}

function anchorChunkSuffix(anchor: string): string | null {
  const hashIndex = anchor.lastIndexOf('#chunk-');
  if (hashIndex < 0) return null;
  return anchor.slice(hashIndex + '#chunk-'.length).toLowerCase();
}

function sectionPathTail(path: readonly string[]): string {
  const last = path.at(-1);
  return last ? normalizeMatchText(last) : '';
}

function sectionMatchesHint(section: SectionRecord, hint: SearchResultContextHint): boolean {
  if (hint.sectionType && section.sectionType === hint.sectionType) return true;
  const tail = sectionPathTail(hint.sectionPath);
  if (!tail) return false;
  const title = normalizeMatchText(section.title);
  return title.includes(tail) || tail.includes(title);
}

function chunkMatchesHint(chunk: ChunkRecord, hint: SearchResultContextHint): boolean {
  const suffix = anchorChunkSuffix(hint.anchor);
  if (suffix && anchorChunkSuffix(chunk.anchor)?.startsWith(suffix)) return true;
  const normalizedSnippet = normalizeMatchText(hint.anchor);
  const anchorPath = normalizedSnippet.split('#')[0] ?? normalizedSnippet;
  const chunkAnchor = normalizeMatchText(chunk.anchor);
  if (anchorPath.length > 12 && chunkAnchor.includes(anchorPath.slice(anchorPath.lastIndexOf('/')))) {
    return true;
  }
  return false;
}

async function findChunkInDocument(
  store: MedicalStore,
  documentId: string,
  hint: SearchResultContextHint,
): Promise<ChunkRecord | null> {
  const direct = await store.getChunk(hint.chunkId);
  if (direct) {
    const document = await store.getDocument(documentId);
    if (document && direct.documentVersionId === document.version.id) return direct;
  }

  const sections = await store.getSectionsByDocument(documentId);
  const matchingSections = sections.filter((section) => sectionMatchesHint(section, hint));
  const orderedSections =
    matchingSections.length > 0
      ? matchingSections
      : hint.sectionId
        ? sections.filter((section) => section.id === hint.sectionId)
        : [];

  for (const section of orderedSections) {
    const chunks = await store.getChunksBySection(section.id);
    const matched = chunks.find((chunk) => chunkMatchesHint(chunk, hint));
    if (matched) return matched;
    if (chunks[0]) return chunks[0];
  }

  return null;
}

export async function resolveSearchResultChunkId(
  store: MedicalStore,
  hint: SearchResultContextHint,
): Promise<string | null> {
  const existing = await store.getChunk(hint.chunkId);
  if (existing) return hint.chunkId;

  const documents = await store.listDocuments();
  const availableIds = new Set(documents.map((document) => document.id));
  const candidateDocumentIds = [
    resolveReadableDocumentId(hint.documentId, availableIds),
    hint.documentId,
    summaryDocumentId(hint.documentId),
  ].filter((documentId, index, values) => values.indexOf(documentId) === index && availableIds.has(documentId));

  for (const documentId of candidateDocumentIds) {
    const chunk = await findChunkInDocument(store, documentId, hint);
    if (chunk) return chunk.id;
  }

  const section = await store.getSection(hint.sectionId);
  if (section) {
    const chunks = await store.getChunksBySection(section.id);
    if (chunks[0]) return chunks[0].id;
  }

  return null;
}

export function searchResultContextFallbackMessage(
  hint: SearchResultContextHint,
  cause: LocalMedError,
): string {
  if (cause.code !== 'CONTENT_NOT_FOUND') return cause.message;
  return `Источник «${hint.sectionPath.at(-1) ?? hint.title}» пока недоступен в локальной базе. Откройте полный документ или обновите поиск.`;
}

export type BuildChunkContext = (
  chunkId: string,
  radius: number,
) => Promise<ChunkContext | null>;

export async function resolveSearchResultContext(
  store: MedicalStore,
  hint: SearchResultContextHint,
  radius: number,
  buildChunkContext: BuildChunkContext,
): Promise<ChunkContext | null> {
  const resolvedChunkId = await resolveSearchResultChunkId(store, hint);
  if (!resolvedChunkId) return null;
  return buildChunkContext(resolvedChunkId, radius);
}
