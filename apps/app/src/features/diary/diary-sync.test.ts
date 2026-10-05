import { describe, expect, it } from 'vitest';

import {
  DiaryPartCollector,
  decodeDiaryResultsText,
  encodeDiaryResults,
  encodeDiaryResultsText,
} from '@/features/diary/diary-codec';
import {
  detectPlatform,
  installAdvice,
  installCardDismissed,
  isInAppBrowser,
} from '@/features/diary/diary-install';
import {
  entryFingerprint,
  markAllSent,
  mergeInvitation,
  mergeResults,
  shareStatus,
} from '@/features/diary/diary-merge';
import {
  DIARY_FORMAT_VERSION,
  type DiaryEntry,
  type DiaryInvitation,
  type DiaryResults,
  diaryTemplate,
  parseDiaryEntry,
  parseDiaryInvitation,
} from '@/features/diary/diary-model';
import { createDiaryStore } from '@/features/diary/diary-storage';

const NOW = Date.parse('2026-10-05T12:00:00Z');

function memoryStorage(seed: Readonly<Record<string, string>> = {}): Storage {
  const values = new Map(Object.entries(seed));
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  };
}

function invitation(
  overrides: Partial<{
    id: string;
    template: string;
    issuedAt: string;
    note: string;
    plan: { id: string; name: string; dose?: string; ended?: boolean }[];
  }> = {},
): DiaryInvitation {
  const template = diaryTemplate(overrides.template ?? 'blood-pressure');
  if (!template) throw new Error('template');
  return parseDiaryInvitation(
    {
      v: DIARY_FORMAT_VERSION,
      id: overrides.id ?? 'diarysync001',
      template: template.id,
      title: template.title,
      issuedAt: overrides.issuedAt ?? '2026-10-01T09:00:00.000Z',
      fields: template.fields,
      ...(overrides.plan ? { plan: overrides.plan, planTitle: 'Назначение' } : {}),
      ...(overrides.note ? { note: overrides.note } : {}),
    },
    NOW,
  );
}

function reading(
  inv: DiaryInvitation,
  id: string,
  at: string,
  systolic: number,
  diastolic: number,
): DiaryEntry {
  return parseDiaryEntry(inv, { id, at, values: { systolic, diastolic } }, NOW);
}

function results(inv: DiaryInvitation, entries: readonly DiaryEntry[]): DiaryResults {
  return { v: DIARY_FORMAT_VERSION, invitation: inv, entries };
}

const MED_PLAN = [
  { id: 'p1', name: 'Эналаприл', dose: '5 мг' },
  { id: 'p2', name: 'Амлодипин', dose: '5 мг' },
];

describe('merging a link into a diary already on the device', () => {
  it('reports a first sight, a repeat and a newer plan', () => {
    const first = invitation();
    expect(mergeInvitation(undefined, first, []).outcome).toBe('new');
    expect(mergeInvitation(first, first, []).outcome).toBe('same');
    const newer = invitation({ issuedAt: '2026-10-04T09:00:00.000Z', note: 'Только утром' });
    const merged = mergeInvitation(first, newer, []);
    expect(merged.outcome).toBe('updated');
    expect(merged.invitation.note).toBe('Только утром');
  });

  it('never rolls a diary back to an older link', () => {
    const newer = invitation({ issuedAt: '2026-10-04T09:00:00.000Z', note: 'Только утром' });
    const older = invitation({ issuedAt: '2026-10-01T09:00:00.000Z' });
    const merged = mergeInvitation(newer, older, []);
    expect(merged.outcome).toBe('older');
    expect(merged.invitation).toBe(newer);
  });

  it('keeps entries for a plan item the doctor dropped, marked as ended', () => {
    const before = invitation({ template: 'medication', plan: MED_PLAN });
    const taken = parseDiaryEntry(
      before,
      {
        id: 'entry00001',
        at: '2026-10-02T08:00:00Z',
        values: { medication: { item: 'p1', done: true } },
      },
      NOW,
    );
    const after = invitation({
      template: 'medication',
      issuedAt: '2026-10-04T09:00:00.000Z',
      plan: [MED_PLAN[1] ?? { id: 'p2', name: 'x' }, { id: 'p3', name: 'Лозартан' }],
    });
    const merged = mergeInvitation(before, after, [taken]);
    expect(merged.outcome).toBe('updated');
    expect(merged.invitation.plan?.map((item) => [item.id, item.ended ?? false])).toEqual([
      ['p2', false],
      ['p3', false],
      ['p1', true],
    ]);
    // The old entry still reads against the merged header.
    expect(() => parseDiaryEntry(merged.invitation, taken, NOW)).not.toThrow();
  });

  it('refuses a link whose fields do not fit the stored entries', () => {
    const stored = invitation();
    const entry = reading(stored, 'entry00001', '2026-10-02T08:00:00Z', 120, 80);
    const other = invitation({ template: 'glucose', issuedAt: '2026-10-04T09:00:00.000Z' });
    const merged = mergeInvitation(stored, other, [entry]);
    expect(merged.outcome).toBe('incompatible');
    expect(merged.invitation).toBe(stored);
  });

  it('adds only missing entries from a saved copy and keeps local ones on a conflict', () => {
    const inv = invitation();
    const local = results(inv, [
      reading(inv, 'entry00001', '2026-10-02T08:00:00Z', 120, 80),
      reading(inv, 'entry00002', '2026-10-03T08:00:00Z', 130, 85),
    ]);
    const copy = results(inv, [
      reading(inv, 'entry00001', '2026-10-02T08:00:00Z', 150, 95),
      reading(inv, 'entry00003', '2026-10-01T08:00:00Z', 118, 78),
    ]);
    const merge = mergeResults(local, copy);
    expect(merge).toMatchObject({ added: 1, kept: 1, skipped: 0 });
    expect(merge.results.entries.map((entry) => entry.id)).toEqual([
      'entry00003',
      'entry00001',
      'entry00002',
    ]);
    expect(merge.results.entries.find((entry) => entry.id === 'entry00001')?.values).toMatchObject({
      systolic: 120,
    });
    expect(mergeResults(merge.results, copy).added).toBe(0);
  });
});

