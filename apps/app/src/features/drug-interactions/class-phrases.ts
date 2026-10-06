/**
 * Names of drug classes, taken from the official Russian ATC classification (INT1).
 *
 * The dictionary is the НСИ «АТХ» names (`features/medications/atc-names.json`, levels 2–4). A name
 * is cut at its qualifiers («для …», «в комбинации с …», «, …», «и …»); the container words that
 * almost every name uses («препараты», «средства», «другие», …, found by their frequency in the
 * names, not listed by hand) are dropped; what is left is the phrase an instruction would use
 * («Блокаторы кальциевых каналов», «Ингибиторы АПФ»). A phrase that several branches of the
 * classification claim («Антибиотики» is in A07, D06, J04, L01) is ambiguous and is dropped.
 *
 * The only hand-made part is `CLASS_ALIASES`: abbreviations and everyday names that are not in the
 * classification text (НПВП, антикоагулянты, статины). Each alias points at official ATC codes and
 * the build refuses an alias whose code is not in the НСИ dictionary.
 */
import { type NamePattern, nameStems, nameWordStem } from './mention-matcher';

export interface ClassAlias {
  /** The words an instruction uses. */
  readonly text: string;
  /** Official ATC groups the words stand for (prefixes of drug ATC codes). */
  readonly codes: readonly string[];
  /** Why the words stand for these groups. */
  readonly basis: string;
}

const BASIS_NSI = 'НСИ «АТХ»: название группы';

/**
 * Words used in instructions that the classification does not spell out. Sources: the ATC group
 * names themselves (НСИ «АТХ» v3.8) and the standard Russian abbreviations of those groups.
 */
