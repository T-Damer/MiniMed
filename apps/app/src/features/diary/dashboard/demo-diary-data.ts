/**
 * Invented diary entries for the demo patients: dose marks, wellbeing, vitals, questionnaires,
 * choices and short notes of a few weeks that end today. Pure and deterministic for a seed — no
 * network, no storage, no clock besides the `now` it is given — so the shape of the data can be
 * tested; `demo-patients.ts` writes it through a real paired device.
 */
import { addDays, atTime, CARE_DOSE_FIELD, dayKey, onCourse } from '@/features/diary/diary-care';
import {
  activePlanItems,
  type DiaryCheckpoint,
  type DiaryEntry,
  type DiaryField,
  type DiaryInvitation,
  type DiaryValue,
} from '@/features/diary/diary-model';

export type DemoTrend = 'improving' | 'fluctuating' | 'worsening' | 'stable';

/** Average vital signs of a patient; the generator scatters them around these. */
export interface DemoVitals {
  readonly pulse: number;
  readonly systolic: number;
  readonly diastolic: number;
  readonly spo2: number;
}

/** How a demo patient behaves, independent of the plan the doctor wrote. */
export interface DemoBehavior {
  readonly trend: DemoTrend;
  /** Share of planned intakes the patient marks as taken, 0–1. */
  readonly adherence: number;
  readonly vitals: DemoVitals;
  /** The latest PHQ-9 gets a positive item 9, to show the urgent alert. */
  readonly urgentAlert: boolean;
}

/** The questions of a questionnaire the generator fills: summed items and any extra questions. */
export interface QuestionnaireShape {
  /** Items that add up to the total (including the alert item). */
  readonly items: readonly string[];
  /** Questions outside the total (PHQ-9: how hard the problems make daily life). */
  readonly extras: readonly string[];
  /** The item whose positive answer raises an alert (PHQ-9 item 9). */
  readonly alertItem?: string;
}

export interface DemoDiaryInput {
  readonly invitation: DiaryInvitation;
  readonly behavior: DemoBehavior;
  /** Questionnaire slug → its questions. */
  readonly questionnaires: Readonly<Record<string, QuestionnaireShape>>;
  /** Nothing is generated after this moment. */
  readonly now: Date;
  /** Days of history, today included. */
  readonly days: number;
  readonly seed: number;
}

export interface DemoDiary {
  readonly entries: readonly DiaryEntry[];
  /** When the patient confirmed the consent summaries. */
  readonly consentAt: string;
  /** The questionnaire entry that carries the urgent answer, when the behaviour asks for one. */
  readonly alertEntryId: string | undefined;
}

type Random = () => number;

