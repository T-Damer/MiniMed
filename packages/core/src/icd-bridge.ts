import { lightStemRussian, normalizeSurfaceText } from '@localmed/search-lexical';
import type { SearchDocumentDescriptor } from '@localmed/storage';

/**
 * Diagnosis → МКБ code → clinical recommendations (roadmap item 4, S3).
 *
 * A diagnosis phrase usually names an МКБ card («острый бронхит неуточнённый» → J20.9), while the
 * recommendation that covers it is titled differently («Острый бронхит»), so the words never meet.
 * Every recommendation pointer in the core carries the МКБ codes it covers, and every card its own
 * code: the bridge only joins the two through those source codes. It adds recommendations; it never
 * removes or reorders what lexical search found, and it reads no generated text.
 */
export interface IcdBridgeTuning {
  /** How many of the best-ranked code-bearing documents (cards, disease articles) may lend codes. */
  readonly cards: number;
  /** A card lends its codes only when its score is at least this share of the best card's score. */
  readonly minCardShare: number;
  /** Recommendations added per card, best code match first. */
  readonly perCard: number;
  /** Recommendations added in total. */
  readonly total: number;
  /** Only exact code matches (a card's code is listed by the recommendation) when true. */
  readonly exactOnly: boolean;
  /**
   * A card whose title covers at least this share of the query's words is a diagnosis match: its
   * recommendations go to the front of the list (behind exact-name groups). Other cards are weak
   * evidence: their recommendations follow the first `weakKeep` recommendations found by words, or
   * are not added at all when `weakKeep` is negative.
   */
  readonly strongCoverage: number;
  readonly weakKeep: number;
  /** Recommendations found by words that stay ahead of the strong bridged ones. */
  readonly strongKeep: number;
  /**
   * Bridge only when the first group is itself a code-bearing document (a card or disease article),
   * i.e. the query names a diagnosis; a drug name or a title that is not a diagnosis never lends
   * its neighbours' recommendations to the top of the list.
   */
  readonly requireCardFirst: boolean;
  readonly scoreFactor: number;
}

const CLINICAL_TUNING: IcdBridgeTuning = {
  cards: 5,
  minCardShare: 0.3,
  perCard: 4,
  total: 6,
  exactOnly: false,
  strongCoverage: 0.8,
  weakKeep: -1,
  strongKeep: 0,
  requireCardFirst: false,
  scoreFactor: 0.9,
};

/**
 * Clinical analysis («Клинический разбор»): a card that names the diagnosis puts its
 * recommendations first; weaker evidence adds nothing. Name lookup («Все»): the bridge only adds
 * behind the recommendations the words already found, so exact names and the first hits stay.
 */
export const DEFAULT_ICD_BRIDGE_TUNING: Readonly<Record<'clinical' | 'lookup', IcdBridgeTuning>> = {
  clinical: CLINICAL_TUNING,
  lookup: { ...CLINICAL_TUNING, strongKeep: 1, weakKeep: 2, requireCardFirst: true },
};

const CODE_PATTERN = /^[A-Z]\d{2}(?:\.\d{1,2})?$/u;

/** МКБ-10 codes a document declares (`icd10Codes`, `mkbCode`), upper case. */
export function documentIcdCodes(document: SearchDocumentDescriptor): readonly string[] {
  const codes = new Set<string>();
  const declared = document.metadata['icd10Codes'];
  if (Array.isArray(declared))
    for (const code of declared) if (typeof code === 'string') codes.add(code.trim().toUpperCase());
  const single = document.metadata['mkbCode'];
  if (typeof single === 'string') codes.add(single.trim().toUpperCase());
  return [...codes].filter((code) => CODE_PATTERN.test(code));
}

/** A clinical recommendation or its catalog pointer in the core. */
export function isRecommendationDocument(document: SearchDocumentDescriptor): boolean {
  return (
    document.metadata['catalogFamily'] === 'clinical' ||
    document.sourceType === 'clinical_recommendation' ||
    document.sourceType === 'clinical_recommendation_summary'
  );
}

const category = (code: string) => code.slice(0, 3);

/** 3 = the same code, 2 = a category and one of its subcodes, 0 = unrelated (siblings included). */
function codeRelation(cardCode: string, recommendationCode: string): number {
  if (cardCode === recommendationCode) return 3;
  if (category(cardCode) !== category(recommendationCode)) return 0;
  return cardCode.length === 3 || recommendationCode.length === 3 ? 2 : 0;
}

export interface BridgedRecommendation {
  readonly documentId: string;
  readonly relation: number;
  readonly code: string;
}

/** Recommendation documents by the МКБ categories they cover, built from the search projection. */
export class IcdRecommendationIndex {
  private readonly byCategory = new Map<
    string,
    { readonly documentId: string; readonly codes: readonly string[] }[]
  >();

  constructor(documents: readonly SearchDocumentDescriptor[]) {
    for (const document of documents) {
      if (!isRecommendationDocument(document)) continue;
      const codes = documentIcdCodes(document);
      for (const block of new Set(codes.map(category))) {
        const entries = this.byCategory.get(block) ?? [];
        entries.push({ documentId: document.id, codes });
        this.byCategory.set(block, entries);
      }
    }
  }

  /** Recommendations covering any of `codes`, strongest relation first, then by document id. */
  recommendationsFor(
    codes: readonly string[],
    exactOnly: boolean,
  ): readonly BridgedRecommendation[] {
    const best = new Map<string, BridgedRecommendation>();
    for (const code of codes) {
      for (const entry of this.byCategory.get(category(code)) ?? []) {
        for (const recommendationCode of entry.codes) {
          const relation = codeRelation(code, recommendationCode);
          if (relation === 0 || (exactOnly && relation < 3)) continue;
          const known = best.get(entry.documentId);
          if (!known || relation > known.relation)
            best.set(entry.documentId, { documentId: entry.documentId, relation, code });
        }
      }
    }
    return [...best.values()].toSorted(
      (left, right) =>
        right.relation - left.relation || left.documentId.localeCompare(right.documentId),
    );
  }
}

const QUERY_WORD = /[0-9a-zа-я]{3,}/gu;

function stems(text: string): readonly string[] {
  return (normalizeSurfaceText(text).match(QUERY_WORD) ?? []).map(lightStemRussian);
}

/** Share of the query's words (stems of three letters or more) that a title also has. */
export function titleCoverage(title: string, query: string): number {
  const wanted = stems(query);
  if (wanted.length === 0) return 0;
  const present = stems(title);
  const covered = wanted.filter((word) =>
    present.some(
      (candidate) =>
        candidate === word ||
        (Math.min(candidate.length, word.length) >= 5 &&
          (candidate.startsWith(word) || word.startsWith(candidate))),
    ),
  );
  return covered.length / wanted.length;
}
