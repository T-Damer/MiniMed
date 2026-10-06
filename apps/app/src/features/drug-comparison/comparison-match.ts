/**
 * Which statements two or more instructions share (CMP1). Pure and deterministic: no text is
 * generated, no statement is judged. Every unit (a sentence or a list item, see
 * `comparison-units.ts`) is reduced to a set of word stems; units of different drugs are matched
 * by those sets.
 *
 * Normalisation: lower case, «ё» → «е», punctuation dropped, every word cut to the same light
 * stem the interaction index uses (`nameWordStem`: «ибупрофена», «ибупрофеном» → «ибупрофен»),
 * numbers kept as their own tokens («12» ≠ «6»), Roman numerals kept («II» ≠ «III»). Not counted:
 * a short list of function words, and the drug's OWN names (its МНН words and trade names), so
 * «Гиперчувствительность к ибупрофену» and «Гиперчувствительность к парацетамолу» are the same
 * statement about the drug in front of the reader.
 *
 * Two units are **identical** when their remaining stem sequences are equal, and **similar** when
 * the Jaccard similarity of their stem sets is at least `SIMILAR_THRESHOLD`. The threshold was
 * chosen on a hand-checked sample (docs/research/drug-comparison-2026-10-06.md). A similar pair is
 * shown side by side with the words that differ marked; a number that differs is such a word.
 * A statement of at least four words that is almost entirely (85 %) inside a longer unit of another
 * drug (a list printed as one sentence) is matched with it the same way, as a similar pair.
 *
 * With three or four drugs a group of matched units must be a clique: every two of its members
 * are at least similar, and a group holds at most one unit per drug.
 */
import { nameWordStem } from '@/features/drug-interactions/mention-matcher';

/** Jaccard similarity of two stem sets from which two units count as the same statement. */
export const SIMILAR_THRESHOLD = 0.6;
/**
 * A short statement whose words (at least `MIN_CONTAINED_TOKENS` of them) are almost all (this
 * share) inside a longer unit of another drug is that statement inside a list printed as one
 * sentence: the two are matched, the extra words of the longer one are marked.
 */
export const CONTAINED_THRESHOLD = 0.85;
export const MIN_CONTAINED_TOKENS = 4;
/** Units per drug and section compared: a longer list is cut (never silently: the view says so). */
export const MAX_UNITS_PER_COLUMN = 400;

const FUNCTION_WORDS = [
  'и',
  'в',
  'во',
  'на',
  'с',
  'со',
  'к',
  'ко',
  'по',
  'о',
  'об',
  'от',
  'из',
  'у',
  'за',
  'для',
  'при',
  'или',
  'либо',
  'также',
  'а',
  'же',
  'ли',
  'бы',
  'это',
  'как',
  'что',
  'чем',
  'то',
  'так',
  'быть',
  'препарат',
  'лекарственный',
  'средство',
];
const IGNORED_STEMS: ReadonlySet<string> = new Set(
  FUNCTION_WORDS.flatMap((word) => {
    const stem = nameWordStem(word);
    return stem ? [stem, word] : [word];
  }),
);

const TOKEN = /[a-zа-яёβ]+|\d+(?:[.,]\d+)?/giu;
const ROMAN_NUMERAL = /^(?:i{1,3}|iv|vi{0,3}|ix|x)$/u;

export interface UnitToken {
  readonly stem: string;
  readonly start: number;
  readonly end: number;
}

/** Tokens of a unit's display text, in reading order, each with its offsets in that text. */
export function unitTokens(text: string): readonly UnitToken[] {
  const tokens: UnitToken[] = [];
  for (const match of text.matchAll(TOKEN)) {
    const word = match[0];
    const start = match.index ?? 0;
    let stem: string | null;
    if (/^\d/u.test(word)) stem = `#${word.replace(',', '.')}`;
    else if (ROMAN_NUMERAL.test(word.toLowerCase()) && word === word.toUpperCase()) {
      stem = `r:${word.toLowerCase()}`;
    } else stem = nameWordStem(word);
    if (stem) tokens.push({ stem, start, end: start + word.length });
  }
  return tokens;
}

