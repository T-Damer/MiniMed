/**
 * Push notifications for the doctor: urgent marks and invitations, content-free (ADR-0026). The
 * app's service worker shows a fixed text; the server knows only the push endpoint.
 */
import { fromBase64Url } from '@localmed/diary-sync';

import { diaryPush } from '@/features/diary/connected/diary-api';
import { type DoctorSession, doctorApi } from '@/features/diary/connected/doctor-account';

export type PushState = 'on' | 'unsupported' | 'denied';

async function registration(): Promise<ServiceWorkerRegistration | undefined> {
  // The development server registers no worker; do not wait forever for one.
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<undefined>((resolve) => window.setTimeout(() => resolve(undefined), 4000)),
  ]);
}

export async function enableDoctorPush(session: DoctorSession): Promise<PushState> {
  if (
    !('serviceWorker' in navigator) ||
    !('PushManager' in window) ||
    !('Notification' in window)
  ) {
    return 'unsupported';
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';
  const ready = await registration();
  if (!ready) return 'unsupported';
  const api = doctorApi(session);
  const { publicKey } = await diaryPush.key(api);
  if (!publicKey) return 'unsupported';
  const subscription =
    (await ready.pushManager.getSubscription()) ??
    (await ready.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: fromBase64Url(publicKey),
    }));
  await diaryPush.subscribe(api, subscription.endpoint);
  return 'on';
}
