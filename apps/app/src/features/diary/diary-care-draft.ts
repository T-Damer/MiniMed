/**
 * The doctor's editor state for a care diary and its conversion to the invitation. The draft is
 * the patient's screen as a list of sections — a medicine (a «recipe»: name, form, dose, signa,
 * times, course days), a wellbeing score, vitals, a free description, a choice or a
 * questionnaire — plus the doctor's contacts and help lines. Ids stay stable across re-issues so
 * the patient's marks keep matching; removed sections stay in the plan as ended.
 */
import {
  ACTIVITY_FIELD,
  APPETITE_FIELD,
  CARE_CHECKPOINTS,
  DIARY_FORMAT_VERSION,
  type DiaryAppointment,
  type DiaryAssignment,
  type DiaryAssignmentRepeat,
  type DiaryCheckpoint,
  type DiaryContact,
  type DiaryContactKind,
  type DiaryField,
  type DiaryInvitation,
  type DiaryLabRequest,
  type DiaryMeal,
  type DiaryOperator,
  type DiaryPlanItem,
  type DiaryTip,
  diaryTemplate,
  GLUCOSE_FIELD,
  MAX_DIARY_OPTIONS,
  MEALS_FIELD,
  parseDiaryInvitation,
  STEPS_FIELD,
} from '@/features/diary/diary-model';
import {
  customQuestionnaireSlug,
  diaryQuestionnaire,
  questionnaireCheckpointId,
} from '@/features/diary/diary-questionnaires';
import {
  substanceFieldSet,
  substancesOf,
  USE_CHECKPOINT_ID,
  USE_CRAVING_FIELD,
  USE_DEFAULT_TIME,
} from '@/features/diary/diary-substances';
import {
  type UserQuestionnaire,
  withoutUserQuestionnaireImages,
} from '@/state/user-questionnaire-format';
import type { UserWorksheet } from '@/state/user-worksheet-format';

export interface CareDoseDraft {
  readonly time: string;
  readonly meal: DiaryMeal | undefined;
}

export interface CareDayRange {
  readonly from: string;
  readonly to: string;
}

export type CareSectionKind =
  | 'drug'
  | 'score'
  | 'mood'
  | 'vitals'
  | 'body'
  | 'glucose'
  | 'activity'
  | 'meals'
  | 'text'
  | 'choice'
  | 'use'
  | 'questionnaire';

export interface CareSectionDraft {
  /** Editor key, stable while the dialog is open. */
  readonly key: string;
  readonly kind: CareSectionKind;
  /** Id of an issued plan item or checkpoint; a new section gets the next free one. */
  readonly id?: string;
  /** Medicine name or section title as the patient reads it. */
  readonly title: string;
  /** Times of day; empty: once a day at any time (a medicine without times is taken as needed). */
  readonly times: readonly CareDoseDraft[];
  readonly tip: string;
  /** Medicine only. */
  readonly form: string;
  readonly dose: string;
  readonly signa: string;
  readonly asNeeded: boolean;
  /** Medicine days; empty: no end date. */
  readonly course: readonly CareDayRange[];
  /** Choice only. */
  readonly options: readonly string[];
  /** Substance use only: catalog ids (`diary-substances`) the patient marks. */
  readonly substances: readonly string[];
  /** Substance use only: also ask for the craving, 0–10. */
  readonly craving: boolean;
  /** Questionnaire only: the built-in slug, or `own-…` for the doctor's own questionnaire. */
  readonly quiz: string;
  readonly everyDays: number;
  /** Questionnaire only: the doctor's own questionnaire (without pictures) behind an `own-…` slug. */
  readonly custom?: UserQuestionnaire;
}

export interface CareContactDraft {
  readonly kind: DiaryContactKind;
  readonly value: string;
  readonly label: string;
}

export interface CareDraft {
  readonly sections: readonly CareSectionDraft[];
  readonly contacts: readonly CareContactDraft[];
  /** Help lines, one per line of text. */
  readonly crisis: string;
  /** Visits the doctor booked (DIARY27). */
  readonly appointments?: readonly CareAppointmentDraft[];
  /** Lab tests the doctor asks for (DIARY27). */
  readonly labs?: readonly CareLabDraft[];
  /** CBT diaries and homework the doctor assigned (CBT1). */
  readonly assignments?: readonly CareAssignmentDraft[];
}

