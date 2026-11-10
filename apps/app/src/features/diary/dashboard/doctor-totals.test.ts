import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EMPTY_REPLICA } from '@/features/diary/connected/diary-replica';
import type { DoctorPatient } from '@/features/diary/connected/doctor-workspace';
import { DEMO_LABEL_PREFIX } from '@/features/diary/dashboard/demo-patients';
import { doctorTotals, totalsFingerprint } from '@/features/diary/dashboard/doctor-totals';
import { atTime } from '@/features/diary/diary-care';
import type { DiaryEntry, DiaryInvitation } from '@/features/diary/diary-model';

const NOW = new Date(2026, 10, 10, 23, 0);
const DOCTOR = { doctor: { id: 'doc1' } } as never;

const invitation = {
  id: 'inv',
  issuedAt: new Date(2026, 10, 8, 7, 0).toISOString(),
  plan: [
    { id: 'a', name: 'А', times: [{ time: '08:00' }] },
    { id: 'b', name: 'Б', times: [{ time: '08:00' }] },
    { id: 'old', name: 'Снято', ended: true, times: [{ time: '08:00' }] },
  ],
} as unknown as DiaryInvitation;

const mark = (id: string, day: string, done: boolean): DiaryEntry =>
  ({
    id,
    at: atTime(day, '08:05'),
    values: { medication: { item: 'a', done, slot: '08:00' } },
  }) as unknown as DiaryEntry;

function patient(
  id: string,
  options: {
    readonly role?: 'owner' | 'editor' | 'reader';
    readonly label?: string;
    readonly invitation?: DiaryInvitation | undefined;
    readonly entries?: readonly DiaryEntry[];
    readonly status?: 'active' | 'withdrawn';
  } = {},
): DoctorPatient {
  return {
    refused: 0,
    summary: {
      id,
      role: options.role ?? 'owner',
      status: options.status ?? 'active',
    } as DoctorPatient['summary'],
    replica: {
      ...EMPTY_REPLICA,
      invitation: 'invitation' in options ? options.invitation : invitation,
      profile: { label: options.label ?? 'Иванов' } as DoctorPatient['replica']['profile'],
      entries: new Map((options.entries ?? []).map((entry) => [entry.id, entry] as const)),
    },
  };
}

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('doctor totals (ADR-0026 §7)', () => {
  it('sums active prescriptions and intakes over the diaries the doctor owns', () => {
    const totals = doctorTotals(
      [
        patient('p1', {
          entries: [mark('e1', '2026-11-08', true), mark('e2', '2026-11-09', false)],
        }),
        patient('p2'),
      ],
      DOCTOR,
      NOW,
    );
    // Two diaries, two active items each (the ended one is not counted); three days of two
    // morning doses each, two doses marked (adherence counts what the patient marked, as the doctor's page does).
    expect(totals).toEqual({
      diaries: 2,
      prescriptions: 4,
      adherence7: { done: 2, total: 12 },
      adherence30: { done: 2, total: 12 },
    });
  });

  it('counts a patient once: curators, demo diaries, empty plans and withdrawn ones add nothing', () => {
    const totals = doctorTotals(
      [
        patient('mine'),
        patient('shared', { role: 'editor' }),
        patient('read', { role: 'reader' }),
        patient('demo', { label: `${DEMO_LABEL_PREFIX} Лиса` }),
        patient('noplan', { invitation: { ...invitation, plan: [] } }),
        patient('unread', { invitation: undefined }),
        patient('gone', { status: 'withdrawn' }),
      ],
      DOCTOR,
      NOW,
    );
    expect(totals?.diaries).toBe(1);
    expect(totals?.prescriptions).toBe(2);
  });

  it('reports nothing for a demo session and an empty list gives zeros', () => {
    localStorage.setItem('minimed.diary.demo.v1', JSON.stringify({ doctorId: 'doc1' }));
    expect(doctorTotals([patient('p1')], DOCTOR, NOW)).toBeUndefined();
    localStorage.clear();
    expect(doctorTotals([], DOCTOR, NOW)).toEqual({
      diaries: 0,
      prescriptions: 0,
      adherence7: { done: 0, total: 0 },
      adherence30: { done: 0, total: 0 },
    });
  });

  it('carries no id or name: only the four figures', () => {
    const totals = doctorTotals([patient('secret-id', { label: 'Секретов' })], DOCTOR, NOW);
    expect(Object.keys(totals ?? {}).toSorted()).toEqual([
      'adherence30',
      'adherence7',
      'diaries',
      'prescriptions',
    ]);
    expect(JSON.stringify(totals)).not.toMatch(/secret|Секретов|doc1/u);
  });

  it('fingerprints equal numbers equally', () => {
    const a = {
      diaries: 1,
      prescriptions: 2,
      adherence7: { done: 1, total: 2 },
      adherence30: { done: 3, total: 4 },
    };
    expect(totalsFingerprint(a)).toBe(totalsFingerprint({ ...a }));
    expect(totalsFingerprint(a)).not.toBe(totalsFingerprint({ ...a, prescriptions: 3 }));
  });
});
