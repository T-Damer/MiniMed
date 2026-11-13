import { describe, expect, it } from 'vitest';

import { loadDoseIndex } from './dose-load';
import { cardSlugOfDrugDocument } from './drug-on-screen';

// SRCHDRUG1 (owner 2026-11-13): «Рецепт» on кветиапин said «в указателе доз нет карточки». The
// substance card shows a representative instruction (КВЕТИАПИН-АЛИУМ), which the dose index does not
// keep, and the sheet asked only for that instruction's id. The opened card comes first now.
describe('cardSlugOfDrugDocument', () => {
  it('finds the card the screen was opened on before the instruction it shows', async () => {
    const index = await loadDoseIndex();
    expect(
      cardSlugOfDrugDocument(index, {
        documentIds: ['esklp.mnn.кветиапин', 'drug.rf.not-in-the-dose-index.instruction'],
        names: [],
      }),
    ).toBe('кветиапин');
  });

  it('reads a core pointer of a card whose group is not installed', async () => {
    const index = await loadDoseIndex();
    expect(
      cardSlugOfDrugDocument(index, {
        documentIds: ['core.catalog.pointer.medication.esklp.mnn.кветиапин-4a6836f336013c7e'],
        names: [],
      }),
    ).toBe('кветиапин');
  });

  it('serves an indexed instruction by its card', async () => {
    const index = await loadDoseIndex();
    const [id, document] = Object.entries(index.asset.documents)[0] ?? [];
    const card = index.asset.cards[document?.c[0] ?? -1];
    expect(card).toBeDefined();
    expect(cardSlugOfDrugDocument(index, { documentIds: [undefined, id], names: [] })).toBe(
      card?.s,
    );
  });

  it('falls back to the substance name, then to a trade name of one card only', async () => {
    const index = await loadDoseIndex();
    const unknown = ['drug.allmed.unknown'];
    expect(cardSlugOfDrugDocument(index, { documentIds: unknown, names: ['Кветиапин'] })).toBe(
      'кветиапин',
    );
    expect(
      cardSlugOfDrugDocument(index, { documentIds: unknown, names: [null, 'Сероквель Пролонг'] }),
    ).toBe('кветиапин');
    expect(
      cardSlugOfDrugDocument(index, { documentIds: unknown, names: ['Не препарат вовсе'] }),
    ).toBeNull();
  });

  it('resolves every card of the index from its own id and from its registry name', async () => {
    const index = await loadDoseIndex();
    let byName = 0;
    for (const card of index.asset.cards) {
      expect(
        cardSlugOfDrugDocument(index, { documentIds: [`esklp.mnn.${card.s}`], names: [] }),
      ).toBe(card.s);
      if (cardSlugOfDrugDocument(index, { documentIds: [], names: [card.n] }) === card.s) {
        byName += 1;
      }
    }
    // Registry names are unique once case and signs are set aside.
    expect(byName).toBe(index.asset.cards.length);
  });
});
