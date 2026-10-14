/**
 * The confidence gate of the dose rules (RX2). A rule is read from a sentence by patterns; most
 * sentences are read right, but a blind audit (docs/research/dose-rules-2026-10-14.md) found about a
 * third of random rules wrong in some field, mostly where a sentence is not a plain «who — how
 * much — how often» statement: table rows flattened to text, regimens with stages, alternatives,
 * populations borrowed from a heading or an earlier sentence. A wrong computed dose is worse than a
 * missing one, so only rules whose sentence has a shape that was measured correct may produce
 * numbers; the others show the quoted sentence with the link to the instruction.
 *
 * `classifyRule` names the shape of a rule from evidence in its own clause and the lines around it:
 * sentence-local numbers (every number of the clause is accounted for by the rule), an explicit
 * population (in the clause or a plain heading line before it, with no other population between), no
 * table cues, no staging or alternatives, no sex / pregnancy / partner-drug wording, and a unit that
 * fits the dosage form. The shape is stored in the rule (`gc`, an index into `DOSE_SHAPES`);
 * `GATE_ALLOWED` is the subset that measured 100 % on the development sample
 * (tools/benchmarks/dose-rule-gate-dev.json) and decides what is computed.
 *
 * Pure and deterministic, no instruction text is kept.
 */
import {
  COND_DIALYSIS,
  COND_HEPATIC,
  COND_RENAL,
  type DoseRule,
  GROUP_ADOLESCENT,
  GROUP_ADULT,
  GROUP_CHILD,
  GROUP_ELDERLY,
  GROUP_INFANT,
  GROUP_NEWBORN,
  PIECE_KINDS,
  ROLE_INITIAL,
  ROLE_LOADING,
  RULE_CAP,
  RULE_DOSE,
  RULE_DURATION,
} from '@localmed/contracts';

import { extractAmountLimits } from '@/features/medication-safety/age-limits';
import { findAmounts, findDurations, findFrequencies } from './dose-numbers';

/** Where a rule's population came from. */
export type PopulationSource = 'own' | 'sticky' | 'heading' | 'none';

export const DOSE_SHAPES = [
  'rejected.other',
  'rejected.condition',
  'rejected.table',
  'rejected.stage',
  'rejected.special',
  'rejected.alternative',
  'rejected.numbers',
  'rejected.borrowed',
  'rejected.population',
  'rejected.context',
  'rejected.unit',
  'rejected.role',
  'rejected.duration',
  'rejected.cap',
  'rejected.basis',
  'dose.local.abs.freq',
  'dose.local.abs.nofreq',
  'dose.local.kg.freq',
  'dose.local.kg.nofreq',
  'dose.local.bsa.freq',
  'dose.local.bsa.nofreq',
  'dose.localor.abs.freq',
  'dose.localor.abs.nofreq',
  'dose.localor.kg.freq',
  'dose.localor.kg.nofreq',
  'dose.localor.bsa.freq',
  'dose.localor.bsa.nofreq',
  'dose.heading.abs.freq',
  'dose.heading.abs.nofreq',
  'dose.heading.kg.freq',
  'dose.heading.kg.nofreq',
  'dose.heading.bsa.freq',
  'dose.heading.bsa.nofreq',
  'dose.none.abs.freq',
  'dose.none.abs.nofreq',
  'cap.local',
  'cap.heading',
  'cap.none',
  'duration.local',
  'duration.heading',
  'duration.none',
] as const;
export type DoseShape = (typeof DOSE_SHAPES)[number];

export function shapeOf(rule: Pick<DoseRule, 'gc'>): DoseShape {
  return DOSE_SHAPES[rule.gc ?? 0] ?? 'rejected.other';
}

export function isRejectedShape(shape: DoseShape): boolean {
  return shape.startsWith('rejected.');
}

/**
 * The shapes whose rules may produce computed numbers. Filled from the development sample: a shape
 * is listed only when every judged rule of it was correct in every field
 * (tools/benchmarks/dose-rule-gate-dev.json, `bun run benchmark:dose-precision -- --dev`).
 */
export const GATE_ALLOWED: ReadonlySet<DoseShape> = new Set<DoseShape>([
  'dose.local.abs.freq',
  'dose.local.abs.nofreq',
  'dose.local.kg.freq',
  'dose.local.kg.nofreq',
  'dose.heading.abs.freq',
  'dose.heading.abs.nofreq',
  'dose.none.abs.freq',
  'dose.none.abs.nofreq',
  'cap.local',
  'cap.heading',
  'cap.none',
  'duration.none',
]);

/**
 * A shape is allowed only when its family (the shape without the last «.freq» / «.nofreq» part) has at
 * least this many judged development rules, none wrong.
 */
export const GATE_MIN_JUDGED = 9;

export function shapeFamily(shape: DoseShape): string {
  return shape.replace(/\.(?:no)?freq$/u, '');
}

/** True when the rule may produce computed numbers (doses, cap comparisons, a default course). */
export function mayCompute(rule: Pick<DoseRule, 'gc'>): boolean {
  return GATE_ALLOWED.has(shapeOf(rule));
}

