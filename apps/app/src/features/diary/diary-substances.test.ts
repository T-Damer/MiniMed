import { describe, expect, it } from 'vitest';

import { chartSeries, DIARY_CHARTS } from '@/features/diary/dashboard/diary-charts';
import { exportRows } from '@/features/diary/dashboard/diary-insights';
import {
  dayKey,
  dayPlan,
  type HeatPart,
  heatmapDays,
  heatParts,
} from '@/features/diary/diary-care';
import {
  type CareDraft,
  type CareSectionDraft,
  careDraftFrom,
  careInvitation,
  emptyCareDraft,
  newCareSection,
} from '@/features/diary/diary-care-draft';
import { decodeDiaryResultsText, encodeDiaryResultsText } from '@/features/diary/diary-codec';
import { diaryToFhirBundle } from '@/features/diary/diary-fhir';
import {
  type DiaryInvitation,
  describeDiaryEntry,
  parseDiaryEntry,
  parseDiaryInvitation,
  parseDiaryResults,
} from '@/features/diary/diary-model';
import {
  amountText,
  pluralForm,
  SUBSTANCES,
  substanceByField,
  substanceDayScore,
  substanceFieldSet,
  substanceSummary,
} from '@/features/diary/diary-substances';
import { MEASUREMENT_LIMIT_LABEL, MEASUREMENT_LIMITS } from '@/state/assessment-limits';

const NOW = new Date(2026, 10, 3, 22, 0);

function use(next: Partial<CareSectionDraft> = {}): CareSectionDraft {
  return {
    ...newCareSection('use'),
    substances: ['alcohol', 'nicotine'],
    craving: true,
    ...next,
  };
}

function issue(sections: readonly CareSectionDraft[], previous?: DiaryInvitation): DiaryInvitation {
  const draft: CareDraft = { ...emptyCareDraft(), sections };
  return careInvitation({ id: 'carediary02', draft, doctor: '', note: '', previous });
}

const base = emptyCareDraft().sections.filter((section) => section.id === 'am');

function entry(invitation: DiaryInvitation, values: Record<string, unknown>, at = NOW) {
  return parseDiaryEntry(
    invitation,
    { id: `e${Math.abs(at.getTime() % 1e9)}`, at: at.toISOString(), check: 'use', values },
    NOW.getTime() + 60_000,
  );
}

describe('substance catalog', () => {
  it('declares unique ids and valid, short diary field ids', () => {
    expect(new Set(SUBSTANCES.map((substance) => substance.id)).size).toBe(SUBSTANCES.length);
    expect(new Set(SUBSTANCES.map((substance) => substance.field)).size).toBe(SUBSTANCES.length);
    for (const substance of SUBSTANCES) {
      expect(substance.field).toMatch(/^[a-z][a-z0-9-]{0,23}$/u);
      expect(substance.max).toBeGreaterThan(0);
      expect(substanceByField(substance.field)).toBe(substance);
    }
    expect(SUBSTANCES.find((substance) => substance.id === 'alcohol')?.hint).toMatch(
      /10 г спирта/u,
    );
  });

  it('counts in the right Russian form', () => {
    const alcohol = SUBSTANCES[0];
    const nicotine = SUBSTANCES[1];
    if (!alcohol || !nicotine) throw new Error('catalog is empty');
    expect([1, 2, 5, 11, 21, 22].map((count) => amountText(alcohol, count))).toEqual([
      '1 порция',
      '2 порции',
      '5 порций',
      '11 порций',
      '21 порция',
      '22 порции',
    ]);
    expect(amountText(nicotine, 12)).toBe('12 сигарет');
    expect(pluralForm(3, ['раз', 'раза', 'раз'])).toBe('раза');
  });
});

