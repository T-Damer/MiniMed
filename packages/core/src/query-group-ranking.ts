import type { MedicalDocumentSummary, SearchResultGroup } from '@localmed/contracts';
import { lightStemRussian, normalizeSurfaceText, tokenize } from '@localmed/search-lexical';

const GENERIC_QUERY_TERMS = new Set([
  'какой',
  'какая',
  'какие',
  'который',
  'пациент',
  'ребенок',
  'ребёнок',
  'взрослый',
  'нужно',
  'можно',
  'приказ',
  'закон',
]);

const CURRENT_EDITION_QUERY =
  /(?:действующ|актуальн|текущ|сейчас|на\s+сегодня|вместо|замен(?:ил|яет|ен|ён|ить))/u;
const HISTORICAL_EDITION_QUERY =
  /(?:утратил[ао]?\s+сил|историческ|стар(?:ый|ая|ое)|отмен[её]н|недействующ)/u;
const HISTORICAL_DOCUMENT_TEXT = /(?:утратил[ао]?\s+сил|историческ|отмен[её]н|недействующ)/u;
const INSTRUCTION_QUERY =
  /(?:инструкц|показани|противопоказани|побочн|способ[а-я]*\s+применени|дозировк|как\s+(?:принимать|применять|вводить))/u;
const REGISTRY_QUERY =
  /(?:грлс|регистрационн[а-я]*\s+(?:номер|карточк|запис)|регистрац[а-я]*\s+препарат)/u;

type SearchDocumentDescriptor = Pick<MedicalDocumentSummary, 'id' | 'sourceType' | 'metadata'>;

function compactReference(value: string): string {
  return normalizeSurfaceText(value).replace(/[^0-9a-zа-я]+/gu, '');
}

function legalReferences(value: string): ReadonlySet<string> {
  const normalized = normalizeSurfaceText(value);
  const references = new Set<string>();
  for (const match of normalized.matchAll(
    /(?:^|[^0-9a-zа-я])(\d{2,4}\s*[-–—]?\s*(?:фз|н))(?=$|[^0-9a-zа-я])/gu,
  )) {
    const reference = match[1];
    if (reference) references.add(compactReference(reference));
  }
  return references;
}

function textCoverage(query: string, text: string): number {
  const queryTerms = new Set(
    tokenize(query).filter((term) => term.length >= 4 && !GENERIC_QUERY_TERMS.has(term)),
  );
  const textTerms = tokenize(text);
  const matchedTextTerms = new Set<string>();
  for (const queryTerm of queryTerms) {
    const textTerm = textTerms.find(
      (candidate) => candidate.startsWith(queryTerm) || queryTerm.startsWith(candidate),
    );
    if (textTerm) matchedTextTerms.add(textTerm);
  }
  return Math.min(0.5, matchedTextTerms.size * 0.12);
}

function subjectPhraseBoost(query: string, text: string): number {
  const normalizedQuery = normalizeSurfaceText(query);
  const normalizedText = normalizeSurfaceText(text);
  const pairs: readonly [RegExp, RegExp, number][] = [
    [/групп[а-я]*\s+здоров/u, /групп[а-я]*\s+здоров/u, 0.55],
    [/инвалид/u, /инвалид/u, 0.55],
    [
      /(?:профосмотр|профилактическ[а-я]*\s+(?:медицинск[а-я]*\s+)?осмотр)/u,
      /(?:профосмотр|профилактическ[а-я]*\s+(?:медицинск[а-я]*\s+)?осмотр)/u,
      0.65,
    ],
    [/санатор/u, /санатор/u, 0.4],
    [/туберкул[а-я]*.*групп|групп[а-я]*.*туберкул/u, /туберкул/u, 0.4],
    [/перв[а-я]*\s+помощ/u, /перв[а-я]*\s+помощ/u, 0.4],
    [/педиатр/u, /педиатр/u, 0.35],
  ];
  return pairs.reduce(
    (boost, [queryPattern, textPattern, value]) =>
      queryPattern.test(normalizedQuery) && textPattern.test(normalizedText)
        ? Math.max(boost, value)
        : boost,
    0,
  );
}

function editionStatusBoost(query: string, text: string): number {
  const normalizedQuery = normalizeSurfaceText(query);
  const normalizedText = normalizeSurfaceText(text);
  const historicalDocument = HISTORICAL_DOCUMENT_TEXT.test(normalizedText);
  if (CURRENT_EDITION_QUERY.test(normalizedQuery) && historicalDocument) return -2;
  if (HISTORICAL_EDITION_QUERY.test(normalizedQuery) && historicalDocument) return 0.8;
  return 0;
}

