export type NativeBackAction = 'history' | 'search' | 'minimize';

export function nativeBackAction(
  route: string,
  currentView: 'search' | 'modules' | 'notes',
  canGoBack: boolean,
): NativeBackAction {
  if ((route.startsWith('modules/') || route.startsWith('notes/')) && canGoBack) return 'history';
  return currentView === 'search' ? 'minimize' : 'search';
}
