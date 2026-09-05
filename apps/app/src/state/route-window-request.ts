import type { RootView } from '@/app/root-view';

export const ROUTE_WINDOW_REQUEST_EVENT = 'minimed:route-window-request';

export interface RouteWindowRequestDetail {
  readonly view: Extract<RootView, 'assessments' | 'calculators'>;
  readonly route: string;
}

export function requestRouteWindow(view: RouteWindowRequestDetail['view'], route: string): boolean {
  const event = new CustomEvent<RouteWindowRequestDetail>(ROUTE_WINDOW_REQUEST_EVENT, {
    detail: { view, route },
    cancelable: true,
  });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
