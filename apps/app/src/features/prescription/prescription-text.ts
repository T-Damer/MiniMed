/**
 * The words of a prescription (RX1): the Latin line «Rp.: Tab. Amoxicillini 0,5 N 21» and the sign
 * «Внутрь по 1 таблетке 3 раза в день в течение 7 дней». Pure string building from the numbers the
 * plan holds; it adds no clinical instruction of its own (no «до еды», no warnings). The order
 * allows the composition and the form in Latin or in Russian in the genitive (1094н, appendix 1,
 * clause 16); the sign is in Russian (clause 11). The doctor can edit every line.
 */
import {
  type DoseUnit,
  ROUTE_EYE_EAR_NOSE,
  ROUTE_IM,
  ROUTE_INHALED,
  ROUTE_IV,
  ROUTE_ORAL,
  ROUTE_RECTAL,
  ROUTE_SC,
  ROUTE_SUBLINGUAL,
  ROUTE_TOPICAL,
  ROUTE_VAGINAL,
} from '@localmed/contracts';

import { isUnstatedValue } from '@/features/search/registry-values';
import { pluralRu } from '@/i18n/labels';
import type { UnitsPlan } from './dose-compute';
import {
  type FormKind,
  formKind,
  type PieceWords,
  pieceWords,
  pieceWordsOfKind,
} from './product-strength';

/** «0,5», «1 1/2», «2,5»: a count as a person writes it on a prescription. */
export function countText(value: number): string {
  const whole = Math.floor(value + 1e-9);
  const rest = value - whole;
  if (Math.abs(rest) < 1e-9) return String(whole);
  const fraction =
    Math.abs(rest - 0.5) < 1e-6
      ? '1/2'
      : Math.abs(rest - 0.25) < 1e-6
        ? '1/4'
        : Math.abs(rest - 0.75) < 1e-6
          ? '3/4'
          : null;
  if (fraction) return whole === 0 ? fraction : `${whole} ${fraction}`;
  return String(Math.round(value * 100) / 100).replace('.', ',');
}

/** A decimal with a comma: «2,5». */
export function decimalText(value: number): string {
  return String(Math.round(value * 1000) / 1000).replace('.', ',');
}

/** Milligrams as grams the way Latin prescriptions write them: 500 → «0,5», 1000 → «1,0». */
export function gramsText(milligrams: number): string {
  const grams = milligrams / 1000;
  const text = String(Math.round(grams * 100000) / 100000).replace('.', ',');
  return Number.isInteger(grams) ? `${text},0` : text;
}

const UNIT_RU: Readonly<Record<DoseUnit, string>> = {
  mg: 'мг',
  ml: 'мл',
  IU: 'МЕ',
  U: 'ЕД',
  mmol: 'ммоль',
  drop: 'кап.',
  dose: 'доз',
  piece: 'шт.',
};

/** An amount with its unit: «500 мг», «1,5 г», «5 мл». */
export function amountText(amount: number, unit: DoseUnit): string {
  if (unit === 'mg') {
    if (amount >= 1000 && amount % 100 === 0) return `${decimalText(amount / 1000)} г`;
    if (amount < 0.1) return `${decimalText(amount * 1000)} мкг`;
    return `${decimalText(amount)} мг`;
  }
  return `${decimalText(amount)} ${UNIT_RU[unit]}`;
}

/**
 * The route a dosage form says by its own wording («суппозитории ректальные», «таблетки подъязычные»,
 * «капли глазные»), in the words of a prescription. The first pattern that fits wins; a form that does
 * not say is not guessed.
 */
