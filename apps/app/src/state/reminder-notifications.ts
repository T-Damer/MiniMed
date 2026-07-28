import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';

import {
  isReminderDue,
  loadPatientNotes,
  PATIENT_NOTES_EVENT,
  type PatientNote,
} from '@/state/patient-notes';

const NOTIFICATION_SOURCE = 'minimed-note-reminder';
const CHECK_INTERVAL_MS = 15_000;

export interface ReminderNotificationPermission {
  readonly granted: boolean;
  readonly message: string;
}

function notePath(note: PatientNote): string {
  return `#/notes/${encodeURIComponent(note.cardId)}/records/${encodeURIComponent(note.id)}`;
}

function nativeNotificationId(noteId: string): number {
  let hash = 2166136261;
  for (const character of noteId) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 1;
}

function notificationExtra(
  value: unknown,
): { readonly source: string; readonly path: string } | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as { readonly source?: unknown; readonly path?: unknown };
  return typeof candidate.source === 'string' && typeof candidate.path === 'string'
    ? { source: candidate.source, path: candidate.path }
    : null;
}

export async function requestReminderNotificationPermission(): Promise<ReminderNotificationPermission> {
  if (Capacitor.isNativePlatform()) {
    const current = await LocalNotifications.checkPermissions();
    const permission =
      current.display === 'granted' ? current : await LocalNotifications.requestPermissions();
    return permission.display === 'granted'
      ? { granted: true, message: 'Системное уведомление включено.' }
      : { granted: false, message: 'Разрешите уведомления в настройках устройства.' };
  }
  if (!('Notification' in window)) {
    return { granted: false, message: 'Этот браузер не поддерживает уведомления.' };
  }
  const permission =
    Notification.permission === 'default'
      ? await Notification.requestPermission()
      : Notification.permission;
  return permission === 'granted'
    ? { granted: true, message: 'Уведомление появится, пока вкладка MiniMed открыта.' }
    : { granted: false, message: 'Уведомления заблокированы в настройках браузера.' };
}

async function reconcileNativeNotifications(): Promise<void> {
  const permission = await LocalNotifications.checkPermissions();
  if (permission.display !== 'granted') return;
  const pending = await LocalNotifications.getPending();
  const owned = pending.notifications.filter(
    (notification) => notificationExtra(notification.extra)?.source === NOTIFICATION_SOURCE,
  );
  if (owned.length > 0) {
    await LocalNotifications.cancel({
      notifications: owned.map((notification) => ({ id: notification.id })),
    });
  }
  const notifications = loadPatientNotes().notes.flatMap((note) => {
    const reminder = note.reminder;
    if (
      !reminder?.notificationEnabled ||
      reminder.completedAt !== null ||
      new Date(reminder.dueAt).getTime() <= Date.now()
    ) {
      return [];
    }
    return [
      {
        id: nativeNotificationId(note.id),
        title: 'Напоминание MiniMed',
        body: 'Откройте запланированную запись.',
        schedule: { at: new Date(reminder.dueAt), allowWhileIdle: true },
        autoCancel: true,
        extra: { source: NOTIFICATION_SOURCE, path: notePath(note) },
      },
    ];
  });
  if (notifications.length > 0) await LocalNotifications.schedule({ notifications });
}

function startNativeNotifications(): () => void {
  let stopped = false;
  let actionListener: Awaited<ReturnType<typeof LocalNotifications.addListener>> | undefined;
  let reconciliation = Promise.resolve();
  const reconcile = (): void => {
    reconciliation = reconciliation
      .then(reconcileNativeNotifications, reconcileNativeNotifications)
      .catch(() => console.warn('Не удалось обновить локальные напоминания.'));
  };
  const handleNotesChanged = (): void => reconcile();
  window.addEventListener(PATIENT_NOTES_EVENT, handleNotesChanged);
  void LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
    const extra = notificationExtra(action.notification.extra);
    if (extra?.source === NOTIFICATION_SOURCE) window.location.hash = extra.path;
  }).then((listener) => {
    if (stopped) void listener.remove();
    else actionListener = listener;
  });
  reconcile();
  return () => {
    stopped = true;
    window.removeEventListener(PATIENT_NOTES_EVENT, handleNotesChanged);
    void actionListener?.remove();
  };
}

function startBrowserNotifications(): () => void {
  if (!('Notification' in window)) return () => undefined;
  const shown = new Set<string>();
  const notifyDue = (): void => {
    if (Notification.permission !== 'granted') return;
    for (const note of loadPatientNotes().notes) {
      const reminder = note.reminder;
      if (!reminder?.notificationEnabled || !isReminderDue(reminder)) continue;
      const signature = `${note.id}:${reminder.dueAt}`;
      if (shown.has(signature)) continue;
      const notification = new Notification('Напоминание MiniMed', {
        body: 'Откройте запланированную запись.',
        tag: signature,
      });
      notification.onclick = () => {
        window.focus();
        window.location.hash = notePath(note);
        notification.close();
      };
      shown.add(signature);
    }
  };
  const handleVisibility = (): void => notifyDue();
  window.addEventListener(PATIENT_NOTES_EVENT, notifyDue);
  document.addEventListener('visibilitychange', handleVisibility);
  const timer = window.setInterval(notifyDue, CHECK_INTERVAL_MS);
  notifyDue();
  return () => {
    window.removeEventListener(PATIENT_NOTES_EVENT, notifyDue);
    document.removeEventListener('visibilitychange', handleVisibility);
    window.clearInterval(timer);
  };
}

export function startReminderNotifications(): () => void {
  return Capacitor.isNativePlatform() ? startNativeNotifications() : startBrowserNotifications();
}
