import type { DiaryPatientDetail } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import {
  carerName,
  diaryPhones,
  doseMoments,
  markAuthor,
  markLine,
  memberName,
  memberRecordId,
} from '@/features/diary/connected/carer';
import { applyRevisions, EMPTY_REPLICA } from '@/features/diary/connected/diary-replica';
import { atTime, CARE_DOSE_FIELD } from '@/features/diary/diary-care';
import {
  DIARY_FORMAT_VERSION,
  type DiaryInvitation,
  diaryTemplate,
  intakeMark,
  parseDiaryEntry,
  parseDiaryInvitation,
} from '@/features/diary/diary-model';

const NOW = new Date(2026, 10, 4, 12, 0);

function careDiary(): DiaryInvitation {
  const template = diaryTemplate('care');
  return parseDiaryInvitation(
    {
      v: DIARY_FORMAT_VERSION,
      id: 'carerdiary01',
      template: 'care',
      title: template?.title,
      issuedAt: new Date(2026, 10, 1, 9, 0).toISOString(),
      fields: template?.fields,
      plan: [
        {
          id: 'p1',
          name: 'Кветиапин',
          dose: '25 мг',
          times: [{ time: '09:00' }, { time: '21:00' }],
        },
        { id: 'p2', name: 'Сертралин', dose: '50 мг', times: [{ time: '09:00' }] },
      ],
    },
    NOW.getTime(),
  );
}

function mark(invitation: DiaryInvitation, item: string, slot: string, done: boolean, at: Date) {
  const planItem = invitation.plan?.find((candidate) => candidate.id === item);
  if (!planItem) throw new Error(item);
  return parseDiaryEntry(
    invitation,
    {
      id: `m${item}${slot.replace(':', '')}d${at.getDate()}`,
      at: at.toISOString(),
      values: { [CARE_DOSE_FIELD]: intakeMark(planItem, done, slot) },
    },
    NOW.getTime(),
  );
}

const detail = (
  devices: { id: string; kind: 'patient' | 'carer'; at: string }[],
): DiaryPatientDetail => ({
  members: [],
  devices: devices.map((device) => ({
    id: device.id,
    kind: device.kind,
    identity: { wrap: 'w', sign: 's' },
    createdAt: device.at,
    lastSeenAt: null,
  })),
});

describe('dose moments for a carer’s missed-dose notice', () => {
  it('keeps a moment open until every dose of it is marked taken; a skipped dose stays open', () => {
    const invitation = careDiary();
    const today = '2026-11-04';
    const nine = atTime(today, '09:00');
    const nineTonight = atTime(today, '21:00');
    // 09:00: one of two doses taken — still open (three hours ago, past the notice: not reported).
    const half = doseMoments(
      invitation,
      [mark(invitation, 'p1', '09:00', true, new Date(2026, 10, 4, 9, 5))],
      NOW,
    );
    expect(half.open).not.toContain(nine);
    expect(half.taken).not.toContain(nine);
    expect(half.open).toContain(nineTonight);
    // Both taken: the moment is closed and reported as taken.
    const both = doseMoments(
      invitation,
      [
        mark(invitation, 'p1', '09:00', true, new Date(2026, 10, 4, 9, 5)),
        mark(invitation, 'p2', '09:00', true, new Date(2026, 10, 4, 9, 6)),
      ],
      NOW,
    );
    expect(both.taken).toContain(nine);
    // Tonight's dose marked skipped in advance is not «taken»: the carer still hears of it.
    const skipped = doseMoments(
      invitation,
      [mark(invitation, 'p1', '21:00', false, new Date(2026, 10, 4, 11, 0))],
      NOW,
    );
    expect(skipped.open).toContain(nineTonight);
    expect(skipped.taken).not.toContain(nineTonight);
  });

  it('reports open moments from half an hour ago over the reminder days', () => {
    const invitation = careDiary();
    const moments = doseMoments(invitation, [], new Date(2026, 10, 4, 9, 20), 3);
    expect(moments.open[0]).toBe(atTime('2026-11-04', '09:00'));
    expect(moments.open.at(-1)).toBe(atTime('2026-11-06', '21:00'));
    expect(moments.open).toHaveLength(6);
    expect(moments.taken).toEqual([]);
  });
});