const FORM_ROUTES: readonly { readonly pattern: RegExp; readonly word: string }[] = [
  { pattern: /вагинальн/u, word: 'Вагинально' },
  { pattern: /ректальн/u, word: 'Ректально' },
  { pattern: /сублингвальн|подъязычн/u, word: 'Под язык' },
  { pattern: /для\s+рассасывани|^(?:пастилки|леденцы)/u, word: 'Рассасывать' },
  { pattern: /внутрь|жевательн|шипучи|диспергируем|растворим/u, word: 'Внутрь' },
  { pattern: /глазн/u, word: 'В конъюнктивальный мешок' },
  { pattern: /ушн/u, word: 'В ухо' },
  { pattern: /назальн|в\s+нос/u, word: 'В нос' },
  { pattern: /ингаляц|небул/u, word: 'Ингаляционно' },
  {
    pattern: /наружн|мазь|крем|гель|линимент|паста|пластыр|лосьон|присыпк|трансдермальн/u,
    word: 'Наружно',
  },
  { pattern: /^[^,]*внутривенн(?![^,]*(?:внутримышечн|подкожн))/u, word: 'Внутривенно' },
  { pattern: /^[^,]*внутримышечн(?![^,]*(?:внутривенн|подкожн))/u, word: 'Внутримышечно' },
  { pattern: /^[^,]*подкожн(?![^,]*(?:внутривенн|внутримышечн))/u, word: 'Подкожно' },
];

export function routeOfForm(form: string): string | null {
  const clean = form.toLocaleLowerCase('ru-RU').trim();
  return FORM_ROUTES.find((spec) => spec.pattern.test(clean))?.word ?? null;
}

/**
 * The route word of the sign: what the dosage form says by its own wording, else what the sentence
 * names, else «Внутрь» for a plain oral form. A suppository, a vaginal or sublingual tablet, a lozenge
 * and drops are never «Внутрь» by default.
 */
export function routeWord(routeBits: number, kind: FormKind, form?: string): string | null {
  const byForm = form === undefined ? null : routeOfForm(form);
  if (byForm !== null) return byForm;
  if (kind === 'injection') {
    if ((routeBits & ROUTE_IV) !== 0) return 'Внутривенно';
    if ((routeBits & ROUTE_IM) !== 0) return 'Внутримышечно';
    if ((routeBits & ROUTE_SC) !== 0) return 'Подкожно';
    return null;
  }
  if ((routeBits & ROUTE_SUBLINGUAL) !== 0) return 'Под язык';
  if ((routeBits & ROUTE_ORAL) !== 0) return 'Внутрь';
  if ((routeBits & ROUTE_INHALED) !== 0) return 'Ингаляционно';
  if ((routeBits & ROUTE_RECTAL) !== 0) return 'Ректально';
  if ((routeBits & ROUTE_VAGINAL) !== 0) return 'Вагинально';
  if ((routeBits & ROUTE_TOPICAL) !== 0) return 'Наружно';
  if ((routeBits & (ROUTE_EYE_EAR_NOSE | ROUTE_IV | ROUTE_IM | ROUTE_SC)) !== 0) return null;
  // A suppository the wording does not place is not «Внутрь»: the route is left to the doctor.
  if (form !== undefined && /суппозитор|свеч|пессар/u.test(form.toLocaleLowerCase('ru-RU'))) {
    return null;
  }
  if (kind === 'solid' || kind === 'liquid' || kind === 'powder') return 'Внутрь';
  return null;
}

function unitsPhrase(units: UnitsPlan, words: PieceWords | null, amount: string | null): string {
  const tail = amount ? ` (${amount})` : '';
  if (units.kind === 'ml') return `по ${decimalText(units.count)} мл${tail}`;
  if (units.kind === 'drop') {
    return `по ${countText(units.count)} ${pluralRu(Math.round(units.count), 'капле', 'капли', 'капель')}`;
  }
  if (units.kind === 'dose') {
    return `по ${countText(units.count)} ${pluralRu(Math.round(units.count), 'дозе', 'дозы', 'доз')}`;
  }
  // What the instruction counts (a spoon, an ampoule) comes before the piece word of the dosage form.
  const word = pieceWordsOfKind(units.piece) ?? words ?? PLAIN_PIECE;
  if (!Number.isInteger(units.count)) return `по ${countText(units.count)} ${word.genitive}${tail}`;
  if (units.count === 1) return `по 1 ${word.dative}${tail}`;
  const noun = pluralRu(units.count, word.dative, word.few, word.many);
  return `по ${units.count} ${noun}${tail}`;
}

const PLAIN_PIECE: PieceWords = {
  nominative: 'шт.',
  genitive: 'шт.',
  dative: 'шт.',
  few: 'шт.',
  many: 'шт.',
};

