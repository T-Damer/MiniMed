import { cardSlugOfDocumentId } from '@/features/drug-picker/card-id';
import type { DoseIndex } from './dose-index';

/** «Кветиапин-Алиум» and «КВЕТИАПИН АЛИУМ» compare equal: case, «ё», signs and spaces aside. */
function nameKey(name: string): string {
  return name
    .toLocaleLowerCase('ru-RU')
    .replaceAll('ё', 'е')
    .replace(/[^a-zа-я0-9]+/gu, ' ')
    .trim();
}

const nameMaps = new WeakMap<
  DoseIndex,
  { substance: Map<string, string>; trade: Map<string, string> }
>();

/** Substance names → card, and the trade names that belong to one card only → that card. */
function namesOf(index: DoseIndex): { substance: Map<string, string>; trade: Map<string, string> } {
  const cached = nameMaps.get(index);
  if (cached) return cached;
  const substance = new Map<string, string>();
  const trade = new Map<string, string>();
  const shared = new Set<string>();
  for (const card of index.asset.cards) {
    substance.set(nameKey(card.n), card.s);
    for (const name of card.t) {
      const key = nameKey(name);
      const other = trade.get(key);
      if (other !== undefined && other !== card.s) shared.add(key);
      else trade.set(key, card.s);
    }
  }
  for (const key of shared) trade.delete(key);
  const maps = { substance, trade };
  nameMaps.set(index, maps);
  return maps;
}

/** What the drug screen knows about the drug on it: its documents, best first, and its names. */
export interface DrugOnScreen {
  /**
   * The documents of the screen: the ЕСКЛП card it was opened on (or its core pointer) and the
   * instruction it shows. A substance card shows a representative instruction, which may be one the
   * dose index does not keep (it keeps a few per card), so the card itself is asked first.
   */
  readonly documentIds: readonly (string | undefined)[];
  /** The substance and trade names on screen, for a document no index knows by id. */
  readonly names: readonly (string | null | undefined)[];
}

/**
 * The ЕСКЛП card of the drug on screen: the card a document id names, the card an indexed
 * instruction serves, else the card whose substance (or unique trade) name the screen shows.
 */
export function cardSlugOfDrugDocument(index: DoseIndex, drug: DrugOnScreen): string | null {
  for (const id of drug.documentIds) {
    if (!id) continue;
    const direct = cardSlugOfDocumentId(id);
    if (direct !== null && index.cardBySlug.has(direct)) return direct;
    const first = index.asset.documents[id]?.c[0];
    const slug = first === undefined ? undefined : index.asset.cards[first]?.s;
    if (slug !== undefined) return slug;
  }
  const { substance, trade } = namesOf(index);
  for (const name of drug.names) {
    const slug = name ? substance.get(nameKey(name)) : undefined;
    if (slug !== undefined) return slug;
  }
  for (const name of drug.names) {
    const slug = name ? trade.get(nameKey(name)) : undefined;
    if (slug !== undefined) return slug;
  }
  return null;
}
