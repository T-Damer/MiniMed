import { describe, expect, it } from 'vitest';

import {
  applyDiaryImport,
  diaryEventOwner,
  diaryImportEvents,
  previewDiaryImport,
} from '@/features/diary/diary-import';
import { parseLedger, withImport, withIssued, withoutIssued } from '@/features/diary/diary-ledger';
import {
  DIARY_FORMAT_VERSION,
  type DiaryEntry,
  type DiaryInvitation,
  type DiaryResults,
  diaryTemplate,
  parseDiaryEntry,
  parseDiaryInvitation,
  parseDiaryResults,
} from '@/features/diary/diary-model';
import {
  appendEpisode,
  closeClinicalEpisode,
  createClinicalEpisode,
  createPatientProfile,
  emptyPatientVaultSnapshot,
} from '@/state/patient-domain';

const NOW = Date.parse('2026-10-05T12:00:00Z');

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

describe('importing into a patient card again and again', () => {
  function card() {
    const created = createPatientProfile({ displayName: 'Тестовый пациент' });
    const base = {
      ...emptyPatientVaultSnapshot(),
      profiles: [created.profile],
      events: created.initialEvents,
      observations: created.initialEvents.flatMap((event) => event.observations),
    };
    return { snapshot: base, patientId: created.profile.id };
  }

  it('updates a record the patient corrected, once, and keeps what it said before', () => {
    const { snapshot, patientId } = card();
    const inv = invitation();
    const original = results(inv, [reading(inv, 'entry00001', '2026-10-02T08:00:00Z', 150, 95)]);
    const first = applyDiaryImport(snapshot, diaryImportEvents(original, patientId));
    expect(first).toMatchObject({ added: 1, updated: 0 });

    const corrected = results(inv, [reading(inv, 'entry00001', '2026-10-02T08:00:00Z', 145, 95)]);
    const events = diaryImportEvents(corrected, patientId);
    expect(previewDiaryImport(first.snapshot, events)).toEqual({
      added: 0,
      updated: 1,
      alreadyPresent: 0,
    });
    const second = applyDiaryImport(first.snapshot, events);
    expect(second).toMatchObject({ added: 0, updated: 1, blocked: 0 });
    const record = second.snapshot.events.find((event) => event.id.startsWith('diary-'));
    expect(record?.observations.map((item) => item.value)).toEqual([145, 95]);
    expect(record?.text).toContain('Исправлено пациентом, ранее:');
    expect(record?.text).toContain('150');
    expect(second.snapshot.events.filter((event) => event.id.startsWith('diary-'))).toHaveLength(1);
    expect(
      second.snapshot.observations.filter((item) => item.metricId.startsWith('blood')),
    ).toHaveLength(2);

    // The same corrected copy again is not a new correction.
    const third = applyDiaryImport(second.snapshot, events);
    expect(third).toMatchObject({ added: 0, updated: 0, alreadyPresent: 1 });
    expect(third.snapshot.events.find((event) => event.id.startsWith('diary-'))?.text).toBe(
      record?.text,
    );
  });

  it('does not touch a corrected record whose visit is closed', () => {
    const { snapshot, patientId } = card();
    const inv = invitation();
    const episode = createClinicalEpisode({ patientId, title: 'Приём' });
    const withEpisode = appendEpisode(snapshot, episode);
    const original = results(inv, [reading(inv, 'entry00001', '2026-10-02T08:00:00Z', 150, 95)]);
    const first = applyDiaryImport(withEpisode, diaryImportEvents(original, patientId, episode.id));
    const closed = closeClinicalEpisode(first.snapshot, episode.id);

    const corrected = results(inv, [reading(inv, 'entry00001', '2026-10-02T08:00:00Z', 145, 95)]);
    const outcome = applyDiaryImport(closed, diaryImportEvents(corrected, patientId));
    expect(outcome).toMatchObject({ added: 0, updated: 0, blocked: 1 });
    expect(
      outcome.snapshot.events.find((event) => event.id.startsWith('diary-'))?.observations[0]
        ?.value,
    ).toBe(150);
  });

  it('finds the card a diary was already imported into', () => {
    const { snapshot, patientId } = card();
    const inv = invitation();
    const copy = results(inv, [reading(inv, 'entry00001', '2026-10-02T08:00:00Z', 150, 95)]);
    expect(diaryEventOwner(snapshot, inv.id)).toBeUndefined();
    const imported = applyDiaryImport(snapshot, diaryImportEvents(copy, patientId));
    expect(diaryEventOwner(imported.snapshot, inv.id)).toBe(patientId);
    expect(diaryEventOwner(imported.snapshot, 'someotherid1')).toBeUndefined();
  });
});

describe('the doctor ledger of issued diaries', () => {
  it('records an update under the same id and keeps the first issue time', () => {
    const first = invitation();
    const issued = withIssued([], first);
    const updated = invitation({ issuedAt: '2026-10-04T09:00:00.000Z', note: 'Только утром' });
    const next = withImport(withIssued(issued, updated), first.id, '2026-10-05T10:00:00.000Z', 7);
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({
      firstIssuedAt: first.issuedAt,
      lastImport: { entries: 7 },
    });
    expect(next[0]?.invitation.note).toBe('Только утром');
    // A later update does not forget the last import.
    const again = withIssued(next, invitation({ issuedAt: '2026-10-06T09:00:00.000Z' }));
    expect(again[0]?.lastImport?.entries).toBe(7);
    expect(withoutIssued(again, first.id)).toHaveLength(0);
  });

  it('survives a round trip through its stored text and rejects damaged text', () => {
    const issued = withIssued([], invitation());
    const parsed = parseLedger(JSON.stringify(issued), NOW);
    expect(parsed[0]?.invitation.id).toBe('diarysync001');
    expect(() => parseLedger('{"nope":1}', NOW)).toThrow();
    expect(() => parseLedger('[{"invitation":{"v":9}}]', NOW)).toThrow();
  });

  it('reads results that carry the same diary through the model', () => {
    const inv = invitation();
    const copy = results(inv, [reading(inv, 'entry00001', '2026-10-02T08:00:00Z', 150, 95)]);
    expect(parseDiaryResults(JSON.parse(JSON.stringify(copy)), NOW).entries).toHaveLength(1);
  });
});