/** «3 раза в день», «1 раз в неделю», «через день». */
export function frequencyPhrase(intakesPerDay: number, periodDays: number): string {
  if (periodDays === 1) {
    const rounded = Math.round(intakesPerDay);
    const count = Math.abs(intakesPerDay - rounded) < 1e-6 ? rounded : intakesPerDay;
    return `${typeof count === 'number' && Number.isInteger(count) ? count : decimalText(count)} ${pluralRu(Math.round(count), 'раз', 'раза', 'раз')} в день`;
  }
  // `intakesPerDay` already divides by the period.
  const perPeriod = Math.round(intakesPerDay * periodDays * 1000) / 1000;
  if (periodDays === 2 && perPeriod === 1) return 'через день';
  const unit =
    periodDays === 7
      ? 'неделю'
      : periodDays === 30
        ? 'месяц'
        : `${periodDays} ${pluralRu(periodDays, 'день', 'дня', 'дней')}`;
  return `${countText(perPeriod)} ${pluralRu(Math.round(perPeriod), 'раз', 'раза', 'раз')} в ${unit}`;
}

export function durationPhrase(days: number): string {
  if (days >= 14 && days % 7 === 0) {
    const weeks = days / 7;
    return `в течение ${weeks} ${pluralRu(weeks, 'недели', 'недель', 'недель')}`;
  }
  return `в течение ${days} ${pluralRu(days, 'дня', 'дней', 'дней')}`;
}

export interface SignaInput {
  readonly form: string;
  readonly routeBits: number;
  readonly units: UnitsPlan | null;
  /** The mass in one intake, when known: «500 мг». */
  readonly singleAmount: { readonly value: number; readonly unit: DoseUnit } | null;
  readonly intakesPerDay: number | null;
  readonly periodDays: number;
  readonly days: number | null;
}

/** «Внутрь по 1 таблетке (500 мг) 3 раза в день в течение 7 дней.» */
export function signaText(input: SignaInput): string {
  const kind = formKind(input.form);
  const parts: string[] = [];
  const route = routeWord(input.routeBits, kind, input.form);
  if (route) parts.push(route);
  if (input.units) {
    const amount =
      input.singleAmount && input.units.kind !== 'drop' && input.units.kind !== 'dose'
        ? amountText(input.singleAmount.value, input.singleAmount.unit)
        : null;
    parts.push(unitsPhrase(input.units, pieceWords(input.form), amount));
  } else if (input.singleAmount) {
    parts.push(`по ${amountText(input.singleAmount.value, input.singleAmount.unit)}`);
  }
  if (input.intakesPerDay !== null) {
    parts.push(frequencyPhrase(input.intakesPerDay, input.periodDays));
  }
  if (input.days !== null) parts.push(durationPhrase(input.days));
  const text = parts.join(' ');
  return text === '' ? '' : `${text}.`;
}

/* ------------------------------------------------------------------------------------------ */
/* Names                                                                                       */
/* ------------------------------------------------------------------------------------------ */

/** Genitive of a Latin name given in the nominative: «Amoxycillinum» → «Amoxycillini». */
export function latinGenitive(nominative: string): string {
  return nominative
    .split(/(\s+\+\s+|\s+)/u)
    .map((word) => {
      if (/^\s*\+?\s*$/u.test(word)) return word;
      if (/(?:ii|ae)$/u.test(word) || /i$/u.test(word)) return word;
      if (/um$/u.test(word)) return `${word.slice(0, -2)}i`;
      if (/us$/u.test(word)) return `${word.slice(0, -2)}i`;
      if (/a$/u.test(word)) return `${word.slice(0, -1)}ae`;
      if (/is$/u.test(word)) return word;
      return word;
    })
    .join('');
}

/** Genitive of a Russian substance name, for the Russian wording the order allows. */
export function russianGenitive(name: string): string {
  return name
    .split(/(\s+|\+)/u)
    .map((word) => {
      if (!/\p{L}/u.test(word)) return word;
      const lower = word.toLocaleLowerCase('ru-RU');
      if (/(?:ая|яя)$/u.test(lower))
        return `${word.slice(0, -2)}${lower.endsWith('яя') ? 'ей' : 'ой'}`;
      if (/(?:ый|ий|ой)$/u.test(lower)) return `${word.slice(0, -2)}ого`;
      if (/ь$/u.test(lower)) return `${word.slice(0, -1)}я`;
      if (/й$/u.test(lower)) return `${word.slice(0, -1)}я`;
      if (/а$/u.test(lower)) return `${word.slice(0, -1)}ы`;
      if (/я$/u.test(lower)) return `${word.slice(0, -1)}и`;
      if (/[бвгджзклмнпрстфхцчшщ]$/u.test(lower)) return `${word}а`;
      return word;
    })
    .join('');
}

