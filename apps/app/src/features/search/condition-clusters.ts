import type { SearchResultGroup } from '@localmed/contracts';

/**
 * One condition, several sources. A search for «Мигрень» found the recommendation, a general
 * article and an МКБ-10 card as three separate cards of the same name (owner 2026-11-15: «you
 * search for something specific — you get it without too many buttons»). Results whose titles name
 * the same thing become one card: the recommendation leads (or the best-ranked result when there is
 * none) and the other sources are listed under it. The sources stay separate documents and keep
 * their own labels: this groups by name, it does not say the texts are the same.
 *
 * A name can mean two things: «Мигрень» is one recommendation for adults and another for children
 * (owner 2026-11-15). Recommendations written for different ages are different answers and are
 * never folded into each other; each keeps its own card, and the caller labels it with the age.
 */
export interface ResultCluster {
  readonly lead: SearchResultGroup;
  /** The other sources of the same name, in the order the search ranked them. */
  readonly others: readonly SearchResultGroup[];
}

/** Document types that describe a condition; drugs, tools and legal acts are never folded. */
const CLUSTERED_KINDS: ReadonlySet<string> = new Set(['clinical-recommendation', 'reference']);

const ICD_CODE_PREFIX = /^[A-ZА-Я]\d{2}(?:[.-]\d+)?(?:\s*[–-]\s*[A-ZА-Я]\d{2}(?:\.\d+)?)?\s+/u;
const ICD_SUFFIX = /,\s*МКБ-1[01]\s*$/iu;

/**
 * What a result's title names: the title without an МКБ code in front («K85 Острый панкреатит,
 * МКБ-10» → «острый панкреатит»), lower case, «ё» as «е», single spaces.
 */
export function conditionTitleKey(title: string): string {
  return title
    .replace(ICD_SUFFIX, '')
    .replace(ICD_CODE_PREFIX, '')
    .toLowerCase()
    .replaceAll('ё', 'е')
    .replace(/\s+/gu, ' ')
    .trim();
}

function clusters(group: SearchResultGroup): boolean {
  return (
    CLUSTERED_KINDS.has(group.documentKind ?? 'reference') &&
    // A term found as a definition, or as a mention inside another text, is its own kind of card.
    group.terminologyMatch === undefined
  );
}

/**
 * Folds results of one name into clusters, in the order of each name's first result. Within a
 * cluster a clinical recommendation leads; among several, the best-ranked one.
 *
 * `audienceOf` tells whom a recommendation is written for («взрослые», «дети»; undefined when the
 * source does not say). Recommendations of one name for different audiences form separate
 * clusters; the other sources of that name (an article, an МКБ card) fold under the first of them.
 */
export function clusterResultGroups(
  groups: readonly SearchResultGroup[],
  audienceOf: (group: SearchResultGroup) => string | undefined = () => undefined,
): readonly ResultCluster[] {
  interface Building {
    audience: string | undefined;
    hasRecommendation: boolean;
    readonly members: SearchResultGroup[];
  }
  const byName = new Map<string, Building[]>();
  const order: (Building | SearchResultGroup)[] = [];
  for (const group of groups) {
    const name = clusters(group) ? conditionTitleKey(group.title) : '';
    if (!name) {
      order.push(group);
      continue;
    }
    const ofName = byName.get(name) ?? [];
    byName.set(name, ofName);
    const isRecommendation = group.documentKind === 'clinical-recommendation';
    const audience = isRecommendation ? audienceOf(group) : undefined;
    // A recommendation joins the cluster of its own audience (or one that has no recommendation
    // yet); any other source joins the first cluster of the name.
    const home = isRecommendation
      ? ofName.find((cluster) => !cluster.hasRecommendation || cluster.audience === audience)
      : ofName[0];
    if (home) {
      home.members.push(group);
      if (isRecommendation && !home.hasRecommendation) {
        home.audience = audience;
        home.hasRecommendation = true;
      }
      continue;
    }
    const created: Building = { audience, hasRecommendation: isRecommendation, members: [group] };
    ofName.push(created);
    order.push(created);
  }
  return order.map((entry): ResultCluster => {
    if (!('members' in entry)) return { lead: entry, others: [] };
    const lead =
      entry.members.find((member) => member.documentKind === 'clinical-recommendation') ??
      entry.members[0];
    if (!lead) throw new Error('A result cluster has no members.');
    return { lead, others: entry.members.filter((member) => member !== lead) };
  });
}

/**
 * Whom a document says it is for, in the words shown on a card: «взрослые», «дети», «взрослые и
 * дети». Read from the source's own age categories; undefined when it names none.
 */
export function audienceLabel(
  metadata: Readonly<Record<string, unknown>> | undefined,
): string | undefined {
  const categories = metadata?.['ageCategories'];
  if (!Array.isArray(categories)) return undefined;
  const names = [
    ...new Set(
      categories
        .filter((category): category is string => typeof category === 'string')
        .map((category) => category.trim().toLowerCase())
        .filter(Boolean),
    ),
  ].toSorted();
  return names.length > 0 ? names.join(' и ') : undefined;
}

/**
 * The two parts of a result list (owner 2026-11-15: «break down into sections like "more" and
 * "found in text"»). `named`: the search's best result and every result whose title carries the
 * words of the query. `inText`: results the query was only found inside. Each part keeps the
 * order the search ranked it in.
 */
export interface ResultSections {
  readonly named: readonly ResultCluster[];
  readonly inText: readonly ResultCluster[];
}

export function splitResultSections(
  clusters: readonly ResultCluster[],
  titleNamesQuery: (title: string) => boolean,
): ResultSections {
  const named: ResultCluster[] = [];
  const inText: ResultCluster[] = [];
  clusters.forEach((cluster, index) => {
    // The first result is the search's own answer whatever its title (a trade name typed whole
    // finds its substance card).
    if (index === 0 || titleNamesQuery(cluster.lead.title)) named.push(cluster);
    else inText.push(cluster);
  });
  return { named, inText };
}

/** How many «found in text» results show before «Показать ещё». */
export const IN_TEXT_PREVIEW = 6;

/** The part of `inText` shown now: all of it when expanded or when fewer than three would hide. */
export function shownInText(
  inText: readonly ResultCluster[],
  expanded: boolean,
): readonly ResultCluster[] {
  return expanded || inText.length - IN_TEXT_PREVIEW < 3
    ? inText
    : inText.slice(0, IN_TEXT_PREVIEW);
}
