import { describe, expect, it, vi } from 'vitest';
import { atTime, dayKey, dayPlan } from '@/features/diary/diary-care';
import { careInvitation, emptyCareDraft, newCareSection } from '@/features/diary/diary-care-draft';
import { decodeDiaryResultsText, encodeDiaryResultsText } from '@/features/diary/diary-codec';
import { diaryToFhirBundle } from '@/features/diary/diary-fhir';
import {
  DIARY_FORMAT_VERSION,
  type DiaryPlanValue,
  describeDiaryEntry,
  parseDiaryEntry,
  parseDiaryResults,
} from '@/features/diary/diary-model';

const NOW = new Date(2026, 9, 21, 23, 0);
const invitation = (() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 20, 7, 0));
  try {
    return careInvitation({
      id: 'patient0000000000002',
      draft: {
        ...emptyCareDraft(),
        sections: [
          {
            ...newCareSection('drug'),
            title: 'Сертралин',
            dose: '50 мг',
            times: [{ time: '08:00', meal: 'after' }],
          },
          ...emptyCareDraft().sections.slice(1),
        ],
      },
      doctor: 'Д-р',
      note: '',
    });
  } finally {
    vi.useRealTimers();
  }
})();
const item = invitation.plan?.[0]?.id ?? '';

function mark(value: Record<string, unknown>, at = atTime('2026-10-21', '09:00')) {
  return parseDiaryEntry(
    invitation,
    { id: 'dose00000009', at, values: { medication: { item, slot: '08:00', ...value } } },
    NOW.getTime(),
  );
}

describe('why a dose was missed (DIARY22)', () => {
  it('keeps a known reason on a skipped mark and nowhere else', () => {
    expect(
      (mark({ done: false, reason: 'forgot' }).values['medication'] as DiaryPlanValue).reason,
    ).toBe('forgot');
    expect(
      (mark({ done: true, reason: 'forgot' }).values['medication'] as DiaryPlanValue).reason,
    ).toBeUndefined();
    // A reason this app does not know (a newer app's) is dropped; the mark still counts.
    const unknown = mark({ done: false, reason: 'abducted-by-aliens' });
    expect((unknown.values['medication'] as DiaryPlanValue).done).toBe(false);
    expect((unknown.values['medication'] as DiaryPlanValue).reason).toBeUndefined();
  });

  it('reads as the patient said it, in the day and in the doctor’s lines', () => {
    const entry = mark({ done: false, reason: 'side-effects' });
    expect(describeDiaryEntry(invitation, entry)).toContain('пропущено: плохо переносит');
    const plan = dayPlan(invitation, [entry], dayKey(entry.at), NOW);
    expect(plan.doses[0]?.state).toBe('skipped');
  });

  it('survives the QR text and goes to FHIR as the statement’s status reason', async () => {
    const results = parseDiaryResults(
      { v: DIARY_FORMAT_VERSION, invitation, entries: [mark({ done: false, reason: 'ran-out' })] },
      NOW.getTime(),
    );
    const back = await decodeDiaryResultsText(await encodeDiaryResultsText(results), NOW.getTime());
    expect(back.entries).toEqual(results.entries);
    const bundle = diaryToFhirBundle(results) as {
      entry: { resource: { resourceType: string; status?: string; statusReason?: unknown } }[];
    };
    const statement = bundle.entry.find(
      (one) => one.resource.resourceType === 'MedicationStatement',
    )?.resource;
    expect(statement?.status).toBe('not-taken');
    expect(statement?.statusReason).toEqual([{ text: 'Закончилось' }]);
  });
});
