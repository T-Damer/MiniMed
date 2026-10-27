/**
 * The doctor's editor state for a care diary and its conversion to the invitation's day plan:
 * medicines with intake times, the wellbeing and vitals checkpoints, questionnaires, contacts,
 * help lines and tips. Ids stay stable across re-issues so the patient's marks keep matching.
 */
import {
  CARE_CHECKPOINTS,
  DIARY_FORMAT_VERSION,
  type DiaryCheckpoint,
  type DiaryContact,
  type DiaryContactKind,
  type DiaryInvitation,
  type DiaryMeal,
  type DiaryPlanItem,
  type DiaryTip,
  diaryTemplate,
  parseDiaryInvitation,
} from '@/features/diary/diary-model';
import {
  diaryQuestionnaire,
  questionnaireCheckpointId,
} from '@/features/diary/diary-questionnaires';

export interface CareDoseDraft {
  readonly time: string;
  readonly meal: DiaryMeal | undefined;
}

export interface CareItemDraft {
  /** Id of an item already issued; a new one gets the next free `pN`. */
  readonly id?: string;
  readonly name: string;
  readonly dose: string;
  readonly times: readonly CareDoseDraft[];
  readonly asNeeded: boolean;
  readonly tip: string;
}

export interface CareCheckDraft {
  readonly on: boolean;
  readonly time: string;
}

export interface CareQuizDraft {
  readonly slug: string;
  readonly everyDays: number;
}

export interface CareContactDraft {
  readonly kind: DiaryContactKind;
  readonly value: string;
  readonly label: string;
}

export type CareCheckId = 'am' | 'pm' | 'vitals';

export interface CareDraft {
  readonly items: readonly CareItemDraft[];
  readonly checks: Readonly<Record<CareCheckId, CareCheckDraft>>;
  readonly quizzes: readonly CareQuizDraft[];
  readonly contacts: readonly CareContactDraft[];
  /** Help lines, one per line of text. */
  readonly crisis: string;
}

const CHECK_IDS: readonly CareCheckId[] = ['am', 'pm', 'vitals'];

export const EMPTY_CARE_ITEM: CareItemDraft = {
  name: '',
  dose: '',
  times: [{ time: '08:00', meal: undefined }],
  asNeeded: false,
  tip: '',
};

export const EMPTY_CARE_CONTACT: CareContactDraft = { kind: 'phone', value: '', label: '' };

function presetTime(id: CareCheckId): string {
  return CARE_CHECKPOINTS.find((checkpoint) => checkpoint.id === id)?.times?.[0] ?? '09:00';
}

/** A new care diary: one empty medicine, every vitals checkpoint on, PHQ-9 weekly. */
export function emptyCareDraft(): CareDraft {
  return {
    items: [EMPTY_CARE_ITEM],
    checks: {
      am: { on: true, time: presetTime('am') },
      pm: { on: true, time: presetTime('pm') },
      vitals: { on: true, time: presetTime('vitals') },
    },
    quizzes: [{ slug: 'phq-9', everyDays: 7 }],
    contacts: [EMPTY_CARE_CONTACT],
    crisis: '',
  };
}

