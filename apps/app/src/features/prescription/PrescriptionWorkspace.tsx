import type { MedicalCore, MedicalDocument } from '@localmed/contracts';
import { createMemo, createSignal, For, type JSX, onCleanup, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { NavBack } from '@/components/NavBack';
import { Page } from '@/components/Page';
import { PatientPickerRow } from '@/components/PatientPickerRow';
import { PatientVaultUnlock } from '@/components/PatientVaultUnlock';
import { Heading } from '@/components/Text';
import { InteractionPairsPanel } from '@/features/drug-interactions/InteractionPairs';
import type { DrugItem } from '@/features/drug-interactions/interaction-check';
import { loadInteractionIndex } from '@/features/drug-interactions/interaction-load';
import { formDraftStateText } from '@/features/forms/form-draft-state';
import { findFormSchema } from '@/features/forms/form-registry';
import { registrationReference } from '@/features/forms/form-source-line';
import { defaultEpisode } from '@/features/forms/form-view-model';
import { usePatientVaultSnapshot } from '@/features/forms/use-patient-vault-snapshot';
import { notesFormsPath, notesPatientsPath } from '@/features/notes/notes-routing';
import {
  type ClinicianProfile,
  getClinicianProfile,
  subscribeClinicianProfile,
} from '@/state/clinician-profile';
import { CONTENT_CHANGED_EVENT } from '@/state/content-events';
import { createQuietResource } from '@/state/quiet-resource';
import { PrescriptionBlankChoice, PrescriptionBlankThumbnail } from './PrescriptionBlank';
import { PrescriptionDrugSlot } from './PrescriptionDrugSlot';
import { PrescriptionItemCard } from './PrescriptionItemCard';
import { PrescriptionPatientFacts } from './PrescriptionPatientFacts';
import { createPrescriptionController, type PrescriptionSeed } from './prescription-controller';
import { FORM_107_ID, FORM_148_ID, isSingleNameAtc, splitIntoBlanks } from './prescription-output';
import { RecipeDialog } from './RecipeDialog';
import { recipeMissingText } from './recipe-missing';
import '@/styles/prescription.css';

export interface PrescriptionWorkspaceProps {
  readonly core: MedicalCore | undefined;
  readonly seed?: PrescriptionSeed | undefined;
  readonly initialPatientId?: string | undefined;
  readonly onBack: () => void;
  readonly onNavigate: (path: string) => void;
  readonly onContentChanged?: (() => Promise<void>) | undefined;
}

/**
 * «Назначение»: a prescription built from the official instruction. Patient (prefilled from the
 * card), drug, dosage form and strength from the registry, the dose sentence that fits — quoted —
 * the computed intake, the course, the quantity; more drugs on the same prescription, the
 * interactions between them, and the official blank 107-1/у or 148-1/у-88 to print.
 */
export function PrescriptionWorkspace(props: PrescriptionWorkspaceProps): JSX.Element {
  const onContentChanged =
    props.onContentChanged ??
    (async () => {
      window.dispatchEvent(new Event(CONTENT_CHANGED_EVENT));
    });
  const vault = usePatientVaultSnapshot();
  const [patientId, setPatientId] = createSignal<string | undefined>(props.initialPatientId);
  const [clinician, setClinician] = createSignal<ClinicianProfile>(getClinicianProfile());
  onCleanup(subscribeClinicianProfile(() => setClinician(getClinicianProfile())));
  const [recipeOpen, setRecipeOpen] = createSignal(false);
  const [page, setPage] = createSignal(0);
  const [focusSlot, setFocusSlot] = createSignal(false);

  const controller = createPrescriptionController({
    core: () => props.core,
    patientId,
    snapshot: vault.snapshot,
    seed: props.seed,
  });

  const profile = createMemo(() => {
    const id = patientId();
    return id ? vault.snapshot()?.profiles.find((item) => item.id === id) : undefined;
  });
  const episode = createMemo(() => {
    const snapshot = vault.snapshot();
    const id = patientId();
    return snapshot && id ? defaultEpisode(snapshot, id) : undefined;
  });
  const needsHeight = createMemo(() =>
    controller.analyses().some((analysis) => analysis.plan?.status === 'needs-bsa'),
  );
  const blanksNeeded = createMemo(
    () => splitIntoBlanks(controller.lines(), controller.draft().formId).length,
  );
  const singleNameNote = createMemo(
    () =>
      controller.draft().formId === FORM_107_ID &&
      controller.lines().some((line) => isSingleNameAtc(line.atcCodes)),
  );

  // Interactions between the drugs: the INT1 index is loaded only once there are two of them.
  const interactionIndex = createQuietResource(
    () => (controller.draft().items.length >= 2 ? true : undefined),
    () => loadInteractionIndex(),
  );
  const interactionItems = createMemo<readonly DrugItem[]>(() => {
    const loaded = interactionIndex.value();
    if (!loaded) return [];
    return controller.draft().items.flatMap((item): DrugItem[] => {
      const card = loaded.cardBySlug.get(item.slug);
      return card === undefined ? [] : [{ id: item.slug, kind: 'drug', card, label: item.label }];
    });
  });

  const schema = () => findFormSchema(controller.draft().formId);
  const documentOf = (id: string | null): MedicalDocument | undefined => {
    const read = id ? controller.documents().get(id) : undefined;
    return read && read !== 'loading' && read !== 'missing' ? read : undefined;
  };
  const stateText = (): string =>
    formDraftStateText({
      status: controller.status(),
      savedAt: controller.draft().savedAt,
      error: controller.error() || undefined,
    });

  return (
    <section class="prescription" aria-label="Назначение" data-testid="prescription">
      <Page
        navigation={
          <NavBack
            class="prescription__back knowledge-back-button"
            aria-label="Назад"
            onClick={props.onBack}
          />
        }
        title={<Heading depth={1}>Назначение</Heading>}
        actions={
          <>
            <Button
              type="button"
              variant="icon"
              class="prescription__recipe-button"
              aria-label="Рецепт"
              title="Рецепт"
              data-testid="prescription-recipe-button"
              icon={<AppGlyph name="prescription" />}
              onClick={() => setRecipeOpen(true)}
            />
            <PrescriptionBlankThumbnail
              formId={controller.draft().formId}
              lines={controller.lines()}
              ageDays={controller.facts().ageDays ?? null}
              profile={profile()}
              episode={episode()}
              clinician={clinician()}
              page={page()}
            />
          </>
        }
        helpTitle="О назначении"
        help={
          <>
            <p>
              Дозы читаются из официальной инструкции препарата: рядом с каждым числом —
              предложение, из которого оно взято. Расчёт — арифметика над этими числами, а не
              рекомендация.
            </p>
            <p>
              Если в инструкции нет дозы для пациента, приложение так и скажет и покажет раздел
              целиком. Предел и состояния пациента показаны цитатами, без вывода «можно» или
              «нельзя».
            </p>
            <p>
              Возраст, масса и состояние подставляются из карточки пациента; введённое вручную
              важнее. Черновик сохраняется сам, «Сохранить» утверждает назначение и записывает его в
              карточку.
            </p>
          </>
        }
      />

      <div class="prescription__patient">
        <PatientPickerRow
          profiles={vault.snapshot()?.profiles ?? []}
          patientId={patientId() ?? ''}
          unlocked={vault.unlocked()}
          onPatientChange={(next) => setPatientId(next || undefined)}
          onSnapshotChange={vault.adopt}
        />
      </div>
      <Show when={patientId() && !vault.unlocked()}>
        <PatientVaultUnlock
          onUnlocked={vault.adopt}
          dialog={{ title: 'Пациенты', onClose: () => setPatientId(undefined) }}
        />
      </Show>

      <PrescriptionPatientFacts
        patient={controller.draft().patient}
        card={controller.card()}
        needsHeight={needsHeight()}
        onChange={controller.updatePatient}
      />

      <Show when={controller.indexFailed()}>
        <p class="prescription__status" role="alert">
          Указатель доз не загрузился. Перезапустите приложение.
        </p>
      </Show>

      <For each={controller.draft().items}>
        {(item, position) => (
          // The analysis exists once the dose index is loaded; the card waits for it.
          <Show when={controller.analyses()[position()]}>
            {(analysis) => (
              <PrescriptionItemCard
                item={item}
                analysis={analysis()}
                facts={controller.facts()}
                document={documentOf(analysis().documentId)}
                onChange={(patch) => controller.updateItem(item.id, patch)}
                onRemove={() => controller.removeItem(item.id)}
                onContentChanged={onContentChanged}
              />
            )}
          </Show>
        )}
      </For>

      <PrescriptionDrugSlot
        core={props.core}
        index={controller.index()}
        placeholder={controller.draft().items.length === 0 ? 'Препарат' : 'Добавить препарат'}
        taken={(slug) => controller.draft().items.some((item) => item.slug === slug)}
        focusOnMount={focusSlot()}
        onPick={(candidate) => {
          setFocusSlot(true);
          controller.addCandidate(candidate);
        }}
        onContentChanged={onContentChanged}
      />

      <Show when={interactionItems().length >= 2}>
        <div class="prescription__interactions" data-testid="prescription-interactions">
          <InteractionPairsPanel
            core={props.core}
            items={interactionItems()}
            actions={false}
            onContentChanged={onContentChanged}
          />
        </div>
      </Show>

      <Show when={controller.lines().length > 0}>
        <section class="prescription__blank" aria-label="Бланк">
          <PrescriptionBlankChoice
            formId={controller.draft().formId}
            onChange={(formId) => {
              setPage(0);
              controller.setFormId(formId);
            }}
          />
          <Show when={singleNameNote()}>
            <p class="prescription__note">
              На бланке 107-1/у по препарату этой группы АТХ указывается одно наименование.
            </p>
          </Show>
          <Show when={blanksNeeded() > 1}>
            <fieldset class="prescription__pages" aria-label="Бланки">
              <For each={Array.from({ length: blanksNeeded() }, (_, index) => index)}>
                {(index) => (
                  <Button
                    type="button"
                    variant={page() === index ? 'primary' : 'secondary'}
                    aria-pressed={page() === index}
                    onClick={() => setPage(index)}
                  >
                    {`Бланк ${index + 1}`}
                  </Button>
                )}
              </For>
            </fieldset>
          </Show>
          <div class="prescription__actions">
            <Button
              type="button"
              variant="primary"
              class="prescription__save"
              data-testid="prescription-save"
              icon={<AppGlyph name="check" />}
              disabled={controller.status() === 'saved'}
              onClick={() => void controller.save()}
            >
              Сохранить
            </Button>
            <p class="prescription__state" role="status">
              {stateText()}
            </p>
          </div>
          <Show when={patientId() && controller.status() === 'saved'}>
            <a class="prescription__link" href={notesPatientsPath(patientId() as string)}>
              К карточке пациента
            </a>
          </Show>
          <Show when={schema()}>
            {(form) => (
              <p class="prescription__reference">
                Бланки 107-1/у и 148-1/у-88, {registrationReference(form().source)}.{' '}
                <a
                  class="prescription__link"
                  href={form().source.publicationUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Официальная публикация
                </a>{' '}
                <a
                  class="prescription__link"
                  href={notesFormsPath(
                    controller.draft().formId === FORM_148_ID ? FORM_148_ID : FORM_107_ID,
                    patientId() ? { patientId: patientId() as string } : {},
                  )}
                >
                  Открыть форму
                </a>
              </p>
            )}
          </Show>
        </section>
      </Show>

      <RecipeDialog
        open={recipeOpen()}
        text={controller.recipe()}
        onClose={() => setRecipeOpen(false)}
        empty={recipeMissingText(controller.analyses())}
      />
    </section>
  );
}
