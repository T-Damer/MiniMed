/**
 * Editions of clinical recommendations (КР). The registry keeps every edition of a code as its own
 * document («507_3» replaced by «507_4»); the sidecar `catalog.clinical-editions.json` records the
 * chains. Pure logic only: which edition lists, which edition a reader links to, and the wording.
 * The date shown is the registry publication date (`publishedAt`), not the approval date.
 */
import editionsText from '@/features/modules/catalog.clinical-editions.json?raw';

export interface ClinicalEdition {
  readonly id: string;
  readonly version: number;
  readonly status: 'active' | 'superseded';
  readonly publishedAt: string;
  readonly replacedBy: string | null;
  /** Catalog module that ships the edition; null when only the raw JSON is kept. */
  readonly moduleId: string | null;
}

interface ClinicalEditionCode {
  readonly code: number;
  readonly title: string;
  readonly editions: readonly ClinicalEdition[];
}

interface ClinicalEditionsFile {
  readonly codes: readonly ClinicalEditionCode[];
}

export interface ClinicalEditionIndex {
  /** Edition id («507_4») → its chain ordered by version. */
  readonly chains: ReadonlyMap<string, readonly ClinicalEdition[]>;
  readonly byModuleId: ReadonlyMap<string, ClinicalEdition>;
}

const DOCUMENT_ID_PATTERN = /^kr\.rf\.(\d+_\d+)(?![\d_])/u;
const MODULE_ID_PREFIX = 'minimed.clinical.recommendation.';

export function buildClinicalEditionIndex(file: ClinicalEditionsFile): ClinicalEditionIndex {
  const chains = new Map<string, readonly ClinicalEdition[]>();
  const byModuleId = new Map<string, ClinicalEdition>();
  for (const { editions } of file.codes) {
    const chain = editions.toSorted((left, right) => left.version - right.version);
    for (const edition of chain) {
      chains.set(edition.id, chain);
      if (edition.moduleId !== null) byModuleId.set(edition.moduleId, edition);
    }
  }
  return { chains, byModuleId };
}

let cachedIndex: ClinicalEditionIndex | undefined;

/** Parsed once on first use; the ~220 kB sidecar stays off the start-up path. */
export function clinicalEditionIndex(): ClinicalEditionIndex {
  cachedIndex ??= buildClinicalEditionIndex(JSON.parse(editionsText) as ClinicalEditionsFile);
  return cachedIndex;
}

export function clinicalEditionIdFromDocumentId(documentId: string): string | null {
  return DOCUMENT_ID_PATTERN.exec(documentId)?.[1] ?? null;
}

export function clinicalModuleIdForEdition(editionId: string): string {
  return `${MODULE_ID_PREFIX}${editionId}`;
}

export function clinicalDocumentIdForEdition(editionId: string): string {
  return `kr.rf.${editionId}`;
}

export function isSupersededClinicalModule(
  moduleId: string,
  index: ClinicalEditionIndex = clinicalEditionIndex(),
): boolean {
  return index.byModuleId.get(moduleId)?.status === 'superseded';
}

/**
 * Lists show a replaced edition only while it is installed: otherwise it would stand beside its
 * successor with the same title. Nothing is removed from the catalog itself.
 */
export function listableModules<T extends { readonly id: string }>(
  modules: readonly T[],
  installedModuleIds: ReadonlySet<string>,
  index: ClinicalEditionIndex = clinicalEditionIndex(),
): readonly T[] {
  return modules.filter(
    (module) => installedModuleIds.has(module.id) || !isSupersededClinicalModule(module.id, index),
  );
}

export interface ClinicalEditionLink {
  readonly editionId: string;
  readonly moduleId: string | null;
  readonly documentId: string;
  readonly date: string;
}

/** The edition a replaced module's card points to: the newest one of its chain, if it is another. */
export function currentEditionLink(
  moduleId: string,
  index: ClinicalEditionIndex = clinicalEditionIndex(),
): ClinicalEditionLink | null {
  const edition = index.byModuleId.get(moduleId);
  if (!edition || edition.status !== 'superseded') return null;
  return newerEditionLink(edition, index);
}

/**
 * One edition per clinical recommendation in a result list. The registry keeps a replaced edition
 * under the same title as its successor, so when a newer edition of the chain is among the items,
 * the older one is left out; an edition found on its own stays (its reader names the current one).
 */
