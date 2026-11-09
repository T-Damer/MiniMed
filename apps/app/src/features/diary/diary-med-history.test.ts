import { describe, expect, it } from 'vitest';

import {
  applyRevisions,
  EMPTY_REPLICA,
  replicaResults,
} from '@/features/diary/connected/diary-replica';
import { diaryToFhirBundle } from '@/features/diary/diary-fhir';
import {
  draftOf,
  emptyPastMedDraft,
  isPastMedWhen,
  mergePastMedications,
  newPastMedId,
  type PastMedication,
  parsePastMedication,
  parsePastMedications,
  parseWhenInput,
  pastMedConcern,
  pastMedFromDraft,
  pastMedPeriod,
  prescribingWarnings,
  sortPastMedications,
  whenInputText,
  withMedHistory,
} from '@/features/diary/diary-med-history';
import { mergeResults } from '@/features/diary/diary-merge';
import {
  DIARY_FORMAT_VERSION,
  type DiaryInvitation,
  type DiaryResults,
  diaryTemplate,
  parseDiaryResults,
} from '@/features/diary/diary-model';
import { diaryPrintHtml } from '@/features/diary/diary-print';
import {
  draftFromRemoval,
  offeredRemovals,
  planRemovals,
} from '@/features/diary/med-history/plan-removals';

const TODAY = new Date(2026, 10, 9, 12);

function withoutKey(
  item: PastMedication,
  key: keyof PastMedication,
  patch: Partial<PastMedication> = {},
): PastMedication {
  const copy: Record<string, unknown> = { ...item, ...patch };
  delete copy[key];
  return copy as unknown as PastMedication;
}

const amoxicillin: PastMedication = {
  id: 'amox0001',
  name: 'Амоксициллин',
  atc: ['J01CA04'],
  from: '2020',
  to: '2020',
  approx: true,
  stop: 'intolerance',
  reaction: 'Крапивница',
  severity: 'moderate',
  allergy: 'yes',
  by: 'doctor',
  updatedAt: '2026-11-01T10:00:00.000Z',
};

const fluoxetine: PastMedication = {
  id: 'flu00001',
  name: 'Флуоксетин',
  atc: ['N06AB03'],
  dose: '20 мг',
  from: '2023-03',
  duration: 'около года',
  stop: 'ineffective',
  effect: 'no',
  by: 'patient',
  updatedAt: '2026-11-02T10:00:00.000Z',
};

const paroxetine: PastMedication = {
  id: 'parox001',
  name: 'Пароксетин',
  atc: ['N06AB05'],
  stop: 'side-effects',
  reaction: 'Тошнота',
  severity: 'mild',
  by: 'carer',
  updatedAt: '2026-11-03T10:00:00.000Z',
};

const template = diaryTemplate('care');
const invitation = {
  v: DIARY_FORMAT_VERSION,
  id: 'patient0000000000001',
  template: 'care',
  title: template?.title,
  issuedAt: '2026-10-20T08:00:00.000Z',
  fields: template?.fields,
  plan: [{ id: 'p1', name: 'Сертралин', dose: '50 мг', times: [{ time: '08:00' }] }],
  planTitle: 'Лекарства',
} as unknown as DiaryInvitation;

describe('partial dates', () => {
  it('takes a year, a month or a day that has passed', () => {
    expect(isPastMedWhen('2022', TODAY)).toBe(true);
    expect(isPastMedWhen('2026-11', TODAY)).toBe(true);
    expect(isPastMedWhen('2026-11-09', TODAY)).toBe(true);
    expect(isPastMedWhen('2026-11-10', TODAY)).toBe(false);
    expect(isPastMedWhen('2027', TODAY)).toBe(false);
    expect(isPastMedWhen('2022-02-30', TODAY)).toBe(false);
    expect(isPastMedWhen('2022-13', TODAY)).toBe(false);
    expect(isPastMedWhen('1899', TODAY)).toBe(false);
  });

  it('reads what the patient types and writes it back the same way', () => {
    expect(parseWhenInput('2022', TODAY)).toBe('2022');
    expect(parseWhenInput('3.2022', TODAY)).toBe('2022-03');
    expect(parseWhenInput('14.03.2022', TODAY)).toBe('2022-03-14');
    expect(parseWhenInput('14/3/2022', TODAY)).toBe('2022-03-14');
    expect(parseWhenInput('  ', TODAY)).toBe('');
    expect(parseWhenInput('весной', TODAY)).toBeUndefined();
    expect(parseWhenInput('31.02.2022', TODAY)).toBeUndefined();
    expect(whenInputText('2022-03')).toBe('03.2022');
    expect(whenInputText('2022-03-14')).toBe('14.03.2022');
    expect(whenInputText(undefined)).toBe('');
  });

  it('words a period', () => {
    expect(pastMedPeriod(amoxicillin)).toBe('≈ 2020');
    expect(pastMedPeriod(fluoxetine)).toBe('с марта 2023, около года');
    expect(pastMedPeriod(withoutKey(fluoxetine, 'from', { to: '2024-05-02' }))).toBe(
      'до 02.05.2024, около года',
    );
  });
});

