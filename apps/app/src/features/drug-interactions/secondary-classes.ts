/**
 * The secondary classes of the ЕСКЛП cards as a small file of their own (CLS2).
 *
 * A card's secondary classes (an additional class that one component brings, CLS1) are card element
 * 4 of the 2.1 MB interaction index. The drug screen wants one line from them («также: снотворное
 * (через фенобарбитал)»), and must not load that index for it, so `scripts/build-drug-interactions.ts`
 * writes the same facts to `data/secondary-classes.json` (a few kB, a lazy chunk): the cards that have
 * any, by slug, each with `[ATC group, component, label]`. A generated file, never edited by hand.
 */
import type { AssetCard } from './interaction-index';

export const SECONDARY_CLASSES_SCHEMA_VERSION = 1;

/** `[ATC group code, the component that brings the class, the class (singular)]`. */
export type SecondaryClassRow = readonly [code: string, via: string, label: string];

export interface SecondaryClassAsset {
  readonly schemaVersion: typeof SECONDARY_CLASSES_SCHEMA_VERSION;
  /** The НСИ «АТХ» edition the group codes belong to. */
  readonly atc: { readonly version: string; readonly publishDate: string };
  /** Card slug (the ЕСКЛП id without `esklp.mnn.`) → its secondary classes, sorted by code. */
  readonly cards: Readonly<Record<string, readonly SecondaryClassRow[]>>;
}

export interface SecondaryClass {
  readonly code: string;
  readonly via: string;
  readonly label: string;
}

export type SecondaryClassCatalog = ReadonlyMap<string, readonly SecondaryClass[]>;

/** The asset for the cards of the interaction index (the build calls this; the data test checks it). */
export function secondaryClassAsset(
  cards: readonly AssetCard[],
  atc: SecondaryClassAsset['atc'],
): SecondaryClassAsset {
  const byCard: [string, readonly SecondaryClassRow[]][] = [];
  for (const [slug, , , secondary] of cards) {
    if (secondary && secondary.length > 0) byCard.push([slug, secondary]);
  }
  byCard.sort(([left], [right]) => left.localeCompare(right));
  return {
    schemaVersion: SECONDARY_CLASSES_SCHEMA_VERSION,
    atc,
    cards: Object.fromEntries(byCard),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRow(value: unknown): value is SecondaryClassRow {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((item) => typeof item === 'string' && item !== '')
  );
}

/** Checks the file's shape at the package boundary; a malformed chunk is an error, not an empty list. */
export function parseSecondaryClassAsset(value: unknown): SecondaryClassCatalog {
  if (!isRecord(value) || value['schemaVersion'] !== SECONDARY_CLASSES_SCHEMA_VERSION) {
    throw new Error('Secondary classes: unknown schema version');
  }
  const cards = value['cards'];
  if (!isRecord(cards)) throw new Error('Secondary classes: cards are missing');
  const catalog = new Map<string, readonly SecondaryClass[]>();
  for (const [slug, rows] of Object.entries(cards)) {
    if (!Array.isArray(rows) || rows.length === 0 || !rows.every(isRow)) {
      throw new Error(`Secondary classes: card ${slug} has a malformed list`);
    }
    catalog.set(
      slug,
      (rows as readonly SecondaryClassRow[]).map(([code, via, label]) => ({ code, via, label })),
    );
  }
  return catalog;
}

/**
 * The line of the drug screen for a card that has secondary classes, or null: «также: снотворное
 * (через фенобарбитал)». Plain words only, no ATC codes; one clause per class, in the order of
 * the file, with the same class never said twice.
 */
export function secondaryClassLine(classes: readonly SecondaryClass[] | undefined): string | null {
  if (!classes || classes.length === 0) return null;
  const clauses: string[] = [];
  for (const entry of classes) {
    const clause = `${entry.label} (через ${entry.via})`;
    if (!clauses.includes(clause)) clauses.push(clause);
  }
  return `также: ${clauses.join('; ')}`;
}
