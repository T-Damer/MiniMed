import { describe, expect, it } from 'vitest';

import type { DiaryReplica } from '@/features/diary/connected/diary-replica';
import { EMPTY_REPLICA } from '@/features/diary/connected/diary-replica';
import type { DoctorPatient } from '@/features/diary/connected/doctor-workspace';
import { curatorHue, curatorInitials } from '@/features/diary/dashboard/curators';
import {
  ALL_GREETINGS,
  dayPart,
  GREETINGS,
  pickGreeting,
} from '@/features/diary/dashboard/greetings';
import {
  changedByColleague,
  knownDoctorIds,
  matchesFilter,
  matchesQuery,
  normalizeSearch,
  patientCounters,
} from '@/features/diary/dashboard/patient-list';

const NOW = new Date('2026-11-03T12:00:00');

function entry(id: string, at: string) {
  return { id, at } as unknown as DiaryReplica['entries'] extends ReadonlyMap<string, infer E>
    ? E
    : never;
}

function patient(
  overrides: {
    readonly label?: string;
    readonly openAlerts?: number;
    readonly entries?: readonly [string, string][];
    readonly authors?: readonly [string, string][];
    readonly history?: readonly { rev: number; author: string; at: string }[];
    readonly status?: 'active' | 'pending';
    readonly ownerId?: string;
  } = {},
): DoctorPatient {
  const entries = new Map(
    (overrides.entries ?? []).map(([id, at]) => [id, entry(id, at)] as const),
  );
  return {
    refused: 0,
    summary: {
      id: 'p1',
      role: 'owner',
      status: overrides.status ?? 'active',
      ownerId: overrides.ownerId ?? 'me',
      openAlerts: overrides.openAlerts ?? 0,
    } as DoctorPatient['summary'],
    replica: {
      ...EMPTY_REPLICA,
      invitation: {} as DiaryReplica['invitation'],
      profile: { label: overrides.label ?? 'Демо · Медведь' } as DiaryReplica['profile'],
      entries,
      entryAuthors: new Map(overrides.authors ?? []),
      planHistory: (overrides.history ?? []).map((revision) => ({
        ...revision,
        invitation: {} as never,
      })),
    },
  };
}

describe('the patient list', () => {
  it('searches by every typed word, ignoring case and «ё»', () => {
    const bear = patient({ label: 'Демо · Медведь' });
    expect(normalizeSearch('  Ёжик  ПЕТРОВ ')).toBe('ежик петров');
    expect(matchesQuery(bear, '')).toBe(true);
    expect(matchesQuery(bear, 'мед')).toBe(true);
    expect(matchesQuery(bear, 'демо медв')).toBe(true);
    expect(matchesQuery(bear, 'лиса')).toBe(false);
    expect(matchesQuery(patient({ label: 'Ёлкина' }), 'елк')).toBe(true);
  });

  it('counts urgent patients, today’s writers and those silent for two days', () => {
    const urgent = patient({ openAlerts: 1, entries: [['a', '2026-11-03T08:00:00']] });
    const quiet = patient({ entries: [['b', '2026-10-30T08:00:00']] });
    const fresh = patient({ entries: [['c', '2026-11-02T20:00:00']] });
    const pending = patient({ status: 'pending' });
    const list = [urgent, quiet, fresh, pending];
    expect(patientCounters(list, NOW)).toEqual({ urgent: 1, today: 1, silent: 1 });
    expect(matchesFilter(quiet, 'silent', NOW)).toBe(true);
    expect(matchesFilter(fresh, 'silent', NOW)).toBe(false);
    expect(matchesFilter(urgent, 'today', NOW)).toBe(true);
    expect(matchesFilter(urgent, undefined, NOW)).toBe(true);
    // A doctor's correction is not the patient's entry.
    const corrected = patient({
      entries: [['d', '2026-11-03T09:00:00']],
      authors: [['d', 'd:colleague']],
    });
    expect(matchesFilter(corrected, 'today', NOW)).toBe(false);
  });

  it('marks a plan changed by a colleague after the doctor last looked', () => {
    const edited = patient({
      history: [
        { rev: 1, author: 'd:me', at: '2026-11-01T10:00:00Z' },
        { rev: 2, author: 'd:anna', at: '2026-11-02T10:00:00Z' },
      ],
    });
    expect(changedByColleague(edited, 'me', '2026-11-01T12:00:00Z')?.author).toBe('anna');
    expect(changedByColleague(edited, 'me', '2026-11-02T12:00:00Z')).toBeUndefined();
    expect(changedByColleague(edited, 'me', undefined)).toBeUndefined();
    expect(changedByColleague(edited, 'anna', '2026-11-01T12:00:00Z')).toBeUndefined();
  });

  it('knows the doctors from the replica without asking the service', () => {
    const shared = patient({
      ownerId: 'olga',
      history: [{ rev: 1, author: 'd:anna', at: '2026-11-01T10:00:00Z' }],
      authors: [
        ['x', 'd:boris'],
        ['y', 'p:phone'],
      ],
    });
    expect([...knownDoctorIds(shared)].sort()).toEqual(['anna', 'boris', 'olga']);
  });
});

describe('curator avatars', () => {
  it('takes initials from the name, or from the e-mail without one', () => {
    expect(curatorInitials('Анна Петрова', 'a@x.ru')).toBe('АП');
    expect(curatorInitials('Иванов', 'i@x.ru')).toBe('И');
    expect(curatorInitials('', 'olga.smirnova@clinic.ru')).toBe('OS');
  });

  it('gives the same hue to the same text, always on the colour wheel', () => {
    expect(curatorHue('Анна Петрова')).toBe(curatorHue('Анна Петрова'));
    for (const text of ['а', 'b@c.d', 'Борис Николаевич']) {
      expect(curatorHue(text)).toBeGreaterThanOrEqual(0);
      expect(curatorHue(text)).toBeLessThan(360);
    }
  });
});

describe('the header greeting', () => {
  it('has at least 32 short lines, none repeated', () => {
    expect(ALL_GREETINGS.length).toBeGreaterThanOrEqual(32);
    expect(new Set(ALL_GREETINGS).size).toBe(ALL_GREETINGS.length);
    for (const line of ALL_GREETINGS) expect(line.length).toBeLessThanOrEqual(46);
  });

  it('chooses by the part of the day and is stable for one seed', () => {
    expect(dayPart(7)).toBe('morning');
    expect(dayPart(13)).toBe('day');
    expect(dayPart(20)).toBe('evening');
    expect(dayPart(2)).toBe('night');
    expect(pickGreeting(8, 3)).toBe(pickGreeting(8, 3));
    expect(pickGreeting(8, 11)).not.toBe(pickGreeting(8, 12));
    const morningPool = new Set([...GREETINGS.morning]);
    expect(morningPool.has(pickGreeting(8, 0))).toBe(true);
  });
});
