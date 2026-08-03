export type NativeBackAction = 'history' | 'search' | 'minimize';

export function nativeBackAction(
  route: string,
  currentView: 'search' | 'modules' | 'notes',
  canGoBack: boolean,
): NativeBackAction {
  if (
    (route.startsWith('modules/') ||
      route.startsWith('notes/') ||
      route.startsWith('assessments/') ||
      route.startsWith('calculators/')) &&
    canGoBack
  ) {
    return 'history';
  }
  if (route === 'assessments' || route === 'calculators') return 'search';
  return currentView === 'search' ? 'minimize' : 'search';
}