describe('diary store: opening a link', () => {
  it('stores a diary the moment its link is opened, with no entries yet', () => {
    const storage = memoryStorage();
    const store = createDiaryStore(storage, () => NOW);
    const opened = store.open(invitation());
    expect(opened.outcome).toBe('new');
    expect(store.list().map((item) => item.id)).toEqual(['diarysync001']);
    expect(store.summaries()[0]).toMatchObject({ entries: 0, unsent: 0 });
  });

  it('merges a newer link into the stored diary without touching entries', () => {
    const store = createDiaryStore(memoryStorage(), () => NOW);
    const first = invitation();
    store.open(first);
    store.save(results(first, [reading(first, 'entry00001', '2026-10-02T08:00:00Z', 120, 80)]));

    const opened = store.open(invitation({ issuedAt: '2026-10-04T09:00:00.000Z', note: 'Новое' }));
    expect(opened.outcome).toBe('updated');
    expect(opened.results.entries).toHaveLength(1);
    expect(store.read('diarysync001')?.invitation.note).toBe('Новое');
    expect(store.list()).toHaveLength(1);

    expect(store.open(first).outcome).toBe('older');
    expect(store.read('diarysync001')?.invitation.note).toBe('Новое');
  });

  it('keeps readable entries of a damaged record and sets the original aside', () => {
    const inv = invitation();
    const good = reading(inv, 'entry00001', '2026-10-02T08:00:00Z', 120, 80);
    const broken = { id: 'entry00002', at: '2026-10-03T08:00:00Z', values: { systolic: 5000 } };
    const raw = JSON.stringify({ v: 2, invitation: inv, entries: [good, broken] });
    const storage = memoryStorage({ [`minimed.diary.v1.${inv.id}`]: raw });
    const store = createDiaryStore(storage, () => NOW);

    const opened = store.open(inv);
    expect(opened.results.entries.map((entry) => entry.id)).toEqual(['entry00001']);
    expect(opened.salvagedSkipped).toBe(1);
    expect(storage.getItem(`minimed.diary.salvage.v1.${inv.id}`)).toBe(raw);
  });

  it('keeps hand-over bookkeeping out of the diary list and removes it with the diary', () => {
    const storage = memoryStorage();
    const store = createDiaryStore(storage, () => NOW);
    const inv = invitation();
    store.open(inv);
    const entry = reading(inv, 'entry00001', '2026-10-02T08:00:00Z', 120, 80);
    store.save(results(inv, [entry]));
    store.setMeta(inv.id, { sent: markAllSent([entry], '2026-10-03T10:00:00.000Z') });
    store.setUi({ lastOpenedId: inv.id });

    expect(store.list()).toHaveLength(1);
    expect(store.summaries()[0]?.unsent).toBe(0);
    store.save(results(inv, [entry, reading(inv, 'entry00002', '2026-10-04T08:00:00Z', 118, 78)]));
    expect(store.summaries()[0]?.unsent).toBe(1);

    store.remove(inv.id);
    expect(store.list()).toHaveLength(0);
    expect(store.meta(inv.id)).toEqual({});
  });

  it('restores a saved copy into a new device and into an existing diary', () => {
    const inv = invitation();
    const copy = results(inv, [
      reading(inv, 'entry00001', '2026-10-02T08:00:00Z', 120, 80),
      reading(inv, 'entry00002', '2026-10-03T08:00:00Z', 130, 85),
    ]);
    const store = createDiaryStore(memoryStorage(), () => NOW);
    expect(store.restore(copy)).toMatchObject({ added: 2, outcome: 'new' });
    expect(store.restore(copy)).toMatchObject({ added: 0, kept: 0 });
    expect(store.read(inv.id)?.entries).toHaveLength(2);
  });
});