export const CLASS_ALIASES: readonly ClassAlias[] = [
  { text: 'антациды', codes: ['A02A'], basis: `${BASIS_NSI} A02A «Антациды»` },
  { text: 'опиоиды', codes: ['N02A'], basis: `${BASIS_NSI} N02A «Опиоиды»` },
  { text: 'фибраты', codes: ['C10AB'], basis: `${BASIS_NSI} C10AB «Фибраты»` },
  { text: 'хинолоны', codes: ['J01M'], basis: `${BASIS_NSI} J01M «Антибактериальные хинолоны»` },
  { text: 'фторхинолоны', codes: ['J01M'], basis: `${BASIS_NSI} J01MA «Фторхинолоны»` },
  { text: 'тиазиды', codes: ['C03A'], basis: `${BASIS_NSI} C03A «Тиазидные диуретики»` },
  { text: 'коксибы', codes: ['M01AH'], basis: `${BASIS_NSI} M01AH «Коксибы»` },
  {
    text: 'НПВП',
    codes: ['M01A'],
    basis: `${BASIS_NSI} M01A «Нестероидные противовоспалительные…»`,
  },
  { text: 'НПВС', codes: ['M01A'], basis: `${BASIS_NSI} M01A (НПВС — тот же перечень)` },
  {
    text: 'нестероидные противовоспалительные средства',
    codes: ['M01A'],
    basis: `${BASIS_NSI} M01A`,
  },
  {
    text: 'антикоагулянты',
    codes: ['B01AA', 'B01AB', 'B01AE', 'B01AF'],
    basis: `${BASIS_NSI} B01A: антагонисты витамина K, группа гепарина, прямые ингибиторы тромбина и фактора Xa`,
  },
  {
    text: 'антиагреганты',
    codes: ['B01AC'],
    basis: `${BASIS_NSI} B01AC «Ингибиторы агрегации тромбоцитов…»`,
  },
  { text: 'антиагрегантные средства', codes: ['B01AC'], basis: `${BASIS_NSI} B01AC` },
  {
    text: 'антибиотики',
    codes: ['J01'],
    basis: `${BASIS_NSI} J01 «Антибактериальные препараты системного действия»`,
  },
  {
    text: 'ГКС',
    codes: ['H02A'],
    basis: `${BASIS_NSI} H02A «Кортикостероиды для системного использования»`,
  },
  { text: 'глюкокортикостероиды', codes: ['H02A'], basis: `${BASIS_NSI} H02A` },
  {
    text: 'кортикостероиды',
    codes: ['H02A'],
    basis: `${BASIS_NSI} H02A (в названиях групп других разделов слово встречается и с уточнением)`,
  },
  { text: 'иАПФ', codes: ['C09A', 'C09B'], basis: `${BASIS_NSI} C09A/C09B «Ингибиторы АПФ»` },
  {
    text: 'АРА',
    codes: ['C09C', 'C09D'],
    basis: `${BASIS_NSI} C09C/C09D «Антагонисты рецепторов ангиотензина II»`,
  },
  {
    text: 'БРА',
    codes: ['C09C', 'C09D'],
    basis: `${BASIS_NSI} C09C/C09D (блокаторы рецепторов ангиотензина)`,
  },
  {
    text: 'СИОЗС',
    codes: ['N06AB'],
    basis: `${BASIS_NSI} N06AB «Селективные ингибиторы обратного захвата серотонина»`,
  },
  {
    text: 'ТЦА',
    codes: ['N06AA'],
    basis: `${BASIS_NSI} N06AA «Неселективные ингибиторы обратного захвата моноаминов» (трициклические антидепрессанты)`,
  },
  { text: 'трициклические антидепрессанты', codes: ['N06AA'], basis: `${BASIS_NSI} N06AA` },
  {
    text: 'ИМАО',
    codes: ['N06AF', 'N04BD'],
    basis: `${BASIS_NSI} N06AF/N04BD «Ингибиторы моноаминоксидазы»`,
  },
  {
    text: 'нейролептики',
    codes: ['N05A'],
    basis: `${BASIS_NSI} N05A «Антипсихотические средства»`,
  },
  { text: 'транквилизаторы', codes: ['N05B'], basis: `${BASIS_NSI} N05B «Анксиолитики»` },
  {
    text: 'противосудорожные',
    codes: ['N03'],
    basis: `${BASIS_NSI} N03 «Противоэпилептические препараты»`,
  },
  { text: 'статины', codes: ['C10AA'], basis: `${BASIS_NSI} C10AA «Ингибиторы ГМГ-КоА-редуктазы»` },
  { text: 'нитраты', codes: ['C01DA'], basis: `${BASIS_NSI} C01DA «Органические нитраты»` },
  {
    text: 'гипотензивные',
    codes: ['C02'],
    basis: `${BASIS_NSI} C02 «Антигипертензивные средства»`,
  },
  { text: 'цитостатики', codes: ['L01'], basis: `${BASIS_NSI} L01 «Противоопухолевые препараты»` },
  { text: 'наркотические анальгетики', codes: ['N02A'], basis: `${BASIS_NSI} N02A «Опиоиды»` },
  { text: 'опиоидные анальгетики', codes: ['N02A'], basis: `${BASIS_NSI} N02A «Опиоиды»` },
  {
    text: 'пероральные контрацептивы',
    codes: ['G03A'],
    basis: `${BASIS_NSI} G03A «Гормональные контрацептивы системного действия»`,
  },
  { text: 'оральные контрацептивы', codes: ['G03A'], basis: `${BASIS_NSI} G03A` },
];

export interface ClassPhrase {
  readonly stems: readonly string[];
  readonly codes: readonly string[];
  readonly origin: 'atc-name' | 'alias';
  /** The phrase ends in an adjective: it names the class only in the plural. */
  readonly pluralOnly: boolean;
}

export interface ClassPhraseReport {
  readonly phrases: number;
  readonly fromNames: number;
  readonly fromAliases: number;
  /** Phrases several branches of the classification claim (kept, with the codes of every branch). */
  readonly manyBranches: readonly string[];
  readonly containerWords: readonly string[];
}

/** Words in more than this share of the group names are containers («препараты», «средства»). */
const CONTAINER_WORD_SHARE = 0.07;
/** … and in at least this many names, so a small dictionary has no containers by accident. */
const CONTAINER_WORD_MIN_NAMES = 20;
/** A single-word phrase shorter than this is an abbreviation or an ordinary word (an alias covers real ones). */
const MIN_SINGLE_PHRASE_LENGTH = 7;
/** ATC section V holds contrast agents, solutions, diets and dressings: no class an instruction names. */
const EXCLUDED_ATC_SECTIONS = new Set(['V']);
/** «Препараты щитовидной железы»: the words after a leading «препараты» name an organ, not a class. */
const ORGAN_COMPLEMENT_HEADS = new Set(['препарат', 'средств']);
/** «Другие X», «Прочие X»: the filler is dropped, X stays. */
const FILLER_STEMS = new Set(['друг', 'проч', 'разн']);
/**
 * Pieces of group names that are not class names: qualifiers, dosage forms, anatomy. The derivation
 * produces them because it only cuts names at punctuation and prepositions; they are listed here
 * (prefixes, so every inflection is covered) instead of being matched.
 */
