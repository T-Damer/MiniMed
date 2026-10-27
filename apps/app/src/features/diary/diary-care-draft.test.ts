import { describe, expect, it } from 'vitest';

import {
  careDraftFrom,
  careInvitationParts,
  emptyCareDraft,
} from '@/features/diary/diary-care-draft';
import {
  DIARY_FORMAT_VERSION,
  diaryTemplate,
  parseDiaryInvitation,
} from '@/features/diary/diary-model';

function issue(parts: ReturnType<typeof careInvitationParts>) {
  const template = diaryTemplate('care');
  return parseDiaryInvitation({
    v: DIARY_FORMAT_VERSION,
    id: 'carediary01',
    template: 'care',
    title: template?.title,
    issuedAt: '2026-10-20T08:00:00.000Z',
    fields: template?.fields,
    planTitle: 'Лекарства',
    consent: true,
    ...parts,
  });
}

describe('care diary editor', () => {
  it('starts with the vitals preset and PHQ-9 and issues a valid invitation', () => {
    const draft = {
      ...emptyCareDraft(),
      items: [
        {
          name: 'Сертралин',
          dose: '50 мг',
          times: [
            { time: '20:00', meal: 'after' as const },
            { time: '20:00', meal: undefined },
          ],
          asNeeded: false,
          tip: 'Вечером, после ужина',
        },
      ],
      contacts: [{ kind: 'phone' as const, value: ' +7 900 000-00-00 ', label: '' }],
      crisis: 'Телефон клиники\n\n',
    };
    const invitation = issue(careInvitationParts(draft));
    expect(invitation.plan).toEqual([
      { id: 'p1', name: 'Сертралин', dose: '50 мг', times: [{ time: '20:00' }] },
    ]);
    expect(invitation.checkpoints?.map((checkpoint) => checkpoint.id)).toEqual([
      'am',
      'pm',
      'vitals',
      'q-phq-9',
    ]);
    expect(invitation.tips).toEqual([
      { id: expect.stringMatching(/^t-p1-/u), target: 'p1', text: 'Вечером, после ужина' },
    ]);
    expect(invitation.contacts).toEqual([{ kind: 'phone', value: '+7 900 000-00-00' }]);
    expect(invitation.crisis).toEqual(['Телефон клиники']);
  });

  it('keeps ids on re-issue and ends a removed medicine instead of dropping it', () => {
    const first = issue(
      careInvitationParts({
        ...emptyCareDraft(),
        items: [
          {
            name: 'А',
            dose: '',
            times: [{ time: '08:00', meal: undefined }],
            asNeeded: false,
            tip: '',
          },
          { name: 'Б', dose: '', times: [], asNeeded: true, tip: '' },
        ],
      }),
    );
    const draft = careDraftFrom(first);
    expect(draft.items.map((item) => item.id)).toEqual(['p1', 'p2']);
    const [, kept] = draft.items;
    if (!kept) throw new Error('The as-needed item is missing.');
    const second = issue(
      careInvitationParts(
        {
          ...draft,
          items: [
            kept,
            {
              name: 'В',
              dose: '',
              times: [{ time: '21:00', meal: undefined }],
              asNeeded: false,
              tip: '',
            },
          ],
          checks: { ...draft.checks, vitals: { on: false, time: '09:00' } },
        },
        first,
      ),
    );
    expect(second.plan?.map((item) => [item.id, item.name, item.ended === true])).toEqual([
      ['p2', 'Б', false],
      ['p3', 'В', false],
      ['p1', 'А', true],
    ]);
    expect(second.checkpoints?.find((checkpoint) => checkpoint.id === 'vitals')?.ended).toBe(true);
  });
});