const ADULT_AGE_DAYS = Math.round(18 * 365.25);
const CHILD_BITS = GROUP_CHILD | GROUP_NEWBORN | GROUP_INFANT | GROUP_ADOLESCENT;

/* ------------------------------------------------------------------------------------------ */
/* Cues                                                                                         */
/* ------------------------------------------------------------------------------------------ */

const WORD_END = '(?![\\p{L}\\d])';
const WORD_START = '(?<![\\p{L}\\d])';

/** Stages of a regimen, first doses, titration: the sentence is one step of several. */
const STAGE = new RegExp(
  `${WORD_START}(?:затем|далее|после\\s+(?:этого|чего)|в\\s+(?:первы[еймх]|последующ\\p{L}*|дальнейшем)|(?:с|со|на|в|по)\\s+\\d+-?(?:й|го|м|х|ой)?\\s+(?:день|дня|дне|дни|недел\\p{L}*|мес\\p{L}*)|начиная|постепенно|титр\\p{L}*|увеличива\\p{L}*|повыша\\p{L}*|уменьша\\p{L}*|снижа\\p{L}*|первая|первую|первой|нагрузочн\\p{L}*|ударн\\p{L}*|насыщающ\\p{L}*|начальн\\p{L}*|первоначальн\\p{L}*|стартов\\p{L}*|на\\s+следующ\\p{L}*|возобнов\\p{L}*|последующ\\p{L}*|перерыв\\p{L}*|в\\s+начале|перв(?:ое|ого|ым|ые|ая)\\s+(?:введени|доз|инъекц|прием|приём)\\p{L}*|фаз\\p{L}*|этап\\p{L}*|компонент\\p{L}*|исходн\\p{L}*|(?:перв|втор|трет|четверт|пят|шест)\\p{L}*\\s+недел\\p{L}*|(?:увеличени|повышени|снижени|уменьшени|коррекц|возрастани)\\p{L}*|(?:\\d+|одн\\p{L}*|дву\\p{L}*|трех)\\s+(?:и\\s+(?:более|менее)\\s+)?(?:цикл\\p{L}*))`,
  'u',
);
/** Conditions and limits inside a dose sentence: «если», «при необходимости», «максимум до». */
const QUALIFIER = new RegExp(
  `${WORD_START}(?:если|в\\s+случае|при\\s+необходимости|по\\s+необходимости|в\\s+зависимости|может\\s+быть|можно|допускается|допустимо|при\\s+условии|только\\s+при|при\\s+отсутствии|при\\s+наличии|ранее\\s+не|в\\s+тяжелых|при\\s+тяжел\\p{L}*|тяжел\\p{L}*\\s+(?:течени|форм|случа|степен|состояни)\\p{L}*|при\\s+выраженн\\p{L}*|максимум|максимально|до\\s+(?:\\d|одн|двух|трех)(?=\\s*[-\\p{L}]*\\s*раз)|не\\s+менее|не\\s+более|не\\s+превышать|предпочтительно|рассчитыва\\p{L}*|подбира\\p{L}*|индивидуальн\\p{L}*|определя\\p{L}*|в\\s+некоторых|может\\s+назначить|врач\\s+(?:может|скажет|назначит|определит|подберет)|(?:могут|может)\\s+(?:потребова\\p{L}*|потребоваться)|или\\s+больше|или\\s+до\\s+(?:исчезновени|купировани|нормализац|достижени)|минимальн\\p{L}*\\s+эффективн\\p{L}*|за\\s+исключением|в\\s+остальных|в\\s+других\\s+случа\\p{L}*|как\\s+минимум|адекватн\\p{L}*|(?:но|однако)\\s|не\\s+должн\\p{L}*\\s+превышать|возможн\\p{L}*)`,
  'u',
);
/** Sex, pregnancy, calendar, per-side, partner drug: not populations the rule models. */
const SPECIAL = new RegExp(
  `${WORD_START}(?:беремен\\p{L}*|лактац\\p{L}*|кормлен\\p{L}*|кормящ\\p{L}*|женщин\\p{L}*|мужчин\\p{L}*|мальчик\\p{L}*|девочк\\p{L}*|менопауз\\p{L}*|менструал\\p{L}*|цикл\\p{L}*|одновременно|в\\s+комбинации|совместно|в\\s+сочетании|вместе\\s+с|(?:в|на)\\s+кажд\\p{L}*\\s+(?:ноздр\\p{L}*|носов\\p{L}*\\s+ход|глаз|ух\\p{L}*)|в\\s+оба\\s+глаза|в\\s+оба\\s+уха|по\\s+схеме|схем\\p{L}*|при\\s+введении\\s+в|в\\s+(?:крупные|средние|мелкие)\\s+сустав\\p{L}*|сходн\\p{L}*|эквивалент\\p{L}*|обеспечива\\p{L}*|таков\\p{L}*|суммарн\\p{L}*|общая\\s+доза|курсов\\p{L}*\\s+доз\\p{L}*|означает|в\\s+сумме|содержащ\\p{L}*|полугоди\\p{L}*|в\\s+добавлени\\p{L}*|дополнительн\\p{L}*|также\\s+принима\\p{L}*|(?:в|на)\\s+кажд\\p{L}*\\s+(?!прием|раз|день|сутки|введени|кг|килограмм|кв|м2)\\p{L}+|переход\\p{L}*\\s+на|(?:при|в)\\s+перевод\\p{L}*|(?:со|с)\\s+\\d+(?:[.,]\\d+)?\\s*(?:мг|мкг|г)\\s+\\p{L}+|\\d\\s*(?:мг|мкг|г)\\s*\\+\\s*\\d)`,
  'u',
);
const ALTERNATIVE = new RegExp(
  `${WORD_START}(?:либо|и/или)${WORD_END}|\\d\\s*(?:мг|мл|г|мкг|ме|ед|таблет\\p{L}*|капсул\\p{L}*|капл\\p{L}*|доз\\p{L}*|пакет\\p{L}*|ложк\\p{L}*)\\s+(?:или|/)\\s+(?:по\\s+)?\\d`,
  'u',
);
const TABLE_CUES =
  /[≤≥<>±]|\*\*|(?:^|\s)таблиц\p{L}*\s+\d|мл\/мин|(?<![\p{L}\d])(?:кк|скф|clcr|сlcr)(?![\p{L}\d])|клиренс\p{L}*\s+креатинин|[-–—]\s*[-–—]|\?\s*\d|\d\s*\?/u;
