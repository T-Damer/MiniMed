import { userQuestionnaireHomePath } from '@/features/assessments/assessment-routing';
import { USER_LIBRARY_CATALOG_HASH } from '@/features/library/user-library-routing';
import { activeProfile } from '@/state/app-profile';

/**
 * Where «Дневники и задания» lies (CBT1): the shared library in the main app; in a profile build
 * (the doctors' diaries) its «Библиотека» tab, which is the questionnaires page.
 */
export function worksheetsParentHash(): string {
  return activeProfile() ? userQuestionnaireHomePath() : USER_LIBRARY_CATALOG_HASH;
}
