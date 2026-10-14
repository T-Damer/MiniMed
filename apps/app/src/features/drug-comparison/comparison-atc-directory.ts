/**
 * The drugs and their ATC codes, read from the drug-comparison index (ATC5). The index holds every
 * ЕСКЛП МНН card with its codes (the registry's, the completed ones and the agreed ones, ATC2/ATC3)
 * and ships with the app, so a code search works for drugs whose module is not installed and
 * offline. The main search core and the drug pickers both look codes up here.
 */
import type { DrugCodeDirectory } from '@localmed/core';
import type { AtcAgreedCode, AtcDirectoryEntry } from '@localmed/search-lexical';

import { normalizeAtcCode } from '@/features/medications/atc-code';
import { classOfSearchQuery } from '@/features/medications/drug-class-lookup';
import type { ComparisonIndexAsset } from './comparison-index';
import { loadComparisonIndex } from './comparison-load';

const CARD_PREFIX = 'esklp.mnn.';

function normalizedCodes(raw: readonly string[]): readonly string[] {
  const codes = new Set<string>();
  for (const code of raw) {
    const normalized = normalizeAtcCode(code);
    if (normalized) codes.add(normalized.code);
  }
  return [...codes].toSorted();
}

/** One directory entry per card; a card without a valid code has none. */
export function atcDirectoryEntries(asset: ComparisonIndexAsset): readonly AtcDirectoryEntry[] {
  return asset.cards.flatMap((card): AtcDirectoryEntry[] => {
    const codes = normalizedCodes([...card.a, ...(card.q ?? []).flat()]);
    if (codes.length === 0) return [];
    const agreed = (card.q ?? []).flatMap(([code, registry]): AtcAgreedCode[] => {
      const pair = {
        code: normalizeAtcCode(code)?.code,
        registry: normalizeAtcCode(registry)?.code,
      };
      return pair.code && pair.registry ? [{ code: pair.code, registry: pair.registry }] : [];
    });
    return [
      {
        id: `${CARD_PREFIX}${card.s}`,
        name: card.n,
        codes,
        weight: card.r,
        ...(agreed.length > 0 ? { agreed } : {}),
      },
    ];
  });
}

const entriesOfAsset = new WeakMap<ComparisonIndexAsset, readonly AtcDirectoryEntry[]>();

/** The directory of the shipped index; loads the index's chunk on the first lookup. */
export async function loadAtcDirectoryEntries(): Promise<readonly AtcDirectoryEntry[]> {
  const { asset } = await loadComparisonIndex();
  let entries = entriesOfAsset.get(asset);
  if (!entries) {
    entries = atcDirectoryEntries(asset);
    entriesOfAsset.set(asset, entries);
  }
  return entries;
}

const HOMEOPATHIC_GROUP = 'гомеопат';
const homeopathicOfAsset = new WeakMap<ComparisonIndexAsset, ReadonlySet<string>>();

/** Card ids of the homeopathic preparations: the registry's pharmacotherapeutic group says so. */
export function homeopathicCardIds(asset: ComparisonIndexAsset): ReadonlySet<string> {
  return new Set(
    asset.cards
      .filter((card) =>
        card.g.some((group) => group.toLocaleLowerCase('ru-RU').includes(HOMEOPATHIC_GROUP)),
      )
      .map((card) => `${CARD_PREFIX}${card.s}`),
  );
}

/** What `createMedicalCore({ drugCodes })` takes. */
export const comparisonDrugCodes: DrugCodeDirectory = {
  entries: loadAtcDirectoryEntries,
  classOf: classOfSearchQuery,
  async homeopathicIds() {
    const { asset } = await loadComparisonIndex();
    let ids = homeopathicOfAsset.get(asset);
    if (!ids) {
      ids = homeopathicCardIds(asset);
      homeopathicOfAsset.set(asset, ids);
    }
    return ids;
  },
};
