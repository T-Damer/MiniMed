import type { SearchScope } from '../../../apps/app/src/features/search/ScopedMedicalCore';

export interface RuntimeRetrievalCase {
  readonly id: string;
  readonly query: string;
  readonly scope: SearchScope;
  readonly expectedTargets?: readonly string[];
  readonly forbiddenTargets?: readonly string[];
  readonly evidenceIncludes?: readonly string[];
  readonly evidencePattern?: RegExp;
  readonly negatedTerm?: string;
  readonly expectedIcdCode?: string;
}

export const RUNTIME_RETRIEVAL_CASES: readonly RuntimeRetrievalCase[] = [
  {
    id: 'ambiguity-mkb-classification',
    query: 'МКБ',
    scope: 'all',
    expectedTargets: ['rls.mkb.classification'],
  },
  { id: 'ambiguity-mkb-disease', query: 'МКБ', scope: 'all', expectedTargets: ['kr.rf.7_2'] },
  {
    id: 'ambiguity-mkb10',
    query: 'МКБ-10',
    scope: 'all',
    expectedTargets: ['rls.mkb.classification'],
  },
  {
    id: 'brand-form',
    query: 'нурофен суспензия',
    scope: 'medications',
    expectedTargets: ['esklp.mnn.ибупрофен'],
    evidenceIncludes: ['суспенз'],
  },
  {
    id: 'inn-form',
    query: 'ибупрофен суспензия',
    scope: 'medications',
    expectedTargets: ['esklp.mnn.ибупрофен'],
    evidenceIncludes: ['суспенз'],
  },
  {
    id: 'brand-strength',
    query: 'нурофен 100 мг/5 мл',
    scope: 'medications',
    expectedTargets: ['esklp.mnn.ибупрофен'],
    evidencePattern: /(?<![\d.])100\s*мг\s*\/\s*5\s*мл/iu,
  },
  {
    id: 'brand-wrong-form',
    query: 'нурофен мазь',
    scope: 'medications',
    forbiddenTargets: ['esklp.mnn.ибупрофен'],
  },
  {
    id: 'inn-topical-form',
    query: 'ибупрофен мазь',
    scope: 'medications',
    expectedTargets: ['esklp.mnn.ибупрофен'],
    evidenceIncludes: ['мазь'],
  },
  {
    id: 'inn-route',
    query: 'цефтриаксон внутривенно',
    scope: 'medications',
    expectedTargets: ['esklp.mnn.цефтриаксон'],
    evidenceIncludes: ['внутрив'],
  },
  {
    id: 'clinical-pointer',
    query: 'острая ишемия конечностей',
    scope: 'guidelines',
    expectedTargets: ['kr.rf.1006_1'],
  },
  {
    id: 'definition-discovery',
    query: 'двигательной заторможенностью и нарушением мышления',
    scope: 'all',
    expectedTargets: ['krasotaimedicina.disease.0007ef852d70ba32'],
    evidenceIncludes: ['двигательной заторможенностью'],
  },
  { id: 'negative-finding', query: 'кашель без лихорадки', scope: 'all', negatedTerm: 'лихорад' },
  { id: 'icd-cyrillic-a', query: 'А09', scope: 'all', expectedIcdCode: 'A09' },
  { id: 'icd-cyrillic-c', query: 'С50', scope: 'all', expectedIcdCode: 'C50' },
  { id: 'icd-cyrillic-m', query: 'М16', scope: 'all', expectedIcdCode: 'M16' },
  { id: 'icd-cyrillic-subcategory', query: 'м16.1', scope: 'all', expectedIcdCode: 'M16.1' },
  {
    id: 'disease-short-name',
    query: 'описание болезни Рак желудка',
    scope: 'all',
    expectedTargets: ['kr.rf.574_1'],
  },
  {
    id: 'disease-acronym',
    query: 'документы по заболеванию ОНПЛ',
    scope: 'all',
    expectedTargets: ['kr.rf.893_1'],
  },
  {
    id: 'disease-virus-letter',
    query: 'документы по заболеванию острый гепатит С',
    scope: 'all',
    expectedTargets: ['kr.rf.771_1'],
  },
  {
    id: 'symptom-not-plant',
    query: 'кашель высокая температура боль в груди у ребенка',
    scope: 'all',
    forbiddenTargets: [
      'esklp.mnn.подорожника-большого-листья',
      'esklp.mnn.чистотела-большого-трава',
    ],
  },
];
