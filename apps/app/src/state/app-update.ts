export const APP_UPDATE_READY_EVENT = 'minimed:app-update-ready';

export interface AppUpdateReadyDetail {
  readonly worker: ServiceWorker;
}

function announceUpdate(worker: ServiceWorker): void {
  if (!navigator.serviceWorker.controller) return;
  window.dispatchEvent(
    new CustomEvent<AppUpdateReadyDetail>(APP_UPDATE_READY_EVENT, { detail: { worker } }),
  );
}

export async function registerAppServiceWorker(): Promise<void> {
  const registration = await navigator.serviceWorker.register('./sw.js');
  if (registration.waiting) announceUpdate(registration.waiting);
  registration.addEventListener('updatefound', () => {
    const worker = registration.installing;
    if (!worker) return;
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed') announceUpdate(worker);
    });
  });
}

export function activateAppUpdate(
  worker: Pick<ServiceWorker, 'postMessage'>,
  serviceWorkers: Pick<ServiceWorkerContainer, 'addEventListener'> = navigator.serviceWorker,
  reload: () => void = () => window.location.reload(),
): void {
  serviceWorkers.addEventListener('controllerchange', reload, { once: true });
  worker.postMessage({ type: 'SKIP_WAITING' });
}
