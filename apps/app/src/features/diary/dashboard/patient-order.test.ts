import { describe, expect, it } from 'vitest';

import type { DoctorPatient } from '@/features/diary/connected/doctor-workspace';
import { lastPatientEntry, orderPatients } from '@/features/diary/dashboard/patient-order';

function patient(
  label: string,
  options: { alerts?: number; issuedAt?: string; entries?: [string, string][] } = {},
): DoctorPatient {
  const entries = (options.entries ?? []).map(([id, at]) => ({ id, at, values: {} }));
  return {
    summary: { id: label, openAlerts: options.alerts ?? 0, createdAt: '2026-10-01T00:00:00Z' },
    replica: {
      profile: { label },
      invitation: options.issuedAt ? { issuedAt: options.issuedAt } : undefined,
      entries: new Map(entries.map((entry) => [entry.id, entry])),
      entryAuthors: new Map(
        entries.map((entry) => [entry.id, entry.id.startsWith('d') ? 'd:1' : 'p:1']),
      ),
    },
    refused: 0,
  } as unknown as DoctorPatient;
}

describe('patient list order', () => {
  const a = patient('Анна', {
    issuedAt: '2026-10-20T00:00:00Z',
    entries: [['p1', '2026-10-25T00:00:00Z']],
  });
  const b = patient('Борис', {
    issuedAt: '2026-10-26T00:00:00Z',
    entries: [
      ['p2', '2026-10-21T00:00:00Z'],
      ['d3', '2026-10-27T00:00:00Z'],
    ],
  });
  const c = patient('Вера', { alerts: 1 });

  it('keeps urgent patients on top in every order', () => {
    expect(orderPatients([a, b, c], 'name').map((one) => one.summary.id)).toEqual([
      'Вера',
      'Анна',
      'Борис',
    ]);
  });

  it('orders by the patient’s own latest entry, ignoring doctor corrections', () => {
    expect(lastPatientEntry(b)).toBe('2026-10-21T00:00:00Z');
    expect(orderPatients([b, a], 'patient').map((one) => one.summary.id)).toEqual([
      'Анна',
      'Борис',
    ]);
  });

  it('orders by the doctor’s latest plan change', () => {
    expect(orderPatients([a, b], 'doctor').map((one) => one.summary.id)).toEqual(['Борис', 'Анна']);
  });
});
