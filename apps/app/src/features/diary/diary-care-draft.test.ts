import { describe, expect, it } from 'vitest';

import {
  type CareDraft,
  type CareSectionDraft,
  careDraftFrom,
  careInvitation,
  emptyCareDraft,
  newCareSection,
} from '@/features/diary/diary-care-draft';
import { parseDiaryEntry } from '@/features/diary/diary-model';

function drug(next: Partial<CareSectionDraft>): CareSectionDraft {
  return { ...newCareSection('drug'), ...next };
}

function issue(draft: CareDraft, previous?: Parameters<typeof careInvitation>[0]['previous']) {
  return careInvitation({ id: 'carediary01', draft, doctor: 'Д-р', note: '', previous });
}

describe('care diary editor', () => {
  it('starts with wellbeing, vitals and PHQ-9 and issues a medicine recipe', () => {
    const base = emptyCareDraft();
    const draft: CareDraft = {
      ...base,
      sections: [
        drug({
          title: 'Сертралин',
          form: 'таблетки',
          dose: '50 мг',
          signa: 'По 1 таблетке вечером',
          times: [
            { time: '20:00', meal: 'after' },
            { time: '20:00', meal: undefined },
          ],
          course: [{ from: '2026-10-20', to: '2026-11-02' }],
          tip: 'Вечером, после ужина',
        }),
        ...base.sections.slice(1),
      ],
      contacts: [{ kind: 'phone', value: ' +7 900 000-00-00 ', label: '' }],
      crisis: 'Телефон клиники\n\n',
    };
    const invitation = issue(draft);
    expect(invitation.plan).toEqual([
      {
        id: 'p1',
        name: 'Сертралин',
        form: 'таблетки',
        dose: '50 мг',
        signa: 'По 1 таблетке вечером',
        course: [{ from: '2026-10-20', to: '2026-11-02' }],
        times: [{ time: '20:00' }],
      },
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

  it('turns a description and a choice into their own fields the patient can answer', () => {
    const invitation = issue({
      ...emptyCareDraft(),
      sections: [
        { ...newCareSection('text'), title: 'Как прошёл день' },
        { ...newCareSection('choice'), title: 'Сон', options: ['хорошо', ' плохо ', 'хорошо'] },
      ],
    });
    expect(invitation.plan).toBeUndefined();
    expect(invitation.checkpoints).toEqual([
      { id: 'd-1', kind: 'text', label: 'Как прошёл день', times: ['21:00'], fields: ['d-1'] },
      { id: 'c-1', kind: 'choice', label: 'Сон', times: ['09:00'], fields: ['c-1'] },
    ]);
    expect(invitation.fields.find((field) => field.id === 'c-1')?.options).toEqual([
      'хорошо',
      'плохо',
    ]);
    const entry = parseDiaryEntry(invitation, {
      id: 'entry000001',
      at: new Date().toISOString(),
      check: 'c-1',
      values: { 'c-1': 'плохо' },
    });
    expect(entry.values['c-1']).toBe('плохо');
  });

  it('keeps ids on re-issue and ends removed sections instead of dropping them', () => {
    const first = issue({
      ...emptyCareDraft(),
      sections: [
        drug({ title: 'А' }),
        drug({ title: 'Б', asNeeded: true }),
        { ...newCareSection('choice'), title: 'Сон', options: ['хорошо', 'плохо'] },
        ...emptyCareDraft().sections.slice(1),
      ],
    });
    const draft = careDraftFrom(first);
    expect(draft.sections.map((section) => section.id)).toEqual([
      'p1',
      'p2',
      'c-1',
      'am',
      'pm',
      'vitals',
      'q-phq-9',
    ]);
    const [, kept, choice, ...checks] = draft.sections;
    if (!kept || !choice) throw new Error('Sections are missing.');
    const second = issue(
      {
        ...draft,
        sections: [
          kept,
          drug({ title: 'В', times: [{ time: '21:00', meal: undefined }] }),
          // A lost variant gets a new id: earlier answers keep the old field.
          { ...choice, options: ['хорошо', 'беспокойно'] },
          ...checks.filter((section) => section.id !== 'vitals'),
        ],
      },
      first,
    );
    expect(second.plan?.map((item) => [item.id, item.name, item.ended === true])).toEqual([
      ['p2', 'Б', false],
      ['p3', 'В', false],
      ['p1', 'А', true],
    ]);
    const ended = (id: string) =>
      second.checkpoints?.find((checkpoint) => checkpoint.id === id)?.ended === true;
    expect(ended('vitals')).toBe(true);
    expect(ended('c-1')).toBe(true);
    expect(ended('c-2')).toBe(false);
    expect(second.fields.find((field) => field.id === 'c-1')?.options).toEqual(['хорошо', 'плохо']);
  });

  it('refuses a diary without any section and a choice with one variant', () => {
    expect(() => issue({ ...emptyCareDraft(), sections: [] })).toThrow('хотя бы один раздел');
    expect(() =>
      issue({
        ...emptyCareDraft(),
        sections: [{ ...newCareSection('choice'), options: ['да'] }],
      }),
    ).toThrow('два варианта');
  });
});
