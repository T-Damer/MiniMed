/**
 * ATC (АТХ) codes as the Russian registries (ЕСКЛП) give them: normalisation of the code and the
 * level-by-level explanation shown in the drug screen.
 *
 * Names are never invented. Levels 1-4 take their Russian names from the Minzdrav NSI dictionary
 * «АТХ» (`atc-names.ts`, a lazy asset built from the dictionary the NSI publishes). Only where that
 * dictionary has no such code do the older, narrower sources apply: the 14 level-1 headings of
 * MiniMed's own medication taxonomy (`content/medication-module-taxonomy.yaml`) and the chain of
 * group names that ЕСКЛП prints in its «pharmacotherapeutic group» text for some nodes. Level 5
 * is the node's own substance name.
 */

export type AtcLevel = 1 | 2 | 3 | 4 | 5;

/** Where the name of a level comes from; shown to the reader beside the name. */
export type AtcNameSource = 'nsi-atc' | 'minimed-taxonomy' | 'esklp-group-text' | 'esklp-substance';

/** The code length that completes each level: N, N06, N06B, N06BX, N06BX03. */
const LEVEL_LENGTHS: readonly [1, 3, 4, 5, 7] = [1, 3, 4, 5, 7];

/** Level-1 headings, as in MiniMed's medication taxonomy (module titles). */
export const ATC_ANATOMICAL_GROUPS: Readonly<Record<string, string>> = {
  A: 'Пищеварительный тракт и обмен веществ',
  B: 'Кровь и кроветворение',
  C: 'Сердечно-сосудистая система',
  D: 'Дерматологические препараты',
  G: 'Мочеполовая система и половые гормоны',
  H: 'Системные гормональные препараты',
  J: 'Противоинфекционные препараты системного действия',
  L: 'Противоопухолевые и иммуномодулирующие препараты',
  M: 'Костно-мышечная система',
  N: 'Нервная система',
  P: 'Противопаразитарные препараты и репелленты',
  R: 'Дыхательная система',
  S: 'Органы чувств',
  V: 'Прочие препараты и диагностические средства',
};

/** What a position in the code means; structural wording, not a classification list. */
export const ATC_LEVEL_ROLES: Readonly<Record<AtcLevel, string>> = {
  1: 'Анатомическая группа',
  2: 'Терапевтическая подгруппа',
  3: 'Фармакологическая подгруппа',
  4: 'Химическая подгруппа',
  5: 'Химическое вещество',
};

/**
 * Cyrillic letters that look like Latin ones: registries and OCR put them into ATC codes
 * («С01ВА» typed on a Russian keyboard).
 */
const CYRILLIC_LOOKALIKES: Readonly<Record<string, string>> = {
  А: 'A',
  В: 'B',
  С: 'C',
  Е: 'E',
  Н: 'H',
  К: 'K',
  М: 'M',
  О: 'O',
  Р: 'P',
  Т: 'T',
  Х: 'X',
};

export interface NormalizedAtcCode {
  /** Latin upper-case code without spaces, e.g. `N06BX`. */
  readonly code: string;
  readonly level: AtcLevel;
  /** True when look-alike Cyrillic letters or spacing were corrected. */
  readonly corrected: boolean;
}

const LEVEL_PATTERNS: readonly RegExp[] = [
  /^[ABCDGHJLMNPRSV]$/u,
  /^[ABCDGHJLMNPRSV]\d{2}$/u,
  /^[ABCDGHJLMNPRSV]\d{2}[A-Z]$/u,
  /^[ABCDGHJLMNPRSV]\d{2}[A-Z]{2}$/u,
  /^[ABCDGHJLMNPRSV]\d{2}[A-Z]{2}\d{2}$/u,
];

/**
 * Normalises a code from the source. Returns null for the registry's «~» placeholder, empty values
 * and anything that is not an ATC code of level 1-5 (the code is then left as the source wrote it).
 */
export function normalizeAtcCode(raw: string): NormalizedAtcCode | null {
  const stripped = raw.replace(/[\s­​]+/gu, '');
  if (!stripped || stripped === '~') return null;
  const code = [...stripped.toLocaleUpperCase('ru-RU')]
    .map((character) => CYRILLIC_LOOKALIKES[character] ?? character)
    .join('');
  const levelIndex = LEVEL_PATTERNS.findIndex((pattern) => pattern.test(code));
  if (levelIndex < 0) return null;
  return { code, level: (levelIndex + 1) as AtcLevel, corrected: code !== raw };
}

