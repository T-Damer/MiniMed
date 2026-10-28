import { describe, expect, it } from 'vitest';

import { planNotice } from '@/features/diary/connected/doctor-workspace';
import type { DiaryInvitation } from '@/features/diary/diary-model';

const plan = {
  v: 2,
  id: 'carediary01',
  template: 'care',
  title: 'Дневник',
  issuedAt: '2026-10-20T08:00:00.000Z',
  fields: [],
  plan: [{ id: 'p1', name: 'Сертралин', times: [{ time: '08:00' }] }],
  tips: [{ id: 't1', target: 'p1', text: 'Запивайте водой' }],
} as unknown as DiaryInvitation;

describe('what a new plan tells the patient', () => {
  it('says «tip» only when the change adds tips and nothing else', () => {
    const withTip = {
      ...plan,
      issuedAt: '2026-10-21T08:00:00.000Z',
      tips: [...(plan.tips ?? []), { id: 't2', target: 'p1', text: 'Утром' }],
    };
    expect(planNotice(plan, withTip)).toBe('tip');
    expect(planNotice(plan, { ...withTip, title: 'Новый план' })).toBe('plan');
    expect(planNotice(plan, { ...plan, issuedAt: '2026-10-22T08:00:00.000Z' })).toBe('plan');
    expect(planNotice(undefined, plan)).toBe('plan');
  });
});