/** One assigned worksheet in the editor: the copy made for this patient and its schedule. */
export interface CareAssignmentDraft {
  readonly key: string;
  readonly id?: string;
  readonly worksheet: UserWorksheet;
  readonly repeat: DiaryAssignmentRepeat;
  /** Weekdays 1…7 for `days`. */
  readonly days: readonly number[];
  readonly time: string;
  /** `YYYY-MM-DD`: given on (kept across re-issues). */
  readonly from: string;
  readonly until: string;
  readonly why: string;
  readonly what: string;
}

export interface CareAppointmentDraft {
  readonly key: string;
  readonly id?: string;
  /** `YYYY-MM-DD`; empty while the doctor has not chosen it. */
  readonly day: string;
  readonly time: string;
  readonly place: string;
  readonly note: string;
}

export interface CareLabDraft {
  readonly key: string;
  readonly id?: string;
  readonly name: string;
  readonly unit: string;
  /** Take it by this day; empty: whenever the patient can. */
  readonly by: string;
  readonly why: string;
}

/** Field id of a lab request's result: `lab-` and the request's id. */
export function labFieldId(id: string): string {
  return `lab-${id}`;
}

export function newCareAppointment(day = ''): CareAppointmentDraft {
  return { key: sectionKey(), day, time: '', place: '', note: '' };
}

/**
 * A worksheet just picked for a patient: a log is filled when the event happens, a material is
 * practised daily, the other layouts once a day.
 */
export function newCareAssignment(worksheet: UserWorksheet, from: string): CareAssignmentDraft {
  return {
    key: sectionKey(),
    worksheet,
    repeat: worksheet.layout === 'log' || worksheet.layout === 'card' ? 'event' : 'daily',
    days: [1, 3, 5],
    time: '',
    from,
    until: '',
    why: '',
    what: '',
  };
}

export function newCareLab(next: Partial<Omit<CareLabDraft, 'key'>> = {}): CareLabDraft {
  return { key: sectionKey(), name: '', unit: '', by: '', why: '', ...next };
}

export const CARE_SECTION_LABEL: Readonly<Record<CareSectionKind, string>> = {
  drug: 'Лекарство',
  score: 'Самочувствие',
  mood: 'Настроение',
  vitals: 'Пульс и давление',
  body: 'Вес и рост',
  glucose: 'Глюкоза',
  activity: 'Активность',
  meals: 'Питание',
  text: 'Описание',
  choice: 'Выбор',
  use: 'Зависимости',
  questionnaire: 'Опросник',
};

export const EMPTY_CARE_CONTACT: CareContactDraft = { kind: 'phone', value: '', label: '' };

let keySeed = 0;
function sectionKey(): string {
  keySeed += 1;
  return `s${Date.now().toString(36)}${keySeed}`;
}

const BLANK: Omit<CareSectionDraft, 'key' | 'kind'> = {
  title: '',
  times: [],
  tip: '',
  form: '',
  dose: '',
  signa: '',
  asNeeded: false,
  course: [],
  options: [],
  substances: [],
  craving: true,
  quiz: '',
  everyDays: 7,
};

/** A new section of the kind, with the defaults a doctor most often keeps. */
/**
 * A copy of a drug section for the next medicine (owner 2026-11-02): same form, times, meals,
 * duration and patient hint, without the drug itself, its dose and signa, which belong to it alone.
 */
export function copyCareSection(section: CareSectionDraft): CareSectionDraft {
  return { ...section, key: sectionKey(), title: '', dose: '', signa: '' };
}

