/**
 * Routes that take the whole screen: the bottom bar hides there and the page fills the window
 * (owner 2026-10-28: «adding a patient is an action of its own», the patient view). Declared data;
 * the shell never branches on a feature.
 */
export const FULL_SCREEN_ROUTES: readonly RegExp[] = [
  /^#\/notes\/diaries\/new$/u,
  /^#\/notes\/diaries\/[a-z0-9]{12,32}\/(?:screen|day\/\d{4}-\d{2}-\d{2})$/u,
];

export function isFullScreenRoute(hash: string): boolean {
  const path = hash.split('?')[0] ?? '';
  return FULL_SCREEN_ROUTES.some((route) => route.test(path));
}