describe('a medicine from another device', () => {
  it('keeps what is valid and refuses the rest', () => {
    expect(parsePastMedication(amoxicillin, TODAY)).toEqual(amoxicillin);
    expect(() => parsePastMedication({ ...amoxicillin, id: 'BAD ID' }, TODAY)).toThrow();
    expect(() => parsePastMedication({ ...amoxicillin, name: ' ' }, TODAY)).toThrow();
    expect(() => parsePastMedication({ ...amoxicillin, atc: ['x'] }, TODAY)).toThrow();
    expect(() =>
      parsePastMedication({ ...amoxicillin, from: '2021', to: '2020' }, TODAY),
    ).toThrow();
    expect(() => parsePastMedication({ ...amoxicillin, severity: 'awful' }, TODAY)).toThrow();
    expect(() => parsePastMedication({ ...amoxicillin, by: undefined }, TODAY)).toThrow();
    expect(() => parsePastMedication({ ...amoxicillin, note: 'x'.repeat(1001) }, TODAY)).toThrow();
  });

  it('accepts a month inside the year it ends', () => {
    expect(parsePastMedication({ ...fluoxetine, to: '2023' }, TODAY).to).toBe('2023');
  });

  it('reads a list: bad ones out, one id keeps its newest version', () => {
    const older = { ...fluoxetine, dose: '10 мг', updatedAt: '2026-10-01T00:00:00.000Z' };
    const list = parsePastMedications([older, fluoxetine, { id: 'x' }, amoxicillin]);
    expect(list.map((item) => item.id)).toEqual(['amox0001', 'flu00001']);
    expect(list[1]?.dose).toBe('20 мг');
  });
});

describe('what matters to the doctor', () => {
  it('ranks allergies, then intolerance, then side effects, then the rest', () => {
    expect(pastMedConcern(amoxicillin)).toBe('allergy');
    expect(pastMedConcern({ ...amoxicillin, allergy: 'no' })).toBe('intolerance');
    expect(pastMedConcern(paroxetine)).toBe('side-effects');
    expect(pastMedConcern(fluoxetine)).toBeUndefined();
    expect(
      sortPastMedications([fluoxetine, paroxetine, amoxicillin]).map((item) => item.id),
    ).toEqual(['amox0001', 'parox001', 'flu00001']);
  });

  it('warns about the same medicine and the same ATC level-4 group, only with a reaction', () => {
    const history = [amoxicillin, paroxetine, fluoxetine];
    const same = prescribingWarnings(history, { name: 'Амоксициллин', atc: ['J01CA04'] });
    expect(same).toEqual([
      { item: amoxicillin, concern: 'allergy', match: 'same', code: 'J01CA04' },
    ]);
    const group = prescribingWarnings(history, { name: 'Ампициллин', atc: ['J01CA01'] });
    expect(group).toEqual([
      { item: amoxicillin, concern: 'allergy', match: 'group', code: 'J01CA' },
    ]);
    // Sertraline shares N06AB with paroxetine (a reaction) and fluoxetine (none): one warning.
    const ssri = prescribingWarnings(history, { name: 'Сертралин', atc: ['N06AB06'] });
    expect(ssri.map((warning) => [warning.item.id, warning.match])).toEqual([
      ['parox001', 'group'],
    ]);
    // Own words without codes match by name only (ё = е, case ignored).
    expect(
      prescribingWarnings([withoutKey(paroxetine, 'atc')], {
        name: 'пароксетин',
      }),
    ).toHaveLength(1);
    expect(prescribingWarnings(history, { name: 'Кветиапин', atc: ['N05AH04'] })).toEqual([]);
    expect(prescribingWarnings(history, { name: '' })).toEqual([]);
  });
});

