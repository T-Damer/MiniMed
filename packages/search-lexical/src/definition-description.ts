import { lightStemRussian, normalizeSurfaceText } from './normalize';

/** These are language operators, not clinical aliases or a phrase-to-diagnosis dictionary. */
const STOP = new Set([
  'а',
  'бы',
  'в',
  'во',
  'для',
  'до',
  'же',
  'и',
  'из',
  'или',
  'к',
  'как',
  'ко',
  'ли',
  'на',
  'но',
  'о',
  'об',
  'от',
  'по',
  'под',
  'при',
  'с',
  'со',
  'у',
  'что',
  'это',
  'этот',
  'эта',
  'эти',
  'такой',
  'такая',
  'такое',
  'когда',
  'который',
  'которая',
  'которые',
  'которое',
  'его',
  'ее',
  'их',
  'он',
  'она',
  'они',
  'оно',
  'себя',
  'собой',
  'есть',
  'является',
  'представляет',
  'помощью',
  'одного',
  'одной',
  'один',
]);
const FRAMING =
  /^(?:(?:как\s+(?:это\s+)?называется|что\s+(?:это\s+)?за\s+термин|не\s+(?:помню|знаю)\s+(?:название|термин)|найди\s+(?:термин|определение)|найти\s+(?:термин|определение))\s*[,.:—-]?\s*(?:когда\s+)*)/u;
const ABSENCE = /^(?:не|нет|без|отсутств\p{L}*|отрица\p{L}*)$/u;
const MAX_TERMS = 16;
export const DEFINITION_DESCRIPTION_CANDIDATES = 192;
export const DEFINITION_DESCRIPTION_CHARACTERS = 4096;

interface Feature {
  readonly surface: string;
  readonly stem: string;
  readonly absent: boolean;
  readonly position: number;
}
export interface DefinitionDescriptionPlan {
  readonly subject: string;
  readonly descriptive: boolean;
  readonly terms: readonly Feature[];
  readonly conjunction: string;
  readonly disjunction: string;
}
export interface DefinitionDescriptionCandidate {
  readonly id: string;
  readonly text: string;
  readonly retrievalRank: number;
}
export interface RankedDefinitionDescription {
  readonly id: string;
  readonly score: number;
  readonly matched: number;
  readonly total: number;
}

/** Same existing light stemmer plus case endings it deliberately leaves untouched elsewhere. */
function stem(value: string): string {
  const normalized = lightStemRussian(value);
  if (normalized !== value) return normalized;
  if (/^[а-я]{6,}(?:ых|их)$/u.test(value)) return value.slice(0, -2);
  if (/^[а-я]{3}[аяуюыие]$/u.test(value)) return value.slice(0, -1);
  return value;
}

function features(value: string): readonly Feature[] {
  const result: Feature[] = [];
  let position = 0;
  // Additive "not only" is not absence. Other negation remains clause-local, not semantic parsing.
  const normalized = normalizeSurfaceText(value.replace(/[;!?]/gu, '.')).replace(
    /(^|\s)не\s+только(?=\s|$)/gu,
    '$1',
  );
  for (const clause of normalized.split(/[.,:;!?]|\s(?:но|однако|зато)\s/gu)) {
    const words = clause.match(/[\p{L}\p{N}]+/gu) ?? [];
    const absent = words.some((word) => ABSENCE.test(word));
    for (const word of words) {
      const current = position++;
      if (word.length < 2 || STOP.has(word) || ABSENCE.test(word)) continue;
      result.push({ surface: word, stem: stem(word), absent, position: current });
    }
  }
  return result;
}

/** Suppress navigation-only text after, never before, exact identity lookup. */
export function isDefinitionNavigationOnly(value: string): boolean {
  const normalized = normalizeSurfaceText(value.replace(/[;!?]/gu, '.'));
  return normalized.length > 0 && normalized.replace(FRAMING, '').replace(/[.\s]+$/gu, '') === '';
}

export function planDefinitionDescription(value: string): DefinitionDescriptionPlan | null {
  if (!value || value.length > 2048 || value.includes('\0')) return null;
  const normalized = normalizeSurfaceText(value.replace(/[;!?]/gu, '.'));
  const subject = normalized.replace(FRAMING, '').trim();
  if (!subject) return null;
  const unique = new Map<string, Feature>();
  for (const feature of features(subject)) {
    const previous = unique.get(feature.stem);
    // Repeated positive/negative mentions are not reconciled into a confident search assertion.
    if (previous && previous.absent !== feature.absent) return null;
    unique.set(feature.stem, previous ?? feature);
  }
  const terms = [...unique.values()];
  if (terms.length < 2 || terms.length > MAX_TERMS) return null;
  const expression = terms.map(
    (term) => `"${term.stem}"${/^[а-яa-z]{3,}$/u.test(term.stem) ? '*' : ''}`,
  );
  return {
    subject,
    descriptive: subject !== normalized || terms.length >= 3,
    terms,
    conjunction: expression.join(' AND '),
    disjunction: expression.join(' OR '),
  };
}

