/**
 * The condition row of a drug card (owner 2026-11-03, «как у Видаля»): pregnancy, breastfeeding,
 * children, the elderly, liver and kidney impairment and driving, each with a level read from the
 * instruction open on screen. Pure and deterministic: the level comes from the section a sentence
 * sits in (Противопоказания, С осторожностью, …) and a few fixed phrases; every level is backed by
 * the quoted sentences, which the sheet shows verbatim with a link into the text.
 */
import type { MedicalDocument } from '@localmed/contracts';

import { splitSentenceSpans } from '@/features/drug-interactions/interaction-text';
import { repairWrappedInstructionText } from '@/features/library/instruction-text-repair';

export type ConditionId =
  | 'pregnancy'
  | 'lactation'
  | 'children'
  | 'elderly'
  | 'liver'
  | 'kidney'
  | 'driving';

/** Worst first: the row shows the worst level any quoted sentence carries. */
export type ConditionLevel = 'contraindicated' | 'caution' | 'allowed' | 'unknown';

export type MentionOrigin =
  | 'contraindications'
  | 'caution'
  | 'pregnancy'
  | 'dosage'
  | 'special'
  | 'other';

export interface ConditionMention {
  readonly sectionTitle: string;
  readonly origin: MentionOrigin;
  readonly text: string;
  readonly anchor: string | null;
  /** The level this sentence gives, or null when it only names the condition. */
  readonly level: ConditionLevel | null;
  /** Only a form or stage is contraindicated («тяжёлая печёночная недостаточность», «до 3 лет»). */
  readonly partial: boolean;
}

export interface ConditionFinding {
  readonly id: ConditionId;
  readonly level: ConditionLevel;
  /** One short line for the sheet: «Противопоказано при тяжёлых нарушениях». */
  readonly summary: string;
  readonly mentions: readonly ConditionMention[];
}

export interface ConditionSectionInput {
  readonly type: string | null;
  readonly title: string;
  readonly chunks: readonly { readonly text: string; readonly anchor: string | null }[];
}

export const CONDITION_ORDER: readonly ConditionId[] = [
  'pregnancy',
  'lactation',
  'children',
  'elderly',
  'liver',
  'kidney',
  'driving',
];

export const CONDITION_LABELS: Readonly<Record<ConditionId, string>> = {
  pregnancy: 'Беременность',
  lactation: 'Грудное вскармливание',
  children: 'Дети',
  elderly: 'Пожилые',
  liver: 'Печень',
  kidney: 'Почки',
  driving: 'Вождение',
};

/** Short labels under the icons. */
export const CONDITION_SHORT_LABELS: Readonly<Record<ConditionId, string>> = {
  pregnancy: 'Берем.',
  lactation: 'ГВ',
  children: 'Дети',
  elderly: 'Пожил.',
  liver: 'Печень',
  kidney: 'Почки',
  driving: 'Авто',
};

export const LEVEL_LABELS: Readonly<Record<ConditionLevel, string>> = {
  contraindicated: 'Противопоказано',
  caution: 'С осторожностью',
  allowed: 'Без ограничений',
  unknown: 'Нет данных',
};

const NOT_LETTER = '(?<!\\p{L})';