const NEGATION =
  /противопоказ|не\s+применя|не\s+рекомендуется|не\s+назнача|не\s+следует|осторожн|опыт|отсутству|не\s+установлен|не\s+изуч|недопустимо|нельзя|отмен\p{L}*|прекра[тщ]\p{L}*|непереносим\p{L}*|не\s+(?:делайте|превышайте|принимайте|вводите|применяйте)|оцени\p{L}*|риск\p{L}*|польз\p{L}*|превышайте|(?:больше|более)\s+(?:\d|одн\p{L}*|двух|трех)(?!\s*(?:-\s*\d+\s*)?(?:лет|года|кг|мес|недел|дн))/u;

const GROUP_WORDS = {
  adult: /(?<![\p{L}])взросл\p{L}*/u,
  child:
    /(?<![\p{L}])(?:дет(?:ям|ей|ьми|ях|и)|детск\p{L}*|ребен\p{L}*|ребят\p{L}*|подрост\p{L}*|младенц\p{L}*|новорожд\p{L}*|недоношен\p{L}*|грудн\p{L}*|школьн\p{L}*)(?![\p{L}])/u,
  elderly: /пожил\p{L}*|старческ\p{L}*|старше\s+(?:6[5-9]|[7-9]\d)\s+лет/u,
};
/** Population or condition words that make a population-less sentence suspect when they stand before it. */
const CLASH =
  /(?<![\p{L}])(?:дет(?:ям|ей|ьми|ях|и)|детск\p{L}*|ребен\p{L}*|ребят\p{L}*|подрост\p{L}*|младенц\p{L}*|новорожд\p{L}*|недоношен\p{L}*|грудн\p{L}*|пожил\p{L}*|старческ\p{L}*|беремен\p{L}*|лактац\p{L}*|женщин\p{L}*|мужчин\p{L}*)(?![\p{L}])|почечн\p{L}*|печеночн\p{L}*|печен\p{L}*|почк\p{L}*|диализ|нарушени\p{L}*\s+функци|клиренс\p{L}*\s+креатинин|(?<![\p{L}\d])(?:масс\p{L}*\s+тела|весом|массой)[^.]{0,20}\d/u;

const AGE_BAND_BETWEEN =
  /(?:до|от|старше|младше|моложе|с)\s+\d+(?:[.,]\d+)?\s*-?\s*(?:х|ти|ми)?\s*(?:лет|года|год|мес\p{L}*|недел\p{L}*)|\d+\s*-\s*\d+\s*-?\s*(?:х|ти|ми)?\s*(?:лет|года|мес\p{L}*)|возраст\p{L}*\s+от/u;

/** True when the text reads as a plain heading line: a few words naming a population, no sentence. */
export function isPlainHeading(text: string): boolean {
  const clean = text.trim();
  if (clean.length === 0 || clean.length > 90) return false;
  if (clean.split(/\s+/u).length > 12) return false;
  if (/[.!?]\s*\p{L}/u.test(clean)) return false;
  if ((clean.match(/,/gu) ?? []).length > 2) return false;
  if (
    /(?:ает|яет|ует|ют|ят|ится|ется|ются|ают|ишь|ите|ит|йте|ать|ять|ить|еть|ыть|уть)(?![\p{L}])|(?:должн|следует|может|могут|рекомендуется|назнач|примен|принима|вводят|предрасполож|получавш)\p{L}*/u.test(
      clean,
    )
  ) {
    return false;
  }
  if (/\d/u.test(clean)) {
    // Numbers only as age or weight bounds.
    const stripped = clean.replace(
      /\d+(?:[.,]\d+)?\s*(?:-\s*\d+(?:[.,]\d+)?\s*)?(?:-?(?:х|ти|ми|и)\s+)?(?:лет|года|год|месяц\p{L}*|мес\.?|недел\p{L}*|дн\p{L}*|кг)/gu,
      '',
    );
    if (/\d/u.test(stripped)) return false;
  }
  return true;
}

