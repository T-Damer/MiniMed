import type {
  DefinitionReferenceHit,
  DefinitionReferenceReply,
  DefinitionReferenceRequest,
} from '@localmed/contracts';
import { type SenseSource, senseSource } from './sense-detail';

export type ReferenceAsk = (
  request: DefinitionReferenceRequest,
) => Promise<DefinitionReferenceReply>;

export interface ReferenceScope {
  readonly moduleId: string;
  readonly editionId: string;
}

export interface TermParagraph {
  readonly role: 'definition' | 'item' | 'context';
  readonly text: string;
}

/** A term as the modal shows it: the source's own paragraphs and every place that gives them. */
export interface TermArticle {
  readonly card: DefinitionReferenceHit;
  readonly paragraphs: readonly TermParagraph[];
  readonly sources: readonly SenseSource[];
}

const MAX_PAGES = 3;
const MAX_CONTINUATIONS = 4;
const MAX_SOURCES = 12;

function sourceKey(source: SenseSource): string {
  const link = source.link;
  if (!link) return source.label;
  return link.kind === 'document' ? `${link.documentId}#${link.anchor}` : link.url;
}

/**
 * Reads one entry through the reference reader: its definition, criteria and context blocks in
 * order, with long blocks continued, and the distinct sources of its definition blocks. Pipeline
 * annotations (`annotation` blocks) are not part of what a doctor reads and are skipped.
 */
export async function loadTermArticle(
  ask: ReferenceAsk,
  scope: ReferenceScope,
  id: string,
): Promise<TermArticle> {
  const card = await ask({ ...scope, op: 'card', id });
  if (card.op !== 'card' || !card.card) throw new Error('Карточка не найдена.');
  const paragraphs: TermParagraph[] = [];
  const sources = new Map<string, SenseSource>();
  const origins = new Map<string, Readonly<Record<string, unknown>> | null>();
  let after: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const reply = await ask({ ...scope, op: 'blocks', id, ...(after ? { after } : {}) });
    if (reply.op !== 'blocks') throw new Error('Некорректная страница справочника.');
    for (const block of reply.page.blocks) {
      if (block.role === 'annotation') continue;
      let offset: number | undefined;
      let body = '';
      let provenance: Readonly<Record<string, unknown>> = {};
      for (let part = 0; part <= MAX_CONTINUATIONS; part += 1) {
        const chunk = await ask({
          ...scope,
          op: 'text',
          id,
          chunkId: block.chunkId,
          ...(offset ? { offset } : {}),
        });
        if (chunk.op !== 'text' || !chunk.block) throw new Error('Фрагмент больше не доступен.');
        body += chunk.block.text;
        if (part === 0) provenance = chunk.block.provenance;
        if (chunk.block.nextOffset === null) break;
        offset = chunk.block.nextOffset;
      }
      const text = body.trim();
      if (text) paragraphs.push({ role: block.role, text });
      if (block.role !== 'definition' || sources.size >= MAX_SOURCES) continue;
      if (!origins.has(block.sourceId)) {
        const origin = await ask({ ...scope, op: 'source', id: block.sourceId });
        origins.set(block.sourceId, origin.op === 'source' ? origin.source : null);
      }
      const source = senseSource(origins.get(block.sourceId) ?? null, provenance);
      sources.set(sourceKey(source), source);
    }
    if (!reply.page.next) break;
    after = reply.page.next;
  }
  return { card: card.card, paragraphs, sources: [...sources.values()] };
}