const NOT_A_CLASS_PREFIXES = [
  'включ',
  'исключ',
  'комбинирован',
  'комплексн',
  'фиксирован',
  'секвенциальн',
  'природн',
  'вторичн',
  'аналогичн',
  'инфекци',
  'таблетк',
  'раствор',
  'реагент',
  'коллоид',
  'частиц',
  'повязк',
  'антибактериальных',
  'бактериальных',
  'адренергических',
  'желчевыводящих',
  'мочевыводящих',
  'желчных',
  'жирных',
  'суставных',
  'вызываемых',
  'недерж',
  'обмен',
  'наруш',
  'способствующ',
  'снижающ',
  'подавляющ',
  'повышающ',
  'увеличивающ',
  'применяем',
  'используем',
  'влияющ',
  'длительн',
  'коротк',
  'красящ',
  'хирургическ',
  'вязкоупруг',
  'препятствующ',
  'индифферентн',
  'диагностическ',
  'пластыр',
  'перевязочн',
  'лечебн',
  'расщепляющ',
  'содержащ',
  'его',
  'класс',
  'пиримидин',
  'сульфон',
  'минеральн',
  'вазелин',
  'силикон',
  'шампун',
  'общи',
  'использ',
  'родственн',
  'третичн',
  'четвертичн',
  'ферментн',
  'близк',
  'серосодержащ',
  'гематологическ',
  'алкалоид',
  'электролит',
];
/** Pronouns left over from «их аналоги», «его аналог»: no class. */
const NOT_A_CLASS_STEMS = new Set(['их', 'ее', 'его', 'она', 'они']);
/** The last word of a class name is an adjective («слабительные»): a class only in the plural. */
const ADJECTIVE_ENDING = /(?:ые|ие|ый|ий|ая|ое|ой)$/iu;
const QUALIFIER_SPLIT =
  /\s(?:для|при|в|с|со|на|кроме|включая|применяемые|действующие|системного|местного|системного)\s/u;
const PIECE_SPLIT = /,|;|\sи\s|\sили\s/u;

function atcLevel(code: string): number {
  return code.length <= 1 ? 1 : code.length === 3 ? 2 : code.length === 4 ? 3 : 4;
}

function isPrefixOfAny(code: string, others: readonly string[]): boolean {
  return others.some((other) => other !== code && code.startsWith(other));
}

/** Keeps the shortest codes of a set: «C03» already covers «C03A». */
function minimalCodes(codes: readonly string[]): readonly string[] {
  const unique = [...new Set(codes)].toSorted();
  return unique.filter((code) => !isPrefixOfAny(code, unique));
}

interface DerivedPhrase {
  readonly stems: readonly string[];
  readonly pluralOnly: boolean;
}

function wordsOf(piece: string): readonly { readonly word: string; readonly stem: string }[] {
  const words: { word: string; stem: string }[] = [];
  for (const match of piece.matchAll(/[a-zа-яёβ]+/giu)) {
    const stem = nameWordStem(match[0]);
    if (stem) words.push({ word: match[0], stem });
  }
  return words;
}