/* ------------------------------------------------------------------------------------------ */
/* Unit and dosage form                                                                         */
/* ------------------------------------------------------------------------------------------ */

const FORM_CLASSES = {
  solid: /таблет|капсул|драже|пастилк|леденц|суппозитор|свеч/u,
  liquidOral:
    /раствор\p{L}*\s+для\s+приема|сироп|суспенз|капли\s+для\s+приема|эликсир|гранул\p{L}*\s+для\s+приготовления|порошок\p{L}*\s+для\s+приготовления|концентрат\p{L}*\s+для\s+приготовления\s+раствора\s+для\s+приема/u,
  injection:
    /инъекц|инфуз|лиофилизат|ампул|раствор\p{L}*\s+для\s+(?:внутривенн|внутримышечн|подкожн|парентерал)|эмульси\p{L}*\s+для\s+(?:инфуз|внутривенн)|концентрат\p{L}*\s+для\s+(?:приготовления\s+(?:раствора\s+)?для\s+)?(?:инфуз|инъекц)/u,
  topical: /мазь|крем|гель|линимент|паста|пластыр|лосьон|раствор\p{L}*\s+для\s+наружн|наружн/u,
  inhaled:
    /аэрозол|спрей|порошок\p{L}*\s+для\s+ингаляц|раствор\p{L}*\s+для\s+ингаляц|небул|ингаляц/u,
  drops: /капли|раствор\p{L}*\s+для\s+(?:глаз|ушн|назаль)|глазн|ушн|назаль/u,
  powder: /порошок|гранул/u,
};

/** True when the rule's unit makes sense for the dosage form the document says it is. */
export function unitFitsForm(rule: DoseRule, dosageForm: string | null): boolean {
  if (dosageForm === null) return true;
  const form = dosageForm.toLocaleLowerCase('ru-RU');
  const isSolid = FORM_CLASSES.solid.test(form);
  const isLiquidOral = FORM_CLASSES.liquidOral.test(form);
  const isInjection = FORM_CLASSES.injection.test(form);
  const isTopical = FORM_CLASSES.topical.test(form);
  const isInhaled = FORM_CLASSES.inhaled.test(form);
  const isDrops = FORM_CLASSES.drops.test(form);
  const isPowder = FORM_CLASSES.powder.test(form);
  const unit = rule.u ?? 0;
  if (rule.k !== RULE_DOSE && rule.k !== RULE_CAP) return true;
  if (unit === 0) {
    // mg: not of a topical preparation (the weight of the gel is not the weight of the substance).
    return !isTopical || isSolid;
  }
  if (unit === 1) return isLiquidOral || isInjection || isDrops || isInhaled || isPowder;
  if (unit === 5) return isDrops || isLiquidOral || isInhaled;
  if (unit === 6) return !isSolid || isInhaled;
  if (unit === 7) {
    const piece = PIECE_KINDS[rule.qu ?? 9] ?? 'other';
    if (piece === 'tablet') return /таблет|драже/u.test(form);
    if (piece === 'capsule') return /капсул/u.test(form);
    if (piece === 'lozenge') return /пастилк|леденц/u.test(form);
    if (piece === 'suppository') return /суппозитор|свеч/u.test(form);
    if (piece === 'sachet') return isPowder || isLiquidOral;
    if (piece === 'ampoule') return isInjection;
    if (piece === 'spoon' || piece === 'measure') return isLiquidOral || isPowder;
    if (piece === 'patch') return isTopical;
    return false;
  }
  return true;
}

/* ------------------------------------------------------------------------------------------ */
/* Evidence                                                                                     */
/* ------------------------------------------------------------------------------------------ */

export interface GateInput {
  readonly rule: DoseRule;
  /** The clause the rule was read from, in the normal form (lower case, «ё» as «е»). */
  readonly clause: string;
  /** Up to ~500 characters of normal-form text before the clause, in the same section. */
  readonly before: string;
  readonly source: PopulationSource;
  /** The text of the heading or earlier clause the population was taken from. */
  readonly contextText: string | null;
  /** The text between that heading and the clause. */
  readonly between: string;
  /** The dosage form the document's metadata states. */
  readonly dosageForm: string | null;
  /** Stems (first five letters) of the words that name the document's own drug. */
  readonly subject: readonly string[];
  /** The document's drug is a combination of several substances. */
  readonly combination: boolean;
  /** The title of the section the clause is in (normal form). */
  readonly sectionTitle: string;
  /** Up to 80 characters of normal-form text right after the clause. */
  readonly after: string;
}

function spansOf(
  items: readonly { readonly start: number; readonly end: number }[],
): readonly [number, number][] {
  return items.map((item): [number, number] => [item.start, item.end]);
}

