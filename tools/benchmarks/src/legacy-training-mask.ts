import {
  findNormalizedPhraseIndex,
  lightStemRussian,
  normalizeSurfaceText,
} from '@localmed/search-lexical';

const LEGACY_ANSWER_MARKERS_BY_DOCUMENT: Readonly<Record<string, readonly string[]>> = {
  'kr.rf.281_3.uti': ['пиелонефрит', 'цистит', 'имп', 'имвп'],
  'kr.rf.381_3.bronchitis': ['бронхит'],
  'kr.rf.360_3.bronchiolitis': ['бронхиолит'],
  'kr.rf.563_2.measles': ['корь'],
  'kr.rf.755_1.rotavirus': ['ротавирус', 'ротавирусный'],
  'kr.rf.58_2.meningococcal': [
    'менингококк',
    'менингококковый',
    'менингит',
    'менингококцемия',
  ],
  'kr.rf.714_2.pneumonia': ['пневмония'],
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function markerStems(documentIds: readonly string[]): ReadonlySet<string> {
  return new Set(
    documentIds.flatMap((documentId) =>
      (LEGACY_ANSWER_MARKERS_BY_DOCUMENT[documentId] ?? []).map((marker) =>
        lightStemRussian(normalizeSurfaceText(marker)),
      ),
    ),
  );
}

function maskPhraseLeakage(query: string, terms: readonly string[]): string {
  let masked = query;
  for (const term of [...new Set(terms)].toSorted((left, right) => right.length - left.length)) {
    const expression = new RegExp(
      `(^|[^\\p{L}\\p{N}])${escapeRegExp(term)}(?=$|[^\\p{L}\\p{N}])`,
      'giu',
    );
    masked = masked.replace(expression, '$1[диагноз]');
  }
  return masked;
}

function maskTargetMarkers(query: string, documentIds: readonly string[]): string {
  const stems = markerStems(documentIds);
  if (stems.size === 0) return query;
  return query.replace(/[\\p{L}\\p{N}-]+/gu, (token) =>
    stems.has(lightStemRussian(normalizeSurfaceText(token))) ? '[диагноз]' : token,
  );
}

export function remainingLegacyAnswerMarker(
  query: string,
  documentIds: readonly string[],
): string | undefined {
  const stems = markerStems(documentIds);
  return query
    .match(/[\\p{L}\\p{N}-]+/gu)
    ?.find((token) => stems.has(lightStemRussian(normalizeSurfaceText(token))));
}

export function remainingLeakagePhrase(
  query: string,
  leakageTerms: readonly string[],
): string | undefined {
  const normalized = normalizeSurfaceText(query);
  return leakageTerms.find(
    (term) => findNormalizedPhraseIndex(normalized, normalizeSurfaceText(term)) >= 0,
  );
}

export function maskLegacyTrainingQuery(
  query: string,
  documentIds: readonly string[],
  leakageTerms: readonly string[],
): string {
  return maskTargetMarkers(maskPhraseLeakage(query, leakageTerms), documentIds)
    .replace(/(?:\\[диагноз\\]\\s*){2,}/gu, '[диагноз] ')
    .replace(/\\s+/gu, ' ')
    .trim();
}