const LATIN_FORMS: readonly { readonly pattern: RegExp; readonly abbreviation: string }[] = [
  { pattern: /^таблетки|^драже/u, abbreviation: 'Tab.' },
  { pattern: /^капсулы/u, abbreviation: 'Caps.' },
  { pattern: /^суспензия/u, abbreviation: 'Susp.' },
  { pattern: /^сироп/u, abbreviation: 'Sir.' },
  { pattern: /^капли/u, abbreviation: 'Gtt.' },
  { pattern: /^раствор|^концентрат/u, abbreviation: 'Sol.' },
  { pattern: /^эмульсия/u, abbreviation: 'Emuls.' },
  { pattern: /^(?:порошок|гранулы|лиофилизат)/u, abbreviation: 'Pulv.' },
  { pattern: /^(?:суппозитории|свечи)/u, abbreviation: 'Supp.' },
  { pattern: /^мазь/u, abbreviation: 'Ung.' },
  { pattern: /^крем/u, abbreviation: 'Crem.' },
  { pattern: /^гель/u, abbreviation: 'Gel.' },
  { pattern: /^(?:аэрозоль|спрей)/u, abbreviation: 'Aer.' },
  { pattern: /^(?:пастилки|леденцы)/u, abbreviation: 'Past.' },
];

export function latinForm(form: string): string | null {
  const clean = form.toLocaleLowerCase('ru-RU').trim();
  return LATIN_FORMS.find((spec) => spec.pattern.test(clean))?.abbreviation ?? null;
}

/** Strength as a Latin prescription writes it: grams for solids («0,5»), «125 mg/5 ml» for liquids. */
export function latinStrength(strength: string): string {
  const clean = strength.toLocaleLowerCase('ru-RU').replace(/\s+/gu, ' ').trim();
  const solid = /^(\d+(?:[.,]\d+)?)\s*(мкг|мг|г)$/u.exec(clean);
  if (solid) {
    const value = Number((solid[1] ?? '').replace(',', '.'));
    const milligrams = solid[2] === 'мкг' ? value / 1000 : solid[2] === 'г' ? value * 1000 : value;
    return gramsText(milligrams);
  }
  return clean
    .replaceAll('мкг', 'mcg')
    .replaceAll('мг', 'mg')
    .replaceAll('мл', 'ml')
    .replaceAll('ме', 'ME')
    .replaceAll('ед', 'ED')
    .replaceAll('г', 'g');
}

export interface RpInput {
  readonly latinName: string | null;
  readonly russianName: string;
  readonly form: string;
  readonly strength: string;
  /** Pieces over the course for solids; the container volume in ml for liquids. */
  readonly quantity: number | null;
  readonly quantityKind: UnitsPlan['kind'] | null;
}

/** «Tab. Amoxicillini 0,5 N 21» — Latin when the substance has a Latin name, else Russian. */
export function rpLine(input: RpInput): string {
  const abbreviation = latinForm(input.form);
  const count =
    input.quantity === null
      ? ''
      : input.quantityKind === 'ml'
        ? ` ${decimalText(Math.ceil(input.quantity))} ml`
        : ` N ${countText(Math.ceil(input.quantity))}`;
  // A dosage the registry does not state is left out of the line, never printed as its words.
  const stated = !isUnstatedValue(input.strength);
  if (input.latinName && abbreviation) {
    const head = [abbreviation, latinGenitive(input.latinName)];
    return `${[...head, ...(stated ? [latinStrength(input.strength)] : [])].join(' ')}${count}`;
  }
  const formWord = input.form.charAt(0).toLocaleUpperCase('ru-RU') + input.form.slice(1);
  const head = [formWord, russianGenitive(input.russianName), ...(stated ? [input.strength] : [])];
  return `${head.join(' ')}${count.replace(' ml', ' мл')}`;
}