export function newCareSection(kind: CareSectionKind, quiz = 'phq-9'): CareSectionDraft {
  const at = (time: string): CareDoseDraft[] => [{ time, meal: undefined }];
  switch (kind) {
    case 'drug':
      return { ...BLANK, key: sectionKey(), kind, times: at('08:00') };
    case 'score':
      return { ...BLANK, key: sectionKey(), kind, title: 'Самочувствие', times: at('09:00') };
    case 'mood':
      return { ...BLANK, key: sectionKey(), kind, title: 'Настроение', times: at('21:00') };
    case 'body':
      return { ...BLANK, key: sectionKey(), kind, title: 'Вес и рост', times: [] };
    case 'glucose':
      return { ...BLANK, key: sectionKey(), kind, title: 'Глюкоза', times: at('08:00') };
    case 'activity':
      return { ...BLANK, key: sectionKey(), kind, title: 'Активность', times: at('21:00') };
    case 'meals':
      return { ...BLANK, key: sectionKey(), kind, title: 'Питание', times: at('21:00') };
    case 'vitals':
      return {
        ...BLANK,
        key: sectionKey(),
        kind,
        title: 'Пульс, давление, сатурация',
        times: at('09:00'),
      };
    case 'text':
      return { ...BLANK, key: sectionKey(), kind, title: 'Как прошёл день', times: at('21:00') };
    case 'choice':
      return {
        ...BLANK,
        key: sectionKey(),
        kind,
        title: 'Сон',
        times: at('09:00'),
        options: ['хорошо', 'беспокойно', 'плохо'],
      };
    case 'use':
      return {
        ...BLANK,
        key: sectionKey(),
        kind,
        title: 'Употребление',
        times: at(USE_DEFAULT_TIME),
      };
    case 'questionnaire':
      return {
        ...BLANK,
        key: sectionKey(),
        kind,
        title: diaryQuestionnaire(quiz)?.title ?? quiz,
        quiz,
      };
  }
}

/**
 * A questionnaire section for one of the doctor's own questionnaires (main app «Мои опросники»).
 * `sourceId` is its library file id: the same questionnaire always gets the same slug, so a
 * re-issued diary keeps the checkpoint and the patient's answers. Pictures are dropped here.
 */
export function newCustomQuestionnaireSection(
  questionnaire: UserQuestionnaire,
  sourceId: string,
): CareSectionDraft {
  return {
    ...BLANK,
    key: sectionKey(),
    kind: 'questionnaire',
    title: questionnaire.title,
    quiz: customQuestionnaireSlug(sourceId),
    custom: withoutUserQuestionnaireImages(questionnaire),
  };
}

function preset(id: string): CareSectionDraft {
  const checkpoint = CARE_CHECKPOINTS.find((candidate) => candidate.id === id);
  const kind = checkpoint?.kind === 'vitals' ? 'vitals' : 'score';
  return {
    ...BLANK,
    key: sectionKey(),
    kind,
    title: checkpoint?.label ?? '',
    times: (checkpoint?.times ?? []).map((time) => ({ time, meal: undefined })),
  };
}

/** A new care diary: one empty medicine, wellbeing morning and evening, vitals, PHQ-9 weekly. */
export function emptyCareDraft(): CareDraft {
  return {
    sections: [
      newCareSection('drug'),
      { ...preset('am'), id: 'am' },
      { ...preset('pm'), id: 'pm' },
      { ...preset('vitals'), id: 'vitals' },
      newCareSection('questionnaire'),
    ],
    contacts: [EMPTY_CARE_CONTACT],
    crisis: '',
  };
}

