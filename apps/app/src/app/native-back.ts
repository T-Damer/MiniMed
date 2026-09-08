import type { RootView } from '@/app/root-view';
import { assessmentParentHash } from '@/features/assessments/assessment-routing';
import { calculatorParentHash } from '@/features/calculators/calculator-routing';
import { knowledgeDocumentBackHash } from '@/features/knowledge/knowledge-routing';
import { settingsParentHash } from '@/features/settings/settings-routing';
import { isDocumentReadRoute } from '@/state/document-route';

export type { RootView };

export type NativeBackAction =
  | { readonly type: 'parent'; readonly hash: string }
  | { readonly type: 'history' }
  | { readonly type: 'search' }
  | { readonly type: 'minimize' };

export function hierarchicalParentHash(route: string): string | null {
  const documentParent = knowledgeDocumentBackHash(route);
  if (documentParent) return documentParent;
  const assessmentParent = assessmentParentHash(route);
  if (assessmentParent) return assessmentParent;
  const calculatorParent = calculatorParentHash(route);
  if (calculatorParent) return calculatorParent;
  return settingsParentHash(route);
}

export function nativeBackAction(
  route: string,
  currentView: RootView,
  _canGoBack: boolean,
  splitNavigation = true,
): NativeBackAction {
  const parentHash = hierarchicalParentHash(route);
  if (
    !splitNavigation &&
    parentHash &&
    /^(assessments|calculators)(?:\/|$)/u.test(route) &&
    !/\/results\//u.test(route)
  ) {
    return { type: 'search' };
  }
  if (parentHash) {
    return { type: 'parent', hash: parentHash };
  }
  if (isDocumentReadRoute(route)) {
    return { type: 'history' };
  }
  if (route.startsWith('notes/')) {
    return { type: 'history' };
  }
  if (
    route === 'assessments' ||
    route === 'calculators' ||
    route === 'modules' ||
    route === 'modules/documents' ||
    route === 'settings'
  ) {
    return { type: 'search' };
  }
  return currentView === 'search' ? { type: 'minimize' } : { type: 'search' };
}
