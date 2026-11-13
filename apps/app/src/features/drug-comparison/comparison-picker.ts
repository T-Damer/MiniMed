/**
 * The drug picker of «Сравнение препаратов» (owner 2026-11-13: «Выбрать» was plain text): rows of
 * the app's list, each drug with its ATC group, the chosen ones marked. Before anything is typed it
 * offers the drugs of the chosen drug's ATC group (level 4, widened to level 3 when that group is
 * small), the comparison a doctor usually makes; typing searches every drug.
 */
import type { AtcNameCatalog } from '@/features/medications/atc-code';
import { normalizeAtcCode } from '@/features/medications/atc-code';
import { displayDrugName } from '@/features/medications/drug-screen';
import type { AssetCard, ComparisonIndex } from './comparison-index';

/** Fewer than this many other drugs in the level-4 group: the level-3 group is offered too. */
const SMALL_GROUP = 4;
/** Rows offered before typing. */
export const GROUP_SUGGESTIONS = 24;

export interface DrugGroup {
  /** ATC code of the group: level 4 («N05AH»), or level 3 when level 4 has no name. */
  readonly code: string;
  readonly name: string;
}

/** Full ATC codes of a card (registry and agreed), level 5 where known. */
function codesOf(card: AssetCard): readonly string[] {
  const codes: string[] = [];
  for (const raw of [...card.a, ...(card.q ?? []).map(([agreed]) => agreed)]) {
    const code = normalizeAtcCode(raw)?.code;
    if (code && !codes.includes(code)) codes.push(code);
  }
  return codes;
}

/** The named group of a code: its level 4, else its level 3. */
function groupOfCode(code: string, names: AtcNameCatalog | null): DrugGroup | null {
  for (const length of [5, 4]) {
    if (code.length < length) continue;
    const prefix = code.slice(0, length);
    const name = names?.names[prefix];
    if (name) return { code: prefix, name };
  }
  return null;
}

/** «Диазепины, оксазепины, тиазепины и оксепины»: the group line of a drug's row. */
export function drugGroupOf(card: AssetCard, names: AtcNameCatalog | null): DrugGroup | null {
  for (const code of codesOf(card)) {
    const group = groupOfCode(code, names);
    if (group) return group;
  }
  return null;
}

export interface GroupSuggestions {
  /** The group the list is titled with. */
  readonly group: DrugGroup;
  /** Card indexes: the narrow group first, then the wide one; most registrations first. */
  readonly cards: readonly number[];
}

/**
 * The drugs of the same ATC group as the drugs already chosen (the first chosen with a code):
 * level 4, and level 3 too when level 4 holds fewer than {@link SMALL_GROUP} others.
 */
export function sameGroupSuggestions(
  index: ComparisonIndex,
  chosenCards: readonly number[],
  names: AtcNameCatalog | null,
  limit = GROUP_SUGGESTIONS,
): GroupSuggestions | null {
  const cards = index.asset.cards;
  const code = chosenCards
    .map((at) => (cards[at] ? codesOf(cards[at]).find((entry) => entry.length >= 5) : undefined))
    .find((entry) => entry !== undefined);
  if (!code) return null;
  const level4 = code.slice(0, 5);
  const level3 = code.slice(0, 4);
  const inGroup = (prefix: string): number[] =>
    cards.flatMap((card, at) =>
      codesOf(card).some((entry) => entry.startsWith(prefix)) ? [at] : [],
    );
  const byRegistrations = (left: number, right: number): number =>
    (cards[right]?.r ?? 0) - (cards[left]?.r ?? 0) ||
    (cards[left]?.n ?? '').localeCompare(cards[right]?.n ?? '', 'ru');
  const narrow = inGroup(level4).toSorted(byRegistrations);
  const others = narrow.filter((at) => !chosenCards.includes(at)).length;
  const wide =
    others < SMALL_GROUP
      ? inGroup(level3)
          .filter((at) => !narrow.includes(at))
          .toSorted(byRegistrations)
      : [];
  const groupName = (prefix: string): string | undefined => names?.names[prefix];
  const titled =
    wide.length > 0 && groupName(level3)
      ? { code: level3, name: groupName(level3) as string }
      : groupName(level4)
        ? { code: level4, name: groupName(level4) as string }
        : null;
  if (!titled) return null;
  return { group: titled, cards: [...narrow, ...wide].slice(0, limit) };
}

/** The title of a card's row: the name as the doctor reads it. */
export function cardTitle(card: AssetCard): string {
  return displayDrugName(card.n);
}
