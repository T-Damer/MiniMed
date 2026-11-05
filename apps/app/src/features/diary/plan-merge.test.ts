import { describe, expect, it } from 'vitest';

import type { DiaryPlanRevision } from '@/features/diary/connected/diary-replica';
import {
  DIARY_FORMAT_VERSION,
  type DiaryInvitation,
  diaryTemplate,
  parseDiaryInvitation,
} from '@/features/diary/diary-model';
import { planEditDays, planEdits, planOn } from '@/features/diary/plan-history';
import { mergeInvitations } from '@/features/diary/plan-merge';

const NOW = Date.parse('2026-11-02T09:00:00Z');

function diary(overrides: Record<string, unknown> = {}): DiaryInvitation {
  const template = diaryTemplate('care');
  return parseDiaryInvitation(
    {
      v: DIARY_FORMAT_VERSION,
      id: 'planmerge001',
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

const SERTRALINE = { id: 'p1', name: 'Сертралин', dose: '50 мг', times: [{ time: '08:00' }] };
const HYDROXYZINE = { id: 'p2', name: 'Гидроксизин', dose: '25 мг', asNeeded: true };

describe('two doctors saving one plan', () => {
  it('keeps both doctors’ changes when they touched different things', () => {
    const base = diary();
    const theirs = diary({
      plan: [{ ...SERTRALINE, dose: '100 мг' }, HYDROXYZINE],
      tips: [{ id: 't1', target: 'p1', text: 'Утром после еды' }],
    });
    const mine = diary({
      plan: [
        SERTRALINE,
        HYDROXYZINE,
        { id: 'p3', name: 'Кветиапин', dose: '25 мг', times: [{ time: '22:00' }] },
      ],
      note: 'Контроль через неделю',
    });
    const merged = mergeInvitations(base, mine, theirs);
    expect(merged.conflicts).toEqual([]);
    expect(merged.invitation.plan?.map((item) => [item.id, item.dose])).toEqual([
      ['p1', '100 мг'],
      ['p2', '25 мг'],
      ['p3', '25 мг'],
    ]);
    expect(merged.invitation.tips?.map((tip) => tip.id)).toEqual(['t1']);
    expect(merged.invitation.note).toBe('Контроль через неделю');
  });

  it('keeps a removal from either side and puts a new item where it was added', () => {
    const base = diary();
    const theirs = diary({ plan: [SERTRALINE] });
    const mine = diary({
      plan: [
        { id: 'p0', name: 'Мелатонин', dose: '3 мг', asNeeded: true },
        SERTRALINE,
        HYDROXYZINE,
      ],
    });
    expect(mergeInvitations(base, mine, theirs).invitation.plan?.map((item) => item.id)).toEqual([
      'p0',
      'p1',
    ]);
  });

  it('keeps the saving doctor’s version of a thing both changed, and names it', () => {
    const base = diary();
    const theirs = diary({ plan: [{ ...SERTRALINE, dose: '100 мг' }, HYDROXYZINE] });
    const mine = diary({ plan: [{ ...SERTRALINE, dose: '75 мг' }, HYDROXYZINE] });
    const merged = mergeInvitations(base, mine, theirs);
    expect(merged.invitation.plan?.[0]?.dose).toBe('75 мг');
    expect(merged.conflicts).toEqual(['Назначения: Сертралин']);
  });
});

function version(rev: number, at: string, invitation: DiaryInvitation): DiaryPlanRevision {
  return { rev, at, author: rev === 2 ? 'd:colleague' : 'd:me', invitation };
}

describe('plan versions on the calendar', () => {
  const first = diary();
  const second = diary({ plan: [{ ...SERTRALINE, dose: '100 мг' }, HYDROXYZINE] });
  const third = diary({
    plan: [{ ...SERTRALINE, dose: '100 мг' }, HYDROXYZINE],
    tips: [{ id: 't1', target: 'p1', text: 'После еды' }],
  });
  const history = [
    version(1, '2026-10-20T09:00:00.000Z', first),
    version(2, '2026-10-25T12:00:00.000Z', second),
    version(3, '2026-10-25T18:00:00.000Z', third),
    version(4, '2026-10-27T18:00:00.000Z', third),
  ];

  it('finds the version in force on a day', () => {
    expect(planOn(history, '2026-10-21', third).plan?.[0]?.dose).toBe('50 мг');
    expect(planOn(history, '2026-10-26', first).plan?.[0]?.dose).toBe('100 мг');
    expect(planOn(history, '2026-10-01', third)).toBe(first);
  });

  it('lists who changed what, leaving out a save that changed nothing', () => {
    const edits = planEdits(history);
    expect(edits.map((edit) => [edit.rev, edit.author, edit.lines])).toEqual([
      [1, 'd:me', ['Дневник начат']],
      [2, 'd:colleague', ['Сертралин: 50 мг → 100 мг']],
      [3, 'd:me', ['Новая подсказка: После еды']],
    ]);
    expect([...planEditDays(history).keys()]).toEqual(['2026-10-20', '2026-10-25']);
  });
});
