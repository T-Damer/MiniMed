import { createSignal, onCleanup } from 'solid-js';

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

const [claims, setClaims] = createSignal(0);

/**
 * A screen that takes the whole window while it is mounted, whatever its route: the signed-out
 * diary sign-in is the whole app until the doctor is in (owner 2026-10-30). Call from a component.
 */
export function claimFullScreen(): void {
  setClaims((count) => count + 1);
  onCleanup(() => setClaims((count) => count - 1));
}

/** Whether the bottom bar hides: a full-screen route, or a mounted screen that claimed the window. */
export function isFullScreen(hash: string): boolean {
  return claims() > 0 || isFullScreenRoute(hash);
}