/** `N06BX03` → `N`, `N06`, `N06B`, `N06BX`, `N06BX03`; shorter codes stop at their level. */
export function atcPrefixes(
  code: string,
): readonly { readonly level: AtcLevel; readonly code: string }[] {
  return LEVEL_LENGTHS.flatMap((length, index) =>
    code.length >= length ? [{ level: (index + 1) as AtcLevel, code: code.slice(0, length) }] : [],
  );
}

/** One level of the explanation. */
export interface AtcLadderStep {
  readonly level: AtcLevel;
  readonly role: string;
  /** The code up to this level; null when the source's code stops before it. */
  readonly code: string | null;
  readonly name: string | null;
  readonly nameSource: AtcNameSource | null;
}

function sentenceCase(value: string): string {
  const text = value.trim();
  if (!text) return text;
  return text.charAt(0).toLocaleUpperCase('ru-RU') + text.slice(1);
}

/** The ЕСКЛП group text: a «;» chain on some nodes, free text on the others. */
export function atcGroupChain(groupText: string | null | undefined): readonly string[] {
  return (groupText ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part !== '~');
}

/**
 * Names for levels 2-4 from the group chain. Only the unambiguous layout is used: three entries on
 * a code that reaches level 4 are the names of levels 2, 3 and 4. Chains of any other length do not
 * say which level each entry belongs to, so they name nothing (they are still shown as the node's
 * group text).
 */
function chainNames(
  chain: readonly string[],
  codeLevel: AtcLevel,
): Readonly<Partial<Record<AtcLevel, string>>> {
  const [second, third, fourth, ...rest] = chain;
  if (!second || !third || !fourth || rest.length > 0 || codeLevel < 4) return {};
  return { 2: sentenceCase(second), 3: sentenceCase(third), 4: sentenceCase(fourth) };
}

/** The NSI «АТХ» names of levels 1-4, keyed by code prefix (`N`, `N06`, `N06B`, `N06BX`). */
export interface AtcNameCatalog {
  readonly source: string;
  readonly version: string;
  /** ISO date the NSI published this version. */
  readonly publishDate: string;
  readonly names: Readonly<Record<string, string>>;
}

/** «2025-07-15» → «15.07.2025»; anything else is returned as written. */
function displayDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  return match ? `${match[3] ?? ''}.${match[2] ?? ''}.${match[1] ?? ''}` : value;
}

/** The source line shown under the ladder: «НСИ Минздрава, справочник АТХ, версия 3.8 от 15.07.2025». */
export function atcCatalogCitation(catalog: AtcNameCatalog): string {
  return `${catalog.source}, версия ${catalog.version} от ${displayDate(catalog.publishDate)}`;
}

export interface AtcLadderInput {
  readonly code: NormalizedAtcCode;
  /** The NSI names; without them (not loaded yet, or failed) only the older sources name levels. */
  readonly catalog?: AtcNameCatalog | null | undefined;
  /** The node's «pharmacotherapeutic group» text from ЕСКЛП. */
  readonly groupText?: string | null | undefined;
  /** The node's standardised substance name, already formatted for display. */
  readonly substanceName?: string | null | undefined;
}

/** All five levels for a code, with the names that are known and the ones that are not. */
export function atcLadder(input: AtcLadderInput): readonly AtcLadderStep[] {
  const prefixes = atcPrefixes(input.code.code);
  const names = chainNames(atcGroupChain(input.groupText), input.code.level);
  return ([1, 2, 3, 4, 5] as const).map((level): AtcLadderStep => {
    const code = prefixes.find((prefix) => prefix.level === level)?.code ?? null;
    const role = ATC_LEVEL_ROLES[level];
    if (code === null) return { level, role, code, name: null, nameSource: null };
    const catalogName = level < 5 ? input.catalog?.names[code]?.trim() : undefined;
    if (catalogName) return { level, role, code, name: catalogName, nameSource: 'nsi-atc' };
    if (level === 1) {
      const name = ATC_ANATOMICAL_GROUPS[code] ?? null;
      return { level, role, code, name, nameSource: name ? 'minimed-taxonomy' : null };
    }
    if (level === 5) {
      const name = input.substanceName?.trim() || null;
      return { level, role, code, name, nameSource: name ? 'esklp-substance' : null };
    }
    const name = names[level] ?? null;
    return { level, role, code, name, nameSource: name ? 'esklp-group-text' : null };
  });
}

export function atcNameSourceLabel(source: AtcNameSource): string {
  switch (source) {
    case 'nsi-atc':
      return 'НСИ АТХ';
    case 'minimed-taxonomy':
      return 'раздел MiniMed';
    case 'esklp-group-text':
      return 'текст группы ЕСКЛП';
    case 'esklp-substance':
      return 'вещество по ЕСКЛП';
  }
}
