import type { MedicalCore } from '@localmed/contracts';
import { createEffect, createMemo, createSignal, type JSX, Show } from 'solid-js';

import { notesPrescriptionPath } from '@/features/notes/notes-routing';
import { CONTENT_CHANGED_EVENT } from '@/state/content-events';
import { createQuietResource } from '@/state/quiet-resource';
import { loadDoseIndex } from './dose-load';
import { cardSlugOfDrugDocument, type DrugOnScreen } from './drug-on-screen';
import { PrescriptionItemCard } from './PrescriptionItemCard';
import { PrescriptionPatientFacts } from './PrescriptionPatientFacts';
import { createPrescriptionController } from './prescription-controller';
import { RecipeDialog } from './RecipeDialog';
import { recipeMissingText } from './recipe-missing';
import '@/styles/prescription.css';

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
        onTyped={controller.rememberPatient}
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
 * «Рецепт» for the drug on screen, opened from the drug card's «⋯» menu: age and weight are asked
 * in the sheet, the dose sentence of the instruction that fits is quoted, and the text of the recipe
 * is ready to copy, share or print. The dose index and the drug's own instruction are not read until
 * the sheet first opens.
 */
export function DrugRecipeSheet(props: {
  readonly core: MedicalCore | undefined;
  readonly drug: DrugOnScreen;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onContentChanged?: (() => Promise<void>) | undefined;
}): JSX.Element {
  const [opened, setOpened] = createSignal(false);
  createEffect(() => {
    if (props.open) setOpened(true);
  });
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
    return loaded ? cardSlugOfDrugDocument(loaded, props.drug) : undefined;
  });
  return (
    <Show
      when={slug()}
      fallback={
        <RecipeDialog
          open={props.open}
          text=""
          onClose={props.onClose}
          empty={
            index.value() === undefined ? (
              'Загружаем указатель доз…'
            ) : (
              // No ЕСКЛП card names this drug: the prescription tool still takes it by hand.
              <a class="prescription__link" href={notesPrescriptionPath({ cards: [] })}>
                Выписать в «Назначении»
              </a>
            )
          }
        />
      }
    >
      {(found) => (
        <RecipeSheet
          open={props.open}
          core={props.core}
          slug={found()}
          onClose={props.onClose}
          onContentChanged={onContentChanged}
        />
      )}
    </Show>
  );
}