describe('what the doctor has received', () => {
  it('tells new, edited and handed-over entries apart', () => {
    const inv = invitation();
    const a = reading(inv, 'entry00001', '2026-10-02T08:00:00Z', 120, 80);
    const b = reading(inv, 'entry00002', '2026-10-03T08:00:00Z', 130, 85);
    expect(shareStatus([a, b], undefined)).toMatchObject({
      unsent: 2,
      changed: 0,
      sentAt: undefined,
    });

    const sent = markAllSent([a, b], '2026-10-04T10:00:00.000Z');
    expect(shareStatus([a, b], sent)).toMatchObject({ unsent: 0, changed: 0 });

    const edited = reading(inv, 'entry00002', '2026-10-03T08:00:00Z', 135, 85);
    const later = reading(inv, 'entry00003', '2026-10-05T08:00:00Z', 118, 78);
    expect(shareStatus([a, edited, later], sent)).toMatchObject({
      unsent: 1,
      changed: 1,
      total: 3,
    });
    expect(entryFingerprint(a)).toBe(entryFingerprint({ ...a }));
    expect(entryFingerprint(a)).not.toBe(entryFingerprint(b));
  });
});

describe('results as text (a file, a message)', () => {
  it('round-trips through text with captions around it, in any line order', async () => {
    const inv = invitation();
    const copy = results(
      inv,
      Array.from({ length: 80 }, (_, index) =>
        reading(
          inv,
          `entry${String(index).padStart(5, '0')}`,
          new Date(Date.parse('2026-08-01T08:00:00Z') + index * 3_600_000 * 8).toISOString(),
          110 + (index % 30),
          70 + (index % 15),
        ),
      ),
    );
    const parts = await encodeDiaryResults(copy);
    expect(parts.length).toBeGreaterThan(1);
    const message = `Здравствуйте, мой дневник!\n\n${[...parts].reverse().join('\n\n')}\n\nСпасибо`;
    const decoded = await decodeDiaryResultsText(message);
    expect(decoded.entries).toHaveLength(80);
    expect(await encodeDiaryResultsText(decoded)).toBe(await encodeDiaryResultsText(copy));
  });

  it('says what is wrong with text that is not a complete copy', async () => {
    await expect(decodeDiaryResultsText('привет')).rejects.toThrow('нет данных дневника');
    const inv = invitation();
    const many = results(
      inv,
      Array.from({ length: 80 }, (_, index) =>
        reading(
          inv,
          `entry${String(index).padStart(5, '0')}`,
          new Date(Date.parse('2026-08-01T08:00:00Z') + index * 3_600_000 * 8).toISOString(),
          110 + (index % 30),
          70 + (index % 15),
        ),
      ),
    );
    const [first] = await encodeDiaryResults(many);
    await expect(decodeDiaryResultsText(first ?? '')).rejects.toThrow('Данные неполные');
    expect(new DiaryPartCollector().add(first ?? '')).toBe(true);
  });
});

describe('keeping the diary on the phone screen', () => {
  const iphone =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
  const telegramIos =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
  const chromeAndroid =
    'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
  const webviewAndroid =
    'Mozilla/5.0 (Linux; Android 14; Pixel 7; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.0.0 Mobile Safari/537.36';

  it('recognises phones and built-in messenger browsers', () => {
    expect(detectPlatform({ userAgent: iphone })).toBe('ios');
    expect(
      detectPlatform({ userAgent: 'Macintosh', platform: 'MacIntel', maxTouchPoints: 5 }),
    ).toBe('ios');
    expect(detectPlatform({ userAgent: chromeAndroid })).toBe('android');
    expect(detectPlatform({ userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/126' })).toBe('other');
    expect(isInAppBrowser({ userAgent: iphone })).toBe(false);
    expect(isInAppBrowser({ userAgent: telegramIos })).toBe(true);
    expect(isInAppBrowser({ userAgent: chromeAndroid })).toBe(false);
    expect(isInAppBrowser({ userAgent: webviewAndroid })).toBe(true);
  });

  it('picks the advice from what the browser can do', () => {
    expect(installAdvice({ standalone: true, canPrompt: true, platform: 'ios' })).toBe('installed');
    expect(installAdvice({ standalone: false, canPrompt: true, platform: 'android' })).toBe(
      'prompt',
    );
    expect(installAdvice({ standalone: false, canPrompt: false, platform: 'ios' })).toBe('ios');
    expect(installAdvice({ standalone: false, canPrompt: false, platform: 'android' })).toBe(
      'manual',
    );
    expect(installAdvice({ standalone: false, canPrompt: false, platform: 'other' })).toBe('none');
  });

  it('asks again a week after «Не сейчас»', () => {
    expect(installCardDismissed(undefined, NOW)).toBe(false);
    expect(installCardDismissed(new Date(NOW - 2 * 86_400_000).toISOString(), NOW)).toBe(true);
    expect(installCardDismissed(new Date(NOW - 8 * 86_400_000).toISOString(), NOW)).toBe(false);
  });
});
