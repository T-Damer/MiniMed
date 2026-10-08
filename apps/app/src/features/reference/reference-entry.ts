import type { DefinitionReferenceHit } from '@localmed/contracts';
import { type DoctorProfile, EMPTY_DOCTOR_PROFILE } from './doctor-profile';
import { rankSenses } from './sense-ranking';

/**
 * How a reference record is presented. Decided only by the record's declared type — never by
 * its id or source: an abbreviation expansion is not a definition, and a lexical gloss from a
 * general dictionary is kept apart from clinical definitions.
 */
export type ReferenceEntryType = 'abbreviation' | 'gloss' | 'definition';

export function referenceEntryType(
  hit: Pick<DefinitionReferenceHit, 'kind' | 'textKind'>,
): ReferenceEntryType {
  if (hit.kind === 'abbreviation') return 'abbreviation';
  if (hit.textKind === 'source-gloss') return 'gloss';
  return 'definition';
}

/**
 * Entries that share a name (a mood disorder and a fracture pattern are both «Депрессия») in the
 * order the definition card would show them. Each name keeps the place of its first hit; only the
 * entries of one name trade places.
 */
export function orderSameNameHits(
  hits: readonly DefinitionReferenceHit[],
  profile: DoctorProfile = EMPTY_DOCTOR_PROFILE,
): DefinitionReferenceHit[] {
  const slots = new Map<string, number[]>();
  hits.forEach((hit, index) => {
    if (hit.kind === 'abbreviation') return;
    const key = titleKey(hit.title);
    slots.set(key, [...(slots.get(key) ?? []), index]);
  });
  const result = [...hits];
  for (const indexes of slots.values()) {
    if (indexes.length < 2) continue;
    const ranked = rankSenses(
      indexes.map((index, order) => {
        const hit = hits[index] as DefinitionReferenceHit;
        return { item: hit, sense: hit.sense, order };
      }),
      profile,
    );
    indexes.forEach((index, position) => {
      result[index] = (ranked[position] as (typeof ranked)[number]).item;
    });
  }
  return result;
}

export interface ReferenceHitGroup {
  readonly key: string;
  readonly type: ReferenceEntryType;
  readonly title: string;
  /** Abbreviations with the same spelling fold into one row; everything else stays single. */
  readonly hits: readonly DefinitionReferenceHit[];
}

const titleKey = (title: string): string =>
  title.normalize('NFKC').toLowerCase().replaceAll('ё', 'е').trim();

/** Keeps the search order; each abbreviation spelling appears once, at its first hit. */
export function groupReferenceHits(hits: readonly DefinitionReferenceHit[]): ReferenceHitGroup[] {
  const groups: {
    key: string;
    type: ReferenceEntryType;
    title: string;
    hits: DefinitionReferenceHit[];
  }[] = [];
  const abbreviations = new Map<string, (typeof groups)[number]>();
  for (const hit of hits) {
    const type = referenceEntryType(hit);
    if (type !== 'abbreviation') {
      groups.push({ key: hit.id, type, title: hit.title, hits: [hit] });
      continue;
    }
    const key = `abbreviation:${titleKey(hit.title)}`;
    const existing = abbreviations.get(key);
    if (existing) {
      existing.hits.push(hit);
      continue;
    }
    const group = { key, type, title: hit.title, hits: [hit] };
    abbreviations.set(key, group);
    groups.push(group);
  }
  return groups;
}

const expansionForms = new Intl.PluralRules('ru');

/** «1 расшифровка», «3 расшифровки», «12 расшифровок». */
export function expansionCountLabel(count: number): string {
  const form = expansionForms.select(count);
  const noun = form === 'one' ? 'расшифровка' : form === 'few' ? 'расшифровки' : 'расшифровок';
  return `${count} ${noun}`;
}

/**
 * Flags from an annotation block, whose text is the source's own metadata JSON
 * (e.g. `{"flags":["conflicting-expansion"],"note":"…"}`). Anything else carries no flags.
 */
