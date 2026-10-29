import {
  SKIN_AGE_BUCKETS,
  SKIN_DURATIONS,
  SKIN_SITES,
  SKIN_SYMPTOMS,
  type SkinAgeBucket,
  type SkinDetails,
  type SkinDuration,
  type SkinSite,
  type SkinSymptom,
  skinAgeBucket,
} from '@/features/skin/skin-model';
import { calculateAgeOnDate, type PatientProfile } from '@/state/patient-domain';

/** The tap chips of «Кожа по фото», declared as data: the page renders them, never branches on one. */
export interface SkinChipOption<Value extends string | number> {
  readonly value: Value;
  readonly label: string;
}

export const SKIN_SITE_OPTIONS: readonly SkinChipOption<SkinSite>[] = [
  { value: 'head_neck', label: 'Голова, шея' },
  { value: 'arm', label: 'Рука' },
  { value: 'hand', label: 'Кисть' },
  { value: 'torso', label: 'Туловище' },
  { value: 'genital', label: 'Пах' },
  { value: 'buttocks', label: 'Ягодицы' },
  { value: 'leg', label: 'Нога' },
  { value: 'foot', label: 'Стопа' },
];

export const SKIN_DURATION_OPTIONS: readonly SkinChipOption<SkinDuration>[] = [
  { value: 'lt_week', label: 'Меньше недели' },
  { value: '1_4_weeks', label: '1–4 недели' },
  { value: '1_12_months', label: '1–12 месяцев' },
  { value: 'gt_year', label: 'Больше года' },
];

export const SKIN_SYMPTOM_OPTIONS: readonly SkinChipOption<SkinSymptom>[] = [
  { value: 'itch', label: 'Зуд' },
  { value: 'bleed', label: 'Кровоточит' },
  { value: 'grew', label: 'Растёт' },
  { value: 'pain', label: 'Болит' },
  { value: 'changed', label: 'Изменилось' },
  { value: 'raised', label: 'Возвышается' },
];

export const SKIN_FITZPATRICK_OPTIONS: readonly SkinChipOption<1 | 2 | 3 | 4 | 5 | 6>[] = [
  { value: 1, label: 'I' },
  { value: 2, label: 'II' },
  { value: 3, label: 'III' },
  { value: 4, label: 'IV' },
  { value: 5, label: 'V' },
  { value: 6, label: 'VI' },
];

export type SkinDetailGroup = 'sites' | 'duration' | 'symptoms' | 'fitzpatrick';

/**
 * Progressive input: the next group appears once the previous one has an answer, so the doctor
 * never meets a wall of chips. A group that has an answer stays, whatever happens to the others.
 */
export function visibleDetailGroups(details: SkinDetails): readonly SkinDetailGroup[] {
  const groups: SkinDetailGroup[] = ['sites'];
  if ((details.sites?.length ?? 0) > 0) groups.push('duration');
  if (details.duration !== undefined) groups.push('symptoms', 'fitzpatrick');
  return groups;
}

export function toggleSite(details: SkinDetails, site: SkinSite): SkinDetails {
  const current = details.sites ?? [];
  const sites = current.includes(site)
    ? current.filter((entry) => entry !== site)
    : SKIN_SITES.filter((entry) => entry === site || current.includes(entry));
  const { sites: _previous, ...rest } = details;
  return sites.length > 0 ? { ...rest, sites } : rest;
}

export function setDuration(details: SkinDetails, duration: SkinDuration): SkinDetails {
  const { duration: _previous, ...rest } = details;
  return details.duration === duration ? rest : { ...rest, duration };
}

export function setFitzpatrick(details: SkinDetails, type: 1 | 2 | 3 | 4 | 5 | 6): SkinDetails {
  const { fitzpatrick: _previous, ...rest } = details;
  return details.fitzpatrick === type ? rest : { ...rest, fitzpatrick: type };
}

/** A symptom is asked three ways: not asked → present → absent → not asked again. */
export type SkinSymptomState = 'unknown' | 'present' | 'absent';