export function withoutOlderEditions<T>(
  items: readonly T[],
  editionOf: (item: T) => string | null,
  index: ClinicalEditionIndex = clinicalEditionIndex(),
): readonly T[] {
  const placed = items.map((item) => {
    const editionId = editionOf(item);
    const chain = editionId ? index.chains.get(editionId) : undefined;
    const version = chain?.find((edition) => edition.id === editionId)?.version;
    return { item, chain, version };
  });
  const newest = new Map<readonly ClinicalEdition[], number>();
  for (const { chain, version } of placed) {
    if (chain && version !== undefined)
      newest.set(chain, Math.max(newest.get(chain) ?? version, version));
  }
  return placed
    .filter(
      ({ chain, version }) =>
        !chain || version === undefined || version >= (newest.get(chain) ?? version),
    )
    .map(({ item }) => item);
}

export const SUPERSEDED_EDITION_BADGE = 'прежняя редакция';

export interface SupersededEditionNote {
  readonly badge: string;
  /** «Текущая редакция от 14 августа 2026» */
  readonly linkLabel: string;
  readonly target: ClinicalEditionLink;
}

/** What a list row of an installed, replaced edition shows: the badge and a link to the current one. */
export function supersededEditionNote(
  moduleId: string,
  index: ClinicalEditionIndex = clinicalEditionIndex(),
): SupersededEditionNote | null {
  const target = currentEditionLink(moduleId, index);
  if (!target) return null;
  return {
    badge: SUPERSEDED_EDITION_BADGE,
    linkLabel: `Текущая редакция от ${target.date}`,
    target,
  };
}

const MONTHS_GENITIVE = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
] as const;

/** «2025-03-12T00:00:00» → «12 марта 2025»; the calendar date is read as written, no time zone. */
export function formatEditionDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/u.exec(value);
  const month = match ? MONTHS_GENITIVE[Number(match[2]) - 1] : undefined;
  if (!match || !month) return 'даты нет в реестре';
  return `${Number(match[3])} ${month} ${match[1]}`;
}

function toLink(edition: ClinicalEdition): ClinicalEditionLink {
  return {
    editionId: edition.id,
    moduleId: edition.moduleId,
    documentId: clinicalDocumentIdForEdition(edition.id),
    date: formatEditionDate(edition.publishedAt),
  };
}

function newerEditionLink(
  edition: ClinicalEdition,
  index: ClinicalEditionIndex,
): ClinicalEditionLink | null {
  const chain = index.chains.get(edition.id) ?? [];
  // A newer edition that the registry itself has replaced or withdrawn is not «the current one».
  const newest = chain.findLast(
    (candidate) => candidate.status === 'active' && candidate.version > edition.version,
  );
  return newest ? toLink(newest) : null;
}

export interface ClinicalEditionNotice {
  readonly kind: 'current' | 'replaced';
  /** «Это новая редакция от 12 марта 2025.» */
  readonly lead: string;
  /** The text link to the other edition, «Открыть старую редакцию от …»; absent when it is not shipped. */
  readonly action: { readonly label: string; readonly target: ClinicalEditionLink } | null;
  /** Said instead of the link when the other edition is not part of the app. */
  readonly unavailable: string | null;
}

/**
 * The one-line notice above an open clinical recommendation: a current edition points at the
 * immediately previous one, a replaced edition at the newest.
 */
export function clinicalEditionNotice(
  documentId: string,
  index: ClinicalEditionIndex = clinicalEditionIndex(),
): ClinicalEditionNotice | null {
  const editionId = clinicalEditionIdFromDocumentId(documentId);
  const chain = editionId ? index.chains.get(editionId) : undefined;
  const position = chain?.findIndex((edition) => edition.id === editionId) ?? -1;
  const edition = chain?.[position];
  if (!chain || !edition) return null;

  if (edition.status === 'superseded') {
    const target = newerEditionLink(edition, index);
    if (!target) return null;
    return {
      kind: 'replaced',
      lead: `Это старая редакция от ${formatEditionDate(edition.publishedAt)}.`,
      action: { label: `Открыть новую редакцию от ${target.date}`, target },
      unavailable: null,
    };
  }

  const previous = chain[position - 1];
  if (!previous) return null;
  const target = toLink(previous);
  const lead = `Это новая редакция от ${formatEditionDate(edition.publishedAt)}.`;
  if (previous.moduleId === null) {
    return {
      kind: 'current',
      lead,
      action: null,
      unavailable: `Предыдущая редакция от ${target.date} в приложении не поставляется.`,
    };
  }
  return {
    kind: 'current',
    lead,
    action: { label: `Открыть старую редакцию от ${target.date}`, target },
    unavailable: null,
  };
}