const TITLE_FORM_STEMS = new Set([
  'таблетк',
  'порошк',
  'раствор',
  'капсул',
  'сироп',
  'суппозитор',
  'маз',
  'гел',
  'крем',
  'капл',
  'спре',
  'инъекц',
  'приготовлен',
  'прием',
  'внутрь',
  'назальн',
  'наружн',
  'глазн',
  'ректальн',
  'лиофилизат',
  'суспенз',
  'гранул',
  'пастил',
  'шипуч',
  'пленк',
  'покрыт',
  'оболочк',
  'действующ',
  'веществ',
  'доз',
  'внутримышечн',
  'внутривенн',
  'мг',
  'мл',
  'шт',
]);

function stemToken(token: string): string {
  return lightStemRussian(token);
}

function tokensMatch(queryToken: string, titleToken: string): boolean {
  if (
    titleToken === queryToken ||
    titleToken.startsWith(queryToken) ||
    queryToken.startsWith(titleToken)
  ) {
    return true;
  }
  const queryStem = stemToken(queryToken);
  const titleStem = stemToken(titleToken);
  return (
    titleStem === queryStem || titleStem.startsWith(queryStem) || queryStem.startsWith(titleStem)
  );
}

function isFormOrStrengthToken(token: string): boolean {
  if (/^\d/.test(token) || token.length <= 2) return true;
  const stem = stemToken(token);
  if (TITLE_FORM_STEMS.has(stem)) return true;
  for (const formStem of TITLE_FORM_STEMS) {
    if (stem.startsWith(formStem) || formStem.startsWith(stem)) return true;
  }
  return false;
}

function isCombinationTitle(title: string, leftoverTerms: readonly string[]): boolean {
  if (/[+/]|(\sи\s)|(\sс\s)/u.test(title)) return true;
  return leftoverTerms.some((term) => !isFormOrStrengthToken(term));
}

/**
 * A document whose title is (or is headed by) the searched name must outrank a document that merely
 * mentions that name in passing or lists it as one ingredient of a combination. Phrase boosts below
 * are tuned for legal/clinical wording and are not strong enough to guarantee this on their own.
 */
function exactTitleMatchBoost(query: string, title: string): number {
  const normalizedQuery = normalizeSurfaceText(query).trim();
  if (!normalizedQuery) return 0;
  const normalizedTitle = normalizeSurfaceText(title).trim();
  if (normalizedTitle === normalizedQuery) return 6;

  const queryTerms = tokenize(normalizedQuery).filter(
    (term) => !isFormOrStrengthToken(term) && isTitleQueryTerm(term),
  );
  if (queryTerms.length === 0) return 0;
  const titleTerms = tokenize(normalizedTitle);
  if (titleTerms.length === 0) return 0;

  const matchedTitleIndexes = queryTerms.map((queryTerm) =>
    titleTerms.findIndex((titleTerm) => tokensMatch(queryTerm, titleTerm)),
  );
  if (matchedTitleIndexes.some((index) => index < 0)) return 0;

  const leftoverTerms = titleTerms.filter(
    (titleTerm, index) =>
      !matchedTitleIndexes.includes(index) &&
      !queryTerms.some((queryTerm) => tokensMatch(queryTerm, titleTerm)),
  );
  const combination = isCombinationTitle(normalizedTitle, leftoverTerms);
  const headedByQuery = matchedTitleIndexes[0] === 0;
  if (combination) return headedByQuery ? 1.2 : 0.8;
  if (normalizedTitle.startsWith(normalizedQuery)) return 5;
  if (headedByQuery && leftoverTerms.every((term) => isFormOrStrengthToken(term))) return 5;
  return headedByQuery ? 4.5 : 3.5;
}

const TITLE_CONTEXT_STEMS = new Set(
  [
    ...[...GENERIC_QUERY_TERMS],
    'детский',
    'ребенк',
    'вес',
    'год',
    'лет',
    'первый',
    'второй',
    'третий',
    'заболевание',
    'инфекция',
    'мочевой',
    'мочевых',
    'путь',
    'путей',
  ].map(stemToken),
);