describe('use checkpoint in the diary model', () => {
  const fields = substanceFieldSet(['alcohol', 'other'], true);
  const raw = {
    v: 2,
    id: 'carediary01',
    template: 'care',
    title: 'Дневник лечения',
    issuedAt: '2026-10-01T09:00:00.000Z',
    fields: fields.fields,
    checkpoints: [{ id: 'use', kind: 'use', label: 'Употребление', fields: fields.ids }],
  };

  it('accepts counts, a craving score and a text, and keeps the order', () => {
    const invitation = parseDiaryInvitation(raw, NOW.getTime());
    expect(invitation.checkpoints?.[0]?.fields).toEqual([
      'u-alcohol',
      'u-other',
      'u-what',
      'craving',
    ]);
    const made = entry(invitation, {
      'u-alcohol': 2,
      'u-other': 1,
      'u-what': ' феназепам ',
      craving: 6,
    });
    expect(made.values).toEqual({
      'u-alcohol': 2,
      'u-other': 1,
      'u-what': 'феназепам',
      craving: 6,
    });
  });

  it('rejects fields the sheet cannot show, a missing count and a second section', () => {
    const flag = [...fields.fields, { id: 'u-flag', type: 'flag', label: 'Да' }];
    expect(() =>
      parseDiaryInvitation(
        {
          ...raw,
          fields: flag,
          checkpoints: [{ ...raw.checkpoints[0], fields: [...fields.ids, 'u-flag'] }],
        },
        NOW.getTime(),
      ),
    ).toThrow('не того вида');
    const noCeiling = fields.fields.map((field) =>
      field.id === 'u-alcohol' ? { id: field.id, type: 'count', label: field.label } : field,
    );
    expect(() => parseDiaryInvitation({ ...raw, fields: noCeiling }, NOW.getTime())).toThrow(
      'не того вида',
    );
    expect(() =>
      parseDiaryInvitation(
        { ...raw, checkpoints: [{ ...raw.checkpoints[0], fields: ['craving'] }] },
        NOW.getTime(),
      ),
    ).toThrow('хотя бы одно вещество');
    expect(() =>
      parseDiaryInvitation(
        {
          ...raw,
          checkpoints: [
            raw.checkpoints[0],
            { id: 'use2', kind: 'use', label: 'Ещё', fields: fields.ids },
          ],
        },
        NOW.getTime(),
      ),
    ).toThrow('только один');
    const ended = parseDiaryInvitation(
      {
        ...raw,
        checkpoints: [
          raw.checkpoints[0],
          { id: 'use2', kind: 'use', label: 'Ещё', fields: fields.ids, ended: true },
        ],
      },
      NOW.getTime(),
    );
    expect(ended.checkpoints).toHaveLength(2);
  });

  it('rejects bad amounts and an answer without values', () => {
    const invitation = parseDiaryInvitation(raw, NOW.getTime());
    expect(() => entry(invitation, { 'u-alcohol': -1 })).toThrow('целое число');
    expect(() => entry(invitation, { 'u-alcohol': 1.5 })).toThrow('целое число');
    expect(() => entry(invitation, { 'u-alcohol': 31 })).toThrow('вне диапазона');
    expect(() => entry(invitation, { craving: 11 })).toThrow('вне диапазона');
    expect(() => entry(invitation, { 'u-nicotine': 1 })).toThrow('неизвестное поле');
    expect(() => entry(invitation, {})).toThrow();
    expect(() =>
      parseDiaryEntry(
        invitation,
        {
          id: 'e0000000001',
          at: NOW.toISOString(),
          check: 'use',
          values: {},
          note: 'только слова',
        },
        NOW.getTime(),
      ),
    ).toThrow('«Ничего не было»');
  });
});

describe('texts for a day of use', () => {
  it('says «не было» for zeros and lists the amounts with the craving', () => {
    expect(substanceSummary({ 'u-alcohol': 0, 'u-nicotine': 0 })).toBe('не было');
    expect(substanceSummary({ 'u-alcohol': 0, craving: 3 })).toBe('не было · тяга 3');
    expect(substanceSummary({ 'u-alcohol': 2, 'u-nicotine': 5, craving: 6 })).toBe(
      'алкоголь 2 порции, никотин 5 сигарет · тяга 6',
    );
    expect(substanceSummary({ 'u-other': 1, 'u-what': 'феназепам\n10 мг' })).toBe(
      'препараты 1 раз (феназепам 10 мг)',
    );
    expect(substanceSummary({ mood: 4 })).toBe('');
  });

  it('reads well in the day timeline and the export', () => {
    const invitation = issue([...base, use()]);
    const made = entry(invitation, { 'u-alcohol': 2, 'u-nicotine': 0, craving: 6 });
    expect(describeDiaryEntry(invitation, made)).toBe('Употребление · алкоголь 2 порции · тяга 6');
    const none = entry(invitation, { 'u-alcohol': 0, 'u-nicotine': 0 }, new Date(2026, 10, 2, 22));
    expect(describeDiaryEntry(invitation, none)).toBe('Употребление · не было');
    const [row] = exportRows(invitation, [made]);
    expect(row).toMatchObject({
      kind: 'Отметка',
      what: 'Употребление',
      values: 'Употребление · алкоголь 2 порции · тяга 6',
    });
  });

  it('turns a day of use or a strong craving into a symptom score', () => {
    expect(substanceDayScore({ 'u-alcohol': 0 })).toBe(10);
    expect(substanceDayScore({ 'u-alcohol': 2 })).toBe(3);
    expect(substanceDayScore({ 'u-alcohol': 0, craving: 9 })).toBe(1);
    expect(substanceDayScore({ pulse: 70 })).toBeUndefined();
  });

  it('exports counts with their unit to FHIR', () => {
    const invitation = issue([...base, use()]);
    const results = parseDiaryResults(
      { v: 2, invitation, entries: [entry(invitation, { 'u-alcohol': 2, craving: 6 })] },
      NOW.getTime() + 60_000,
    );
    const bundle = diaryToFhirBundle(results, NOW) as {
      entry: {
        resource: { code: { text: string }; valueQuantity?: { value: number; unit: string } };
      }[];
    };
    const alcohol = bundle.entry.find((one) => one.resource.code.text === 'Алкоголь');
    expect(alcohol?.resource.valueQuantity).toEqual({ value: 2, unit: 'порций' });
  });
});