/** The editor state of an issued care diary (to update it). */
export function careDraftFrom(invitation: DiaryInvitation): CareDraft {
  const tipOf = (target: string): string =>
    invitation.tips?.find((tip) => tip.target === target)?.text ?? '';
  const drugs = (invitation.plan ?? [])
    .filter((item) => !item.ended)
    .map(
      (item): CareSectionDraft => ({
        ...BLANK,
        key: sectionKey(),
        kind: 'drug',
        id: item.id,
        title: item.name,
        form: item.form ?? '',
        dose: item.dose ?? '',
        signa: item.signa ?? item.schedule ?? '',
        times: (item.times ?? []).map((time) => ({ time: time.time, meal: time.meal })),
        asNeeded: item.asNeeded === true,
        course: item.course ?? [],
        tip: tipOf(item.id),
      }),
    );
  const checks = (invitation.checkpoints ?? [])
    .filter((checkpoint) => !checkpoint.ended)
    .map((checkpoint): CareSectionDraft => {
      const field = invitation.fields.find((candidate) => candidate.id === checkpoint.fields?.[0]);
      const first = checkpoint.fields?.[0];
      return {
        ...BLANK,
        key: sectionKey(),
        kind:
          checkpoint.kind === 'score' && first === 'mood'
            ? 'mood'
            : (checkpoint.kind === 'vitals' && first && MEASURE_KIND[first]) || checkpoint.kind,
        id: checkpoint.id,
        title: checkpoint.label,
        times: (checkpoint.times ?? []).map((time) => ({ time, meal: undefined })),
        tip: tipOf(checkpoint.id),
        options: checkpoint.kind === 'choice' ? (field?.options ?? []) : [],
        ...(checkpoint.kind === 'use'
          ? {
              substances: substancesOf(checkpoint.fields ?? []),
              craving: checkpoint.fields?.includes(USE_CRAVING_FIELD) === true,
            }
          : {}),
        quiz: checkpoint.questionnaire ?? '',
        everyDays: checkpoint.everyDays ?? 7,
        ...(checkpoint.custom ? { custom: checkpoint.custom } : {}),
      };
    });
  const appointments = (invitation.appointments ?? []).map(
    (appointment): CareAppointmentDraft => ({
      key: sectionKey(),
      id: appointment.id,
      day: appointment.day,
      time: appointment.time ?? '',
      place: appointment.place ?? '',
      note: appointment.note ?? '',
    }),
  );
  const assignments = (invitation.assignments ?? [])
    .filter((assignment) => !assignment.ended)
    .map(
      (assignment): CareAssignmentDraft => ({
        key: sectionKey(),
        id: assignment.id,
        worksheet: assignment.worksheet,
        repeat: assignment.repeat,
        days: assignment.days ?? [1, 3, 5],
        time: assignment.time ?? '',
        from: assignment.from,
        until: assignment.until ?? '',
        why: assignment.why ?? '',
        what: assignment.what ?? '',
      }),
    );
  const labs = (invitation.labs ?? []).map(
    (lab): CareLabDraft => ({
      key: sectionKey(),
      id: lab.id,
      name: lab.name,
      unit: invitation.fields.find((field) => field.id === lab.field)?.unit ?? '',
      by: lab.by ?? '',
      why: lab.why ?? '',
    }),
  );
  return {
    sections: [...drugs, ...checks],
    ...(appointments.length ? { appointments } : {}),
    ...(labs.length ? { labs } : {}),
    ...(assignments.length ? { assignments } : {}),
    contacts: invitation.contacts?.length
      ? invitation.contacts.map((contact) => ({
          kind: contact.kind,
          value: contact.value,
          label: contact.label ?? '',
        }))
      : [EMPTY_CARE_CONTACT],
    crisis: (invitation.crisis ?? []).join('\n'),
  };
}

function nextId(prefix: string, taken: Set<string>): string {
  let number = 1;
  while (taken.has(`${prefix}${number}`)) number += 1;
  taken.add(`${prefix}${number}`);
  return `${prefix}${number}`;
}

const ID_PREFIX: Readonly<Record<Exclude<CareSectionKind, 'questionnaire' | 'use'>, string>> = {
  drug: 'p',
  score: 's-',
  mood: 'm-',
  vitals: 'v-',
  body: 'b-',
  glucose: 'g-',
  activity: 'a-',
  meals: 'f-',
  text: 'd-',
  choice: 'c-',
};

const VITAL_FIELDS =
  CARE_CHECKPOINTS.find((checkpoint) => checkpoint.kind === 'vitals')?.fields ?? [];

/** Measurement sections and the fields each asks (a `vitals` checkpoint on the patient's side). */
const MEASURE_FIELDS: Readonly<
  Record<'body' | 'glucose' | 'activity' | 'meals', readonly DiaryField[]>
> = {
  body: [],
  glucose: [GLUCOSE_FIELD],
  activity: [STEPS_FIELD, ACTIVITY_FIELD],
  meals: [MEALS_FIELD, APPETITE_FIELD],
};

/** The section a `vitals` checkpoint is, by its first field. */
const MEASURE_KIND: Readonly<Partial<Record<string, CareSectionKind>>> = {
  weight: 'body',
  glucose: 'glucose',
  steps: 'activity',
  meals: 'meals',
};

export interface CareInvitationParts {
  readonly fields: readonly DiaryField[];
  readonly plan: readonly DiaryPlanItem[];
  readonly checkpoints: readonly DiaryCheckpoint[];
  readonly contacts: readonly DiaryContact[];
  readonly tips: readonly DiaryTip[];
  readonly crisis: readonly string[];
  readonly appointments: readonly DiaryAppointment[];
  readonly labs: readonly DiaryLabRequest[];
  readonly assignments: readonly DiaryAssignment[];
}