/** Numbers of the clause that no field of the rule accounts for. */
export function leftoverNumbers(input: GateInput): number {
  const { clause, rule } = input;
  const accounted: [number, number][] = [
    ...spansOf(findAmounts(clause)),
    ...spansOf(findFrequencies(clause)),
    ...spansOf(findDurations(clause)),
    ...spansOf(extractAmountLimits(clause)),
  ];
  let leftover = 0;
  for (const match of clause.matchAll(/\d+(?:[.,]\d+)?/gu)) {
    const start = match.index;
    const end = start + match[0].length;
    if (accounted.some(([from, to]) => start >= from && end <= to)) continue;
    const after = clause.slice(end, end + 24);
    const hasAge = rule.p0 !== undefined || rule.p1 !== undefined;
    const hasWeight = rule.w0 !== undefined || rule.w1 !== undefined;
    if (hasAge && /^\s*(?:-\s*\d+\s*)?(?:лет|года|год|месяц\p{L}*|мес\.?|недел\p{L}*)/u.test(after))
      continue;
    if (hasWeight && /^\s*(?:-\s*\d+\s*)?кг/u.test(after)) continue;
    if (
      /^\s*%\s*(?:\p{L}+\s+){0,2}?(?:раствор|гел|мазь|мази|крем|спрей|капл|эмульс|суспенз)/u.test(
        after,
      )
    )
      continue;
    // A bare number after «№»: a registration or order number, never a dose.
    leftover += 1;
  }
  return leftover;
}

function popWordsConsistent(text: string, rule: DoseRule): boolean {
  const group = rule.g ?? 0;
  if (GROUP_WORDS.adult.test(text)) {
    const ok = (group & GROUP_ADULT) !== 0 || (rule.p0 !== undefined && rule.p0 >= ADULT_AGE_DAYS);
    if (!ok) return false;
    // «взрослые, включая пожилых старше 65 лет»: the rule must not shrink to the elderly.
    if (rule.p0 !== undefined && rule.p0 >= 20000 && !GROUP_WORDS.elderly.test(text.slice(0, 40))) {
      return false;
    }
  }
  if (GROUP_WORDS.child.test(text)) {
    const ok = (group & CHILD_BITS) !== 0 || (rule.p1 !== undefined && rule.p1 <= ADULT_AGE_DAYS);
    if (!ok) return false;
  }
  if (GROUP_WORDS.elderly.test(text) && (group & GROUP_ELDERLY) === 0 && (rule.p0 ?? 0) < 20000) {
    return false;
  }
  return true;
}

function hasPopulation(rule: DoseRule): boolean {
  return (
    (rule.g ?? 0) !== 0 ||
    rule.p0 !== undefined ||
    rule.p1 !== undefined ||
    rule.w0 !== undefined ||
    rule.w1 !== undefined
  );
}

/** Population that cannot be told from a single weight limit: no age, no group word. */
function weightOnly(rule: DoseRule): boolean {
  return (
    (rule.w0 !== undefined || rule.w1 !== undefined) &&
    rule.p0 === undefined &&
    rule.p1 === undefined &&
    (rule.g ?? 0) === 0
  );
}

const DURATION_PHRASE =
  /^(?:[^.;:]{0,45}?)(?:длительност\p{L}*|продолжительност\p{L}*|курс\p{L}*)\s+(?:лечения|терапии|приема|применения|введения)?\s*(?:препарата\s+)?(?:обычно\s+|как\s+правило\s+|в\s+среднем\s+|составляет\s+|продолжается\s+|не\s+(?:более|должна\s+превышать)\s+|[-–—:]\s*)+/u;
const DURATION_BAD =
  /минимальн|(?<![\p{L}])от\s+\d+(?:[.,]\d+)?\s*(?:дн\p{L}*|недел\p{L}*|мес\p{L}*|год\p{L}*)(?!\s*(?:-|до))|интервал|перерыв|между|повтор|нескольк|продлен|(?<![\p{L}])(?:однако|но|или)\s|пожизнен|после|перед|переносимост|эффект|клиническ|опыт|отсутств|излечени|через|цикл|титр|первых|первы[ейх]|если|при\s+необходимости|зависимост|до\s+(?:исчезновени|купировани|нормализац|достижени)|менее\s+\d|более\s+\d/u;

/** «доза дексаметазона составляет …»: the sentence is about another substance than the document's. */
const NOT_A_SUBSTANCE =
  /^(?:препарат|лекарств|средств|суточн|разов|рекоменд|максимальн|минимальн|обычн|начальн|стандартн|адекватн|терапевтическ|указанн|взросл|детск|пациент|больн|общ|курсов|эффективн|предписанн|назначенн|рассчитанн|таблет|капсул|гранул|раствор|суспенз|сироп|капл|порошок|драже|суппозитор|пакет|ампул|флакон|инъекц|ингаляц|одн|двух|трех|кажд|ваш|вам|врач|лечащ|поддерж|нагрузоч|данн|этого|этой|такой|которы)/u;
const GENITIVE_ENDING = /(?:а|я|ы|и|ов|ев|ей|ум|ия)$/u;

