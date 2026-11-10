import type { DiaryDoctorTotals } from '@localmed/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EMPTY_REPLICA } from '@/features/diary/connected/diary-replica';
import type { DoctorPatient } from '@/features/diary/connected/doctor-workspace';
import {
  reportDoctorTotals,
  TOTALS_MIN_INTERVAL_MS,
} from '@/features/diary/dashboard/doctor-totals-report';
import type { DiaryInvitation } from '@/features/diary/diary-model';

const SESSION = { token: 't', doctor: { id: 'doc1' } } as never;
const T0 = new Date(2026, 10, 10, 12, 0);
const later = (ms: number): Date => new Date(T0.getTime() + ms);

function owned(items: number): DoctorPatient {
  return {
    refused: 0,
    summary: { id: 'p', role: 'owner', status: 'active' } as DoctorPatient['summary'],
    replica: {
      ...EMPTY_REPLICA,
      invitation: {
        id: 'i',
        issuedAt: T0.toISOString(),
        plan: Array.from({ length: items }, (_, index) => ({ id: `m${index}`, name: 'М' })),
      } as unknown as DiaryInvitation,
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

describe('sending the doctor totals', () => {
  it('sends once, then waits an hour and sends only a change', async () => {
    const send = vi.fn(async (_totals: DiaryDoctorTotals) => ({ ok: true }));
    let patients = [owned(2)];
    const run = (at: Date) => reportDoctorTotals(SESSION, () => patients, at, send);

    expect(await run(T0)).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toMatchObject({ diaries: 1, prescriptions: 2 });

    // Within the hour: nothing, whatever changed.
    patients = [owned(3)];
    expect(await run(later(TOTALS_MIN_INTERVAL_MS - 1))).toBe(false);
    // After the hour, changed: sent. Unchanged: not sent again.
    expect(await run(later(TOTALS_MIN_INTERVAL_MS))).toBe(true);
    expect(await run(later(3 * TOTALS_MIN_INTERVAL_MS))).toBe(false);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('stays silent when the service fails and tries again next time', async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ ok: true });
    expect(await reportDoctorTotals(SESSION, () => [owned(1)], T0, send)).toBe(false);
    expect(await reportDoctorTotals(SESSION, () => [owned(1)], later(1000), send)).toBe(true);
  });

  it('never throws, whatever the storage does', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    const send = vi.fn(async () => ({ ok: true }));
    await expect(reportDoctorTotals(SESSION, () => [owned(1)], T0, send)).resolves.toBeTypeOf(
      'boolean',
    );
  });
});
