import { randomId } from '@localmed/diary-sync';
import { type CareSectionDraft, newCareSection } from '@/features/diary/diary-care-draft';

export const DICTATED_PLAN_TEXT_LIMIT = 3000;

export interface DictatedPlanRow {
  readonly source: string;
  readonly section: CareSectionDraft;
}

export interface DictatedPlan {
  readonly rows: readonly DictatedPlanRow[];
}

const DOSE =
  /^([\p{L}][\p{L}\d-]*(?:\s+[\p{L}][\p{L}\d-]*){0,2}?)(?:\s*,\s*|\s+)(?:по\s+)?(\d+(?:[.,]\d+)?|один|одн(?:а|у|ой)|два|две|три|четыре|пять|шесть|семь|восемь|девять|десять|одиннадцать|двенадцать)\s*(мкг|мг|г|мл|ме|ед|миллиграмм(?:а|ов)?|микрограмм(?:а|ов)?|миллилитр(?:а|ов)?|таблет(?:ка|ки|ок|ку|ке)|капсул(?:а|ы|у|е)?)(?=\s|$)/iu;
const COMPLEX =
  /(?:^|\s)(?:не|если|либо|отмен\p{L}*|уменьш\p{L}*|повыс\p{L}*|увелич\p{L}*|сниз\p{L}*|вместо|поменя\p{L}*|прекрат\p{L}*|замен\p{L}*|титр\p{L}*|принима\p{L}*)(?=\s|$)/iu;
const CLOCK = /^(?:[01]?\d|2[0-3]):[0-5]\d$/u;
const HOURS = [
  'ноль',
  'один',
  'два',
  'три',
  'четыре',
  'пять',
  'шесть',
  'семь',
  'восемь',
  'девять',
  'десять',
  'одиннадцать',
  'двенадцать',
];
const SPOKEN_UNITS = [
  ['миллиграмм', 'мг'],
  ['микрограмм', 'мкг'],
  ['миллилитр', 'мл'],
  ['таблет', 'табл.'],
  ['капсул', 'капс.'],
] as const;

function exactTime(value: string): string | undefined {
  const time = value.trim().replace(/^(?:в|к)\s+/u, '');
  if (CLOCK.test(time)) return time.padStart(5, '0');
  const match = /^(\d{1,2}|[а-яё]+)(?:\s+час(?:а|ов)?)?(?:\s+(утра|вечера|дня|ночи))?$/u.exec(time);
  if (!match?.[1]) return undefined;
  const [, spoken, period] = match;
  const numeric = /^\d/u.test(spoken);
  const hour = numeric ? Number(spoken) : HOURS.indexOf(spoken);
  if (hour < 0 || hour > 23) return undefined;
  if (!period) {
    if (!numeric || (hour < 13 && !spoken.startsWith('0'))) return undefined;
    return `${String(hour).padStart(2, '0')}:00`;
  }
  if (hour < 1 || hour > 12) return undefined;
  if (period === 'ночи' && hour !== 12 && hour > 5) return undefined;
  if (period === 'утра' && hour === 12) return undefined;
  const afternoon = period === 'дня' || period === 'вечера';
  return `${String((hour % 12) + (afternoon ? 12 : 0)).padStart(2, '0')}:00`;
}

function doseText(rawAmount: string, rawUnit: string): string {
  const amount = rawAmount.toLocaleLowerCase('ru-RU');
  const unit = rawUnit.toLocaleLowerCase('ru-RU');
  const known = amount.startsWith('одн') ? 1 : amount === 'две' ? 2 : HOURS.indexOf(amount);
  const symbols = SPOKEN_UNITS.find(([prefix]) => unit.startsWith(prefix))?.[1] ?? unit;
  return `${known >= 0 ? known : amount} ${symbols}`;
}

/** Each source line stays visible in review, including speech the small grammar cannot place. */
export function dictatedPlan(transcript: string): DictatedPlan {
  const clauses = transcript.split(/\r?\n|;|(?<=[.!?])\s+(?=[А-ЯЁA-Z])/u);
  return {
    rows: clauses
      .map((clause) => clause.trim())
      .filter(Boolean)
      .map((source) => {
        const section = { ...newCareSection('drug'), id: `d-${randomId(16)}`, times: [] };
        const words = source
          .replace(/[.!?]+$/u, '')
          .replace(/^назнач(?:ить|аю|ьте)\s+(?:пациент(?:у|ке)\s+)?/iu, '')
          .trim();
        const match = COMPLEX.test(words) ? undefined : DOSE.exec(words);
        const name = match?.[1];
        const amount = match?.[2];
        const unit = match?.[3];
        if (!match || !name || !amount || !unit) return { source, section };

        const rest = words
          .slice(match[0].length)
          .trim()
          .replace(/^,\s*/u, '')
          .toLocaleLowerCase('ru-RU');
        const asNeeded = rest === 'при необходимости';
        // Leave the whole schedule open if any of it is unclear. A mixed schedule must not be shortened.
        const parsed = asNeeded || !rest ? [] : rest.split(/\s*,\s*|\s+и\s+/u).map(exactTime);
        const times = parsed.every((item) => item !== undefined) ? [...new Set(parsed)] : [];
        return {
          source,
          section: {
            ...section,
            title: name,
            dose: /(?:^|\s)по\s/u.test(rest) ? '' : doseText(amount, unit),
            times: times.map((time) => ({ time, meal: undefined })),
            asNeeded,
          },
        };
      }),
  };
}

export function dictatedRowIssue(section: CareSectionDraft): string | undefined {
  if (!section.title.trim() || !section.dose.trim()) return 'Заполните название и дозу.';
  if (
    !section.asNeeded &&
    (!section.times.length || section.times.some((item) => !CLOCK.test(item.time)))
  ) {
    return 'Укажите точное время или выберите «При необходимости».';
  }
  return undefined;
}