function cleanOptions(options: readonly string[]): string[] {
  return [...new Set(options.map((option) => option.trim()).filter(Boolean))].slice(
    0,
    MAX_DIARY_OPTIONS,
  );
}

/**
 * The plan parts of the invitation. Sections the doctor removed stay as ended items or
 * checkpoints (with their fields), so the patient's earlier marks still resolve. A choice whose
 * options lost a variant gets a new id: earlier answers keep the old field.
 */
export function careInvitationParts(
  draft: CareDraft,
  previous?: DiaryInvitation,
): CareInvitationParts {
  const base = diaryTemplate('care')?.fields ?? [];
  const baseIds = new Set(base.map((field) => field.id));
  const previousFields = new Map(
    (previous?.fields ?? [])
      .filter((field) => !baseIds.has(field.id))
      .map((field) => [field.id, field]),
  );
  const taken = new Set<string>([
    ...baseIds,
    ...(previous?.plan ?? []).map((item) => item.id),
    ...(previous?.checkpoints ?? []).map((checkpoint) => checkpoint.id),
    ...previousFields.keys(),
  ]);

  const plan: DiaryPlanItem[] = [];
  const checkpoints: DiaryCheckpoint[] = [];
  const fields = new Map<string, DiaryField>();
  const tips: DiaryTip[] = [];
  const tipFor = (target: string, text: string): void => {
    const trimmed = text.trim();
    if (!trimmed) return;
    // The same text keeps its id, so a tip the patient has read does not show «?» again.
    const same = previous?.tips?.find((tip) => tip.target === target && tip.text === trimmed);
    tips.push({
      id: same?.id ?? `t-${target}-${Date.now().toString(36)}`.slice(0, 24),
      target,
      text: trimmed,
    });
  };
  const timesOf = (section: CareSectionDraft): string[] =>
    [...new Set(section.times.map((time) => time.time).filter(Boolean))].toSorted();

  for (const section of draft.sections) {
    const title = section.title.trim();
    if (section.kind === 'drug') {
      if (!title) continue;
      const times = section.asNeeded
        ? []
        : [...new Map(section.times.map((time) => [time.time, time])).values()]
            .filter((time) => time.time)
            .toSorted((left, right) => left.time.localeCompare(right.time))
            .map((time) => ({ time: time.time, ...(time.meal ? { meal: time.meal } : {}) }));
      const id = section.id ?? nextId(ID_PREFIX.drug, taken);
      plan.push({
        id,
        name: title,
        ...(section.form.trim() ? { form: section.form.trim() } : {}),
        ...(section.dose.trim() ? { dose: section.dose.trim() } : {}),
        ...(section.signa.trim() ? { signa: section.signa.trim() } : {}),
        ...(section.course.length ? { course: section.course } : {}),
        ...(times.length ? { times } : {}),
        // A medicine without times is taken when needed.
        ...(section.asNeeded || !times.length ? { asNeeded: true } : {}),
      });
      tipFor(id, section.tip);
      continue;
    }
    if (section.kind === 'questionnaire') {
      const option = section.custom ? undefined : diaryQuestionnaire(section.quiz);
      if (!option && !section.custom) continue;
      const id = questionnaireCheckpointId(section.quiz);
      if (checkpoints.some((checkpoint) => checkpoint.id === id)) continue;
      checkpoints.push({
        id,
        kind: 'questionnaire',
        label: option?.title ?? (title || section.custom?.title || section.quiz).slice(0, 100),
        questionnaire: section.quiz,
        everyDays: section.everyDays,
        ...(section.custom ? { custom: withoutUserQuestionnaireImages(section.custom) } : {}),
      });
      tipFor(id, section.tip);
      continue;
    }
    if (section.kind === 'use') {
      // One section: the second is left out, like a questionnaire chosen twice.
      if (checkpoints.some((checkpoint) => checkpoint.kind === 'use')) continue;
      const label = title || 'Употребление';
      if (!section.substances.length)
        throw new Error(`«${label}»: отметьте хотя бы одно вещество.`);
      const used = substanceFieldSet(section.substances, section.craving);
      for (const field of used.fields) fields.set(field.id, field);
      const times = timesOf(section);
      checkpoints.push({
        id: USE_CHECKPOINT_ID,
        kind: 'use',
        label,
        ...(times.length ? { times } : {}),
        fields: used.ids,
      });
      tipFor(USE_CHECKPOINT_ID, section.tip);
      continue;
    }
    if (!title) continue;
    let id = section.id ?? nextId(ID_PREFIX[section.kind], taken);
    let fieldIds: readonly string[];
    if (section.kind === 'score') fieldIds = ['wellbeing'];
    else if (section.kind === 'mood') fieldIds = ['mood'];
    else if (section.kind === 'vitals') fieldIds = VITAL_FIELDS;
    else if (section.kind === 'body') fieldIds = ['weight', 'height'];
    else if (
      section.kind === 'glucose' ||
      section.kind === 'activity' ||
      section.kind === 'meals'
    ) {
      const measured = MEASURE_FIELDS[section.kind];
      // One section of each: the fields have fixed ids, like the base ones.
      if (checkpoints.some((checkpoint) => checkpoint.fields?.[0] === measured[0]?.id)) continue;
      for (const field of measured) fields.set(field.id, field);
      fieldIds = measured.map((field) => field.id);
    } else if (section.kind === 'text') {
      fields.set(id, { id, type: 'text', label: title });
      fieldIds = [id];
    } else {
      const options = cleanOptions(section.options);
      if (options.length < 2) throw new Error(`«${title}»: нужно хотя бы два варианта.`);
      const before = previousFields.get(id);
      if (before?.options?.some((option) => !options.includes(option))) {
        id = nextId(ID_PREFIX.choice, taken);
      }
      fields.set(id, { id, type: 'choice', label: title, options });
      fieldIds = [id];
    }
    const times = timesOf(section);
    checkpoints.push({
      id,
      // Mood is a score and weight with height are measurements to the patient's screen.
      kind:
        section.kind === 'mood'
          ? 'score'
          : section.kind === 'body' ||
              section.kind === 'glucose' ||
              section.kind === 'activity' ||
              section.kind === 'meals'
            ? 'vitals'
            : section.kind,
      label: title,
      ...(times.length ? { times } : {}),
      fields: fieldIds,
    });
    tipFor(id, section.tip);
  }

  const keptPlan = new Set(plan.map((item) => item.id));
  const endedPlan = (previous?.plan ?? [])
    .filter((item) => !keptPlan.has(item.id))
    .map((item) => ({ ...item, ended: true }));
  const active = new Set(checkpoints.map((checkpoint) => checkpoint.id));
  for (const checkpoint of previous?.checkpoints ?? []) {
    if (!active.has(checkpoint.id)) checkpoints.push({ ...checkpoint, ended: true });
  }
  // Ids already given (in this draft or the plan before it) are never handed out again.
  for (const given of [
    ...(previous?.appointments ?? []),
    ...(previous?.labs ?? []),
    ...(draft.appointments ?? []),
    ...(draft.labs ?? []),
  ]) {
    if (given.id) taken.add(given.id);
  }
  const appointments = (draft.appointments ?? [])
    .filter((appointment) => appointment.day)
    .toSorted((left, right) =>
      `${left.day}T${left.time}`.localeCompare(`${right.day}T${right.time}`),
    )
    .map(
      (appointment): DiaryAppointment => ({
        id: appointment.id ?? nextId('v', taken),
        day: appointment.day,
        ...(appointment.time ? { time: appointment.time } : {}),
        ...(appointment.place.trim() ? { place: appointment.place.trim() } : {}),
        ...(appointment.note.trim() ? { note: appointment.note.trim() } : {}),
      }),
    );
  // Each result goes into a number field of its own; a lab taken off the list keeps its field, so
  // the results already typed in keep their name.
  const labs: DiaryLabRequest[] = [];
  for (const lab of draft.labs ?? []) {
    const name = lab.name.trim();
    if (!name) continue;
    const id = lab.id ?? nextId('l', taken);
    const field = labFieldId(id);
    fields.set(field, {
      id: field,
      type: 'number',
      label: name,
      ...(lab.unit.trim() ? { unit: lab.unit.trim() } : {}),
      min: 0,
      max: 1_000_000,
      step: 0.01,
    });
    labs.push({
      id,
      name,
      field,
      ...(lab.by ? { by: lab.by } : {}),
      ...(lab.why.trim() ? { why: lab.why.trim() } : {}),
    });
  }

  // Worksheets (CBT1): ids never handed out twice; one taken off stays as ended, with its sheet,
  // so what the patient wrote in it keeps its columns.
  for (const given of [...(previous?.assignments ?? []), ...(draft.assignments ?? [])]) {
    if (given.id) taken.add(given.id);
  }
  const assignments: DiaryAssignment[] = (draft.assignments ?? []).map((assignment) => ({
    id: assignment.id ?? nextId('w', taken),
    worksheet: assignment.worksheet,
    repeat: assignment.repeat,
    ...(assignment.repeat === 'days' ? { days: assignment.days } : {}),
    ...(assignment.time && assignment.repeat !== 'event' ? { time: assignment.time } : {}),
    from: assignment.from,
    ...(assignment.until ? { until: assignment.until } : {}),
    ...(assignment.why.trim() ? { why: assignment.why.trim() } : {}),
    ...(assignment.what.trim() ? { what: assignment.what.trim() } : {}),
  }));
  const keptAssignments = new Set(assignments.map((assignment) => assignment.id));
  for (const assignment of previous?.assignments ?? []) {
    if (!keptAssignments.has(assignment.id)) {
      assignments.push({ ...assignment, ended: true });
    }
  }

  // Fields of ended sections stay so earlier answers keep their labels and validation.
  for (const [id, field] of previousFields) if (!fields.has(id)) fields.set(id, field);

  // Tips on fields (not on a section) are edited elsewhere; keep them.
  const sectionIds = new Set([...plan.map((item) => item.id), ...checkpoints.map((c) => c.id)]);
  for (const tip of previous?.tips ?? []) {
    if (!sectionIds.has(tip.target) && !tips.some((own) => own.target === tip.target)) {
      tips.push(tip);
    }
  }

  return {
    fields: [...base, ...fields.values()],
    plan: [...plan, ...endedPlan],
    checkpoints,
    contacts: draft.contacts
      .filter((contact) => contact.value.trim())
      .map((contact) => ({
        kind: contact.kind,
        value: contact.value.trim(),
        ...(contact.label.trim() ? { label: contact.label.trim() } : {}),
      })),
    tips,
    crisis: draft.crisis
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
    appointments,
    labs,
    assignments,
  };
}

