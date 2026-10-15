import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ASSESSMENT_NOTE_DRAFTS_KEY,
  clearAssessmentNoteDraft,
  readAssessmentNoteDraft,
  writeAssessmentNoteDraft,
} from '@/features/assessments/assessment-note-draft';

describe('assessment result note draft', () => {
  let storage: Map<string, string>;

  beforeEach(() => {
    storage = new Map();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => void storage.set(key, value),
        removeItem: (key: string) => void storage.delete(key),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the typed card name per result and gives it back', () => {
    writeAssessmentNoteDraft('r1', { cardId: '', newCardTitle: 'Иванова А.' });
    writeAssessmentNoteDraft('r2', { cardId: 'c9', newCardTitle: '' });
    expect(readAssessmentNoteDraft('r1')).toMatchObject({ cardId: '', newCardTitle: 'Иванова А.' });
    expect(readAssessmentNoteDraft('r2')).toMatchObject({ cardId: 'c9' });
    expect(readAssessmentNoteDraft('r3')).toBeUndefined();
  });

  it('removes a draft that was saved, cancelled or emptied', () => {
    writeAssessmentNoteDraft('r1', { cardId: '', newCardTitle: 'Иванова А.' });
    clearAssessmentNoteDraft('r1');
    expect(readAssessmentNoteDraft('r1')).toBeUndefined();
    expect(storage.has(ASSESSMENT_NOTE_DRAFTS_KEY)).toBe(false);

    writeAssessmentNoteDraft('r1', { cardId: '', newCardTitle: 'Иванова А.' });
    writeAssessmentNoteDraft('r1', { cardId: '', newCardTitle: '   ' });
    expect(readAssessmentNoteDraft('r1')).toBeUndefined();
  });

  it('keeps only the newest drafts', () => {
    vi.useFakeTimers();
    for (let index = 0; index < 25; index += 1) {
      vi.setSystemTime(new Date(2026, 9, 15, 10, 0, index));
      writeAssessmentNoteDraft(`r${index}`, { cardId: '', newCardTitle: `Имя ${index}` });
    }
    vi.useRealTimers();
    expect(readAssessmentNoteDraft('r0')).toBeUndefined();
    expect(readAssessmentNoteDraft('r24')).toBeDefined();
    const kept = JSON.parse(storage.get(ASSESSMENT_NOTE_DRAFTS_KEY) ?? '{}') as object;
    expect(Object.keys(kept)).toHaveLength(20);
  });

  it('ignores damaged storage', () => {
    storage.set(ASSESSMENT_NOTE_DRAFTS_KEY, '{not json');
    expect(readAssessmentNoteDraft('r1')).toBeUndefined();
    writeAssessmentNoteDraft('r1', { cardId: '', newCardTitle: 'Имя' });
    expect(readAssessmentNoteDraft('r1')).toBeDefined();
  });
});