/** The stems of a drug's own names: its МНН words and its trade names. */
export function ownNameStems(names: readonly string[]): ReadonlySet<string> {
  const stems = new Set<string>();
  for (const name of names) {
    for (const token of unitTokens(name)) {
      if (!token.stem.startsWith('#') && token.stem.length >= 4) stems.add(token.stem);
    }
  }
  return stems;
}

export interface MatchUnit {
  /** Display text, whitespace collapsed. */
  readonly text: string;
  readonly tokens: readonly UnitToken[];
}

interface PreparedUnit {
  readonly stems: readonly string[];
  /** Sorted, unique. */
  readonly set: readonly string[];
  readonly key: string;
}

function prepare(unit: MatchUnit, own: ReadonlySet<string>): PreparedUnit {
  const stems = unit.tokens
    .map((token) => token.stem)
    .filter((stem) => !IGNORED_STEMS.has(stem) && !own.has(stem));
  return { stems, set: [...new Set(stems)].toSorted(), key: stems.join(' ') };
}

function intersectionSize(left: readonly string[], right: readonly string[]): number {
  let shared = 0;
  let a = 0;
  let b = 0;
  while (a < left.length && b < right.length) {
    const x = left[a] as string;
    const y = right[b] as string;
    if (x === y) {
      shared += 1;
      a += 1;
      b += 1;
    } else if (x < y) a += 1;
    else b += 1;
  }
  return shared;
}

