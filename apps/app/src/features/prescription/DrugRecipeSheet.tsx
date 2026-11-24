import type { MedicalCore, MedicalDocument } from '@localmed/contracts';
import { createEffect, createMemo, createSignal, For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { notesPrescriptionPath } from '@/features/notes/notes-routing';
import { CONTENT_CHANGED_EVENT } from '@/state/content-events';
import { createQuietResource } from '@/state/quiet-resource';
import { extractAllmedRecipes } from './allmed-recipes';
import { loadDoseIndex } from './dose-load';
import { cardSlugOfDrugDocument, type DrugOnScreen } from './drug-on-screen';
import { PrescriptionItemCard } from './PrescriptionItemCard';
import { PrescriptionPatientFacts } from './PrescriptionPatientFacts';
import { createPrescriptionController } from './prescription-controller';
import { RecipeDialog } from './RecipeDialog';
import { recipeMissingText } from './recipe-missing';
import '@/styles/prescription.css';

function RecipeEditorSheet(props: {
  readonly open: boolean;
  readonly core: MedicalCore | undefined;
  readonly slug: string;
  readonly hasAllmed: boolean;
  readonly onBackToAllmed: () => void;
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
      <Show when={props.hasAllmed}>
        <div class="recipe-allmed__bar">
          <Button
            type="button"
            variant="quiet"
            class="recipe-allmed__toggle"
            icon={<AppGlyph name="arrow-left" />}
            onClick={props.onBackToAllmed}
          >
            Примеры из Allmed
          </Button>
        </div>
      </Show>
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
 * «Рецепт» for the drug on screen: shows existing Allmed recipe examples immediately when
 * available (with blank number and an «Изменить» button to open the interactive recipe generator),
 * or opens the generator directly when no Allmed recipe exists.
 */
export function DrugRecipeSheet(props: {
  readonly core: MedicalCore | undefined;
  readonly drug: DrugOnScreen;
  readonly allmedDocuments?: readonly (MedicalDocument | null | undefined)[];
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onContentChanged?: (() => Promise<void>) | undefined;
}): JSX.Element {
  const [opened, setOpened] = createSignal(false);
  const [editing, setEditing] = createSignal(false);
  const [selectedAllmedId, setSelectedAllmedId] = createSignal<string | null>(null);

  const allmed = createMemo(() => extractAllmedRecipes(props.allmedDocuments ?? []));
  const hasAllmed = (): boolean => allmed().recipes.length > 0;

  createEffect(() => {
    if (props.open) {
      setOpened(true);
      if (!hasAllmed()) setEditing(true);
    } else {
      setEditing(false);
    }
  });

  const selectedAllmed = createMemo(() => {
    const list = allmed().recipes;
    const id = selectedAllmedId();
    return (id ? list.find((item) => item.id === id) : undefined) ?? list[0];
  });

  const onContentChanged =
    props.onContentChanged ??
    (async () => {
      window.dispatchEvent(new Event(CONTENT_CHANGED_EVENT));
    });

  // Only load the dose index when the user enters the generator (or when Allmed has no recipes).
  const index = createQuietResource(
    () => (opened() && (editing() || !hasAllmed()) ? true : undefined),
    () => loadDoseIndex(),
  );
  const slug = createMemo(() => {
    const loaded = index.value();
    return loaded ? cardSlugOfDrugDocument(loaded, props.drug) : undefined;
  });

  return (
    <Show
      when={!editing() && hasAllmed()}
      fallback={
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
                  <a class="prescription__link" href={notesPrescriptionPath({ cards: [] })}>
                    Выписать в «Назначении»
                  </a>
                )
              }
            >
              <Show when={hasAllmed()}>
                <div class="recipe-allmed__bar">
                  <Button
                    type="button"
                    variant="quiet"
                    class="recipe-allmed__toggle"
                    icon={<AppGlyph name="arrow-left" />}
                    onClick={() => setEditing(false)}
                  >
                    Примеры из Allmed
                  </Button>
                </div>
              </Show>
            </RecipeDialog>
          }
        >
          {(found) => (
            <RecipeEditorSheet
              open={props.open}
              core={props.core}
              slug={found()}
              hasAllmed={hasAllmed()}
              onBackToAllmed={() => setEditing(false)}
              onClose={props.onClose}
              onContentChanged={onContentChanged}
            />
          )}
        </Show>
      }
    >
      <RecipeDialog
        open={props.open}
        text={selectedAllmed()?.text ?? ''}
        onClose={props.onClose}
        headerAction={
          <Button
            type="button"
            variant="icon"
            aria-label="Изменить и сгенерировать рецепт"
            title="Изменить / сгенерировать рецепт"
            icon={<AppGlyph name="edit" />}
            onClick={() => setEditing(true)}
          />
        }
      >
        <div class="recipe-allmed">
          <div class="recipe-allmed__bar">
            <div class="recipe-allmed__meta">
              <span class="recipe-allmed__source">Allmed</span>
              <For each={allmed().formNumbers}>
                {(formNumber) => <span class="recipe-allmed__form-chip">Бланк {formNumber}</span>}
              </For>
            </div>
            <Button
              type="button"
              variant="secondary"
              class="recipe-allmed__edit-button"
              icon={<AppGlyph name="edit" />}
              onClick={() => setEditing(true)}
            >
              Изменить
            </Button>
          </div>
          <Show when={allmed().recipes.length > 1}>
            <div class="recipe-allmed__variants" role="tablist" aria-label="Варианты рецепта">
              <For each={allmed().recipes}>
                {(item) => {
                  const active = () => selectedAllmed()?.id === item.id;
                  return (
                    <button
                      type="button"
                      role="tab"
                      aria-selected={active()}
                      class="recipe-allmed__variant"
                      classList={{ 'recipe-allmed__variant--active': active() }}
                      onClick={() => setSelectedAllmedId(item.id)}
                    >
                      {item.label}
                    </button>
                  );
                }}
              </For>
            </div>
          </Show>
          <Show when={allmed().dispensingNotes.length > 0}>
            <p class="recipe-allmed__notes">{allmed().dispensingNotes.join(' · ')}</p>
          </Show>
        </div>
      </RecipeDialog>
    </Show>
  );
}