function isTitleQueryTerm(term: string): boolean {
  return term.length >= 4 && !TITLE_CONTEXT_STEMS.has(stemToken(term));
}

function isFailedQueryTerm(query: string, term: string): boolean {
  const normalizedQuery = normalizeSurfaceText(query);
  const termIndex = normalizedQuery.indexOf(term);
  if (termIndex < 0) return false;
  return /^(?:\s+)(?:не\s+)?(?:помог|сработ|эффект|подейств|перенос)/u.test(
    normalizedQuery.slice(termIndex + term.length),
  );
}

function titleTermBoost(
  query: string,
  title: string,
  candidateTerms: readonly ReadonlySet<string>[],
): number {
  const queryTerms = [...new Set(tokenize(query).filter(isTitleQueryTerm))];
  const titleTerms = tokenize(title);
  return queryTerms.reduce((boost, queryTerm) => {
    if (isFailedQueryTerm(query, queryTerm)) return boost;
    const titleIndex = titleTerms.findIndex(
      (titleTerm) => !isFormOrStrengthToken(titleTerm) && tokensMatch(queryTerm, titleTerm),
    );
    if (titleIndex < 0) return boost;
    const documentFrequency = candidateTerms.filter((terms) =>
      [...terms].some((term) => !isFormOrStrengthToken(term) && tokensMatch(queryTerm, term)),
    ).length;
    const inverseFrequency = Math.log((candidateTerms.length + 1) / (documentFrequency + 1));
    const specificity = Math.min(1, queryTerm.length * 0.08);
    const headedTitleBoost = titleIndex === 0 ? 0.45 : 0;
    return boost + 1.8 + specificity + headedTitleBoost + inverseFrequency * 0.2;
  }, 0);
}

export function queryGroupRelevanceBoost(query: string, text: string): number {
  const queryReferences = legalReferences(query);
  const textReferences = legalReferences(text);
  const referenceBoost = [...queryReferences].some((reference) => textReferences.has(reference))
    ? 1
    : 0;
  return (
    referenceBoost +
    textCoverage(query, text) +
    subjectPhraseBoost(query, text) +
    editionStatusBoost(query, text)
  );
}

function groupRankingText(group: SearchResultGroup): string {
  return [
    group.title,
    ...group.results.flatMap((result) => [
      result.sectionPath.join(' '),
      result.matchedTerms.join(' '),
    ]),
  ].join(' ');
}

function medicationDocumentBoost(
  query: string,
  document: SearchDocumentDescriptor | undefined,
): number {
  if (!document) return 0;
  const normalizedQuery = normalizeSurfaceText(query);
  if (document.sourceType === 'official_drug_instruction') {
    return INSTRUCTION_QUERY.test(normalizedQuery) ? 8 : 0;
  }
  if (document.sourceType === 'official_registry_summary') {
    return REGISTRY_QUERY.test(normalizedQuery) ? 8 : 0;
  }
  const metadata = document.metadata;
  if (
    document.sourceType === 'core_catalog_pointer' &&
    metadata?.['catalogFamily'] === 'medication' &&
    !INSTRUCTION_QUERY.test(normalizedQuery) &&
    !REGISTRY_QUERY.test(normalizedQuery)
  ) {
    return 8;
  }
  return 0;
}

export function rankSearchGroupsByQuery(
  groups: readonly SearchResultGroup[],
  query: string,
  documents: readonly SearchDocumentDescriptor[] = [],
): readonly SearchResultGroup[] {
  // ponytail: scan the bounded candidate window; use corpus-wide document frequencies if this grows hot.
  const candidateTerms = groups.map((group) => new Set(tokenize(groupRankingText(group))));
  const documentsById = new Map(documents.map((document) => [document.id, document]));
  return groups
    .map((group, index) => ({
      group,
      index,
      score:
        group.bestScore +
        queryGroupRelevanceBoost(query, groupRankingText(group)) +
        // Drug-name title boosts must not outweigh legal references and subject sections.
        (documentsById.get(group.documentId)?.sourceType === 'regulatory_act_summary' ||
        documentsById.get(group.documentId)?.metadata?.['notLegalAdvice'] === true
          ? 0
          : titleTermBoost(query, group.title, candidateTerms)) +
        exactTitleMatchBoost(query, group.title) +
        medicationDocumentBoost(query, documentsById.get(group.documentId)),
    }))
    .toSorted((left, right) => right.score - left.score || left.index - right.index)
    .map((entry) => entry.group);
}