describe('the editor draft', () => {
  it('turns into a medicine signed by its author, and back', () => {
    const now = new Date('2026-11-09T09:00:00.000Z');
    const result = pastMedFromDraft(draftOf(amoxicillin), 'doctor', now);
    expect(result).toEqual({ ok: true, value: { ...amoxicillin, updatedAt: now.toISOString() } });
  });

  it('names the first thing to fix', () => {
    const draft = emptyPastMedDraft('abcd1234');
    expect(pastMedFromDraft(draft, 'patient', TODAY)).toEqual({
      ok: false,
      error: { kind: 'no-name' },
    });
    const named = { ...draft, name: 'Лоратадин' };
    expect(pastMedFromDraft({ ...named, fromText: 'весной' }, 'patient', TODAY)).toMatchObject({
      error: { kind: 'bad-from' },
    });
    expect(pastMedFromDraft({ ...named, toText: '2030' }, 'patient', TODAY)).toMatchObject({
      error: { kind: 'bad-to' },
    });
    expect(
      pastMedFromDraft({ ...named, fromText: '2023', toText: '2022' }, 'patient', TODAY),
    ).toMatchObject({ error: { kind: 'from-after-to' } });
  });

  it('drops «примерно» without dates and the other reason without «другая причина»', () => {
    const draft = {
      ...emptyPastMedDraft('abcd1234'),
      name: 'Лоратадин',
      approx: true,
      stop: 'ineffective' as const,
      stopNote: 'дорого',
    };
    const result = pastMedFromDraft(draft, 'patient', TODAY);
    expect(result.ok && result.value.approx).toBeFalsy();
    expect(result.ok && result.value.stopNote).toBeFalsy();
  });

  it('makes ids that fit a record id', () => {
    const id = newPastMedId();
    expect(id).toMatch(/^[a-z0-9]{4,32}$/u);
    expect(newPastMedId()).not.toBe(id);
  });
});

describe('the list inside a diary', () => {
  const results: DiaryResults = { v: DIARY_FORMAT_VERSION, invitation, entries: [] };

  it('survives a save and a read, and is left out when empty', () => {
    const saved = withMedHistory(results, [fluoxetine, amoxicillin]);
    const read = parseDiaryResults(JSON.parse(JSON.stringify(saved)));
    expect(read.medHistory?.map((item) => item.id)).toEqual(['amox0001', 'flu00001']);
    expect('medHistory' in withMedHistory(saved, [])).toBe(false);
  });

  it('merges two copies by id, the newer version winning', () => {
    const edited = { ...fluoxetine, dose: '40 мг', updatedAt: '2026-11-05T00:00:00.000Z' };
    expect(
      mergePastMedications([fluoxetine], [edited, amoxicillin]).map((item) => item.dose),
    ).toEqual([undefined, '40 мг']);
    const merged = mergeResults(
      withMedHistory(results, [fluoxetine]),
      withMedHistory(results, [amoxicillin]),
    );
    expect(merged.results.medHistory?.map((item) => item.id)).toEqual(['amox0001', 'flu00001']);
  });

  it('is printed after the plan, allergies first and marked', () => {
    const html = diaryPrintHtml(invitation, [], 0, {
      medHistory: sortPastMedications([fluoxetine, amoxicillin]),
      patient: 'Лиса',
    });
    expect(html).toContain('<h2>Лекарства раньше</h2>');
    expect(html).toContain('Пациент: Лиса');
    expect(html.indexOf('Амоксициллин')).toBeLessThan(html.indexOf('Флуоксетин'));
    expect(html).toContain('<tr class="concern"><td><strong>Амоксициллин');
    expect(html).toContain('тяжесть: средняя');
    expect(diaryPrintHtml(invitation, [], 0)).not.toContain('Лекарства раньше');
  });

  it('is exported to FHIR as statements, and an allergy also as an AllergyIntolerance', () => {
    const bundle = diaryToFhirBundle(withMedHistory(results, [amoxicillin, fluoxetine])) as {
      entry: { resource: Record<string, unknown> }[];
    };
    const resources = bundle.entry.map((entry) => entry.resource);
    const statement = resources.find(
      (resource) => resource['id'] === `${invitation.id}-h-amox0001`,
    );
    expect(statement).toMatchObject({
      resourceType: 'MedicationStatement',
      status: 'stopped',
      statusReason: [{ text: 'Непереносимость' }],
      medicationCodeableConcept: {
        text: 'Амоксициллин',
        coding: [{ system: 'http://www.whocc.no/atc', code: 'J01CA04' }],
      },
      effectivePeriod: { start: '2020', end: '2020' },
    });
    expect(
      resources.find((resource) => resource['id'] === `${invitation.id}-a-amox0001`),
    ).toMatchObject({
      resourceType: 'AllergyIntolerance',
      type: 'allergy',
      category: ['medication'],
      verificationStatus: { coding: [{ code: 'unconfirmed' }] },
      reaction: [{ manifestation: [{ text: 'Крапивница' }], severity: 'moderate' }],
    });
    expect(resources.some((resource) => resource['id'] === `${invitation.id}-a-flu00001`)).toBe(
      false,
    );
  });
});