/**
 * A complete care diary invitation from the editor: a new one (id given) or the next version of
 * an issued one, which keeps its id and title and sorts after it.
 */
export function careInvitation(input: {
  readonly id: string;
  readonly draft: CareDraft;
  readonly doctor: string;
  readonly note: string;
  readonly previous?: DiaryInvitation | undefined;
  /** The clinic and doctor for the joining documents; absent keeps the previous plan's. */
  readonly operator?: DiaryOperator | undefined;
}): DiaryInvitation {
  const operator = input.operator ?? input.previous?.operator;
  const template = diaryTemplate('care');
  const parts = careInvitationParts(input.draft, input.previous);
  const live =
    parts.plan.some((item) => !item.ended) ||
    parts.checkpoints.some((checkpoint) => !checkpoint.ended) ||
    parts.assignments.some((assignment) => !assignment.ended);
  if (!live) throw new Error('Добавьте хотя бы один раздел.');
  const issuedAt = input.previous
    ? new Date(Math.max(Date.now(), Date.parse(input.previous.issuedAt) + 1000)).toISOString()
    : new Date().toISOString();
  return parseDiaryInvitation({
    v: DIARY_FORMAT_VERSION,
    id: input.id,
    template: 'care',
    title: input.previous?.title ?? template?.title ?? 'Дневник лечения',
    issuedAt,
    fields: parts.fields,
    ...(parts.plan.length ? { plan: parts.plan } : {}),
    planTitle: 'Лекарства',
    ...(parts.checkpoints.length ? { checkpoints: parts.checkpoints } : {}),
    ...(parts.contacts.length ? { contacts: parts.contacts } : {}),
    ...(parts.tips.length ? { tips: parts.tips } : {}),
    ...(parts.crisis.length ? { crisis: parts.crisis } : {}),
    ...(parts.appointments.length ? { appointments: parts.appointments } : {}),
    ...(parts.labs.length ? { labs: parts.labs } : {}),
    ...(parts.assignments.length ? { assignments: parts.assignments } : {}),
    consent: true,
    ...(operator ? { operator } : {}),
    ...(input.doctor.trim() ? { doctor: input.doctor.trim() } : {}),
    ...(input.note.trim() ? { note: input.note.trim() } : {}),
  });
}