/** «доза дексаметазона составляет …», «Преднизон принимают …»: the sentence is about another substance. */
export function namesOtherSubstance(
  clause: string,
  subject: readonly string[],
  combination = false,
): boolean {
  if (subject.length === 0) return false;
  const other = (word: string): boolean =>
    word.length >= 6 && !NOT_A_SUBSTANCE.test(word) && !subject.includes(word.slice(0, 5));
  for (const match of clause.matchAll(/доз[аыуеой]\s+(?:адекватн\p{L}*\s+)?([\p{L}-]{6,})/gu)) {
    const word = match[1] ?? '';
    if (NOT_A_SUBSTANCE.test(word) || !GENITIVE_ENDING.test(word)) continue;
    // A combination product: a dose named after one of its components is that component's.
    if (other(word) || combination) return true;
  }
  for (const match of clause.matchAll(
    /(?<![\p{L}])([\p{L}-]{6,})(?:\s+(?:или|и)\s+([\p{L}-]{6,}))?\s+(?:принимают|назначают|вводят|применяют|используют|следует\s+(?:принимать|назначать|вводить))/gu,
  )) {
    for (const word of [match[1] ?? '', match[2] ?? ''])
      if (word !== '' && other(word)) return true;
  }
  return false;
}

/** A dose statement: a dose noun or a «по N …» amount; what a population-less rule must show. */
const DOSE_ANCHOR = /доз[аыуеой]\p{L}*|дозировк\p{L}*|(?:^|[\s,:;–—-])по\s+\d/u;
/** What follows the clause continues the regimen: the clause is only its first step. */
const STAGE_AFTER =
  /^[\s,;:)]*(?:затем|далее|в\s+дальнейшем|после\s+чего|с\s+последующ|(?:увеличива|повыша|снижа)\p{L}*)/u;

const GROUP_ANY =
  /(?<![\p{L}])(?:дет(?:ям|ей|ьми|ях|и)|детск\p{L}*|ребен\p{L}*|подрост\p{L}*|младенц\p{L}*|новорожд\p{L}*)(?![\p{L}])/gu;
const CONDITION_BEFORE =
  /гемодиализ|диализ|почечн\p{L}*\s+недостаточн|печеночн\p{L}*\s+недостаточн|нарушени\p{L}*\s+функци\p{L}*\s+(?:почек|печени)|клиренс\p{L}*\s+креатинин/u;
const SECTION_GROUP =
  /ребен|дет(?:ям|ей|и)(?![\p{L}])|детск|педиатр|новорожд|подрост|пожил|беремен|кормлен|почечн|печен|диализ/u;
const DAILY_CUE = /суточн|(?:в|за)\s+(?:сутки|день)|\/\s*сут|ежесуточн/u;
const AGE_BOUND_ANYWHERE =
  /(?:до|от|старше|младше|моложе|с)\s+\d+(?:[.,]\d+)?\s*-?\s*(?:х|ти|ми)?\s*(?:лет|года|год|мес\p{L}*|недел\p{L}*)|\d+\s*-\s*\d+\s*(?:лет|года|мес\p{L}*)/u;

/**
 * The shape of a rule. Rejections come in a fixed order (the first reason found names the shape);
 * a rule that passes every test gets a shape named by what it is made of.
 */
