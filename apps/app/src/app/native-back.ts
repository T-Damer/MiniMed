import { assessmentParentHash } from '@/features/assessments/assessment-routing';
import { calculatorParentHash } from '@/features/calculators/calculator-routing';
import { knowledgeDocumentBackHash } from '@/features/knowledge/knowledge-routing';
import { newsParentHash } from '@/features/news/news-routing';
import { settingsParentHash } from '@/features/settings/settings-routing';

export function hierarchicalParentHash(route: string): string | null {
  const documentParent = knowledgeDocumentBackHash(route);
  if (documentParent) return documentParent;
  const assessmentParent = assessmentParentHash(route);
  if (assessmentParent) return assessmentParent;
  const calculatorParent = calculatorParentHash(route);
  if (calculatorParent) return calculatorParent;
  const newsParent = newsParentHash(route);
  if (newsParent) return newsParent;
  return settingsParentHash(route);
}

/**
 * Where a back press goes when the history has no app entry to step back to (see
 * `state/app-back.ts`): the screen's logical parent, else the home tab; at the home tab the app
 * minimises. With an app entry below, the history steps back and these are not used.
 */
export interface NativeBackTargets {
  readonly parentHash: string | null;
  readonly homeHash: string | null;
}

export const HOME_ROUTE_HASH = '#/search';

export function nativeBackTargets(route: string, splitNavigation = true): NativeBackTargets {
  const parentHash = hierarchicalParentHash(route);
  // Without separate tabs the tools belong to search: their pages return there.
  const compactToolPage =
    !splitNavigation &&
    parentHash !== null &&
    /^(assessments|calculators)(?:\/|$)/u.test(route) &&
    !/\/results\//u.test(route);
  if (compactToolPage) return { parentHash: HOME_ROUTE_HASH, homeHash: null };
  if (parentHash) return { parentHash, homeHash: null };
  // The search page itself is the end of the line; every other screen has the home tab below it.
  const atHome = route === '' || route === 'search' || route.startsWith('search/');
  return { parentHash: null, homeHash: atHome ? null : HOME_ROUTE_HASH };
}