function mulberry32(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Roughly normal with a standard deviation of 1. */
function gauss(random: Random): number {
  return (random() + random() + random() + random() - 2) * 1.732;
}

function between(random: Random, low: number, high: number): number {
  return low + random() * (high - low);
}

function pick<T>(random: Random, items: readonly T[]): T {
  return items[Math.min(items.length - 1, Math.floor(random() * items.length))] as T;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** The day the diary was issued: the evening before the first day of the history. */
export function demoIssuedAt(now: Date, days: number): string {
  return atTime(addDays(dayKey(now), -days), '18:00');
}

/** The mood of day `index` of `count`, 0–10, before daily noise. */
function baseMood(trend: DemoTrend, index: number, count: number, phase: number): number {
  const progress = count > 1 ? index / (count - 1) : 1;
  switch (trend) {
    case 'improving':
      return 3.4 + 3.8 * (1 - (1 - progress) ** 1.6);
    case 'fluctuating':
      return 5.1 + 2 * Math.sin(index * 0.85 + phase) + 0.9 * Math.sin(index * 0.29 + phase * 2);
    case 'worsening': {
      const from = Math.max(0, count - 6);
      return index < from
        ? 6.7 + 0.5 * Math.sin(index * 0.7 + phase)
        : 6.7 - (index - from + 1) * 0.65;
    }
    case 'stable':
      return 7.5 + 0.5 * Math.sin(index * 0.5 + phase);
  }
}

const NOTES = {
  low: [
    'Тяжело вставать, ничего не хочется делать.',
    'С утра тревожно, сердце колотится. Сон плохой.',
    'Раздражение по пустякам, не могу сосредоточиться.',
    'Почти весь день лежу, сил нет.',
    'Мысли крутятся по кругу, к вечеру стало хуже.',
  ],
  middle: [
    'Состояние ровное, к вечеру накатывает усталость.',
    'Утром было тревожно, после прогулки стало легче.',
    'Сон поверхностный, просыпаюсь ночью.',
    'Аппетит вернулся наполовину, настроение неустойчивое.',
    'Справляюсь с делами, но через силу.',
  ],
  high: [
    'Хороший день: прогулка, обед с друзьями.',
    'Появились силы заниматься делами, тревоги меньше.',
    'Сон лучше, утром есть энергия.',
    'Настроение ровное, начинаю возвращаться к привычному ритму.',
    'Целый день на работе, к вечеру силы ещё остались.',
  ],
} as const;

const DAY_TEXTS = {
  low: [
    'Весь день как в тумане, ничего не успеваю.',
    'Были слёзы, разговор с мамой немного помог.',
    'Хотелось отменить встречу, но на улицу всё же удалось выйти.',
  ],
  middle: [
    'Работа, потом прогулка. Вечером усталость.',
    'День прошёл спокойно, немного беспокоила бессонница.',
    'Магазин, ужин, фильм вечером.',
  ],
  high: [
    'Продуктивный день: работа, спорт, вечер с семьёй.',
    'Встреча с друзьями, давно не было так весело.',
    'Закончены начатые дела, вечером чтение.',
  ],
} as const;

const SKIP_NOTES = [
  'Пропуск: забылось.',
  'Пропуск: тошнило с утра.',
  'Пропуск: не было с собой таблеток.',
  'Пропуск: ранняя смена на работе.',
];

const AFTER_EFFECTS = ['стало лучше', 'без изменений', 'сонливость'];

function tier(mood: number): 'low' | 'middle' | 'high' {
  if (mood < 4) return 'low';
  return mood < 6.2 ? 'middle' : 'high';
}

/** Moves a moment by minutes and keeps it inside its own local day. */
function moment(day: string, time: string, shiftMinutes: number): number {
  const target = Date.parse(atTime(day, time)) + shiftMinutes * 60_000;
  return clamp(target, Date.parse(atTime(day, '00:05')), Date.parse(atTime(day, '23:55')));
}

function questionnaireAnswers(
  random: Random,
  shape: QuestionnaireShape,
  mood: number,
  alert: boolean,
): Record<string, number> {
  const answers: Record<string, number> = {};
  const free = shape.items.filter((item) => item !== shape.alertItem);
  for (const item of shape.items) answers[item] = 0;
  if (shape.alertItem && alert) answers[shape.alertItem] = 1;
  const severity = clamp(((10 - mood) / 10) * 0.9 + between(random, -0.05, 0.05), 0, 1);
  let left = Math.round(severity * 3 * free.length);
  while (left > 0) {
    const open = free.filter((item) => (answers[item] ?? 0) < 3);
    if (!open.length) break;
    const item = pick(random, open);
    answers[item] = (answers[item] ?? 0) + 1;
    left -= 1;
  }
  for (const extra of shape.extras) {
    answers[extra] = severity < 0.15 ? 0 : severity < 0.4 ? 1 : severity < 0.65 ? 2 : 3;
  }
  return answers;
}

function fieldOf(invitation: DiaryInvitation, checkpoint: DiaryCheckpoint): DiaryField | undefined {
  const id = checkpoint.fields?.[0];
  return invitation.fields.find((field) => field.id === id);
}

/** Back-filled diary of a demo patient, oldest first. Every entry is valid for the invitation. */
export function generateDemoDiary(input: DemoDiaryInput): DemoDiary {
  const { invitation, behavior, questionnaires, now, days } = input;
  const random = mulberry32(input.seed);
  const phase = random() * Math.PI * 2;
  const nowMs = now.getTime();
  const today = dayKey(now);
  const startDay = addDays(today, -(days - 1));
  const entries: DiaryEntry[] = [];
  const usedIds = new Set<string>();
  let alertEntryId: string | undefined;

  const newId = (): string => {
    for (;;) {
      let id = 'd';
      for (let index = 0; index < 11; index += 1) id += Math.floor(random() * 36).toString(36);
      if (!usedIds.has(id)) {
        usedIds.add(id);
        return id;
      }
    }
  };

  const add = (
    at: number,
    entry: {
      readonly values: Record<string, DiaryValue>;
      readonly check?: string;
      readonly note?: string;
      readonly answers?: Record<string, number>;
    },
  ): DiaryEntry | undefined => {
    // Nothing from the future: the end of today stays empty.
    if (at > nowMs - 60_000) return undefined;
    const made: DiaryEntry = {
      id: newId(),
      at: new Date(at).toISOString(),
      values: entry.values,
      ...(entry.check ? { check: entry.check } : {}),
      ...(entry.note ? { note: entry.note } : {}),
      ...(entry.answers ? { answers: entry.answers } : {}),
    };
    entries.push(made);
    return made;
  };

  const moods: number[] = [];
  for (let index = 0; index < days; index += 1) {
    moods.push(clamp(baseMood(behavior.trend, index, days, phase), 0.5, 9.5));
  }
  const checkpoints = (invitation.checkpoints ?? []).filter((checkpoint) => !checkpoint.ended);
  let lastNote = -1;

  for (let index = 0; index < days; index += 1) {
    const day = addDays(startDay, index);
    const mood = moods[index] ?? 5;
    const adherence =
      behavior.adherence * (behavior.trend === 'worsening' && index >= days - 6 ? 0.7 : 1);

    for (const item of activePlanItems(invitation)) {
      if (!onCourse(item, day)) continue;
      if (item.asNeeded) {
        const chance = clamp(0.2 + (7 - mood) * 0.04, 0.05, 0.6);
        if (random() < chance) {
          add(moment(day, '14:00', Math.round(between(random, 0, 480))), {
            values: { [CARE_DOSE_FIELD]: { item: item.id, done: true } },
          });
        }
        continue;
      }
      for (const time of item.times ?? []) {
        const roll = random();
        if (roll < adherence) {
          const late = random() < 0.12;
          const shift = late ? between(random, 60, 150) : between(random, -5, 25);
          const values: Record<string, DiaryValue> = {
            [CARE_DOSE_FIELD]: { item: item.id, done: true, slot: time.time },
          };
          const effects = AFTER_EFFECTS.filter((effect) =>
            invitation.fields.find((field) => field.id === 'after')?.options?.includes(effect),
          );
          if (effects.length && random() < 0.1) values['after'] = [pick(random, effects)];
          add(moment(day, time.time, Math.round(shift)), { values });
        } else if (roll < adherence + (1 - adherence) * 0.55) {
          add(moment(day, time.time, Math.round(between(random, 0, 40))), {
            values: { [CARE_DOSE_FIELD]: { item: item.id, done: false, slot: time.time } },
            ...(random() < 0.5 ? { note: pick(random, SKIP_NOTES) } : {}),
          });
        }
      }
    }

    for (const checkpoint of checkpoints) {
      const field = fieldOf(invitation, checkpoint);
      switch (checkpoint.kind) {
        case 'score': {
          for (const time of checkpoint.times?.length ? checkpoint.times : ['12:00']) {
            if (random() > 0.92 || !field) continue;
            const evening = time >= '12:00';
            const offset = evening
              ? 0.3 - (behavior.trend === 'worsening' && index >= days - 6 ? 0.3 : 0)
              : -0.4;
            const score = clamp(Math.round(mood + offset + gauss(random) * 0.7), 0, 10);
            add(moment(day, time, Math.round(between(random, -10, 35))), {
              check: checkpoint.id,
              values: { [field.id]: score },
            });
          }
          break;
        }
        case 'vitals': {
          if (random() > 0.8) break;
          const { vitals } = behavior;
          const strain = 6.5 - mood;
          const wanted = new Set(checkpoint.fields ?? []);
          const systolic = Math.round(vitals.systolic + gauss(random) * 6 + strain);
          const values: Record<string, DiaryValue> = {};
          if (wanted.has('pulse')) {
            values['pulse'] = Math.round(
              clamp(vitals.pulse + gauss(random) * 6 + strain * 1.8, 48, 130),
            );
          }
          if (wanted.has('systolic')) values['systolic'] = clamp(systolic, 90, 175);
          if (wanted.has('diastolic')) {
            values['diastolic'] = Math.round(
              clamp(vitals.diastolic + gauss(random) * 4 + strain * 0.6, 55, systolic - 25),
            );
          }
          if (wanted.has('spo2')) {
            values['spo2'] = Math.round(clamp(vitals.spo2 + gauss(random) * 0.8, 94, 100));
          }
          add(moment(day, checkpoint.times?.[0] ?? '09:00', Math.round(between(random, 0, 25))), {
            check: checkpoint.id,
            values,
          });
          break;
        }
        case 'choice': {
          const options = field?.options ?? [];
          if (!field || options.length < 2 || random() > 0.85) break;
          const level = tier(mood + gauss(random) * 0.8);
          const chosen =
            level === 'high' ? options[0] : level === 'middle' ? options[1] : options.at(-1);
          add(moment(day, checkpoint.times?.[0] ?? '09:00', Math.round(between(random, 0, 40))), {
            check: checkpoint.id,
            values: { [field.id]: chosen ?? options[0] ?? '' },
          });
          break;
        }
        case 'text': {
          if (!field || random() > 0.8) break;
          add(moment(day, checkpoint.times?.[0] ?? '21:00', Math.round(between(random, 0, 70))), {
            check: checkpoint.id,
            values: { [field.id]: pick(random, DAY_TEXTS[tier(mood)]) },
          });
          break;
        }
        case 'questionnaire':
          // Scheduled below, counting back from today so the latest answers are fresh.
          break;
      }
    }

    // A short free description of the state, more often on a bad day.
    if (invitation.fields.some((field) => field.id === 'state')) {
      if (random() < (mood < 4.5 ? 0.4 : 0.2)) {
        const pool = NOTES[tier(mood)];
        let choice = Math.floor(random() * pool.length);
        if (choice === lastNote) choice = (choice + 1) % pool.length;
        lastNote = choice;
        add(moment(day, '12:00', Math.round(between(random, 0, 460))), {
          values: { state: pool[choice] as string },
        });
      }
    }
  }

  // Questionnaires: every `everyDays` days back from yesterday, never on the first day.
  for (const checkpoint of checkpoints) {
    if (checkpoint.kind !== 'questionnaire' || !checkpoint.questionnaire) continue;
    const shape = questionnaires[checkpoint.questionnaire];
    if (!shape) throw new Error(`Нет вопросов опросника ${checkpoint.questionnaire}.`);
    const every = checkpoint.everyDays ?? 7;
    const indexes: number[] = [];
    for (let index = days - 2; index >= 1; index -= every) indexes.push(index);
    indexes.reverse();
    indexes.forEach((index, position) => {
      const mood = moods[index] ?? 5;
      const urgent =
        behavior.urgentAlert && position === indexes.length - 1 && alertEntryId === undefined;
      const answers = questionnaireAnswers(random, shape, mood, urgent && !!shape.alertItem);
      const made = add(
        moment(addDays(startDay, index), '12:00', Math.round(between(random, -30, 60))),
        {
          check: checkpoint.id,
          values: {},
          answers,
        },
      );
      if (made && urgent && shape.alertItem) alertEntryId = made.id;
    });
  }

  entries.sort((left, right) => left.at.localeCompare(right.at));
  return {
    entries,
    consentAt: new Date(Date.parse(demoIssuedAt(now, days)) + 20 * 60_000).toISOString(),
    alertEntryId,
  };
}
