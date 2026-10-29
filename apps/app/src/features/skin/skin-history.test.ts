import { describe, expect, it } from 'vitest';

import {
  applySkinHistoryPatch,
  createMemorySkinHistory,
  parseSkinHistoryEntry,
  type SkinHistoryEntry,
  skinHistoryResults,
} from '@/features/skin/skin-history';
import { SKIN_CLASSES } from '@/features/skin/skin-model';

const known = SKIN_CLASSES[0]?.id ?? '';

function entry(id: string, createdAt: number): SkinHistoryEntry {
  return {
    id,
    createdAt,
    photo: new Blob(['photo']),
    thumbnail: new Blob(['thumb']),
    details: { sites: ['arm'] },
    results: {
      predictions: [{ classId: known, probability: 0.7 }],
      malignantScore: 0.02,
      malignantFlag: false,
      uncertain: false,
    },
    note: '',
  };
}

describe('reading a stored record', () => {
  it('accepts a complete record', () => {
    const stored = entry('a', 10);
    expect(parseSkinHistoryEntry(stored)).toEqual(stored);
  });

  it('drops records that are not records or lack their pictures', () => {
    expect(parseSkinHistoryEntry(null)).toBeUndefined();
    expect(parseSkinHistoryEntry({ id: 'a', createdAt: 1 })).toBeUndefined();
    expect(parseSkinHistoryEntry({ ...entry('a', 1), createdAt: 'yesterday' })).toBeUndefined();
    expect(parseSkinHistoryEntry({ ...entry('a', 1), photo: 'data:' })).toBeUndefined();
  });

  it('keeps only the predictions of classes the app still knows', () => {
    const parsed = parseSkinHistoryEntry({
      ...entry('a', 1),
      results: {
        predictions: [
          { classId: 'gone', probability: 0.9 },
          { classId: known, probability: 3 },
        ],
        malignantFlag: 'yes',
      },
    });
    expect(parsed?.results?.predictions).toEqual([{ classId: known, probability: 1 }]);
    expect(parsed?.results?.malignantFlag).toBe(false);
  });

  it('keeps the photo without results when none of its predictions survive', () => {
    const parsed = parseSkinHistoryEntry({
      ...entry('a', 1),
      results: { predictions: [{ classId: 'gone', probability: 0.9 }] },
    });
    expect(parsed).toBeDefined();
    expect(parsed?.results).toBeUndefined();
  });
});

describe('the memory store', () => {
  it('lists newest first, updates a note and a patient, and removes', async () => {
    const store = createMemorySkinHistory();
    await store.put(entry('old', 1));
    await store.put(entry('new', 2));
    expect((await store.list()).map((item) => item.id)).toEqual(['new', 'old']);

    const updated = await store.update('old', { note: 'контроль через месяц', patientId: 'p1' });
    expect(updated).toMatchObject({ note: 'контроль через месяц', patientId: 'p1' });
    const detached = await store.update('old', { patientId: null });
    expect(detached?.patientId).toBeUndefined();
    expect(await store.update('missing', { note: 'x' })).toBeUndefined();

    await store.remove('new');
    expect((await store.list()).map((item) => item.id)).toEqual(['old']);
  });

  it('leaves the patient alone when the patch does not mention it', () => {
    const attached = applySkinHistoryPatch(entry('a', 1), { patientId: 'p1' });
    expect(applySkinHistoryPatch(attached, { note: 'x' }).patientId).toBe('p1');
  });
});

describe('the ranking a record keeps', () => {
  it('keeps the first five conditions and the flags', () => {
    const predictions = SKIN_CLASSES.map((item, index) => ({
      classId: item.id,
      probability: 1 / (index + 2),
    }));
    const kept = skinHistoryResults({
      predictions,
      malignantScore: 0.4,
      malignantFlag: true,
      uncertain: false,
    });
    expect(kept.predictions).toHaveLength(5);
    expect(kept.malignantFlag).toBe(true);
  });
});
