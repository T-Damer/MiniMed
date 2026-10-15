import type { MedicalCore } from '@localmed/contracts';
import { createMemo, createSignal, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { cardSlugOfDocumentId } from '@/features/drug-interactions/drug-candidates';
import { notesPrescriptionPath } from '@/features/notes/notes-routing';
import { CONTENT_CHANGED_EVENT } from '@/state/content-events';
import { createQuietResource } from '@/state/quiet-resource';
import type { DoseIndex } from './dose-index';
import { loadDoseIndex } from './dose-load';
import { PrescriptionItemCard } from './PrescriptionItemCard';
import { PrescriptionPatientFacts } from './PrescriptionPatientFacts';
import { createPrescriptionController } from './prescription-controller';
import { RecipeDialog } from './RecipeDialog';
import { recipeMissingText } from './recipe-missing';
import '@/styles/prescription.css';

/** The ЕСКЛП card of an open drug document: the card itself, or the card its instruction serves. */
export function cardSlugOfDrugDocument(index: DoseIndex, documentId: string): string | null {
  const direct = cardSlugOfDocumentId(documentId);
  if (direct !== null) return index.cardBySlug.has(direct) ? direct : null;
  const first = index.asset.documents[documentId]?.c[0];
  return first === undefined ? null : (index.asset.cards[first]?.s ?? null);
}

function RecipeSheet(props: {
  readonly open: boolean;
  readonly core: MedicalCore | undefined;
  readonly slug: string;
  readonly onClose: () => void;
  readonly onContentChanged: () => Promise<void>;
}): JSX.Element {
  const controller = createPrescriptionController({
    core: () => props.core,
    patientId: () => undefined,
    snapshot: () => undefined,
    seed: { cards: [props.slug] },
    persist: false,
  });
  const item = () => controller.draft().items[0];
  const analysis = () => controller.analyses()[0];
  const document = createMemo(() => {
    const id = analysis()?.documentId;
    const read = id ? controller.documents().get(id) : undefined;
    return read && read !== 'loading' && read !== 'missing' ? read : undefined;
  });
  return (
    <RecipeDialog
      open={props.open}
      text={controller.recipe()}
      onClose={props.onClose}
      empty={recipeMissingText(controller.analyses())}
    >
      <PrescriptionPatientFacts
        patient={controller.draft().patient}
        card={controller.card()}
        needsHeight={analysis()?.plan?.status === 'needs-bsa'}
        onChange={controller.updatePatient}
      />
      <Show when={item() && analysis()}>
        <PrescriptionItemCard
          item={item() as NonNullable<ReturnType<typeof item>>}
          analysis={analysis() as NonNullable<ReturnType<typeof analysis>>}
          facts={controller.facts()}
          document={document()}
          onChange={(patch) => controller.updateItem((item() as { id: string }).id, patch)}
          onRemove={undefined}
          onContentChanged={props.onContentChanged}
        />
      </Show>
      <a class="prescription__link" href={notesPrescriptionPath({ cards: [props.slug] })}>
        Добавить другие препараты и напечатать бланк
      </a>
    </RecipeDialog>
  );
}

/**
 * The recipe icon of the drug screen: opens «Рецепт» for this drug. Age and weight are asked in the
 * sheet, the dose sentence of the instruction that fits is quoted, and the text of the recipe is
 * ready to copy, share or print. The drug's own instruction is not read until the sheet opens.
 */
export function DrugRecipeButton(props: {
  readonly core: MedicalCore | undefined;
  readonly documentId: string;
  readonly onContentChanged?: (() => Promise<void>) | undefined;
}): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const [opened, setOpened] = createSignal(false);
  const onContentChanged =
    props.onContentChanged ??
    (async () => {
      window.dispatchEvent(new Event(CONTENT_CHANGED_EVENT));
    });
  const index = createQuietResource(
    () => (opened() ? true : undefined),
    () => loadDoseIndex(),
  );
  const slug = createMemo(() => {
    const loaded = index.value();
    return loaded ? cardSlugOfDrugDocument(loaded, props.documentId) : undefined;
  });
  return (
    <>
      <button
        type="button"
        class="drug-recipe__button"
        aria-label="Рецепт"
        title="Рецепт"
        data-testid="drug-recipe-button"
        onClick={() => {
          setOpened(true);
          setOpen(true);
        }}
      >
        <AppGlyph name="prescription" class="drug-recipe__icon" />
      </button>
      <Show
        when={slug()}
        fallback={
          <RecipeDialog
            open={open()}
            text=""
            onClose={() => setOpen(false)}
            empty={
              index.value() === undefined
                ? 'Загружаем указатель доз…'
                : 'Для этого препарата в указателе доз нет карточки: назначение по нему не рассчитывается.'
            }
          />
        }
      >
        {(found) => (
          <RecipeSheet
            open={open()}
            core={props.core}
            slug={found()}
            onClose={() => setOpen(false)}
            onContentChanged={onContentChanged}
          />
        )}
      </Show>
    </>
  );
}
