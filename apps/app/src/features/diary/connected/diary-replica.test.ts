import { describe, expect, it } from 'vitest';

import {
  applyRevisions,
  EMPTY_REPLICA,
  replicaResults,
} from '@/features/diary/connected/diary-replica';
import { DIARY_FORMAT_VERSION, diaryTemplate } from '@/features/diary/diary-model';

const template = diaryTemplate('care');
const invitation = {
  v: DIARY_FORMAT_VERSION,
  id: 'patient0000000000001',
  template: 'care',
  title: template?.title,
  issuedAt: '2026-10-20T08:00:00.000Z',
  fields: template?.fields,
  plan: [{ id: 'p1', name: 'Сертралин', times: [{ time: '08:00' }] }],
  planTitle: 'Лекарства',
};
const entry = (wellbeing: number) => ({
  id: 'entry000001',
  at: '2026-10-21T09:00:00.000Z',
  values: { wellbeing },
});

describe('connected diary replica', () => {
  it('builds the diary from the latest revision of each record', () => {
    const replica = applyRevisions(EMPTY_REPLICA, [
      {
        id: 'e-entry000001',
        rev: 1,
        author: 'p:device0000001',
        at: 't',
        payload: { kind: 'entry', entry: entry(4) },
      },
      {
        id: 'plan',
        rev: 1,
        author: 'd:doctor0000001',
        at: 't',
        payload: { kind: 'plan', invitation },
      },
      {
        id: 'profile',
        rev: 1,
        author: 'd:doctor0000001',
        at: 't',
        payload: { kind: 'profile', label: 'Лиса', emoji: '🦊' },
      },
      {
        id: 'e-entry000001',
        rev: 2,
        author: 'd:doctor0000001',
        at: 't',
        payload: { kind: 'entry', entry: { ...entry(5), corrected: true } },
      },
      {
        id: 'consent',
        rev: 1,
        author: 'p:device0000001',
        at: 't',
        payload: { kind: 'consent', at: '2026-10-20', version: 'x' },
      },
    ]);
    expect(replica.profile).toEqual({ label: 'Лиса', emoji: '🦊' });
    expect(replica.entries.get('entry000001')?.values['wellbeing']).toBe(5);
    expect(replica.entries.get('entry000001')?.corrected).toBe(true);
    expect(replica.entryAuthors.get('entry000001')).toBe('d:doctor0000001');
    expect(replica.consentAt).toBe('2026-10-20');
    expect(replicaResults(replica)?.entries).toHaveLength(1);

    // An older revision arriving late changes nothing; a deletion removes the entry.
    const stale = applyRevisions(replica, [
      {
        id: 'e-entry000001',
        rev: 1,
        author: 'p:device0000001',
        at: 't',
        payload: { kind: 'entry', entry: entry(1) },
      },
    ]);
    expect(stale.entries.get('entry000001')?.values['wellbeing']).toBe(5);
    const deleted = applyRevisions(replica, [
      {
        id: 'e-entry000001',
        rev: 3,
        author: 'p:device0000001',
        at: 't',
        payload: { kind: 'deleted' },
      },
    ]);
    expect(deleted.entries.size).toBe(0);
  });

  it('refuses a plan written by a patient device and unreadable entries', () => {
    const replica = applyRevisions(EMPTY_REPLICA, [
      {
        id: 'plan',
        rev: 1,
        author: 'p:device0000001',
        at: 't',
        payload: { kind: 'plan', invitation },
      },
      {
        id: 'e-entry000001',
        rev: 1,
        author: 'p:device0000001',
        at: 't',
        payload: { kind: 'entry', entry: entry(4) },
      },
    ]);
    expect(replica.invitation).toBeUndefined();
    expect(replica.rejected).toBe(2);
  });
});
