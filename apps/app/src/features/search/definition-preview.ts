import {
  type CoreIdentityHit,
  normalizeCoreIdentityName,
  type SearchResultGroup,
} from '@localmed/contracts';

/**
 * Several dictionaries can hold the same name («Эпилепсия» from two term lists, a Wiktionary gloss
 * and an archived name without a definition). Search shows one preview per name: the entry that
 * best defines it first, the rest one tap away.
 */
export interface DefinitionPreviewGroup {
  readonly key: string;
  readonly title: string;
  readonly primary: CoreIdentityHit;
  readonly others: readonly CoreIdentityHit[];
}

export interface DefinitionPreviewSelection {
  /** The name the query asks for (or the first one found); shown as «Термин — определение». */
  readonly main: DefinitionPreviewGroup;
  /** Other names the query also matched, offered as small links. */
  readonly also: readonly DefinitionPreviewGroup[];
}

const COVERAGE_RANK: Readonly<Record<string, number>> = {
  'explicit-definition': 0,
  definition: 1,
  gloss: 2,
  'source-document': 3,
  abbreviation: 4,
  'mention-only': 5,
  'needs-definition': 6,
};

function coverageRank(hit: CoreIdentityHit): number {
  return COVERAGE_RANK[hit.coverage] ?? 5;
}

/** True when the entry carries no text of its own (the name is kept, the definition is missing). */
export function definitionHitHasText(hit: CoreIdentityHit): boolean {
  return hit.coverage !== 'needs-definition' && hit.coverage !== 'mention-only';
}

export function selectDefinitionPreview(
  hits: readonly CoreIdentityHit[],
  query: string,
): DefinitionPreviewSelection | undefined {
  const groups = new Map<string, CoreIdentityHit[]>();
  for (const hit of hits) {
    const key = normalizeCoreIdentityName(hit.title);
    const members = groups.get(key);
    if (members) members.push(hit);
    else groups.set(key, [hit]);
  }
  const ordered = [...groups.entries()].map(([key, members]): DefinitionPreviewGroup => {
    // Stable: equal coverage keeps the core's order.
    const ranked = members
      .map((hit, index) => ({ hit, index }))
      .toSorted(
        (left, right) =>
          coverageRank(left.hit) - coverageRank(right.hit) || left.index - right.index,
      )
      .map((entry) => entry.hit);
    const primary = ranked[0] as CoreIdentityHit;
    // A capitalised title reads better than a lower-case dictionary headword.
    const title =
      ranked.find((hit) => hit.title !== hit.title.toLowerCase())?.title ?? primary.title;
    return { key, title, primary, others: ranked.slice(1) };
  });
  if (ordered.length === 0) return undefined;
  const wanted = normalizeCoreIdentityName(query);
  const mainIndex = Math.max(
    0,
    ordered.findIndex((group) => group.key === wanted),
  );
  const main = ordered[mainIndex] as DefinitionPreviewGroup;
  return { main, also: ordered.filter((_, index) => index !== mainIndex) };
}

/**
 * The opening of a definition for a one-paragraph preview: whole sentences up to `limit`
 * characters, otherwise cut at a word with «…». Whitespace is collapsed; nothing is reworded.
 */
export function definitionPreviewText(text: string, limit = 260): string {
  const plain = text.replace(/\s+/gu, ' ').trim();
  if (plain.length <= limit) return plain;
  const sentences = plain.match(/[^.!?…]+[.!?…]+(?=\s|$)/gu) ?? [];
  let taken = '';
  for (const sentence of sentences) {
    const next = `${taken}${sentence}`;
    if (next.trim().length > limit) break;
    taken = next;
  }
  if (taken.trim().length >= limit * 0.4) return taken.trim();
  const cut = plain.slice(0, limit);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:—–-]+$/u, '')}…`;
}

/** A definition quoted from a found document, for when no installed dictionary can supply one. */
export interface ResultDefinition {
  readonly text: string;
  readonly documentId: string;
  readonly documentTitle: string;
  readonly anchor: string;
}

const DEFINITION_SECTION =
  /^(?:\d+(?:\.\d+)*\.?\s+)?(?:Определение|Краткое описание)(?=$|[\s.,:;])/u;

/**
 * The definition section of a found document named exactly like the term («Эпилепсия» →
 * «Краткое описание» of the disease card, «Определение» of a recommendation card). Source text as
 * the search returned it; nothing is reworded.
 */
export function definitionFromResults(
  groups: readonly SearchResultGroup[],
  term: string,
): ResultDefinition | undefined {
  const wanted = normalizeCoreIdentityName(term);
  for (const group of groups) {
    if (normalizeCoreIdentityName(group.title) !== wanted) continue;
    const result = group.results.find((candidate) =>
      DEFINITION_SECTION.test(candidate.sectionPath.at(-1)?.trim() ?? ''),
    );
    if (!result) continue;
    const text = definitionPreviewText(result.snippet.replace(/^…\s*/u, ''));
    if (text.length < 20) continue;
    return {
      text,
      documentId: group.documentId,
      documentTitle: group.title,
      anchor: result.anchor,
    };
  }
  return undefined;
}

/**
 * A definition that opens with its own term («Эпилепсия — это…») shows that opening as the term
 * instead of repeating it: `lead` is the text's own spelling of the term, `rest` follows verbatim.
 */
export function splitLeadingTerm(
  text: string,
  term: string,
): { readonly lead: string; readonly rest: string } | undefined {
  const head = text.slice(0, term.length);
  if (normalizeCoreIdentityName(head) !== normalizeCoreIdentityName(term)) return undefined;
  const next = text.charAt(term.length);
  // «Эпилепсия» must not split «Эпилепсиями».
  if (next && /[\p{L}\p{N}]/u.test(next)) return undefined;
  return { lead: head, rest: text.slice(term.length) };
}