describe('who made a mark', () => {
  const phones = diaryPhones(
    detail([
      { id: 'carerphone1', kind: 'carer', at: '2026-11-03T10:00:00Z' },
      { id: 'patientphone1', kind: 'patient', at: '2026-11-01T10:00:00Z' },
    ]),
    { carerphone1: 'Ирина, мама' },
    'patientphone1',
  );

  it('lists the patient’s phones first, carers with their names', () => {
    expect(phones.map((phone) => [phone.id, phone.kind, phone.self, phone.name])).toEqual([
      ['patientphone1', 'patient', true, undefined],
      ['carerphone1', 'carer', false, 'Ирина, мама'],
    ]);
  });

  it('names the carer on the patient’s phone and the patient on the carer’s', () => {
    const names = { carerphone1: 'Ирина, мама' };
    expect(markAuthor('p:carerphone1', phones, names, 'patient')).toBe('опекун Ирина, мама');
    expect(markAuthor(undefined, phones, names, 'patient')).toBe('вы');
    expect(markAuthor('d:doctor1', phones, names, 'patient')).toBe('врач');
    const onCarer = diaryPhones(
      detail([
        { id: 'carerphone1', kind: 'carer', at: '2026-11-03T10:00:00Z' },
        { id: 'patientphone1', kind: 'patient', at: '2026-11-01T10:00:00Z' },
      ]),
      names,
      'carerphone1',
    );
    expect(markAuthor('p:patientphone1', onCarer, names, 'carer')).toBe('пациент');
    expect(markAuthor(undefined, onCarer, names, 'carer')).toBe('вы');
    // A removed carer's old mark keeps the name.
    expect(markAuthor('p:gone', phones, { gone: 'Олег' }, 'patient')).toBe('опекун Олег');
    expect(markLine('опекун Олег')).toBe('Отметил(а) опекун Олег');
  });

  it('says nothing while the diary has no carer', () => {
    const alone = diaryPhones(
      detail([{ id: 'patientphone1', kind: 'patient', at: '2026-11-01T10:00:00Z' }]),
      {},
      'patientphone1',
    );
    expect(markAuthor(undefined, alone, {}, 'patient')).toBeUndefined();
    expect(markAuthor('p:patientphone2', alone, {}, 'patient')).toBeUndefined();
  });
});

describe('a carer’s name record', () => {
  it('is read only from that very phone, trimmed', () => {
    const id = memberRecordId('carerphone1');
    expect(memberName(id, 'p:carerphone1', { kind: 'member', name: '  Ирина   мама ' })).toBe(
      'Ирина мама',
    );
    expect(memberName(id, 'p:otherphone1', { kind: 'member', name: 'Подделка' })).toBeUndefined();
    expect(memberName(id, 'd:doctor1', { kind: 'member', name: 'Врач' })).toBeUndefined();
    expect(memberName(id, 'p:carerphone1', { kind: 'member', name: '   ' })).toBeUndefined();
    expect(carerName('x'.repeat(80))).toHaveLength(60);
  });

  it('gives the doctor’s replica the carer’s name', () => {
    const replica = applyRevisions(EMPTY_REPLICA, [
      {
        id: memberRecordId('carerphone1'),
        rev: 1,
        author: 'p:carerphone1',
        at: '2026-11-04T10:00:00Z',
        payload: { kind: 'member', name: 'Ирина' },
      },
      {
        id: memberRecordId('carerphone2'),
        rev: 1,
        author: 'p:carerphone1',
        at: '2026-11-04T10:00:00Z',
        payload: { kind: 'member', name: 'Чужое имя' },
      },
    ]);
    expect(replica.carerNames).toEqual({ carerphone1: 'Ирина' });
    expect(replica.rejected).toBe(1);
  });
});