/** The editor state of an issued care diary (to update it). */
export function careDraftFrom(invitation: DiaryInvitation): CareDraft {
  const tipOf = (target: string): string =>
    invitation.tips?.find((tip) => tip.target === target)?.text ?? '';
  const check = (id: CareCheckId): CareCheckDraft => {
    const found = invitation.checkpoints?.find(
      (checkpoint) => checkpoint.id === id && !checkpoint.ended,
    );
    return { on: Boolean(found), time: found?.times?.[0] ?? presetTime(id) };
  };
  const items = (invitation.plan ?? [])
    .filter((item) => !item.ended)
    .map(
      (item): CareItemDraft => ({
        id: item.id,
        name: item.name,
        dose: item.dose ?? '',
        times: (item.times ?? []).map((time) => ({ time: time.time, meal: time.meal })),
        asNeeded: item.asNeeded === true,
        tip: tipOf(item.id),
      }),
    );
  return {
    items: items.length ? items : [EMPTY_CARE_ITEM],
    checks: { am: check('am'), pm: check('pm'), vitals: check('vitals') },
    quizzes: (invitation.checkpoints ?? []).flatMap((checkpoint) =>
      checkpoint.kind === 'questionnaire' && checkpoint.questionnaire && !checkpoint.ended
        ? [{ slug: checkpoint.questionnaire, everyDays: checkpoint.everyDays ?? 7 }]
        : [],
    ),
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

function nextPlanId(taken: Set<string>): string {
  let number = 1;
  while (taken.has(`p${number}`)) number += 1;
  taken.add(`p${number}`);
  return `p${number}`;
}

export interface CareInvitationParts {
  readonly plan: readonly DiaryPlanItem[];
  readonly checkpoints: readonly DiaryCheckpoint[];
  readonly contacts: readonly DiaryContact[];
  readonly tips: readonly DiaryTip[];
  readonly crisis: readonly string[];
}

/**
 * The plan parts of the invitation. Items the doctor removed from an issued diary stay as ended,
 * so the patient's earlier marks still resolve; checkpoint ids are fixed (`am`, `pm`, `vitals`,
 * `q-<slug>`).
 */
export function careInvitationParts(
  draft: CareDraft,
  previous?: DiaryInvitation,
): CareInvitationParts {
  const taken = new Set<string>(previous?.plan?.map((item) => item.id) ?? []);
  for (const item of draft.items) if (item.id) taken.add(item.id);
  const filled = draft.items.filter((item) => item.name.trim());
  const plan: DiaryPlanItem[] = filled.map((item) => {
    const times = item.asNeeded
      ? []
      : [...new Map(item.times.map((time) => [time.time, time])).values()]
          .filter((time) => time.time)
          .map((time) => ({ time: time.time, ...(time.meal ? { meal: time.meal } : {}) }));
    return {
      id: item.id ?? nextPlanId(taken),
      name: item.name.trim(),
      ...(item.dose.trim() ? { dose: item.dose.trim() } : {}),
      ...(times.length ? { times } : {}),
      ...(item.asNeeded ? { asNeeded: true } : {}),
    };
  });
  const kept = new Set(plan.map((item) => item.id));
  const ended = (previous?.plan ?? [])
    .filter((item) => !kept.has(item.id))
    .map((item) => ({ ...item, ended: true }));

  const checkpoints: DiaryCheckpoint[] = CHECK_IDS.flatMap((id) => {
    const state = draft.checks[id];
    const preset = CARE_CHECKPOINTS.find((checkpoint) => checkpoint.id === id);
    return state.on && preset ? [{ ...preset, times: [state.time] }] : [];
  });
  for (const quiz of draft.quizzes) {
    const option = diaryQuestionnaire(quiz.slug);
    if (!option) continue;
    checkpoints.push({
      id: questionnaireCheckpointId(quiz.slug),
      kind: 'questionnaire',
      label: option.title,
      questionnaire: quiz.slug,
      everyDays: quiz.everyDays,
    });
  }

  const active = new Set(checkpoints.map((checkpoint) => checkpoint.id));
  for (const checkpoint of previous?.checkpoints ?? []) {
    if (!active.has(checkpoint.id)) checkpoints.push({ ...checkpoint, ended: true });
  }

  const tips: DiaryTip[] = filled.flatMap((item, index) => {
    const id = plan[index]?.id;
    const text = item.tip.trim();
    if (!text || !id) return [];
    // The same text keeps its id, so a tip the patient has read does not show «?» again.
    const same = previous?.tips?.find((tip) => tip.target === id && tip.text === text);
    return [
      { id: same?.id ?? `t-${id}-${Date.now().toString(36)}`.slice(0, 24), target: id, text },
    ];
  });

  return {
    plan: [...plan, ...ended],
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
 * an issued one, which keeps its id, title and fields and sorts after it.
 */
export function careInvitation(input: {
  readonly id: string;
  readonly draft: CareDraft;
  readonly doctor: string;
  readonly note: string;
  readonly previous?: DiaryInvitation | undefined;
  /** Tips edited outside the medicine rows (checkpoints); medicine tips come from the draft. */
  readonly extraTips?: readonly DiaryTip[];
}): DiaryInvitation {
  const template = diaryTemplate('care');
  const parts = careInvitationParts(input.draft, input.previous);
  if (!parts.plan.some((item) => !item.ended)) throw new Error('Добавьте хотя бы один препарат.');
  const issuedAt = input.previous
    ? new Date(Math.max(Date.now(), Date.parse(input.previous.issuedAt) + 1000)).toISOString()
    : new Date().toISOString();
  const tipTargets = new Set(parts.tips.map((tip) => tip.target));
  const tips = [
    ...parts.tips,
    ...(input.extraTips ?? []).filter((tip) => !tipTargets.has(tip.target) && tip.text.trim()),
  ];
  return parseDiaryInvitation({
    v: DIARY_FORMAT_VERSION,
    id: input.id,
    template: 'care',
    title: input.previous?.title ?? template?.title ?? 'Дневник лечения',
    issuedAt,
    fields: input.previous?.fields ?? template?.fields ?? [],
    plan: parts.plan,
    planTitle: 'Лекарства',
    ...(parts.checkpoints.length ? { checkpoints: parts.checkpoints } : {}),
    ...(parts.contacts.length ? { contacts: parts.contacts } : {}),
    ...(tips.length ? { tips } : {}),
    ...(parts.crisis.length ? { crisis: parts.crisis } : {}),
    consent: true,
    ...(input.doctor.trim() ? { doctor: input.doctor.trim() } : {}),
    ...(input.note.trim() ? { note: input.note.trim() } : {}),
  });
}