export function symptomState(details: SkinDetails, symptom: SkinSymptom): SkinSymptomState {
  const value = details.symptoms?.[symptom];
  if (value === undefined) return 'unknown';
  return value ? 'present' : 'absent';
}

export function cycleSymptom(details: SkinDetails, symptom: SkinSymptom): SkinDetails {
  const next: Record<SkinSymptomState, boolean | undefined> = {
    unknown: true,
    present: false,
    absent: undefined,
  };
  const value = next[symptomState(details, symptom)];
  const symptoms: Partial<Record<SkinSymptom, boolean>> = { ...details.symptoms };
  if (value === undefined) delete symptoms[symptom];
  else symptoms[symptom] = value;
  const { symptoms: _previous, ...rest } = details;
  return Object.keys(symptoms).length > 0 ? { ...rest, symptoms } : rest;
}

/** What the chosen patient's card tells the model: the age bucket and the sex, when known. */
export function patientSkinDetails(
  profile: Pick<PatientProfile, 'birthDate' | 'biologicalSex'> | undefined,
  today: string,
): Pick<SkinDetails, 'age' | 'sex'> {
  if (!profile) return {};
  let age: SkinAgeBucket | undefined;
  if (profile.birthDate) {
    try {
      age = skinAgeBucket(calculateAgeOnDate(profile.birthDate, today).years);
    } catch {
      // A birth date that is not a real date: the age stays unknown.
      age = undefined;
    }
  }
  const sex =
    profile.biologicalSex === 'male' || profile.biologicalSex === 'female'
      ? profile.biologicalSex
      : undefined;
  return { ...(age ? { age } : {}), ...(sex ? { sex } : {}) };
}

export function mergeSkinDetails(
  chips: SkinDetails,
  patient: Pick<SkinDetails, 'age' | 'sex'>,
): SkinDetails {
  return { ...chips, ...patient };
}

function pickKnown<Value extends string>(
  allowed: readonly Value[],
  value: unknown,
): Value | undefined {
  return typeof value === 'string' ? allowed.find((entry) => entry === value) : undefined;
}

/** Details read back from storage: anything the model does not know is dropped, never trusted. */
export function sanitizeSkinDetails(value: unknown): SkinDetails {
  if (typeof value !== 'object' || value === null) return {};
  const raw = value as Record<string, unknown>;
  const age = pickKnown(SKIN_AGE_BUCKETS, raw['age']);
  const sex = raw['sex'] === 'male' || raw['sex'] === 'female' ? raw['sex'] : undefined;
  const sites = Array.isArray(raw['sites'])
    ? SKIN_SITES.filter((site) => (raw['sites'] as unknown[]).includes(site))
    : [];
  const symptoms: Partial<Record<SkinSymptom, boolean>> = {};
  const rawSymptoms = raw['symptoms'];
  if (typeof rawSymptoms === 'object' && rawSymptoms !== null) {
    for (const symptom of SKIN_SYMPTOMS) {
      const entry = (rawSymptoms as Record<string, unknown>)[symptom];
      if (typeof entry === 'boolean') symptoms[symptom] = entry;
    }
  }
  const duration = pickKnown(SKIN_DURATIONS, raw['duration']);
  const fitzpatrick = raw['fitzpatrick'];
  const type =
    typeof fitzpatrick === 'number' && Number.isInteger(fitzpatrick) && fitzpatrick >= 1
      ? (fitzpatrick as 1 | 2 | 3 | 4 | 5 | 6)
      : undefined;
  return {
    ...(age ? { age } : {}),
    ...(sex ? { sex } : {}),
    ...(sites.length > 0 ? { sites } : {}),
    ...(Object.keys(symptoms).length > 0 ? { symptoms } : {}),
    ...(duration ? { duration } : {}),
    ...(type && type <= 6 ? { fitzpatrick: type } : {}),
  };
}

/** Same details, regardless of key order: re-ranking only runs when something really changed. */
export function skinDetailsKey(details: SkinDetails): string {
  const symptoms = SKIN_SYMPTOMS.flatMap((symptom) => {
    const value = details.symptoms?.[symptom];
    return value === undefined ? [] : [`${symptom}=${value ? 1 : 0}`];
  });
  return [
    details.age ?? '',
    details.sex ?? '',
    (details.sites ?? []).toSorted().join(','),
    symptoms.join(','),
    details.duration ?? '',
    details.fitzpatrick ?? '',
  ].join('|');
}