export function classifyRule(input: GateInput): DoseShape {
  const { rule, clause } = input;
  if (rule.k !== RULE_DOSE && rule.k !== RULE_CAP && rule.k !== RULE_DURATION) {
    return 'rejected.other';
  }
  if ((rule.c ?? 0) & (COND_RENAL | COND_HEPATIC | COND_DIALYSIS)) return 'rejected.condition';
  const remarkFree = clause.replace(/\(\s*соответствует[^)]*\)/gu, ' ');
  if (TABLE_CUES.test(clause) || NEGATION.test(remarkFree)) return 'rejected.table';
  // A fragment: starts inside a parenthesis, or is a muddle of Latin words and a few Russian ones.
  if (
    (clause.match(/\)/gu) ?? []).length > (clause.match(/\(/gu) ?? []).length ||
    /^\s*\(/u.test(clause)
  ) {
    return 'rejected.table';
  }
  if (/[a-z]{5,}/u.test(clause)) return 'rejected.table';
  if (STAGE.test(remarkFree)) return 'rejected.stage';
  if (rule.k === RULE_DOSE && STAGE_AFTER.test(input.after)) return 'rejected.stage';
  if (rule.k === RULE_DOSE) {
    if (QUALIFIER.test(clause) || rule.up === 1) return 'rejected.stage';
  }
  if (SPECIAL.test(remarkFree) || namesOtherSubstance(clause, input.subject, input.combination)) {
    return 'rejected.special';
  }
  // «Дети от 5 до 13 лет и/или массой тела от 19 до 40 кг»: an age-or-weight population is no alternative
  // of regimens (the rule carries it as `or`).
  const populationOr = rule.or === 1 && /и\/или|или/u.test(clause.slice(0, 120));
  if (ALTERNATIVE.test(populationOr ? clause.replace(/и\/или/gu, ' ') : clause)) {
    return 'rejected.alternative';
  }

  // Amounts: one mass or volume, at most one counted piece, nothing that is a rate.
  const amounts = findAmounts(clause);
  const outside = amounts.filter((amount) => !amount.inParentheses);
  if (outside.some((amount) => amount.rate)) return 'rejected.numbers';
  const masses = outside.filter((amount) => amount.unit !== 'piece');
  const pieces = outside.filter((amount) => amount.unit === 'piece');
  if (masses.length > 1 || pieces.length > 1 || outside.length > 2) return 'rejected.alternative';
  // Two different masses or volumes anywhere in the clause, apart from the dose itself and the strength
  // of one counted piece («N таблеток по M мг»): every number the rule keeps must be printed.
  {
    const allowed = new Set<number>(
      [rule.d0, rule.d1, rule.pm].filter((value): value is number => value !== undefined),
    );
    const extra = amounts.filter(
      (amount) =>
        !amount.rate &&
        amount.unit !== 'piece' &&
        !allowed.has(amount.lo) &&
        (amount.hi === null || !allowed.has(amount.hi)),
    );
    if (extra.length > 0 && (rule.pm !== undefined || rule.q0 !== undefined)) {
      return 'rejected.alternative';
    }
    const distinct = new Set(
      amounts
        .filter((amount) => !amount.rate && amount.unit !== 'piece')
        .map((amount) => `${amount.unit}:${amount.per}:${amount.lo}:${amount.hi ?? ''}`),
    );
    if (rule.pm === undefined && rule.q0 === undefined && distinct.size > 1) {
      return 'rejected.alternative';
    }
    // A day's amount that is the amount of one intake of counted pieces, taken several times a day.
    if (
      rule.bs === 1 &&
      rule.pm !== undefined &&
      rule.q0 !== undefined &&
      (rule.f0 ?? 1) > 1 &&
      rule.d0 !== undefined &&
      Math.abs(rule.d0 - rule.pm * rule.q0) < 1e-6 * rule.d0
    ) {
      return 'rejected.basis';
    }
    // «утром (однократно 50 мг) или утром и вечером (по 50 мг два раза)»: two regimens of one amount.
    const masses = amounts.filter((amount) => !amount.rate && amount.unit !== 'piece');
    if (masses.length > 1 && /(?<![\p{L}])или(?![\p{L}])/u.test(clause))
      return 'rejected.alternative';
  }
  if (leftoverNumbers(input) > 0) return 'rejected.numbers';
  if ((rule.f1 ?? 0) > 8 && (rule.fp ?? 1) === 1) return 'rejected.numbers';
  // The sentence speaks of a day's amount or of a divided dose, the rule says per intake.
  if (rule.k === RULE_DOSE && rule.bs !== 1) {
    // «в день» / «в сутки» that is not part of «3 раза в день»: the amount is a day's.
    let masked = remarkFree;
    for (const frequency of [...findFrequencies(clause)].toSorted((a, b) => b.start - a.start)) {
      masked = `${masked.slice(0, frequency.start)} ${masked.slice(frequency.end)}`;
    }
    if (
      DAILY_CUE.test(masked) ||
      (rule.f0 === undefined && /(?:^|[^\p{L}])в\s+\d(?:\s*-\s*\d)?\s+прием/u.test(clause))
    ) {
      return 'rejected.basis';
    }
  }
  if (rule.k === RULE_DOSE && rule.bs !== 1 && /суточн/u.test(remarkFree)) return 'rejected.basis';
  // The sentence says «на килограмм», the rule has an absolute amount.
  if (
    rule.pk === undefined &&
    /(?:на|\/)\s*(?:1\s*|каждый\s+)?(?:кг|килограмм)(?![\p{L}\d])|\/\s*м\s*2|на\s+(?:каждый\s+)?(?:кв\.?\s*м|квадратн\p{L}*\s+метр|м\s?[2²])/u.test(
      clause,
    )
  ) {
    return 'rejected.numbers';
  }
  if (rule.k === RULE_DOSE && rule.f0 === undefined && rule.bs !== 1 && /ежедневн/u.test(clause)) {
    return 'rejected.basis';
  }
  // A typo in the print («0,5-075 г», «10-020 мг»): a number with a leading zero, or a range wider than tenfold.
  if (/(?<![\d.,])0\d+(?![\d.,])/u.test(clause)) return 'rejected.numbers';
  if (rule.d0 !== undefined && rule.d1 !== undefined && rule.d0 > 0 && rule.d1 / rule.d0 > 10) {
    return 'rejected.numbers';
  }

  if (rule.k === RULE_DURATION) {
    if (!DURATION_PHRASE.test(clause) || DURATION_BAD.test(clause)) return 'rejected.duration';
    if (rule.t0 === undefined) return 'rejected.duration';
    // The duration must end the clause: «… до нескольких месяцев», «… , но может быть продлен» say more.
    const last = findDurations(clause).at(-1);
    if (!last || clause.slice(last.end).replace(/[\s.,;:)]+/gu, '') !== '') {
      return 'rejected.duration';
    }
  }
  if (rule.k === RULE_CAP) {
    if (/за\s+исключением|кроме\s+(?:случаев|того)/u.test(clause)) return 'rejected.cap';
    if (rule.d1 === undefined || rule.d0 !== undefined) return 'rejected.cap';
    // A cap that names a range («140–180 г»), or one that is about another component.
    if (/\d\s*-\s*\d/u.test(clause.replace(/\d+\s*-\s*\d+\s*(?:лет|года|мес)/gu, ''))) {
      return 'rejected.cap';
    }
    if (
      !/(?:максимальн\p{L}*|предельн\p{L}*|высш\p{L}*|не\s+(?:более|превышать|должн\p{L}*\s+превышать)|превышать)/u.test(
        clause,
      )
    ) {
      return 'rejected.cap';
    }
  }

  // Population: stated in the clause, or a plain heading line with no other population between.
  const stated = hasPopulation(rule);
  let orPopulation = false;
  let source: 'local' | 'heading' | 'none';
  if (input.source === 'own' && stated && rule.h === undefined) source = 'local';
  else if (input.source === 'own') return 'rejected.borrowed';
  else if (input.source === 'heading' || input.source === 'sticky') {
    if (!stated || input.contextText === null || !isPlainHeading(input.contextText)) {
      return 'rejected.borrowed';
    }
    if (CLASH.test(input.between) || AGE_BAND_BETWEEN.test(input.between)) {
      return 'rejected.context';
    }
    if (!popWordsConsistent(input.contextText, rule)) return 'rejected.population';
    source = 'heading';
  } else {
    if (stated) return 'rejected.borrowed';
    if (CLASH.test(input.before)) return 'rejected.context';
    // The section is about a group («… массы тела ребенка …»): a sentence without a population is theirs.
    if (SECTION_GROUP.test(input.sectionTitle)) return 'rejected.context';
    // With no population to anchor it, the clause must be a dose statement of its own: a dose noun or «по N».
    if (rule.k === RULE_DOSE && !DOSE_ANCHOR.test(remarkFree)) return 'rejected.context';
    source = 'none';
  }
  if (source === 'local' && !popWordsConsistent(clause, rule)) return 'rejected.population';
  // «старше 2 лет» alone, with no group word: it may be one line of a list whose next line is «взрослые».
  if (
    source === 'local' &&
    rule.p0 !== undefined &&
    rule.p1 === undefined &&
    (rule.g ?? 0) === 0 &&
    rule.w0 === undefined &&
    rule.w1 === undefined
  ) {
    return 'rejected.population';
  }
  // Two population statements in one clause («у детей младше 3-х лет … детям первого полугодия …»).
  if (
    source === 'local' &&
    (rule.p0 !== undefined || rule.p1 !== undefined) &&
    (clause.match(GROUP_ANY) ?? []).length >= 2
  ) {
    return 'rejected.population';
  }
  // A ladder of age lines («до 8 лет …; до 13 лет …»): an upper bound alone means «from the line above».
  if (
    source === 'local' &&
    rule.p1 !== undefined &&
    rule.p0 === undefined &&
    AGE_BOUND_ANYWHERE.test(input.before)
  ) {
    return 'rejected.context';
  }
  // A population line inside a block about another condition (renal impairment, dialysis, liver).
  if (CONDITION_BEFORE.test(input.before) && !CONDITION_BEFORE.test(clause))
    return 'rejected.context';
  // Several concentrations in the lines before: an amount in ml or mg may belong to one of them.
  if ((rule.u === 0 || rule.u === 1) && /\d\s*%/u.test(input.before)) return 'rejected.context';
  if (weightOnly(rule)) return 'rejected.population';
  if (source !== 'none' && (rule.or === 1 || (rule.w0 !== undefined && rule.w1 !== undefined))) {
    // An age OR weight alternative named in the clause itself with one age band and one weight band is
    // a population of its own; anything else with two weight limits is a flattened table band.
    const ownOr =
      source === 'local' &&
      rule.or === 1 &&
      populationOr &&
      rule.p0 !== undefined &&
      rule.p1 !== undefined &&
      (rule.w0 !== undefined || rule.w1 !== undefined);
    if (!ownOr) return 'rejected.population';
    orPopulation = true;
  }
  if (rule.k === RULE_DOSE && source === 'none' && rule.pk !== undefined) {
    return 'rejected.population';
  }

  if (!unitFitsForm(rule, input.dosageForm)) return 'rejected.unit';
  if (rule.k === RULE_DOSE && (rule.ro === ROLE_INITIAL || rule.ro === ROLE_LOADING)) {
    return 'rejected.role';
  }

  if (rule.k === RULE_CAP) return `cap.${source}` as DoseShape;
  if (rule.k === RULE_DURATION) return `duration.${source}` as DoseShape;
  const basis = rule.pk === 1 ? 'kg' : rule.pk === 2 ? 'bsa' : 'abs';
  const frequency = rule.f0 === undefined ? 'nofreq' : 'freq';
  return `dose.${orPopulation ? 'localor' : source}.${basis}.${frequency}` as DoseShape;
}

export function shapeIndex(shape: DoseShape): number {
  return DOSE_SHAPES.indexOf(shape);
}
