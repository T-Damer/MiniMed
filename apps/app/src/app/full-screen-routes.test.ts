import { describe, expect, it } from 'vitest';

import { isFullScreenRoute } from '@/app/full-screen-routes';

describe('full-screen routes', () => {
  it('covers adding a patient, the patient view and a day view', () => {
    expect(isFullScreenRoute('#/notes/diaries/new')).toBe(true);
    expect(isFullScreenRoute('#/notes/diaries/e11at7ahxmirmi6ytp0d/screen')).toBe(true);
    expect(isFullScreenRoute('#/notes/diaries/e11at7ahxmirmi6ytp0d/day/2026-10-27?x=1')).toBe(true);
  });

  it('keeps the bar on lists and patient pages', () => {
    expect(isFullScreenRoute('#/notes/diaries')).toBe(false);
    expect(isFullScreenRoute('#/notes/diaries/e11at7ahxmirmi6ytp0d')).toBe(false);
  });
});
