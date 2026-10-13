/**
 * The dose-rule index (RX1) at run time: lookups over the asset `scripts/build-dose-rules.ts`
 * writes. Like the safety and interaction indexes it holds NO instruction text, only the rules read
 * from it, the offsets of their sentences and a checksum of each section. Nobody edits it by hand.
 */
import {
  type DoseRuleCard,
  type DoseRuleDocument,
  type DoseRuleIndexAsset,
  parseDoseRuleIndex,
} from '@localmed/contracts';

import {
  INSTRUCTION_KINDS,
  SECTION_ID_PREFIX,
} from '@/features/drug-interactions/interaction-index';

export { parseDoseRuleIndex, SECTION_ID_PREFIX };

/** Instructions kept per МНН card: the best one of each of the most common dosage forms. */
export const DOSE_DOCUMENTS_PER_CARD = 6;

/** The first word of a dosage form («таблетки, покрытые оболочкой» → «таблетки»): its class. */
export function formClassOf(form: string | null | undefined): string {
  return form?.toLocaleLowerCase('ru-RU').match(/[а-яёa-z]+/u)?.[0] ?? '';
}

export interface DoseIndex {
  readonly asset: DoseRuleIndexAsset;
  readonly cardBySlug: ReadonlyMap<string, number>;
  /** Card index → its instructions, best first. */
  readonly documentsOfCard: ReadonlyMap<number, readonly string[]>;
}

export function documentKindName(document: DoseRuleDocument): string {
  return INSTRUCTION_KINDS[document.k] ?? 'unknown';
}

/** Which instruction of a card to read first: more dose rules, a ГРЛС file, a professional text. */
export function compareDoseDocuments(
  left: { readonly id: string; readonly document: DoseRuleDocument },
  right: { readonly id: string; readonly document: DoseRuleDocument },
): number {
  const count = (document: DoseRuleDocument): number =>
    Math.min(12, document.rules.filter((rule) => rule.k === 0).length);
  return (
    count(right.document) - count(left.document) ||
    left.document.s - right.document.s ||
    left.document.k - right.document.k ||
    left.id.localeCompare(right.id)
  );
}

export function createDoseIndex(asset: DoseRuleIndexAsset): DoseIndex {
  const cardBySlug = new Map<string, number>();
  asset.cards.forEach((card, index) => {
    cardBySlug.set(card.s, index);
  });
  const documentsOfCard = new Map<number, string[]>();
  for (const [id, document] of Object.entries(asset.documents)) {
    for (const card of document.c) {
      const list = documentsOfCard.get(card);
      if (list) list.push(id);
      else documentsOfCard.set(card, [id]);
    }
  }
  for (const list of documentsOfCard.values()) {
    list.sort((left, right) => {
      const a = asset.documents[left];
      const b = asset.documents[right];
      if (!a || !b) return left.localeCompare(right);
      return compareDoseDocuments({ id: left, document: a }, { id: right, document: b });
    });
  }
  return { asset, cardBySlug, documentsOfCard };
}

export function cardOf(index: DoseIndex, slug: string): DoseRuleCard | undefined {
  const at = index.cardBySlug.get(slug);
  return at === undefined ? undefined : index.asset.cards[at];
}

/** The instructions of a card, best first, those of the wanted dosage form class before the rest. */
export function documentsForForm(
  index: DoseIndex,
  cardIndex: number,
  formWording: string | null,
): readonly string[] {
  const all = index.documentsOfCard.get(cardIndex) ?? [];
  const wanted = formClassOf(formWording);
  if (wanted === '') return all;
  const same = all.filter((id) => formClassOf(index.asset.documents[id]?.f) === wanted);
  return [...same, ...all.filter((id) => !same.includes(id))];
}