/** Jaccard similarity of two sorted unique stem sets; 0 when either is empty. */
export function jaccard(left: readonly string[], right: readonly string[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  const shared = intersectionSize(left, right);
  return shared / (left.length + right.length - shared);
}

export interface ColumnUnits {
  /** Position of the drug among the compared drugs. */
  readonly drug: number;
  readonly units: readonly MatchUnit[];
  readonly ownStems: ReadonlySet<string>;
}

export interface ClusterMember {
  readonly drug: number;
  /** Index into that drug's units. */
  readonly unit: number;
}

export interface UnitCluster {
  readonly members: readonly ClusterMember[];
  /** Every member says the same after normalisation. */
  readonly identical: boolean;
}

export type ClusterKind = 'shared' | 'partial' | 'only';

export function clusterKind(cluster: UnitCluster, drugCount: number): ClusterKind {
  if (cluster.members.length >= drugCount) return 'shared';
  return cluster.members.length === 1 ? 'only' : 'partial';
}

function isContained(left: number, right: number, shared: number): boolean {
  const small = Math.min(left, right);
  return small >= MIN_CONTAINED_TOKENS && shared / small >= CONTAINED_THRESHOLD;
}

interface Item {
  readonly drug: number;
  readonly unit: number;
  readonly prepared: PreparedUnit;
}

interface Candidate {
  readonly a: number;
  readonly b: number;
  readonly score: number;
  readonly identical: boolean;
}

/**
 * Groups the units of the compared drugs. The groups come back in a fixed reading order: first
 * the first drug's units in their own order (each with the units that match it), then the groups
 * that start with the second drug's unit, and so on.
 */
export function clusterUnits(columns: readonly ColumnUnits[]): readonly UnitCluster[] {
  const items: Item[] = [];
  for (const column of columns) {
    column.units.slice(0, MAX_UNITS_PER_COLUMN).forEach((unit, index) => {
      items.push({
        drug: column.drug,
        unit: index,
        prepared: prepare(unit, column.ownStems),
      });
    });
  }
  // Candidate pairs from an inverted index, so a long section is not compared everywhere.
  const byStem = new Map<string, number[]>();
  const candidates: Candidate[] = [];
  items.forEach((item, position) => {
    const shared = new Map<number, number>();
    for (const stem of item.prepared.set) {
      for (const other of byStem.get(stem) ?? []) {
        if (items[other]?.drug !== item.drug) shared.set(other, (shared.get(other) ?? 0) + 1);
      }
    }
    for (const [other, count] of shared) {
      const peer = items[other];
      if (!peer) continue;
      const union = item.prepared.set.length + peer.prepared.set.length - count;
      const score = count / union;
      const identical = item.prepared.key !== '' && item.prepared.key === peer.prepared.key;
      if (identical || score >= SIMILAR_THRESHOLD) {
        candidates.push({ a: other, b: position, score: identical ? 1 : score, identical });
      } else if (isContained(item.prepared.set.length, peer.prepared.set.length, count)) {
        // Below every Jaccard match, so a better partner is always taken first.
        candidates.push({ a: other, b: position, score: score / 2, identical: false });
      }
    }
    for (const stem of item.prepared.set) {
      const list = byStem.get(stem);
      if (list) list.push(position);
      else byStem.set(stem, [position]);
    }
  });
  candidates.sort(
    (left, right) =>
      Number(right.identical) - Number(left.identical) ||
      right.score - left.score ||
      left.a - right.a ||
      left.b - right.b,
  );

  const groupOf = items.map((_, position) => position);
  const groups = new Map<number, number[]>(items.map((_, position) => [position, [position]]));
  const similarEnough = (x: number, y: number): boolean => {
    const left = items[x];
    const right = items[y];
    if (!left || !right) return false;
    const shared = intersectionSize(left.prepared.set, right.prepared.set);
    return (
      (left.prepared.key !== '' && left.prepared.key === right.prepared.key) ||
      jaccard(left.prepared.set, right.prepared.set) >= SIMILAR_THRESHOLD ||
      isContained(left.prepared.set.length, right.prepared.set.length, shared)
    );
  };
  for (const candidate of candidates) {
    const first = groupOf[candidate.a] as number;
    const second = groupOf[candidate.b] as number;
    if (first === second) continue;
    const left = groups.get(first) as number[];
    const right = groups.get(second) as number[];
    const drugsLeft = new Set(left.map((member) => items[member]?.drug));
    if (right.some((member) => drugsLeft.has(items[member]?.drug))) continue;
    if (!left.every((x) => right.every((y) => similarEnough(x, y)))) continue;
    for (const member of right) groupOf[member] = first;
    left.push(...right);
    groups.delete(second);
  }

  const clusters = [...groups.values()].map((members): UnitCluster => {
    const ordered = members
      .map((position) => items[position] as Item)
      .toSorted((left, right) => left.drug - right.drug);
    const keys = new Set(ordered.map((member) => member.prepared.key));
    return {
      members: ordered.map((member) => ({ drug: member.drug, unit: member.unit })),
      identical: ordered.length > 1 && keys.size === 1 && !keys.has(''),
    };
  });
  return clusters.toSorted((left, right) => {
    const a = left.members[0] as ClusterMember;
    const b = right.members[0] as ClusterMember;
    return a.drug - b.drug || a.unit - b.unit;
  });
}

export interface DiffSegment {
  readonly text: string;
  /** The word is not in every unit of the group: a word, a number or a numeral that differs. */
  readonly differs: boolean;
}

/**
 * The text of a unit with the words that the other units of its group do not all have marked.
 * An identical group has none; a unit alone in its group is not marked at all.
 */
export function diffSegments(
  unit: MatchUnit,
  others: readonly MatchUnit[],
  own: ReadonlySet<string>,
  otherOwn: readonly ReadonlySet<string>[],
): readonly DiffSegment[] {
  if (others.length === 0) return [{ text: unit.text, differs: false }];
  const otherSets = others.map(
    (other, position) => new Set(prepare(other, otherOwn[position] ?? new Set()).stems),
  );
  const segments: DiffSegment[] = [];
  let cursor = 0;
  const push = (text: string, differs: boolean): void => {
    if (text === '') return;
    const last = segments[segments.length - 1];
    if (last && last.differs === differs)
      segments[segments.length - 1] = { text: last.text + text, differs };
    else segments.push({ text, differs });
  };
  for (const token of unit.tokens) {
    const counted = !IGNORED_STEMS.has(token.stem) && !own.has(token.stem);
    const differs = counted && otherSets.some((set) => !set.has(token.stem));
    push(unit.text.slice(cursor, token.start), false);
    push(unit.text.slice(token.start, token.end), differs);
    cursor = token.end;
  }
  push(unit.text.slice(cursor), false);
  return segments;
}
