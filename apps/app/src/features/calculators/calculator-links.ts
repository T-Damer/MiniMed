import { requestRouteWindow } from '@/state/route-window-request';

export function openCalculator(slug: string, options?: { readonly preferWindow?: boolean }): void {
  const route = `#/calculators/${encodeURIComponent(slug)}`;
  if (options?.preferWindow && requestRouteWindow('calculators', route)) return;
  window.location.hash = route;
}
