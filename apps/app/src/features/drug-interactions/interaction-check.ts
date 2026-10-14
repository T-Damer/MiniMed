/**
 * What the index says about drugs taken together (INT1). Pure: it reads the index and returns
 * references to sentences; the text of a sentence is read from the installed instruction.
 */
import {
  type DrugTargets,
  drugTargets,
  type IndexedSentence,
  type InteractionIndex,
  sentencesNaming,
} from './interaction-index';
import { ALCOHOL_SUBSTANCE_KEY } from './substance-names';

/** One drug (or alcohol) in the tool. */
export interface DrugItem {
  /** Stable within the tool: the card slug, or `alcohol`. */
  readonly id: string;
  readonly kind: 'drug' | 'alcohol';
  /** Index into the asset's `cards`; null for alcohol. */
  readonly card: number | null;
  readonly label: string;
  /** The word the doctor typed, when it differs from the label. */
  readonly typed?: string | undefined;
}

export const ALCOHOL_ITEM_ID = 'alcohol';

function alcoholTarget(index: InteractionIndex): number | null {
  const position = index.asset.targets.indexOf(`s:${ALCOHOL_SUBSTANCE_KEY}`);
  return position < 0 ? null : position;
}

/** The targets of the index that name this item, split by how it belongs to them (CLS1). */
export function itemTargetSplit(index: InteractionIndex, item: DrugItem): DrugTargets {
  if (item.kind === 'alcohol') {
    const target = alcoholTarget(index);
    return { primary: new Set(target === null ? [] : [target]), secondary: new Map() };
  }
  return item.card === null
    ? { primary: new Set(), secondary: new Map() }
    : drugTargets(index, item.card);
}

/**
 * The targets of the index that name this item: its substances, the classes it belongs to and the
 * additional classes a component brings.
 */
export function itemTargets(index: InteractionIndex, item: DrugItem): ReadonlySet<number> {
  const { primary, secondary } = itemTargetSplit(index, item);
  return new Set([...primary, ...secondary.keys()]);
}

/** The instruction the tool reads for an item: the best indexed one of its card; alcohol has none. */
export function itemDocumentId(index: InteractionIndex, item: DrugItem): string | null {
  if (item.kind === 'alcohol' || item.card === null) return null;
  return index.documentsOfCard.get(item.card)?.[0] ?? null;
}

export interface SideCheck {
  /** The item whose instruction is read. */
  readonly from: DrugItem;
  /** The item looked for in it. */
  readonly to: DrugItem;
  /** Null when no instruction of `from` is indexed (or it is alcohol). */
  readonly documentId: string | null;
  readonly sentences: readonly IndexedSentence[];
}

export interface PairCheck {
  readonly a: DrugItem;
  readonly b: DrugItem;
  readonly aReadsB: SideCheck;
  readonly bReadsA: SideCheck;
  /** Sentences found in either direction. */
  readonly found: number;
}

function side(index: InteractionIndex, from: DrugItem, to: DrugItem): SideCheck {
  const documentId = itemDocumentId(index, from);
  const { primary, secondary } = itemTargetSplit(index, to);
  const sentences = documentId
    ? sentencesNaming(index, documentId, new Set([...primary, ...secondary.keys()]), secondary)
    : [];
  return { from, to, documentId, sentences };
}

export function checkPair(index: InteractionIndex, a: DrugItem, b: DrugItem): PairCheck {
  const aReadsB = side(index, a, b);
  const bReadsA = side(index, b, a);
  return { a, b, aReadsB, bReadsA, found: aReadsB.sentences.length + bReadsA.sentences.length };
}

/** Every unordered pair of the items, in the order the doctor added them. */
export function checkAllPairs(
  index: InteractionIndex,
  items: readonly DrugItem[],
): readonly PairCheck[] {
  const pairs: PairCheck[] = [];
  for (let first = 0; first < items.length; first += 1) {
    for (let second = first + 1; second < items.length; second += 1) {
      const a = items[first];
      const b = items[second];
      if (a && b) pairs.push(checkPair(index, a, b));
    }
  }
  return pairs;
}
