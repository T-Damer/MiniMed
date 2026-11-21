import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
}));
vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {},
}));

import { APP_PREFERENCES_KEY, setNotificationsEnabled } from '@/state/app-preferences';
import { startReminderNotifications } from '@/state/reminder-notifications';

class NotificationDouble {
  static permission: NotificationPermission = 'granted';
  static shown: NotificationDouble[] = [];

  onclick: (() => void) | null = null;

  constructor(
    readonly title: string,
    readonly options?: NotificationOptions,
  ) {
    NotificationDouble.shown.push(this);
  }

  close = vi.fn();
}

describe('browser reminder notifications', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    NotificationDouble.shown = [];
    const windowTarget = new EventTarget();
    const preferences = new Map<string, string>();
    Object.assign(windowTarget, {
      localStorage: {
        getItem: (key: string) =>
          key === APP_PREFERENCES_KEY
            ? (preferences.get(key) ?? null)
            : JSON.stringify({
                cards: [
                  {
                    id: 'card-1',
                    title: 'Пациент',
                    summary: '',
                    createdAt: '2026-07-28T08:00:00.000Z',
                    updatedAt: '2026-07-28T08:00:00.000Z',
                  },
                ],
                notes: [
                  {
                    id: 'note-1',
                    cardId: 'card-1',
                    parentNoteId: null,
                    text: 'Повторный осмотр',
                    createdAt: '2026-07-28T08:00:00.000Z',
                    updatedAt: '2026-07-28T08:00:00.000Z',
                    categories: ['Общее'],
                    relatedDocumentIds: [],
                    reminder: {
                      dueAt: '2026-07-28T08:30:00.000Z',
                      allDay: false,
                      notificationEnabled: true,
                      completedAt: null,
                      completionNote: '',
                    },
                  },
                ],
              }),
        setItem: (key: string, value: string) => preferences.set(key, value),
      },
      location: { hash: '' },
      focus: () => undefined,
      setInterval,
      clearInterval,
      Notification: NotificationDouble,
    });
    const documentTarget = new EventTarget();
    Object.assign(documentTarget, { visibilityState: 'visible' });
    vi.stubGlobal('window', windowTarget);
    vi.stubGlobal('document', documentTarget);
    vi.stubGlobal('Notification', NotificationDouble);
    vi.setSystemTime(new Date('2026-07-28T09:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('shows each due reminder once while the tab remains open', () => {
    const stop = startReminderNotifications();
    expect(NotificationDouble.shown).toHaveLength(1);
    expect(NotificationDouble.shown[0]?.title).toBe('Напоминание MiniMed');

    vi.advanceTimersByTime(45_000);
    expect(NotificationDouble.shown).toHaveLength(1);
    stop();
  });

  it('keeps the system permission and stops reminders while the app switch is off', () => {
    setNotificationsEnabled(false);
    const stop = startReminderNotifications();
    vi.advanceTimersByTime(45_000);
    expect(NotificationDouble.shown).toHaveLength(0);
    expect(Notification.permission).toBe('granted');

    setNotificationsEnabled(true);
    expect(NotificationDouble.shown).toHaveLength(1);
    setNotificationsEnabled(false);
    expect(NotificationDouble.shown[0]?.close).toHaveBeenCalledOnce();
    stop();
  });
});