const CONDITION_WORDS: Readonly<Record<ConditionId, RegExp>> = {
  pregnancy: new RegExp(`${NOT_LETTER}(?:беременн|триместр|плод[ауе]?(?!\\p{L})|зачати)`, 'u'),
  lactation: new RegExp(
    `${NOT_LETTER}(?:лактаци|грудн\\p{L}*\\s+(?:вскармлив|молок|кормлен)|кормлени\\p{L}*\\s+грудью|кормящ|грудного\\s+молока)`,
    'u',
  ),
  children: new RegExp(
    `${NOT_LETTER}(?:дет(?!ородн)\\p{L}*|ребен\\p{L}*|подрост\\p{L}*|новорожд\\p{L}*|младен\\p{L}*|недонош\\p{L}*|педиатр\\p{L}*)`,
    'u',
  ),
  elderly: new RegExp(
    `${NOT_LETTER}(?:пожил|преклонн|старческ|гериатр|(?:старше|после|от)\\s+(?:6[05]|7[05]|80)\\s*(?:-\\s*ти\\s*)?лет)`,
    'u',
  ),
  liver: new RegExp(
    `${NOT_LETTER}(?:печен|печеноч|гепатит|цирроз|холестаз|гепатоцеллюлярн|(?:класс\\p{L}*\\s+)?чайлд)`,
    'u',
  ),
  kidney: new RegExp(
    `${NOT_LETTER}(?:почеч|почк|почек|клиренс\\p{L}*\\s+креатинин|кк\\s*[<≤>≥]|скф|гемодиализ|диализ|нефро)`,
    'u',
  ),
  driving: new RegExp(
    `${NOT_LETTER}(?:транспортн\\p{L}*\\s+средств|вождени|(?:управлени|работ)\\p{L}*\\s+(?:с\\s+)?(?:\\p{L}+\\s+){0,3}(?:автомобил|транспорт|механизм|машин)|концентрац\\p{L}*\\s+внимани|скорост\\p{L}*\\s+психомоторн)`,
    'u',
  ),
};

/** «Не противопоказан», «коррекции дозы не требуется»: read before the stronger phrases. */
const ALLOWED_WORDS =
  /не\s+противопоказан|коррекци\p{L}*\s+(?:режима\s+)?доз\p{L}*\s+не\s+требу|не\s+требу\p{L}*\s+коррекци|не\s+влия\p{L}*|не\s+оказыва\p{L}*\s+(?:\p{L}+\s+)?влияни|может\s+(?:быть\s+)?примен|можно\s+примен|разреш[её]н|допуска\p{L}*\s+примен|безопасн\p{L}*\s+(?:при|для|у)/u;
const CONTRA_WORDS =
  /противопоказ|не\s+(?:следует\s+|должен\s+|должны\s+)?(?:применять|назначать|принимать|использовать)|не\s+применя\p{L}*|запрещ|недопустим|нельзя|прекратить\s+грудное|прекращ\p{L}*\s+грудного/u;
const CAUTION_WORDS =
  /осторожн|данн\p{L}*\s+(?:[^.]{0,80}\s)?недостаточн|(?:недостаточн|ограниченн)\p{L}*\s+(?:\p{L}+\s+)?(?:данн|количеств|информаци|опыт)|не\s+(?:изучен|установлен)|не\s+рекоменд|коррекци\p{L}*\s+(?:режима\s+)?доз|сниж\p{L}*\s+доз|уменьш\p{L}*\s+доз|сниж\p{L}*\s+(?:начальн|суточн)|контрол\p{L}*|мониторинг|наблюдени|только\s+(?:в\s+случа|если|по\s+(?:строгим|жизненным))|ожидаем\p{L}*\s+польз|превыша\p{L}*\s+потенциальн|риск|воздерж|отказ\p{L}*\s+от\s+управлени|снижени\p{L}*\s+(?:скорости|концентрации)|увеличени\p{L}*\s+интервал/u;
/** A contraindication that names only a stage or form of the condition. */
const PARTIAL_WORDS =
  /тяж[её]л|выраженн|декомпенс|терминальн|клиренс|кк\s*[<≤]|скф\s*[<≤]|класс\p{L}*\s+[bcвс]|триместр|(?:до|младше)\s+(\d+)\s*(?:-\s*ти\s*)?(лет|год|мес)/u;

const ORIGIN_BY_TYPE: Readonly<Record<string, MentionOrigin>> = {
  contraindications: 'contraindications',
  caution: 'caution',
  pregnancy: 'pregnancy',
  dosage: 'dosage',
  'special-instructions': 'special',
};