export type SkinChipState = 'off' | 'on' | 'absent';

/** One tappable chip: how it looks now and the details a tap leads to. */
export interface SkinChipView {
  readonly id: string;
  readonly label: string;
  readonly state: SkinChipState;
  readonly next: SkinDetails;
}

export interface SkinChipGroupView {
  readonly id: SkinDetailGroup;
  readonly label: string;
  readonly chips: readonly SkinChipView[];
}

const SYMPTOM_STATE_VIEW: Record<SkinSymptomState, SkinChipState> = {
  unknown: 'off',
  present: 'on',
  absent: 'absent',
};

/**
 * The chips the page shows for these details, as declared data: the component renders groups and
 * chips and never branches on which one it is. Only the groups reached so far are listed.
 */
export function skinChipGroups(details: SkinDetails): readonly SkinChipGroupView[] {
  const all: Record<SkinDetailGroup, SkinChipGroupView> = {
    sites: {
      id: 'sites',
      label: 'Где',
      chips: SKIN_SITE_OPTIONS.map((option) => ({
        id: option.value,
        label: option.label,
        state: details.sites?.includes(option.value) ? 'on' : 'off',
        next: toggleSite(details, option.value),
      })),
    },
    duration: {
      id: 'duration',
      label: 'Как давно',
      chips: SKIN_DURATION_OPTIONS.map((option) => ({
        id: option.value,
        label: option.label,
        state: details.duration === option.value ? 'on' : 'off',
        next: setDuration(details, option.value),
      })),
    },
    symptoms: {
      id: 'symptoms',
      label: 'Симптомы',
      chips: SKIN_SYMPTOM_OPTIONS.map((option) => ({
        id: option.value,
        label: option.label,
        state: SYMPTOM_STATE_VIEW[symptomState(details, option.value)],
        next: cycleSymptom(details, option.value),
      })),
    },
    fitzpatrick: {
      id: 'fitzpatrick',
      label: 'Фототип кожи',
      chips: SKIN_FITZPATRICK_OPTIONS.map((option) => ({
        id: String(option.value),
        label: option.label,
        state: details.fitzpatrick === option.value ? 'on' : 'off',
        next: setFitzpatrick(details, option.value),
      })),
    },
  };
  return visibleDetailGroups(details).map((id) => all[id]);
}

const AGE_LABELS: Record<SkinAgeBucket, string> = {
  lt18: 'до 18 лет',
  '18_29': '18–29 лет',
  '30_39': '30–39 лет',
  '40_49': '40–49 лет',
  '50_59': '50–59 лет',
  '60_69': '60–69 лет',
  '70plus': '70+ лет',
};

/** The details as short words for a saved entry: «Рука», «Зуд», «Кровоточит: нет», «30–39 лет». */
export function skinDetailsLabels(details: SkinDetails): readonly string[] {
  const label = <Value extends string | number>(
    options: readonly SkinChipOption<Value>[],
    value: Value,
  ): string => options.find((option) => option.value === value)?.label ?? String(value);
  return [
    ...(details.age ? [AGE_LABELS[details.age]] : []),
    ...(details.sex ? [details.sex === 'male' ? 'Мужчина' : 'Женщина'] : []),
    ...(details.sites ?? []).map((site) => label(SKIN_SITE_OPTIONS, site)),
    ...(details.duration ? [label(SKIN_DURATION_OPTIONS, details.duration)] : []),
    ...SKIN_SYMPTOMS.flatMap((symptom) => {
      const value = details.symptoms?.[symptom];
      if (value === undefined) return [];
      const name = label(SKIN_SYMPTOM_OPTIONS, symptom);
      return [value ? name : `${name}: нет`];
    }),
    ...(details.fitzpatrick
      ? [`Фототип ${label(SKIN_FITZPATRICK_OPTIONS, details.fitzpatrick)}`]
      : []),
  ];
}
