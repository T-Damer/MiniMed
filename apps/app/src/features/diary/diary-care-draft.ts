/**
 * The doctor's editor state for a care diary and its conversion to the invitation. The draft is
 * the patient's screen as a list of sections — a medicine (a «recipe»: name, form, dose, signa,
 * times, course days), a wellbeing score, vitals, a free description, a choice or a
 * questionnaire — plus the doctor's contacts and help lines. Ids stay stable across re-issues so
 * the patient's marks keep matching; removed sections stay in the plan as ended.
 */
import {
  CARE_CHECKPOINTS,
  DIARY_FORMAT_VERSION,
  type DiaryCheckpoint,
  type DiaryContact,
  type DiaryContactKind,
  type DiaryField,
  type DiaryInvitation,
  type DiaryMeal,
  type DiaryPlanItem,
  type DiaryTip,
  diaryTemplate,
  MAX_DIARY_OPTIONS,
  parseDiaryInvitation,
} from '@/features/diary/diary-model';
import {
  customQuestionnaireSlug,
  diaryQuestionnaire,
  questionnaireCheckpointId,
} from '@/features/diary/diary-questionnaires';
import {
  type UserQuestionnaire,
  withoutUserQuestionnaireImages,
} from '@/state/user-questionnaire-format';

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
  | 'text'
  | 'choice'
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
}

export const CARE_SECTION_LABEL: Readonly<Record<CareSectionKind, string>> = {
  drug: 'Лекарство',
  score: 'Самочувствие',
  mood: 'Настроение',
  vitals: 'Пульс и давление',
  body: 'Вес и рост',
  text: 'Описание',
  choice: 'Выбор',
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
  quiz: '',
  everyDays: 7,
};

/** A new section of the kind, with the defaults a doctor most often keeps. */
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
            : checkpoint.kind === 'vitals' && first === 'weight'
              ? 'body'
              : checkpoint.kind,
        id: checkpoint.id,
        title: checkpoint.label,
        times: (checkpoint.times ?? []).map((time) => ({ time, meal: undefined })),
        tip: tipOf(checkpoint.id),
        options: checkpoint.kind === 'choice' ? (field?.options ?? []) : [],
        quiz: checkpoint.questionnaire ?? '',
        everyDays: checkpoint.everyDays ?? 7,
        ...(checkpoint.custom ? { custom: checkpoint.custom } : {}),
      };
    });
  return {
    sections: [...drugs, ...checks],
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

const ID_PREFIX: Readonly<Record<Exclude<CareSectionKind, 'questionnaire'>, string>> = {
  drug: 'p',
  score: 's-',
  mood: 'm-',
  vitals: 'v-',
  body: 'b-',
  text: 'd-',
  choice: 'c-',
};

const VITAL_FIELDS =
  CARE_CHECKPOINTS.find((checkpoint) => checkpoint.kind === 'vitals')?.fields ?? [];

export interface CareInvitationParts {
  readonly fields: readonly DiaryField[];
  readonly plan: readonly DiaryPlanItem[];
  readonly checkpoints: readonly DiaryCheckpoint[];
  readonly contacts: readonly DiaryContact[];
  readonly tips: readonly DiaryTip[];
  readonly crisis: readonly string[];
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
    if (!title) continue;
    let id = section.id ?? nextId(ID_PREFIX[section.kind], taken);
    let fieldIds: readonly string[];
    if (section.kind === 'score') fieldIds = ['wellbeing'];
    else if (section.kind === 'mood') fieldIds = ['mood'];
    else if (section.kind === 'vitals') fieldIds = VITAL_FIELDS;
    else if (section.kind === 'body') fieldIds = ['weight', 'height'];
    else if (section.kind === 'text') {
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
      kind: section.kind === 'mood' ? 'score' : section.kind === 'body' ? 'vitals' : section.kind,
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
}): DiaryInvitation {
  const template = diaryTemplate('care');
  const parts = careInvitationParts(input.draft, input.previous);
  const live =
    parts.plan.some((item) => !item.ended) ||
    parts.checkpoints.some((checkpoint) => !checkpoint.ended);
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
    consent: true,
    ...(input.doctor.trim() ? { doctor: input.doctor.trim() } : {}),
    ...(input.note.trim() ? { note: input.note.trim() } : {}),
  });
}