export function referenceAnnotationFlags(text: string): readonly string[] {
  // Plain-text annotations are ordinary notes; a metadata object that fails to parse is an error.
  if (!text.trimStart().startsWith('{')) return [];
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || !('flags' in parsed)) return [];
  const flags = parsed.flags;
  return Array.isArray(flags)
    ? flags.filter((flag): flag is string => typeof flag === 'string')
    : [];
}

export interface ReferenceLocation {
  /** Source document identity as the preparer recorded it, e.g. `kr.rf.301_3`. */
  readonly documentId?: string;
  readonly sectionTitle?: string;
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

/** Document and section of a block, read from its exact locator and section title. */
export function referenceLocation(
  provenance: Readonly<Record<string, unknown>>,
): ReferenceLocation {
  const locator = text(provenance['locator']);
  const documentId = locator
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('document='))
    ?.slice('document='.length)
    .trim();
  const sectionTitle = text(provenance['sectionTitle']);
  return {
    ...(documentId ? { documentId } : {}),
    ...(sectionTitle ? { sectionTitle } : {}),
  };
}

/** «Клинические рекомендации 301_3 · раздел «Список сокращений»», or undefined without either. */
export function referenceLocationLabel(location: ReferenceLocation): string | undefined {
  const official = location.documentId?.match(/^kr\.rf\.([\w.-]+)$/u)?.[1];
  const document = official
    ? `Клинические рекомендации ${official}`
    : location.documentId
      ? `Документ ${location.documentId}`
      : undefined;
  const section = location.sectionTitle ? `раздел «${location.sectionTitle}»` : undefined;
  const parts = [document, section].filter((part): part is string => Boolean(part));
  return parts.length ? parts.join(' · ') : undefined;
}

export interface ReferenceSourceAttribution {
  /** The source's own name, before any «; subset» qualifier. */
  readonly name: string;
  readonly license?: string;
  readonly licenseUrl?: string;
  readonly attribution?: string;
  /** Link to the exact entry, when the source declares a base URL and the block a path. */
  readonly entryUrl?: string;
}

/** Only a well-formed http(s) URL becomes a link. */
const httpUrl = (value: string | undefined): string | undefined => {
  if (!value || !URL.canParse(value)) return undefined;
  const url = new URL(value);
  return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined;
};

/** «CC-BY-SA-4.0» → «CC BY-SA 4.0»; other identifiers are shown as declared. */
export function licenseLabel(license: string): string {
  const match = license.match(/^CC-([A-Z-]+)-(\d+(?:\.\d+)?)$/u);
  return match ? `CC ${match[1]} ${match[2]}` : license;
}

/** Attribution as the source metadata declares it; nothing is inferred from ids or names. */
export function referenceSourceAttribution(
  source: Readonly<Record<string, unknown>> | null,
  provenance: Readonly<Record<string, unknown>>,
): ReferenceSourceAttribution {
  const declared = source?.['source'];
  const record =
    declared && typeof declared === 'object' ? (declared as Readonly<Record<string, unknown>>) : {};
  const title = text(record['title']) ?? 'Исходный материал';
  const name = title.split(';')[0]?.trim() || title;
  const license = text(record['license']);
  const licenseUrl = httpUrl(text(record['licenseUrl']));
  const attribution = text(record['attribution']);
  const citations = provenance['citations'];
  const path = Array.isArray(citations)
    ? text((citations[0] as Readonly<Record<string, unknown>> | undefined)?.['path'])
    : undefined;
  const baseUrl = text(record['baseUrl']);
  const entryUrl = baseUrl && path ? httpUrl(`${baseUrl}${path}`) : undefined;
  return {
    name,
    ...(license ? { license: licenseLabel(license) } : {}),
    ...(licenseUrl ? { licenseUrl } : {}),
    ...(attribution ? { attribution } : {}),
    ...(entryUrl ? { entryUrl } : {}),
  };
}
