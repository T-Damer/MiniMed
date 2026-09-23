import type { AliasRecord } from '@localmed/domain';
import { normalizeSurfaceText } from './normalize';

// Search costs, not equivalence classes or clinically interchangeable medicine names.
// In particular и/о is not inferred transitively from и/е and е/о.
const CONFUSIONS = ['ие', 'ео', 'ао', 'дт', 'зс', 'жш', 'бп', 'вф', 'гк', 'шщ', 'ий', 'еэ'];
const PAIRS = new Set(CONFUSIONS.flatMap((pair) => [pair, [...pair].reverse().join('')]));
const MAX_NAME = 96;
export const MAX_MEDICATION_SPELLING_MATCHES = 8;
const NAME = /^(?:[а-я]+(?:[ -][а-я]+){0,3}|[a-z]+(?:[ -][a-z]+){0,3})$/u;
const NEGATION = /(?:^|\s)(?:не|нет|без|отрицает|аллергия|аллергии)(?:\s|$)/u;
const PREFIX = /^(?:(?:инструкция(?:\s+(?:к|по))?|препарат|лекарство|описание)\s+)/u;
const SUFFIX = /\s+(?=\d|(?:мг|мл|mg|ml|таблетки|капсулы|раствор|инструкция|дозировка|противопоказания|побочные\s+эффекты)(?:\s|$))/u;

interface Distance {
  readonly cost: number;
  readonly edits: number;
}

/** Weighted optimal-string-alignment distance with an independent edit-count ceiling. */
function tokenDistance(left: string, right: string): Distance | null {
  if (left === right) return { cost: 0, edits: 0 };
  if (Math.min(left.length, right.length) < 5 || Math.max(left.length, right.length) > 48)
    return null;
  const maximum = Math.min(left.length, right.length) < 7 ? 1 : left.length >= 10 ? 3 : 2;
  if (Math.abs(left.length - right.length) > maximum) return null;
  const budget = maximum === 1 ? 3 : maximum === 2 ? 5 : 6;
  let previous = Array.from({ length: right.length + 1 }, (_, i) => i * 3);
  let previousEdits = Array.from({ length: right.length + 1 }, (_, i) => i);
  let beforePrevious = previous;
  let beforePreviousEdits = previousEdits;
  for (let i = 1; i <= left.length; i += 1) {
    const current = Array<number>(right.length + 1).fill(1000);
    const currentEdits = Array<number>(right.length + 1).fill(1000);
    current[0] = i * 3;
    currentEdits[0] = i;
    for (let j = Math.max(1, i - maximum); j <= Math.min(right.length, i + maximum); j += 1) {
      const same = left[i - 1] === right[j - 1];
      const substitution = same ? 0 : PAIRS.has(`${left[i - 1]}${right[j - 1]}`) ? 1 : 3;
      let cost = Math.min(
        (previous[j] ?? 1000) + 3,
        (current[j - 1] ?? 1000) + 3,
        (previous[j - 1] ?? 1000) + substitution,
      );
      let edits = Math.min(
        (previousEdits[j] ?? 1000) + 1,
        (currentEdits[j - 1] ?? 1000) + 1,
        (previousEdits[j - 1] ?? 1000) + Number(!same),
      );
      if (i > 1 && j > 1 && left[i - 1] === right[j - 2] && left[i - 2] === right[j - 1]) {
        cost = Math.min(cost, (beforePrevious[j - 2] ?? 1000) + 2);
        edits = Math.min(edits, (beforePreviousEdits[j - 2] ?? 1000) + 1);
      }
      current[j] = cost;
      currentEdits[j] = edits;
    }
    beforePrevious = previous;
    beforePreviousEdits = previousEdits;
    previous = current;
    previousEdits = currentEdits;
  }
  const cost = previous[right.length] ?? 1000;
  const edits = previousEdits[right.length] ?? 1000;
  return cost <= budget && edits <= maximum ? { cost, edits } : null;
}

export interface MedicationSpellingMatch {
  readonly name: string;
  readonly canonicalTerms: readonly string[];
  readonly matchedText: string;
  readonly replacementQuery: string;
  readonly cost: number;
}
interface Name {
  readonly name: string;
  readonly normalized: string;
  readonly parts: readonly string[];
  readonly canonicals: Set<string>;
}

/**
 * A compact index of the already-loaded medication alias vocabulary, not document bodies.
 * Exact known names are never repaired. No first-letter filter: the first letter can be wrong.
 * Clinical analysis does not invoke this matcher; it belongs to ordinary source lookup only.
 */
export function createMedicationSpellingMatcher(aliases: readonly AliasRecord[]) {
  const known = new Set<string>();
  const names = new Map<string, Name>();
  for (const alias of aliases) {
    for (const value of [alias.alias, alias.canonicalTerm]) {
      const normalized = normalizeSurfaceText(value);
      known.add(normalized);
      if (alias.category !== 'medication' || normalized.length > MAX_NAME || !NAME.test(normalized))
        continue;
      const existing = names.get(normalized);
      if (existing) existing.canonicals.add(alias.canonicalTerm);
      else
        names.set(normalized, {
          name: value,
          normalized,
          parts: normalized.split(/([ -])/u),
          canonicals: new Set([alias.canonicalTerm]),
        });
    }
  }
  const lengths = new Map<number, Name[]>();
  for (const name of names.values()) {
    const bucket = lengths.get(name.normalized.length) ?? [];
    bucket.push(name);
    lengths.set(name.normalized.length, bucket);
  }
  return (query: string): readonly MedicationSpellingMatch[] => {
    if (!query || query.length > 160 || query.includes('\0')) return [];
    const normalized = normalizeSurfaceText(query);
    if (known.has(normalized) || NEGATION.test(normalized)) return [];
    const prefix = PREFIX.exec(normalized)?.[0] ?? '';
    const remainder = normalized.slice(prefix.length);
    const suffixIndex = SUFFIX.exec(remainder)?.index ?? remainder.length;
    const subject = remainder.slice(0, suffixIndex);
    if (!subject || subject.length > MAX_NAME || !NAME.test(subject) || known.has(subject))
      return [];
    const parts = subject.split(/([ -])/u);
    const matches: MedicationSpellingMatch[] = [];
    for (let length = Math.max(5, subject.length - 3); length <= subject.length + 3; length += 1) {
      for (const name of lengths.get(length) ?? []) {
        if (name.parts.length !== parts.length) continue;
        let cost = 0;
        let edits = 0;
        let valid = true;
        for (let i = 0; i < parts.length; i += 1) {
          const left = parts[i] ?? '';
          const right = name.parts[i] ?? '';
          if (i % 2 === 1) {
            if (left !== right) valid = false;
            continue;
          }
          const distance = tokenDistance(left, right);
          if (!distance) {
            valid = false;
            break;
          }
          cost += distance.cost;
          edits += distance.edits;
          if (cost > 6 || edits > 3) {
            valid = false;
            break;
          }
        }
        if (valid && cost > 0)
          matches.push({
            name: name.name,
            canonicalTerms: [...name.canonicals].sort().slice(0, 8),
            matchedText: subject,
            replacementQuery: prefix + name.normalized + remainder.slice(suffixIndex),
            cost,
          });
      }
    }
    return matches
      .sort((left, right) => left.cost - right.cost || left.name.localeCompare(right.name, 'ru'))
      .slice(0, MAX_MEDICATION_SPELLING_MATCHES);
  };
}
