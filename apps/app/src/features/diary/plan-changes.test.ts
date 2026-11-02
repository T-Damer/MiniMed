import { describe, expect, it } from 'vitest';

import {
  DIARY_FORMAT_VERSION,
  type DiaryInvitation,
  diaryTemplate,
  parseDiaryInvitation,
} from '@/features/diary/diary-model';
import { MAX_PLAN_CHANGE_LINES, mergePlanChange, planChanges } from '@/features/diary/plan-changes';

const NOW = Date.parse('2026-11-02T09:00:00Z');

function diary(overrides: Record<string, unknown> = {}): DiaryInvitation {
  const template = diaryTemplate('care');
  return parseDiaryInvitation(
    {
      v: DIARY_FORMAT_VERSION,
      id: 'planchanges1',
      template: 'care',
      title: template?.title,
      issuedAt: '2026-11-01T09:00:00.000Z',
      fields: template?.fields,
      plan: [
        { id: 'p1', name: 'Сертралин', dose: '50 мг', times: [{ time: '08:00' }] },
        { id: 'p2', name: 'Гидроксизин', dose: '25 мг', asNeeded: true },
      ],
      ...overrides,
    },
    NOW,
  );
}

describe('what a new plan changed, in the patient’s words', () => {
  it('names a new dose, a new time, a new medicine and a cancelled one', () => {
    const before = diary();
    const after = diary({
      issuedAt: '2026-11-02T09:00:00.000Z',
      plan: [
        {
          id: 'p1',
          name: 'Сертралин',
          dose: '100 мг',
          times: [{ time: '08:00' }, { time: '20:00', meal: 'after' }],
        },
        { id: 'p2', name: 'Гидроксизин', dose: '25 мг', asNeeded: true, ended: true },
        { id: 'p3', name: 'Кветиапин', dose: '25 мг', times: [{ time: '22:00' }] },
      ],
    });
    expect(planChanges(before, after)).toEqual([
      'Сертралин: 50 мг → 100 мг',
      'Сертралин: приём 08:00, 20:00 после еды',
      'Отменено: Гидроксизин',
      'Новое: Кветиапин 25 мг',
    ]);
  });

  it('tells a medicine dropped from the plan and a new course end', () => {
    const before = diary();
    const after = diary({
      plan: [
        {
          id: 'p1',
          name: 'Сертралин',
          dose: '50 мг',
          times: [{ time: '08:00' }],
          course: [{ from: '2026-11-01', to: '2026-11-30' }],
        },
      ],
    });
    expect(planChanges(before, after)).toEqual([
      'Сертралин: курс 01.11–30.11',
      'Отменено: Гидроксизин',
    ]);
  });

  it('says nothing for a re-issue or a tip-only change', () => {
    const before = diary();
    expect(planChanges(before, diary({ issuedAt: '2026-11-02T10:00:00.000Z' }))).toEqual([]);
    expect(
      planChanges(before, diary({ tips: [{ id: 't1', target: 'p1', text: 'Утром, после еды' }] })),
    ).toEqual([]);
  });

  it('notices a new contact list and a new note from the doctor', () => {
    const after = diary({
      note: 'Звоните, если станет хуже',
      contacts: [{ kind: 'phone', label: 'Врач', value: '+79001234567' }],
    });
    expect(planChanges(diary(), after)).toEqual([
      'Новая заметка врача',
      'Контакты врача обновлены',
    ]);
  });
});

describe('keeping a plan change until the patient closes it', () => {
  it('adds new lines after the open ones, once each, newest kept', () => {
    const first = mergePlanChange(undefined, ['А', 'Б'], '2026-11-02T09:00:00.000Z');
    expect(first).toEqual({ at: '2026-11-02T09:00:00.000Z', lines: ['А', 'Б'] });
    const second = mergePlanChange(first, ['Б', 'В'], '2026-11-02T10:00:00.000Z');
    expect(second).toEqual({ at: '2026-11-02T10:00:00.000Z', lines: ['А', 'Б', 'В'] });
    expect(mergePlanChange(second, [], '2026-11-02T11:00:00.000Z')).toBe(second);
    const many = Array.from({ length: MAX_PLAN_CHANGE_LINES + 3 }, (_, index) => `строка ${index}`);
    expect(mergePlanChange(undefined, many, '2026-11-02T12:00:00.000Z')?.lines).toEqual(
      many.slice(-MAX_PLAN_CHANGE_LINES),
    );
  });
});
