import { describe, expect, it } from 'vitest';

import {
  cycleSymptom,
  mergeSkinDetails,
  patientSkinDetails,
  sanitizeSkinDetails,
  setDuration,
  setFitzpatrick,
  skinChipGroups,
  skinDetailsKey,
  skinDetailsLabels,
  symptomState,
  toggleSite,
  visibleDetailGroups,
} from '@/features/skin/skin-details';
import { encodeSkinDetails, SKIN_DETAILS_SIZE } from '@/features/skin/skin-model';

describe('progressive details', () => {
  it('shows one group until it is answered, then the next', () => {
    expect(visibleDetailGroups({})).toEqual(['sites']);
    expect(visibleDetailGroups({ sites: ['arm'] })).toEqual(['sites', 'duration']);
    expect(visibleDetailGroups({ sites: ['arm'], duration: 'gt_year' })).toEqual([
      'sites',
      'duration',
      'symptoms',
      'fitzpatrick',
    ]);
  });

  it('toggles sites in the model order and drops the key when none is left', () => {
    const first = toggleSite(toggleSite({}, 'foot'), 'arm');
    expect(first.sites).toEqual(['arm', 'foot']);
    expect(toggleSite(toggleSite(first, 'arm'), 'foot')).toEqual({});
  });

  it('sets and clears a duration and a skin type by tapping the same chip twice', () => {
    const picked = setDuration({}, '1_4_weeks');
    expect(picked.duration).toBe('1_4_weeks');
    expect(setDuration(picked, '1_4_weeks')).toEqual({});
    expect(setFitzpatrick(setFitzpatrick({}, 3), 3)).toEqual({});
    expect(setFitzpatrick(setFitzpatrick({}, 3), 4).fitzpatrick).toBe(4);
  });

  it('cycles a symptom through present, absent and not asked', () => {
    const present = cycleSymptom({}, 'itch');
    expect(symptomState(present, 'itch')).toBe('present');
    const absent = cycleSymptom(present, 'itch');
    expect(symptomState(absent, 'itch')).toBe('absent');
    expect(absent.symptoms).toEqual({ itch: false });
    const unknown = cycleSymptom(absent, 'itch');
    expect(symptomState(unknown, 'itch')).toBe('unknown');
    expect(unknown).toEqual({});
  });
});

describe('details from the patient card', () => {
  it('buckets the age on the day and takes a binary sex', () => {
    expect(
      patientSkinDetails({ birthDate: '1980-03-04', biologicalSex: 'female' }, '2026-10-29'),
    ).toEqual({ age: '40_49', sex: 'female' });
    expect(patientSkinDetails({ birthDate: '2015-03-04' }, '2026-10-29')).toEqual({ age: 'lt18' });
    expect(patientSkinDetails({ biologicalSex: 'intersex' }, '2026-10-29')).toEqual({});
    expect(patientSkinDetails(undefined, '2026-10-29')).toEqual({});
  });

  it('leaves the age out for a birth date that is not a date or lies in the future', () => {
    expect(patientSkinDetails({ birthDate: 'вчера' }, '2026-10-29')).toEqual({});
    expect(patientSkinDetails({ birthDate: '2030-01-01' }, '2026-10-29')).toEqual({});
  });

  it('merges over the chips without inventing values', () => {
    expect(mergeSkinDetails({ sites: ['arm'] }, { age: '30_39' })).toEqual({
      sites: ['arm'],
      age: '30_39',
    });
  });
});

describe('stored details', () => {
  it('keeps only what the model knows', () => {
    const clean = sanitizeSkinDetails({
      age: '30_39',
      sex: 'other',
      sites: ['arm', 'tail', 'foot'],
      symptoms: { itch: true, pain: false, fever: true, bleed: 'yes' },
      duration: 'gt_year',
      fitzpatrick: 9,
    });
    expect(clean).toEqual({
      age: '30_39',
      sites: ['arm', 'foot'],
      symptoms: { itch: true, pain: false },
      duration: 'gt_year',
    });
    expect(sanitizeSkinDetails(null)).toEqual({});
    expect(sanitizeSkinDetails('text')).toEqual({});
  });

  it('gives the same key for the same details whatever the key order', () => {
    expect(skinDetailsKey({ sites: ['foot', 'arm'], duration: 'gt_year' })).toBe(
      skinDetailsKey({ duration: 'gt_year', sites: ['arm', 'foot'] }),
    );
    expect(skinDetailsKey({ sites: ['arm'] })).not.toBe(skinDetailsKey({ sites: ['leg'] }));
  });

  it('encodes into the vector the model expects', () => {
    expect(
      encodeSkinDetails(
        mergeSkinDetails({ sites: ['arm'], symptoms: { itch: true } }, { age: '18_29' }),
      ),
    ).toHaveLength(SKIN_DETAILS_SIZE);
  });
});

describe('chip groups', () => {
  it('lists only the groups reached and marks the chosen chips', () => {
    expect(skinChipGroups({}).map((group) => group.id)).toEqual(['sites']);
    const groups = skinChipGroups({
      sites: ['hand'],
      duration: '1_4_weeks',
      symptoms: { itch: false },
    });
    expect(groups.map((group) => group.id)).toEqual([
      'sites',
      'duration',
      'symptoms',
      'fitzpatrick',
    ]);
    const stateOf = (groupId: string, chipId: string) =>
      groups.find((group) => group.id === groupId)?.chips.find((chip) => chip.id === chipId)?.state;
    expect(stateOf('sites', 'hand')).toBe('on');
    expect(stateOf('sites', 'arm')).toBe('off');
    expect(stateOf('duration', '1_4_weeks')).toBe('on');
    expect(stateOf('symptoms', 'itch')).toBe('absent');
    expect(stateOf('symptoms', 'pain')).toBe('off');
  });

  it('leads each chip to the details its tap produces', () => {
    const [sites] = skinChipGroups({});
    const arm = sites?.chips.find((chip) => chip.id === 'arm');
    expect(arm?.next).toEqual({ sites: ['arm'] });
  });
});

describe('details as words', () => {
  it('names what was told, including a denied symptom', () => {
    expect(
      skinDetailsLabels({
        age: '30_39',
        sex: 'female',
        sites: ['hand'],
        duration: 'gt_year',
        symptoms: { itch: true, bleed: false },
        fitzpatrick: 3,
      }),
    ).toEqual([
      '30–39 лет',
      'Женщина',
      'Кисть',
      'Больше года',
      'Зуд',
      'Кровоточит: нет',
      'Фототип III',
    ]);
    expect(skinDetailsLabels({})).toEqual([]);
  });
});