/** One adjacent-letter swap only; no fuzzy numbers, short tokens or synonym inference. */
function transposed(left: string, right: string): boolean {
  if (left.length !== right.length || !/^[а-яa-z]{6,}$/u.test(left)) return false;
  let at = 0;
  while (at < left.length && left[at] === right[at]) at += 1;
  return (
    at + 1 < left.length &&
    left[at] === right[at + 1] &&
    left[at + 1] === right[at] &&
    left.slice(at + 2) === right.slice(at + 2)
  );
}

function strength(query: Feature, candidate: Feature): number {
  if (query.surface === candidate.surface) return 1;
  if (query.stem === candidate.stem) return 0.96;
  // Prefixes here repair inflection only; short abbreviations/numbers must be exact.
  if (
    /^[а-яa-z]{4,}$/u.test(query.stem) &&
    /^[а-яa-z]{4,}$/u.test(candidate.stem) &&
    Math.abs(query.stem.length - candidate.stem.length) <= 2 &&
    (query.stem.startsWith(candidate.stem) || candidate.stem.startsWith(query.stem))
  )
    return 0.8;
  if (transposed(query.stem, candidate.stem)) return 0.85;
  return 0;
}

/** Evaluate each source passage independently; repeated or disjoint rows are not extra evidence. */
export function rankDefinitionDescriptions(
  plan: DefinitionDescriptionPlan,
  candidates: readonly DefinitionDescriptionCandidate[],
): readonly RankedDefinitionDescription[] {
  if (candidates.length > DEFINITION_DESCRIPTION_CANDIDATES)
    throw new Error('Description candidate budget exceeded.');
  const analyzed = candidates.map((candidate) => {
    if (
      !candidate.id ||
      candidate.text.length > DEFINITION_DESCRIPTION_CHARACTERS * 2 ||
      [...candidate.text].length > DEFINITION_DESCRIPTION_CHARACTERS ||
      !Number.isFinite(candidate.retrievalRank)
    ) {
      throw new Error('Invalid bounded definition candidate.');
    }
    const words = features(candidate.text);
    const matches = plan.terms.map((term) => {
      let compatible = 0;
      let opposite = 0;
      let at = -1;
      for (const word of words) {
        const quality = strength(term, word);
        if (term.absent !== word.absent) {
          opposite = Math.max(opposite, quality);
        } else if (quality > compatible) {
          compatible = quality;
          at = word.position;
        }
      }
      return { best: compatible, at, conflict: opposite > 0 && compatible === 0 };
    });
    return { candidate, words, matches };
  });
  const identities = new Set(analyzed.map((row) => row.candidate.id)).size;
  const weights = plan.terms.map((_, index) => {
    const owners = new Set(
      analyzed.filter((row) => (row.matches[index]?.best ?? 0) > 0).map((row) => row.candidate.id),
    );
    return 1 + Math.log((identities + 1) / (owners.size + 1));
  });
  const totalWeight = weights.reduce((total, value) => total + value, 0);
  const bestById = new Map<string, RankedDefinitionDescription>();
  for (const row of analyzed) {
    const matched = row.matches.filter((match) => match.best > 0).length;
    if (matched < Math.max(2, Math.ceil(plan.terms.length * 0.6))) continue;
    // Both directions matter: a positive query must not silently match a negated definition either.
    if (row.matches.some((match) => match.conflict)) continue;
    const coverage =
      row.matches.reduce((sum, match, i) => sum + match.best * (weights[i] ?? 0), 0) / totalWeight;
    if (coverage < 0.6) continue;
    const positions = row.matches.filter((match) => match.at >= 0).map((match) => match.at);
    const span = Math.max(...positions) - Math.min(...positions) + 1;
    const proximity = matched / Math.max(matched, span);
    const score = coverage * 8 + proximity + matched / Math.max(matched, row.words.length);
    const outcome = { id: row.candidate.id, score, matched, total: plan.terms.length };
    const previous = bestById.get(outcome.id);
    if (!previous || previous.score < score) bestById.set(outcome.id, outcome);
  }
  return [...bestById.values()].sort(
    (left, right) => right.score - left.score || left.id.localeCompare(right.id),
  );
}