/** Sections that never say anything about who may take the drug. */
const SKIPPED_TYPES = new Set([
  'composition',
  'adverse-effects',
  'overdose',
  'pharmacology',
  'release-form',
  'storage',
  'dispensing',
  'registration',
  'indications',
  'interactions',
]);

const MAX_MENTIONS = 12;
const HEADING_MAX = 90;
const ADULT_YEARS = 18;
const LEVEL_RANK: Readonly<Record<ConditionLevel, number>> = {
  contraindicated: 3,
  caution: 2,
  allowed: 1,
  unknown: 0,
};

function normalized(text: string): string {
  return text.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е');
}

/**
 * Where a section's sentences come from. Untyped sections are mostly page stamps («ЛП-№…», «МЗ РФ»)
 * that cut a section in two: they continue the section before them.
 */
function originOf(
  section: ConditionSectionInput,
  previous: MentionOrigin | null | undefined,
): MentionOrigin | null {
  if (section.type && SKIPPED_TYPES.has(section.type)) return null;
  const title = normalized(section.title);
  if (/противопоказ/u.test(title)) return 'contraindications';
  if (/осторожн/u.test(title)) return 'caution';
  if (/беременн|лактац|вскармлив/u.test(title)) return 'pregnancy';
  const typed = section.type ? ORIGIN_BY_TYPE[section.type] : undefined;
  if (typed) return typed;
  return previous === undefined ? 'other' : previous;
}

function isPartial(sentence: string, id: ConditionId): boolean {
  const match = PARTIAL_WORDS.exec(sentence);
  if (!match) return false;
  // «детский возраст до 18 лет» rules out every child; «до 3 лет» only the youngest.
  if (match[1] !== undefined) {
    if (id !== 'children') return false;
    const amount = Number(match[1]);
    return match[2]?.startsWith('мес') === true || amount < ADULT_YEARS;
  }
  return true;
}

/** «(см. раздел "Противопоказания")» points elsewhere; it says nothing itself. */
const CROSS_REFERENCE = /\(?\s*см\.?\s+(?:также\s+)?(?:раздел|подраздел|пункт)\p{L}*[^)]*\)?/gu;

function sentenceLevel(
  sentence: string,
  id: ConditionId,
  origin: MentionOrigin,
): { level: ConditionLevel | null; partial: boolean } {
  if (origin === 'contraindications') {
    const partial = isPartial(sentence, id);
    return { level: partial ? 'caution' : 'contraindicated', partial };
  }
  if (origin === 'caution') return { level: 'caution', partial: false };
  const own = sentence.replace(CROSS_REFERENCE, ' ');
  if (ALLOWED_WORDS.test(own)) return { level: 'allowed', partial: false };
  if (CONTRA_WORDS.test(own)) {
    const partial = isPartial(own, id);
    return { level: partial ? 'caution' : 'contraindicated', partial };
  }
  if (CAUTION_WORDS.test(own)) return { level: 'caution', partial: false };
  // A dose for children in «Способ применения» is a dose: the drug is given to them.
  if (id === 'children' && origin === 'dosage') return { level: 'allowed', partial: false };
  return { level: null, partial: false };
}

function summaryOf(id: ConditionId, level: ConditionLevel, mentions: readonly ConditionMention[]) {
  if (level === 'caution' && mentions.some((mention) => mention.partial)) {
    return id === 'children' || id === 'pregnancy'
      ? 'Противопоказано в части случаев'
      : 'Противопоказано при тяжёлых нарушениях';
  }
  if (level === 'unknown' && mentions.length > 0) return 'Упоминается в инструкции';
  return LEVEL_LABELS[level];
}

/**
 * Sentences, and the items of a list sentence: «…; тяжелые нарушения функции печени; беременность;
 * детский возраст до 18 лет.» is judged item by item, so «тяжелые» qualifies only the liver.
 */