describe('the connected diary', () => {
  const plan = {
    id: 'plan',
    rev: 1,
    author: 'd:doctor0000001',
    at: '2026-10-20T08:00:00.000Z',
    payload: { kind: 'plan', invitation },
  };

  it('reads medicines from the phone and the doctor, and a deletion', () => {
    const replica = applyRevisions(EMPTY_REPLICA, [
      plan,
      {
        id: 'h-flu00001',
        rev: 1,
        author: 'p:phone00000001',
        at: 't',
        payload: { kind: 'past-med', item: fluoxetine },
      },
      {
        id: 'h-amox0001',
        rev: 1,
        author: 'd:doctor0000001',
        at: 't',
        payload: { kind: 'past-med', item: amoxicillin },
      },
    ]);
    expect(replicaResults(replica)?.medHistory?.map((item) => item.id)).toEqual([
      'amox0001',
      'flu00001',
    ]);
    const after = applyRevisions(replica, [
      {
        id: 'h-flu00001',
        rev: 2,
        author: 'd:doctor0000001',
        at: 't',
        payload: { kind: 'deleted' },
      },
    ]);
    expect(replicaResults(after)?.medHistory?.map((item) => item.id)).toEqual(['amox0001']);
  });

  it('refuses a medicine whose author does not match the writer or the key', () => {
    const replica = applyRevisions(EMPTY_REPLICA, [
      plan,
      {
        id: 'h-flu00001',
        rev: 1,
        author: 'p:phone00000001',
        at: 't',
        payload: { kind: 'past-med', item: { ...fluoxetine, by: 'doctor' } },
      },
      {
        id: 'h-other001',
        rev: 1,
        author: 'p:phone00000001',
        at: 't',
        payload: { kind: 'past-med', item: fluoxetine },
      },
    ]);
    expect(replicaResults(replica)?.medHistory).toBeUndefined();
    expect(replica.rejected).toBe(2);
  });
});

describe('from the plan to the history', () => {
  const version = (at: string, plan: DiaryInvitation['plan']) => ({
    at,
    invitation: { ...invitation, plan } as DiaryInvitation,
  });
  const sertraline = { id: 'p1', name: 'Сертралин', dose: '50 мг' };
  const quetiapine = { id: 'p2', name: 'Кветиапин', dose: '25 мг' };

  it('finds what the newest plan took off, ended or gone', () => {
    const removals = planRemovals([
      version('2026-09-01T09:00:00', [sertraline, quetiapine]),
      version('2026-10-01T09:00:00', [sertraline, { ...quetiapine, ended: true }]),
      version('2026-11-01T09:00:00', []),
    ]);
    expect(removals.map((removal) => [removal.item.id, removal.since, removal.removedOn])).toEqual([
      ['p2', '2026-09-01', '2026-10-01'],
      ['p1', '2026-09-01', '2026-11-01'],
    ]);
  });

  it('forgets a medicine put back on the plan', () => {
    const removals = planRemovals([
      version('2026-09-01T09:00:00', [sertraline]),
      version('2026-10-01T09:00:00', []),
      version('2026-10-02T09:00:00', [sertraline]),
    ]);
    expect(removals).toEqual([]);
  });

  it('offers only recent ones not moved or put aside, filled in', () => {
    const removals = planRemovals([
      version('2026-06-01T09:00:00', [sertraline, quetiapine]),
      version('2026-07-01T09:00:00', [quetiapine]),
      version('2026-11-01T09:00:00', []),
    ]);
    expect(offeredRemovals(removals, [], new Set(), TODAY).map((r) => r.item.id)).toEqual(['p2']);
    expect(
      offeredRemovals(removals, [{ ...fluoxetine, planItem: 'p2' }], new Set(), TODAY),
    ).toEqual([]);
    expect(offeredRemovals(removals, [], new Set(['p2']), TODAY)).toEqual([]);
    const draft = draftFromRemoval(removals[1] as (typeof removals)[number]);
    expect(draft).toMatchObject({
      name: 'Кветиапин',
      dose: '25 мг',
      fromText: '01.06.2026',
      toText: '01.11.2026',
      planItem: 'p2',
    });
  });
});
