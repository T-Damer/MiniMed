/**
 * Strengths and dosage forms as the ЕСКЛП registry writes them (RX1): «500 мг», «125 мг/5 мл»,
 * «250 мг/мл». A strength that is a combination of substances, a percentage or something else the
 * arithmetic cannot use is `null`: the screen then lets the doctor pick the number of pieces
 * from the instruction's own words and computes no mass.
 */
import type { DoseUnit, PieceKind } from '@localmed/contracts';

export interface SolidStrength {
  readonly kind: 'solid';
  /** Amount of the substance in one piece (tablet, capsule, vial), in `unit`. */
  readonly amount: number;
  readonly unit: DoseUnit;
}

export interface LiquidStrength {
  readonly kind: 'liquid';
  /** Amount of the substance per millilitre. */
  readonly perMl: number;
  readonly unit: DoseUnit;
  /** The registry states the amount for a volume other than 1 ml («125 мг/5 мл»). */
  readonly volumeMl: number;
}

export type ProductStrength = SolidStrength | LiquidStrength;

const NUMBER = '(\\d+(?:[.,]\\d+)?(?: \\d{3})*)';
const UNIT = '(мкг|мг|г|ме|ед|ммоль)';
const SOLID = new RegExp(`^${NUMBER}\\s*${UNIT}$`, 'u');
const LIQUID = new RegExp(`^${NUMBER}\\s*${UNIT}\\s*/\\s*(?:${NUMBER}\\s*)?мл$`, 'u');

const FACTORS: Readonly<Record<string, { unit: DoseUnit; factor: number }>> = {
  мкг: { unit: 'mg', factor: 0.001 },
  мг: { unit: 'mg', factor: 1 },
  г: { unit: 'mg', factor: 1000 },
  ме: { unit: 'IU', factor: 1 },
  ед: { unit: 'U', factor: 1 },
  ммоль: { unit: 'mmol', factor: 1 },
};

function toNumber(text: string): number {
  return Number(text.replaceAll(' ', '').replace(',', '.'));
}

/** The strength of a registry row, or null when it is not a single substance in a plain unit. */
export function parseStrength(text: string): ProductStrength | null {
  const clean = text.toLocaleLowerCase('ru-RU').replace(/\s+/gu, ' ').trim();
  if (clean === '' || /[+;%]/u.test(clean)) return null;
  const liquid = LIQUID.exec(clean);
  if (liquid) {
    const unit = FACTORS[liquid[2] ?? ''];
    const volume = liquid[3] === undefined ? 1 : toNumber(liquid[3]);
    const amount = toNumber(liquid[1] ?? '');
    if (!unit || !Number.isFinite(amount) || amount <= 0 || !(volume > 0)) return null;
    return {
      kind: 'liquid',
      perMl: (amount * unit.factor) / volume,
      unit: unit.unit,
      volumeMl: volume,
    };
  }
  const solid = SOLID.exec(clean);
  if (solid) {
    const unit = FACTORS[solid[2] ?? ''];
    const amount = toNumber(solid[1] ?? '');
    if (!unit || !Number.isFinite(amount) || amount <= 0) return null;
    return { kind: 'solid', amount: amount * unit.factor, unit: unit.unit };
  }
  return null;
}

export type FormKind = 'solid' | 'liquid' | 'drops' | 'powder' | 'injection' | 'other';

const FORM_PATTERNS: readonly { readonly kind: FormKind; readonly pattern: RegExp }[] = [
  { kind: 'drops', pattern: /^капли/u },
  {
    kind: 'injection',
    pattern:
      /(?:для|в)\s+(?:внутривенн|внутримышечн|подкожн|инъекц|инфуз)|^(?:раствор|лиофилизат|концентрат|эмульсия)\s.*(?:введени|инъекц|инфуз)/u,
  },
  {
    kind: 'powder',
    pattern:
      /^(?:порошок|гранулы|лиофилизат)\s+для\s+приготовления\s+(?:суспензии|раствора)\s+для\s+приема\s+внутрь/u,
  },
  { kind: 'liquid', pattern: /^(?:суспензия|сироп|эликсир|раствор|эмульсия|настойка|экстракт)/u },
  {
    kind: 'solid',
    pattern:
      /^(?:таблетки|капсулы|драже|пастилки|леденцы|суппозитории|свечи|саше|гранулы|порошок)/u,
  },
];

/** The kind of a dosage form wording; `other` for ointments, aerosols and the like. */
export function formKind(form: string): FormKind {
  const clean = form.toLocaleLowerCase('ru-RU').trim();
  for (const spec of FORM_PATTERNS) if (spec.pattern.test(clean)) return spec.kind;
  return 'other';
}

/** Tablets, dragees and the like: the forms a piece of may be halved when the instruction allows. */
export function isTablet(form: string): boolean {
  return /^(?:таблетки|драже)/u.test(form.toLocaleLowerCase('ru-RU').trim());
}