function phrasesOfName(name: string, containers: ReadonlySet<string>): readonly DerivedPhrase[] {
  const withoutBrackets = name.replace(/\([^)]*\)/gu, ' ').replace(/\[[^\]]*\]/gu, ' ');
  // Only what stands before the first qualifier names the class: «Антибактериальные препараты
  // системного действия» is «антибактериальные препараты».
  const head = withoutBrackets.split(QUALIFIER_SPLIT)[0] ?? '';
  const phrases: DerivedPhrase[] = [];
  for (const piece of head.split(PIECE_SPLIT)) {
    let words = [...wordsOf(piece)];
    while (words.length > 0 && FILLER_STEMS.has(words[0]?.stem ?? '')) words = words.slice(1);
    if (ORGAN_COMPLEMENT_HEADS.has(words[0]?.stem ?? '')) continue;
    words = words.filter((entry) => !containers.has(entry.stem));
    const stems = words.map((entry) => entry.stem);
    if (stems.length === 0) continue;
    if (stems.some((stem) => NOT_A_CLASS_STEMS.has(stem))) continue;
    if (stems.some((stem) => NOT_A_CLASS_PREFIXES.some((prefix) => stem.startsWith(prefix))))
      continue;
    if (stems.length === 1 && (stems[0] ?? '').length < MIN_SINGLE_PHRASE_LENGTH) continue;
    const last = words.at(-1)?.word ?? '';
    phrases.push({ stems, pluralOnly: ADJECTIVE_ENDING.test(last) });
  }
  return phrases;
}

export function deriveClassPhrases(
  atcNames: Readonly<Record<string, string>>,
  aliases: readonly ClassAlias[] = CLASS_ALIASES,
): { readonly phrases: readonly ClassPhrase[]; readonly report: ClassPhraseReport } {
  const entries = Object.entries(atcNames).filter(
    ([code]) => atcLevel(code) >= 2 && !EXCLUDED_ATC_SECTIONS.has(code.charAt(0)),
  );
  // Container words: found by frequency across the official names.
  const wordFrequency = new Map<string, number>();
  for (const [, name] of entries) {
    for (const stem of new Set(nameStems(name))) {
      wordFrequency.set(stem, (wordFrequency.get(stem) ?? 0) + 1);
    }
  }
  const containers = new Set(
    [...wordFrequency]
      .filter(
        ([, count]) =>
          count >= CONTAINER_WORD_MIN_NAMES && count / entries.length >= CONTAINER_WORD_SHARE,
      )
      .map(([stem]) => stem),
  );

  const byPhrase = new Map<
    string,
    { stems: readonly string[]; pluralOnly: boolean; codes: string[] }
  >();
  for (const [code, name] of entries) {
    for (const phrase of phrasesOfName(name, containers)) {
      const key = phrase.stems.join(' ');
      const entry = byPhrase.get(key);
      if (entry) entry.codes.push(code);
      else byPhrase.set(key, { ...phrase, codes: [code] });
    }
  }

  const aliasStems = new Set(aliases.map((alias) => nameStems(alias.text).join(' ')));
  const phrases: ClassPhrase[] = [];
  const manyBranches: string[] = [];
  for (const [key, entry] of byPhrase) {
    if (aliasStems.has(key)) continue;
    const codes = minimalCodes(entry.codes);
    // The same class name stands in several branches (systemic and eye drops: «бета-адреноблокаторы»
    // are C07 and S01ED): the phrase names the class in all of them.
    if (new Set(codes.map((code) => code.charAt(0))).size > 1) manyBranches.push(key);
    phrases.push({ stems: entry.stems, codes, origin: 'atc-name', pluralOnly: entry.pluralOnly });
  }
  const fromNames = phrases.length;
  for (const alias of aliases) {
    for (const code of alias.codes) {
      if (!(code in atcNames)) {
        throw new Error(
          `Class alias «${alias.text}»: ATC code ${code} is not in the НСИ dictionary`,
        );
      }
    }
    const lastWord = wordsOf(alias.text).at(-1)?.word ?? '';
    phrases.push({
      stems: nameStems(alias.text),
      codes: [...alias.codes],
      origin: 'alias',
      pluralOnly: ADJECTIVE_ENDING.test(lastWord),
    });
  }
  return {
    phrases,
    report: {
      phrases: phrases.length,
      fromNames,
      fromAliases: aliases.length,
      manyBranches: manyBranches.toSorted(),
      containerWords: [...containers].toSorted(),
    },
  };
}

/** Matcher patterns of the class phrases: one `c:<code>` target per code. */
export function classPatterns(phrases: readonly ClassPhrase[]): readonly NamePattern[] {
  return phrases.flatMap((phrase) =>
    phrase.codes.map((code) => ({
      target: `c:${code}`,
      stems: phrase.stems,
      pluralOnly: phrase.pluralOnly,
    })),
  );
}