describe('the doctor edits the use section', () => {
  it('issues a use checkpoint with the chosen substances and the craving', () => {
    const invitation = issue([...base, use({ tip: 'Пишите честно' })]);
    const checkpoint = invitation.checkpoints?.find((one) => one.kind === 'use');
    expect(checkpoint).toEqual({
      id: 'use',
      kind: 'use',
      label: 'Употребление',
      times: ['21:00'],
      fields: ['u-alcohol', 'u-nicotine', 'craving'],
    });
    expect(invitation.tips?.find((tip) => tip.target === 'use')?.text).toBe('Пишите честно');
    expect(invitation.fields.find((field) => field.id === 'u-alcohol')).toMatchObject({
      type: 'count',
      min: 0,
      max: 30,
    });
  });

  it('round-trips draft → invitation → draft and ends removed substances as kept fields', () => {
    const first = issue([...base, use({ times: [{ time: '20:30', meal: undefined }] })]);
    const draft = careDraftFrom(first);
    const section = draft.sections.find((one) => one.kind === 'use');
    expect(section).toMatchObject({
      id: 'use',
      title: 'Употребление',
      substances: ['alcohol', 'nicotine'],
      craving: true,
      times: [{ time: '20:30' }],
    });
    if (!section) throw new Error('no use section');
    const second = issue(
      draft.sections.map((one) =>
        one.kind === 'use' ? { ...one, substances: ['nicotine', 'cannabis'], craving: false } : one,
      ),
      first,
    );
    const checkpoint = second.checkpoints?.find((one) => one.kind === 'use');
    expect(checkpoint?.id).toBe('use');
    expect(checkpoint?.fields).toEqual(['u-nicotine', 'u-cannabis']);
    // The alcohol amount and the craving are still defined: earlier answers resolve.
    expect(second.fields.map((field) => field.id)).toEqual(
      expect.arrayContaining(['u-alcohol', 'craving']),
    );
    const earlier = parseDiaryEntry(
      second,
      {
        id: 'e0000000002',
        at: NOW.toISOString(),
        check: 'use',
        values: { 'u-alcohol': 3, craving: 4 },
      },
      NOW.getTime(),
    );
    expect(earlier.values['u-alcohol']).toBe(3);
  });

  it('keeps the answers of a removed section and reactivates it with the same id', () => {
    const first = issue([...base, use()]);
    const without = issue(
      careDraftFrom(first).sections.filter((one) => one.kind !== 'use'),
      first,
    );
    const ended = without.checkpoints?.find((one) => one.id === 'use');
    expect(ended?.ended).toBe(true);
    expect(without.fields.some((field) => field.id === 'u-alcohol')).toBe(true);
    const again = issue([...careDraftFrom(without).sections, use()], without);
    const live = again.checkpoints?.filter((one) => one.kind === 'use');
    expect(live).toHaveLength(1);
    expect(live?.[0]?.ended).toBeUndefined();
  });

  it('leaves out a second section and refuses one with no substance', () => {
    const invitation = issue([...base, use(), use({ substances: ['cannabis'] })]);
    expect(invitation.checkpoints?.filter((one) => one.kind === 'use')).toHaveLength(1);
    expect(() => issue([use({ substances: [] })])).toThrow('хотя бы одно вещество');
  });

  it('asks «что именно» only with the medicines without a prescription', () => {
    const invitation = issue([...base, use({ substances: ['alcohol', 'other'], craving: false })]);
    expect(invitation.checkpoints?.find((one) => one.kind === 'use')?.fields).toEqual([
      'u-alcohol',
      'u-other',
      'u-what',
    ]);
    expect(
      careDraftFrom(invitation).sections.find((one) => one.kind === 'use')?.substances,
    ).toEqual(['alcohol', 'other']);
  });
});

