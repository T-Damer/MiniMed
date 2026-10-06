/**
 * Substance names of the ЕСКЛП МНН cards, as match patterns (INT1).
 *
 * A card is one standardized МНН; a combination card lists its components. The index works on
 * SUBSTANCES: a text that names «ибупрофен» is about every card that contains ибупрофен. A
 * substance key is the match stems of its name joined by a space, so a key written at build time
 * and one derived in the app from the same name are the same string.
 */
import { type NamePattern, nameStems } from './mention-matcher';

export interface InteractionCard {
  /** `esklp.mnn.<slug>`. */
  readonly id: string;
  /** The standardized МНН as the registry writes it. */
  readonly name: string;
  readonly synonyms: readonly string[];
  readonly components: readonly string[];
  readonly atcCodes: readonly string[];
}

/**
 * ЕСКЛП names that are also body parts, tissues, gases or laboratory analytes. An instruction that
 * writes «щитовидной железы», «инфаркт миокарда», «мочевины в крови» does not mean the drug, so
 * these keys are never searched for. Found by reading the most frequent hits of the first build;
 * every entry is a card name that is an anatomy or laboratory word in running text («железа» is
 * both «iron» and «gland»; the salts of iron have two-word names and are not affected).
 */
export const NON_DRUG_SUBSTANCE_KEYS: ReadonlySet<string> = new Set([
  'желез',
  'миокард',
  'сыворотк кров',
  'мочевин',
  'кислород',
  'азот',
  'фосфор',
  'амилаз',
  'липаз',
  // A neurotransmitter and the «серотониновый синдром»: the drug of this name is not meant.
  'серотонин',
  // Cytochrome P450 and the blood ammonia: proteins and laboratory values.
  'цитохр',
  'аммиак',
  'глутатион',
]);

/**
 * Elements that are drugs («препараты кальция») and also laboratory values («содержание калия в
 * сыворотке»). They are searched only in the interaction section, where the instruction means a
 * drug; in warnings and leaflets they are almost always an analyte.
 */
export const ANALYTE_SUBSTANCE_KEYS: ReadonlySet<string> = new Set([
  'кали',
  'кальц',
  'магн',
  'натр',
]);

export interface SubstanceAlias {
  /** The words an instruction uses. */
  readonly text: string;
  /** The substance key they stand for. */
  readonly key: string;
  readonly basis: string;
}

/**
 * Everyday names of a substance that the ЕСКЛП does not list. Alcohol is not a drug of the
 * register, but instructions name it as one («не принимать с алкоголем»); the interaction tool
 * treats it as a substance that has no instruction of its own.
 */
export const SUBSTANCE_ALIASES: readonly SubstanceAlias[] = [
  { text: 'этанол', key: 'этанол', basis: 'Название вещества: этанол.' },
  { text: 'алкоголь', key: 'этанол', basis: 'Этанол = алкоголь (общеупотребительное название).' },
  { text: 'алкогольные напитки', key: 'этанол', basis: 'Напитки, содержащие этанол.' },
  { text: 'спиртные напитки', key: 'этанол', basis: 'Напитки, содержащие этанол.' },
  { text: 'этиловый спирт', key: 'этанол', basis: 'Этиловый спирт = этанол.' },
  { text: 'спирт этиловый', key: 'этанол', basis: 'Этиловый спирт = этанол.' },
];

/** The key the tool gives to «алкоголь» as a drug-like item. */
export const ALCOHOL_SUBSTANCE_KEY = 'этанол';

export function substanceKey(name: string): string {
  return nameStems(name).join(' ');
}

function cleanName(name: string): string {
  return name
    .replace(/\[[^\]]*\]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

/** The names of the substances a card holds: its components, or the МНН itself. */
export function cardComponentNames(card: InteractionCard): readonly string[] {
  const parts = card.components.length > 0 ? card.components : card.name.split('+');
  const names = parts.map(cleanName).filter((name) => name !== '' && name !== '~');
  return [...new Set(names)];
}

/** Substance keys of a card; a name with no usable word is left out. */
export function cardSubstanceKeys(card: InteractionCard): readonly string[] {
  return [
    ...new Set(
      cardComponentNames(card)
        .map(substanceKey)
        .filter((key) => key !== ''),
    ),
  ];
}

/**
 * Patterns of every substance of every card, under the names of its components only. The other
 * names a card lists (`inn`) are not used: for a combination or a vaccine they are names of single
 * components and would make the card answer to words that are not its own.
 */
export function substancePatterns(cards: readonly InteractionCard[]): readonly NamePattern[] {
  const patterns: NamePattern[] = [];
  const seen = new Set<string>();
  const add = (target: string, name: string): void => {
    const stems = nameStems(name);
    const id = `${target}|${stems.join(' ')}`;
    if (stems.length === 0 || seen.has(id)) return;
    seen.add(id);
    patterns.push({ target, stems });
  };
  for (const card of cards) {
    for (const name of cardComponentNames(card)) {
      const key = substanceKey(name);
      if (key && !NON_DRUG_SUBSTANCE_KEYS.has(key)) add(`s:${key}`, name);
    }
  }
  for (const alias of SUBSTANCE_ALIASES) add(`s:${alias.key}`, alias.text);
  return patterns;
}

/** The match stems of a substance key (the key is already stems joined by a space). */
export function stemsOfKey(key: string): readonly string[] {
  return key.split(' ').filter((stem) => stem !== '');
}
