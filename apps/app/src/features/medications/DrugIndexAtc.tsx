import { createResource, createSignal, For, type JSX, Show } from 'solid-js';

import { loadComparisonIndex } from '@/features/drug-comparison/comparison-load';
import { AtcCodeSheet, type AtcSheetFocus } from '@/features/medications/AtcCodeSheet';
import { DrugAtcChip } from '@/features/medications/DrugQuickLinks';
import { DrugSecondaryClasses } from '@/features/medications/DrugSecondaryClasses';
import { type DrugAtcCode, drugAtcCodesFromIndexCard } from '@/features/medications/drug-screen';

import '@/features/medications/drug-screen.css';

const MNN_ID_PREFIX = 'esklp.mnn.';
/** Only the first codes are named: a long line of codes with a name each would not stay compact. */
const NAMED_CODES = 2;

/** The slug of an ЕСКЛП МНН card id (`esklp.mnn.умифеновир` → `умифеновир`); null for any other id. */
export function esklpCardSlug(documentId: string): string | null {
  return documentId.startsWith(MNN_ID_PREFIX) ? documentId.slice(MNN_ID_PREFIX.length) : null;
}

async function indexCodes(slug: string): Promise<readonly DrugAtcCode[]> {
  const { asset, cardBySlug } = await loadComparisonIndex();
  const index = cardBySlug.get(slug);
  const card = index === undefined ? undefined : asset.cards[index];
  return card ? drugAtcCodesFromIndexCard(card) : [];
}

/**
 * The ATC code of a drug whose module is not installed yet. The drug-comparison index ships with
 * the app and holds the codes of every ЕСКЛП card, so the code shows (and explains itself) before
 * the 8.5 MB set is downloaded.
 */
export function DrugIndexAtc(props: { readonly slug: string }): JSX.Element {
  const [codes] = createResource(() => props.slug, indexCodes);
  const [atc, setAtc] = createSignal<DrugAtcCode | undefined>();
  const [focus, setFocus] = createSignal<AtcSheetFocus>('main');
  const [open, setOpen] = createSignal(false);
  const openSheet = (code: DrugAtcCode, which: AtcSheetFocus): void => {
    setAtc(code);
    setFocus(which);
    setOpen(true);
  };
  return (
    <Show when={(codes() ?? []).length > 0}>
      <nav class="drug-links" aria-label="Код АТХ" data-testid="drug-index-atc">
        <div class="drug-links__line">
          <ul class="drug-links__list">
            <For each={codes() ?? []}>
              {(code, position) => (
                <li class="drug-links__item">
                  <DrugAtcChip code={code} onOpen={openSheet} named={position() < NAMED_CODES} />
                </li>
              )}
            </For>
          </ul>
        </div>
        <DrugSecondaryClasses slug={props.slug} />
      </nav>
      <AtcCodeSheet code={atc()} focus={focus()} open={open()} onClose={() => setOpen(false)} />
    </Show>
  );
}