function clausesOf(text: string): readonly string[] {
  return repairWrappedInstructionText(text)
    .split(/\n\s*\n|\n(?=\s*[-–—•*]\s)/u)
    .map((paragraph) =>
      paragraph
        .replace(/(\p{Ll})-\n(\p{Ll})/gu, '$1$2')
        .replace(/\s*\n\s*/gu, ' ')
        .replace(/^\s*[-–—•*]\s+/u, '')
        .trim(),
    )
    .filter((paragraph) => paragraph.length > 0)
    .flatMap((paragraph) =>
      splitSentenceSpans(paragraph).flatMap((span) =>
        paragraph
          .slice(span.start, span.end)
          .split(';')
          .map((clause) => clause.trim())
          .filter((clause) => clause.length > 0),
      ),
    );
}

/** The seven conditions of one instruction, in `CONDITION_ORDER`. */
export function drugConditions(
  sections: readonly ConditionSectionInput[],
): readonly ConditionFinding[] {
  const mentions = new Map<ConditionId, ConditionMention[]>(CONDITION_ORDER.map((id) => [id, []]));
  let previous: MentionOrigin | null | undefined;
  for (const section of sections) {
    const origin = originOf(section, previous);
    previous = origin;
    if (!origin) continue;
    const title = normalized(section.title);
    const drivingSection = /управлять\s+транспорт|управлени\p{L}*\s+транспорт/u.test(title);
    // «Применение при беременности и в период грудного вскармливания: Противопоказано.» — a
    // sentence that names neither topic speaks about the ones the heading names.
    const titleTopics = CONDITION_ORDER.filter(
      (id) => (id === 'pregnancy' || id === 'lactation') && CONDITION_WORDS[id].test(title),
    );
    for (const chunk of section.chunks) {
      for (const text of clausesOf(chunk.text)) {
        // A bare heading («Применение у детей») names a condition but says nothing about it.
        // List items of «Противопоказания» look the same and do count.
        const listed = origin === 'contraindications' || origin === 'caution';
        if (!listed && text.length < HEADING_MAX && !/[.!?:;)»]$/u.test(text)) continue;
        const words = normalized(text);
        const namesTopic =
          CONDITION_WORDS.pregnancy.test(words) || CONDITION_WORDS.lactation.test(words);
        for (const id of CONDITION_ORDER) {
          const named =
            id === 'driving'
              ? drivingSection || CONDITION_WORDS.driving.test(words)
              : CONDITION_WORDS[id].test(words) ||
                (origin === 'pregnancy' && !namesTopic && titleTopics.includes(id));
          if (!named) continue;
          // Driving is read only where the instruction speaks about it.
          if (id === 'driving' && !drivingSection && origin !== 'special') continue;
          const list = mentions.get(id);
          if (!list || list.length >= MAX_MENTIONS) continue;
          // In the driving section a sentence about something else is quoted, but sets no level.
          const { level, partial } =
            id === 'driving' && !CONDITION_WORDS.driving.test(words)
              ? { level: null, partial: false }
              : sentenceLevel(words, id, origin);
          list.push({
            sectionTitle: section.title,
            origin,
            text,
            anchor: chunk.anchor,
            level,
            partial,
          });
        }
      }
    }
  }
  return CONDITION_ORDER.map((id) => {
    const list = mentions.get(id) ?? [];
    const level = list.reduce<ConditionLevel>(
      (worst, mention) =>
        mention.level && LEVEL_RANK[mention.level] > LEVEL_RANK[worst] ? mention.level : worst,
      'unknown',
    );
    return { id, level, summary: summaryOf(id, level, list), mentions: list };
  });
}

/** The conditions of an instruction document, or null when it is not one. */
export function documentConditions(document: MedicalDocument): readonly ConditionFinding[] | null {
  if (document.sourceType !== 'official_drug_instruction') return null;
  return drugConditions(
    document.sections.map((section) => ({
      type: section.sectionType,
      title: section.title,
      chunks: section.chunks
        .toSorted((left, right) => left.orderIndex - right.orderIndex)
        .map((chunk) => ({ text: chunk.originalText, anchor: chunk.anchor })),
    })),
  );
}
