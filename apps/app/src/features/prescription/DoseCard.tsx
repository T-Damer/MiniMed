import type { MedicalCore } from '@localmed/contracts';
import { createMemo, createSignal, For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { notesPrescriptionPath } from '@/features/notes/notes-routing';
import { CONTENT_CHANGED_EVENT } from '@/state/content-events';
import { createQuietResource } from '@/state/quiet-resource';
import { findDoseCandidates } from './dose-candidates';
import { loadDoseIndex } from './dose-load';
import type { DoseQuery } from './dose-query';
import { PrescriptionItemCard } from './PrescriptionItemCard';
import { createPrescriptionController, type PrescriptionSeed } from './prescription-controller';
import { ageText } from './prescription-safety';
import { RecipeDialog } from './RecipeDialog';
import { recipeMissingText } from './recipe-missing';
import '@/styles/prescription.css';

export function seedOfQuery(slug: string, query: DoseQuery): PrescriptionSeed {
  return {
    cards: [slug],
    ...(query.ageDays === null ? {} : { ageDays: query.ageDays }),
    ...(query.group === null ? {} : { group: query.group }),
    ...(query.weightKg === null ? {} : { weightKg: query.weightKg }),
    ...(query.days === null ? {} : { days: query.days }),
    ...(query.pregnant ? { pregnant: true } : {}),
    ...(query.lactating ? { lactating: true } : {}),
    ...(query.form === null ? {} : { formWord: query.form }),
    ...(query.strengthMg === null ? {} : { strengthMg: query.strengthMg }),
  };
}

function queryChips(query: DoseQuery): readonly string[] {
  const chips: string[] = [];
  if (query.ageDays !== null) chips.push(ageText(query.ageDays));
  else if (query.group === 'child') chips.push('ребёнок');
  else if (query.group === 'adult') chips.push('взрослый');
  if (query.weightKg !== null) chips.push(`${String(query.weightKg).replace('.', ',')} кг`);
  if (query.days !== null) chips.push(`${query.days} дн.`);
  if (query.pregnant) chips.push('беременность');
  if (query.lactating) chips.push('ГВ');
  if (query.renal) chips.push('почечная недостаточность');
  if (query.hepatic) chips.push('печёночная недостаточность');
  return chips;
}

function DoseCardBody(props: {
  readonly core: MedicalCore | undefined;
  readonly query: DoseQuery;
  readonly slug: string;
  readonly onContentChanged: () => Promise<void>;
}): JSX.Element {
  const [recipeOpen, setRecipeOpen] = createSignal(false);
  const controller = createPrescriptionController({
    core: () => props.core,
    patientId: () => undefined,
    snapshot: () => undefined,
    seed: seedOfQuery(props.slug, props.query),
    persist: false,
  });
  const item = () => controller.draft().items[0];
  const analysis = () => controller.analyses()[0];
  const document = createMemo(() => {
    const id = analysis()?.documentId;
    const read = id ? controller.documents().get(id) : undefined;
    return read && read !== 'loading' && read !== 'missing' ? read : undefined;
  });
  const toolPath = (): string =>
    notesPrescriptionPath({
      cards: [props.slug],
      ...(props.query.ageDays === null ? {} : { ageDays: props.query.ageDays }),
      ...(props.query.group === null ? {} : { group: props.query.group }),
      ...(props.query.weightKg === null ? {} : { weightKg: props.query.weightKg }),
      ...(props.query.days === null ? {} : { days: props.query.days }),
    });
  return (
    <Show when={item() && analysis()}>
      <section class="prescription-card paper-card" data-testid="dose-card">
        <header class="prescription-card__header">
          <h3 class="prescription-card__title">Доза по инструкции</h3>
          <ul class="prescription-card__chips" aria-label="Данные из запроса">
            <For each={queryChips(props.query)}>
              {(chip) => <li class="prescription-card__chip">{chip}</li>}
            </For>
          </ul>
          <span class="prescription-card__tools">
            <Button
              type="button"
              variant="icon"
              aria-label="Рецепт"
              title="Рецепт"
              data-testid="dose-card-recipe"
              icon={<AppGlyph name="prescription" />}
              onClick={() => setRecipeOpen(true)}
            />
          </span>
        </header>
        <PrescriptionItemCard
          item={item() as NonNullable<ReturnType<typeof item>>}
          analysis={analysis() as NonNullable<ReturnType<typeof analysis>>}
          facts={controller.facts()}
          document={document()}
          expandRestricted={props.query.renal || props.query.hepatic}
          hideSafety={!(props.query.pregnant || props.query.lactating)}
          onChange={(patch) => controller.updateItem((item() as { id: string }).id, patch)}
          onRemove={undefined}
          onContentChanged={props.onContentChanged}
        />
        <a
          class="prescription__link prescription-card__open"
          href={toolPath()}
          data-testid="dose-card-open"
        >
          Оформить рецепт
        </a>
        <RecipeDialog
          open={recipeOpen()}
          text={controller.recipe()}
          onClose={() => setRecipeOpen(false)}
          empty={recipeMissingText(controller.analyses())}
        />
      </section>
    </Show>
  );
}

/**
 * The card above the results of a query that names a drug and a patient («амоксициллин ребёнок
 * 20 кг»): the dose sentences of the drug's official instruction that fit the patient, quoted, with
 * the computed intake. It reuses the item of the prescription tool, so the numbers are the same in
 * both places. It changes no ranking and never answers «можно»: with no fitting sentence it says so.
 */
export function DoseCard(props: {
  readonly core: MedicalCore | undefined;
  readonly query: DoseQuery;
  readonly onContentChanged?: (() => Promise<void>) | undefined;
}): JSX.Element {
  const onContentChanged =
    props.onContentChanged ??
    (async () => {
      window.dispatchEvent(new Event(CONTENT_CHANGED_EVENT));
    });
  const index = createQuietResource(loadDoseIndex);
  const candidate = createQuietResource(
    () => {
      const loaded = index.value();
      const core = props.core;
      return loaded && core ? { loaded, core, name: props.query.name } : undefined;
    },
    async (source) => {
      const found = await findDoseCandidates(source.core, source.loaded, source.name, {
        limit: 1,
        strict: true,
      });
      return found[0];
    },
  );
  return (
    <Show when={candidate.value()} keyed>
      {(found) => (
        <DoseCardBody
          core={props.core}
          query={props.query}
          slug={found.slug}
          onContentChanged={onContentChanged}
        />
      )}
    </Show>
  );
}