describe('codec and the day plan', () => {
  const invitation = issue([...base, use({ substances: ['alcohol', 'other'] })]);
  const day = new Date(2026, 10, 3, 21, 10);
  const entries = [
    entry(invitation, { 'u-alcohol': 2, 'u-other': 1, 'u-what': 'феназепам', craving: 8 }, day),
    entry(invitation, { 'u-alcohol': 0, 'u-other': 0, craving: 1 }, new Date(2026, 10, 2, 21, 5)),
  ];

  it('round-trips through the QR text', async () => {
    const results = parseDiaryResults({ v: 2, invitation, entries }, NOW.getTime() + 60_000);
    const text = await encodeDiaryResultsText(results);
    const back = await decodeDiaryResultsText(text, NOW.getTime() + 60_000);
    expect(back.entries).toEqual(results.entries);
    expect(back.invitation.checkpoints?.find((one) => one.kind === 'use')?.fields).toEqual([
      'u-alcohol',
      'u-other',
      'u-what',
      'craving',
    ]);
  });

  it('plans the row by its time and counts it as marked', () => {
    const plan = dayPlan(invitation, entries, dayKey(day), NOW);
    const row = plan.checks.find((task) => task.checkpoint.kind === 'use');
    expect(row?.time).toBe('21:00');
    expect(row?.state).toBe('done');
    expect(heatParts(invitation)).toContain('substances');
  });

  it('tints a day of use or craving red on the calendar and respects the filter', () => {
    const from = dayKey(new Date(2026, 10, 2));
    const days = heatmapDays(invitation, entries, from, dayKey(day), NOW);
    // A craving of 8 with use scores 2 on the wellbeing scale: level 2.
    expect(days.map((one) => one.symptoms)).toEqual([0, 2]);
    const only = heatmapDays(
      invitation,
      entries,
      from,
      dayKey(day),
      NOW,
      new Set<HeatPart>(['doses']),
    );
    expect(only.map((one) => one.symptoms)).toEqual([0, 0]);
  });
});

describe('charts of use', () => {
  it('declares a craving chart with a red line above 7 and a chart per substance', () => {
    expect(MEASUREMENT_LIMITS['craving']).toEqual({ value: 7, direction: 'above' });
    expect(new Set(DIARY_CHARTS.map((chart) => chart.id)).size).toBe(DIARY_CHARTS.length);
    const craving = DIARY_CHARTS.find((chart) => chart.id === 'craving');
    expect(craving?.max).toBe(10);
    for (const substance of SUBSTANCES) {
      const chart = DIARY_CHARTS.find((one) => one.id === `use-${substance.id}`);
      expect(chart?.series[0]?.field).toBe(substance.field);
      expect(chart?.daily).toBe(true);
      expect(MEASUREMENT_LIMIT_LABEL[substance.field]).toBe(substance.label);
    }
  });

  it('shows the charts of what the patient marked, zeros included', () => {
    const invitation = issue([...base, use()]);
    const entries = [
      entry(invitation, { 'u-alcohol': 0, 'u-nicotine': 5, craving: 2 }, new Date(2026, 10, 2, 21)),
      entry(invitation, { 'u-alcohol': 3, 'u-nicotine': 0, craving: 8 }, new Date(2026, 10, 3, 21)),
    ];
    const shown = DIARY_CHARTS.filter((chart) => chartSeries(chart, entries).length).map(
      (chart) => chart.id,
    );
    expect(shown).toEqual(['craving', 'use-alcohol', 'use-nicotine']);
    const alcohol = DIARY_CHARTS.find((chart) => chart.id === 'use-alcohol');
    if (!alcohol) throw new Error('no alcohol chart');
    expect(chartSeries(alcohol, entries)[0]?.points.map((point) => point.value)).toEqual([0, 3]);
  });
});
