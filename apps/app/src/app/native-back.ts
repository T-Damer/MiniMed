import { assessmentParentHash } from '@/features/assessments/assessment-routing';
import { calculatorParentHash } from '@/features/calculators/calculator-routing';
import { knowledgeDocumentBackHash } from '@/features/knowledge/knowledge-routing';
import { isDocumentReadRoute } from '@/state/document-route';

export type NativeBackAction =
  | { readonly type: 'parent'; readonly hash: string }
  | { readonly type: 'history' }
  | { readonly type: 'search' }
  | { readonly type: 'minimize' };

export type RootView = 'search' | 'modules' | 'assessments' | 'calculators' | 'notes' | 'settings';

export function hierarchicalParentHash(route: string): string | null {
  const documentParent = knowledgeDocumentBackHash(route);
  if (documentParent) return documentParent;
  const assessmentParent = assessmentParentHash(route);
  if (assessmentParent) return assessmentParent;
  const calculatorParent = calculatorParentHash(route);
  if (calculatorParent) return calculatorParent;
  return null;
}

export function nativeBackAction(
  route: string,
  currentView: RootView,
  _canGoBack: boolean,
): NativeBackAction {
  const parentHash = hierarchicalParentHash(route);
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
