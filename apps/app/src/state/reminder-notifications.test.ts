import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
}));
vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {},
}));

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

  close(): void {}
}

describe('browser reminder notifications', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    NotificationDouble.shown = [];
    const windowTarget = new EventTarget();
    Object.assign(windowTarget, {
      localStorage: {
        getItem: () =>
          JSON.stringify({
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
        setItem: () => undefined,
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
});
