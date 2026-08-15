export type NativeBackAction = 'history' | 'search' | 'minimize';

export type RootView = 'search' | 'modules' | 'assessments' | 'calculators' | 'notes';

export function nativeBackAction(
  route: string,
  currentView: RootView,
  _canGoBack: boolean,
): NativeBackAction {
  if (
    route.startsWith('modules/') ||
    route.startsWith('notes/') ||
    route.startsWith('assessments/') ||
    route.startsWith('calculators/')
  ) {
    return 'history';
  }
  if (route === 'assessments' || route === 'calculators') return 'search';
  return currentView === 'search' ? 'minimize' : 'search';
}