/** The piece word of a dosage form or of a counted measure, in the forms the sign text needs. */
export interface PieceWords {
  /** Nominative singular, for the count «1»: «таблетка». */
  readonly nominative: string;
  /** Dative singular, after «по 1»: «таблетке». */
  readonly dative: string;
  /** After 2–4: «таблетки». */
  readonly few: string;
  /** Genitive singular, after a fraction («1/2 таблетки»). */
  readonly genitive: string;
  /** After 5 and more: «таблеток». */
  readonly many: string;
}

const PIECES: readonly { readonly pattern: RegExp; readonly words: PieceWords }[] = [
  {
    pattern: /^(?:таблетки|драже)/u,
    words: {
      nominative: 'таблетка',
      genitive: 'таблетки',
      dative: 'таблетке',
      few: 'таблетки',
      many: 'таблеток',
    },
  },
  {
    pattern: /^капсулы/u,
    words: {
      nominative: 'капсула',
      genitive: 'капсулы',
      dative: 'капсуле',
      few: 'капсулы',
      many: 'капсул',
    },
  },
  {
    pattern: /^(?:суппозитории|свечи)/u,
    words: {
      nominative: 'суппозиторий',
      genitive: 'суппозитория',
      dative: 'суппозиторию',
      few: 'суппозитория',
      many: 'суппозиториев',
    },
  },
  {
    pattern: /^(?:пастилки|леденцы)/u,
    words: {
      nominative: 'пастилка',
      genitive: 'пастилки',
      dative: 'пастилке',
      few: 'пастилки',
      many: 'пастилок',
    },
  },
  {
    pattern: /^саше/u,
    words: { nominative: 'саше', genitive: 'саше', dative: 'саше', few: 'саше', many: 'саше' },
  },
  {
    pattern: /^(?:лиофилизат|порошок).*(?:введени|инъекц|инфуз)/u,
    words: {
      nominative: 'флакон',
      genitive: 'флакона',
      dative: 'флакону',
      few: 'флакона',
      many: 'флаконов',
    },
  },
];

export function pieceWords(form: string): PieceWords | null {
  const clean = form.toLocaleLowerCase('ru-RU').trim();
  return PIECES.find((spec) => spec.pattern.test(clean))?.words ?? null;
}

/**
 * The words for what the instruction itself counts («по 1 чайной ложке», «по 1 ампуле»): the instruction's
 * own unit wins over the piece word of the dosage form, so a syrup is never «1 шт.».
 */
const KIND_WORDS: Readonly<Partial<Record<PieceKind, PieceWords>>> = {
  tablet: {
    nominative: 'таблетка',
    genitive: 'таблетки',
    dative: 'таблетке',
    few: 'таблетки',
    many: 'таблеток',
  },
  capsule: {
    nominative: 'капсула',
    genitive: 'капсулы',
    dative: 'капсуле',
    few: 'капсулы',
    many: 'капсул',
  },
  suppository: {
    nominative: 'суппозиторий',
    genitive: 'суппозитория',
    dative: 'суппозиторию',
    few: 'суппозитория',
    many: 'суппозиториев',
  },
  sachet: { nominative: 'саше', genitive: 'саше', dative: 'саше', few: 'саше', many: 'саше' },
  ampoule: {
    nominative: 'ампула',
    genitive: 'ампулы',
    dative: 'ампуле',
    few: 'ампулы',
    many: 'ампул',
  },
  vial: {
    nominative: 'флакон',
    genitive: 'флакона',
    dative: 'флакону',
    few: 'флакона',
    many: 'флаконов',
  },
  lozenge: {
    nominative: 'пастилка',
    genitive: 'пастилки',
    dative: 'пастилке',
    few: 'пастилки',
    many: 'пастилок',
  },
  patch: {
    nominative: 'пластырь',
    genitive: 'пластыря',
    dative: 'пластырю',
    few: 'пластыря',
    many: 'пластырей',
  },
  measure: {
    nominative: 'мерная ложка',
    genitive: 'мерной ложки',
    dative: 'мерной ложке',
    few: 'мерные ложки',
    many: 'мерных ложек',
  },
  teaspoon: {
    nominative: 'чайная ложка',
    genitive: 'чайной ложки',
    dative: 'чайной ложке',
    few: 'чайные ложки',
    many: 'чайных ложек',
  },
  tablespoon: {
    nominative: 'столовая ложка',
    genitive: 'столовой ложки',
    dative: 'столовой ложке',
    few: 'столовые ложки',
    many: 'столовых ложек',
  },
  dessertspoon: {
    nominative: 'десертная ложка',
    genitive: 'десертной ложки',
    dative: 'десертной ложке',
    few: 'десертные ложки',
    many: 'десертных ложек',
  },
  cap: {
    nominative: 'мерный колпачок',
    genitive: 'мерного колпачка',
    dative: 'мерному колпачку',
    few: 'мерных колпачка',
    many: 'мерных колпачков',
  },
  cup: {
    nominative: 'мерный стакан',
    genitive: 'мерного стакана',
    dative: 'мерному стакану',
    few: 'мерных стакана',
    many: 'мерных стаканов',
  },
};

export function pieceWordsOfKind(kind: PieceKind | null | undefined): PieceWords | null {
  return kind ? (KIND_WORDS[kind] ?? null) : null;
}
