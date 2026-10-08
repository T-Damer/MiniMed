import type {
  ContentModuleCatalogEntry,
  CoreIdentityHit,
  DefinitionReferenceHit,
  DefinitionReferenceReply,
  DefinitionReferenceRequest,
  DefinitionReferenceSense,
  MedicalCore,
} from '@localmed/contracts';
import { referenceSourceAttribution } from './reference-entry';

/** Where a sense can be read in full: an installed document at its exact anchor, or a web page. */
export type SenseLink =
  | { readonly kind: 'document'; readonly documentId: string; readonly anchor: string }
  | { readonly kind: 'web'; readonly url: string };

/** What a licence asks the reader to be told about a text (Wiktionary: CC BY-SA 4.0). */
export interface SenseCredit {
  readonly authors?: string;
  readonly license?: string;
  readonly licenseUrl?: string;
}

export interface SenseSource {
  /** «КР: Переломы бедренной кости», «Красота и медицина», «Русский Викисловарь». */
  readonly label: string;
  readonly link?: SenseLink;
  readonly credit?: SenseCredit;
  /** An official publication (a клиническая рекомендация) needs no draft badge. */
  readonly official: boolean;
}

/** One sense of a headword as the card shows it: the source's own words and where they stand. */
export interface SenseDetail {
  readonly hit: CoreIdentityHit;
  readonly card: DefinitionReferenceHit;
  readonly sense: DefinitionReferenceSense | undefined;
  readonly text: string;
  readonly source: SenseSource;
}

type Record_ = Readonly<Record<string, unknown>>;

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const record = (value: unknown): Record_ =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record_) : {};

const httpUrl = (value: string | undefined): string | undefined => {
  if (!value || !URL.canParse(value)) return undefined;
  const url = new URL(value);
  return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined;
};

/** Short name of a source for one line: the publisher, else the title up to its first qualifier. */
export function senseSourceLabel(source: Record_ | null, provenance: Record_): string {
  const documentId = text(provenance['documentId']);
  const documentTitle = text(provenance['documentTitle']);
  if (documentId?.startsWith('kr.rf.') && documentTitle) return `КР: ${documentTitle}`;
  const declared = record(source?.['source']);
  const publisher = text(declared['publisher']);
  if (publisher) return publisher;
  const title = text(declared['title']) ?? 'Источник';
  return title.split(/[;:—]/u)[0]?.trim() || title;
}

export function senseSourceLink(
  source: Record_ | null,
  provenance: Record_,
): SenseLink | undefined {
  const documentId = text(provenance['documentId']);
  const anchor = text(provenance['anchor']);
  if (documentId && anchor) return { kind: 'document', documentId, anchor };
  const declared = record(source?.['source']);
  const citations = provenance['citations'];
  const path = Array.isArray(citations)
    ? text(record(citations[0])['path'])
    : text(provenance['path']);
  const baseUrl = text(declared['baseUrl']);
  const url = baseUrl && path ? httpUrl(`${baseUrl}${path}`) : undefined;
  return url ? { kind: 'web', url } : undefined;
}

/** Recommendations and other official publications; the first extraction names them by type. */
const OFFICIAL_SOURCE_TYPES = new Set([
  'official-clinical-recommendation',
  'existing-clinical-detail-dataset',
]);

function isOfficialSource(declared: Record_): boolean {
  return (
    declared['authority'] === 'official' ||
    (typeof declared['sourceType'] === 'string' &&
      OFFICIAL_SOURCE_TYPES.has(declared['sourceType']))
  );
}

export function senseSource(source: Record_ | null, provenance: Record_): SenseSource {
  const link = senseSourceLink(source, provenance);
  const attribution = referenceSourceAttribution(source, provenance);
  const credit: SenseCredit = {
    ...(attribution.attribution ? { authors: attribution.attribution } : {}),
    ...(attribution.license ? { license: attribution.license } : {}),
    ...(attribution.licenseUrl ? { licenseUrl: attribution.licenseUrl } : {}),
  };
  return {
    label: senseSourceLabel(source, provenance),
    ...(link ? { link } : {}),
    ...(Object.keys(credit).length > 0 ? { credit } : {}),
    official: isOfficialSource(record(source?.['source'])),
  };
}

export interface SenseTarget {
  readonly hit: CoreIdentityHit;
  readonly module: ContentModuleCatalogEntry;
}

/** More than this many entries of one name are never read for ranking. */
export const MAX_SENSES_READ = 8;

/**
 * Reads the first definition block of each entry through the installed reference module: its
 * ranking signals, its text and its source. Entries whose module is not connected, or that have no
 * definition block, are left out. Errors of the reference reader propagate.
 */
export async function loadSenseDetails(
  core: MedicalCore,
  targets: readonly SenseTarget[],
): Promise<SenseDetail[]> {
  const reference = core.reference?.bind(core);
  if (!reference) return [];
  const ask = async (
    request: DefinitionReferenceRequest,
  ): Promise<DefinitionReferenceReply | undefined> => {
    const result = await reference(request);
    if (!result.ok) throw new Error(result.error.message);
    return result.value.op === 'unavailable' ? undefined : result.value;
  };
  const details = await Promise.all(
    targets
      .slice(0, MAX_SENSES_READ)
      .map(async ({ hit, module }): Promise<SenseDetail | undefined> => {
        const target = hit.target;
        const descriptor = module.definitionReference;
        if (
          target.type !== 'definition' ||
          !descriptor ||
          descriptor.editionId !== target.editionId
        )
          return undefined;
        const scope = { moduleId: module.id, editionId: descriptor.editionId };
        const status = await ask({ ...scope, op: 'status' });
        if (status?.op !== 'status' || status.editionId !== descriptor.editionId) return undefined;
        const [card, blocks] = await Promise.all([
          ask({ ...scope, op: 'card', id: target.entityId }),
          ask({ ...scope, op: 'blocks', id: target.entityId }),
        ]);
        if (card?.op !== 'card' || !card.card || blocks?.op !== 'blocks') return undefined;
        const first = blocks.page.blocks.find(
          (block) => block.role === 'definition' || block.role === 'item',
        );
        if (!first) return undefined;
        const body = await ask({
          ...scope,
          op: 'text',
          id: target.entityId,
          chunkId: first.chunkId,
        });
        if (body?.op !== 'text' || !body.block) return undefined;
        const origin = await ask({ ...scope, op: 'source', id: body.block.sourceId });
        return {
          hit,
          card: card.card,
          sense: card.card.sense,
          text: body.block.text,
          source: senseSource(
            origin?.op === 'source' ? origin.source : null,
            body.block.provenance,
          ),
        };
      }),
  );
  return details.filter((detail): detail is SenseDetail => detail !== undefined);
}
