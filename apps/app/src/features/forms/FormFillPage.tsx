import type { FormSchema } from '@localmed/contracts';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  onCleanup,
  Show,
  untrack,
} from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { createDebouncer } from '@/components/debounced-value';
import { NavBack } from '@/components/NavBack';
import { Page } from '@/components/Page';
import { PatientPickerRow } from '@/components/PatientPickerRow';
import { PatientVaultUnlock } from '@/components/PatientVaultUnlock';
import { SelectField } from '@/components/SelectField';
import { Heading } from '@/components/Text';
import { FormFieldControl } from '@/features/forms/FormFieldControl';
import { FormPreviewDialog } from '@/features/forms/FormPreviewDialog';
import { FormProgress } from '@/features/forms/FormProgress';
import { FormThumbnail } from '@/features/forms/FormThumbnail';
import { formDraftStateText } from '@/features/forms/form-draft-state';
import {
  type FormDraftTarget,
  loadFormDraft,
  storeFormDraft,
} from '@/features/forms/form-draft-store';
import {
  buildFormPrefillContext,
  localIsoDate,
  prefillFormValues,
} from '@/features/forms/form-prefill';
import { displayDate } from '@/features/forms/form-print';
import {
  type FormDraft,
  type FormDraftStatus,
  formSessionKey,
  readFormSession,
  writeFormSession,
} from '@/features/forms/form-session';
import {
  localToday,
  orderReference,
  registrationReference,
  validityLine,
} from '@/features/forms/form-source-line';
import { validateForm } from '@/features/forms/form-validation';
import { type FormValue, type FormValues, fillableFields } from '@/features/forms/form-values';
import { defaultEpisode, sectionFields } from '@/features/forms/form-view-model';
import { usePatientVaultSnapshot } from '@/features/forms/use-patient-vault-snapshot';
import { notesFormsPath, notesPatientsPath } from '@/features/notes/notes-routing';
import {
  type ClinicianProfile,
  getClinicianProfile,
  subscribeClinicianProfile,
} from '@/state/clinician-profile';
import { isPatientVaultUnlocked, PATIENT_VAULT_LOCK_EVENT } from '@/state/patient-vault';
import '@/styles/forms.css';

/** Typed values are written to the draft once typing has paused for this long. */
export const FORM_AUTOSAVE_DEBOUNCE_MS = 700;

export interface FormFillPageProps {
  readonly schema: FormSchema;
  readonly patientId?: string | undefined;
  readonly episodeId?: string | undefined;
  readonly onNavigate: (path: string) => void;
}

function sameValue(left: FormValue | undefined, right: FormValue | undefined): boolean {
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => item === right[index]);
  }
  return left === right;
}

/**
 * The filling screen of any schema-described form: prefilled values are marked, a short progress
 * line counts the required fields, each field shows the paragraph of the order that governs it
 * from a «?» in its label. Typing autosaves a draft; «Сохранить» approves the form. It renders
 * schema data only; nothing here knows a form number.
 */
export function FormFillPage(props: FormFillPageProps): JSX.Element {
  const vault = usePatientVaultSnapshot();
  const [clinician, setClinician] = createSignal<ClinicianProfile>(getClinicianProfile());
  const [previewOpen, setPreviewOpen] = createSignal(false);
  const [edits, setEdits] = createSignal<Readonly<Record<string, FormValue>>>({});
  const [status, setStatus] = createSignal<FormDraftStatus>('draft');
  const [savedAt, setSavedAt] = createSignal<string>();
  const [saveError, setSaveError] = createSignal('');
  // Missing fields are marked only after the person has tried to save: a fresh form is not red.
  const [attempted, setAttempted] = createSignal(false);
  const [ready, setReady] = createSignal(false);
  const stopClinician = subscribeClinicianProfile(() => setClinician(getClinicianProfile()));
  onCleanup(stopClinician);

  const profile = createMemo(() =>
    props.patientId
      ? vault.snapshot()?.profiles.find((item) => item.id === props.patientId)
      : undefined,
  );
  const patientEpisodes = createMemo(() => {
    const snapshot = vault.snapshot();
    if (!snapshot || !props.patientId) return [];
    return snapshot.episodes
      .filter((episode) => episode.patientId === props.patientId)
      .toSorted((left, right) => right.startedAt.localeCompare(left.startedAt));
  });
  const episode = createMemo(() => {
    const snapshot = vault.snapshot();
    if (!snapshot || !props.patientId) return undefined;
    return (
      patientEpisodes().find((candidate) => candidate.id === props.episodeId) ??
      defaultEpisode(snapshot, props.patientId)
    );
  });

  // The draft belongs to form + patient + episode; it can be looked up once the vault has told
  // which episode that is.
  const target = createMemo<FormDraftTarget>(() => ({
    formId: props.schema.id,
    patientId: props.patientId,
    episodeId: episode()?.id,
  }));
  const sessionKey = createMemo(() =>
    formSessionKey(props.schema.id, props.patientId, episode()?.id),
  );
  const keyKnown = (): boolean => !props.patientId || vault.snapshot() !== undefined;

  let pending: { readonly target: FormDraftTarget; readonly draft: FormDraft } | undefined;
  let loadRequest = 0;
  let editedSinceLoad = false;
  const autosave = createDebouncer(() => void flushDraft(), FORM_AUTOSAVE_DEBOUNCE_MS);

  const flushDraft = async (): Promise<void> => {
    autosave.cancel();
    const job = pending;
    pending = undefined;
    if (!job) return;
    try {
      await storeFormDraft(job.target, job.draft);
      setSaveError('');
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : 'Не удалось сохранить черновик.');
    }
  };
  onCleanup(() => void flushDraft());

  const applyDraft = (draft: FormDraft | undefined): void => {
    setEdits(draft?.edits ?? {});
    setStatus(draft?.status ?? 'draft');
    setSavedAt(draft?.savedAt);
  };
  // Typed values come back when the person returns to the same form, patient and episode.
  createEffect(() => {
    if (!keyKnown()) return;
    const key = sessionKey();
    untrack(() => {
      const request = ++loadRequest;
      void flushDraft();
      editedSinceLoad = false;
      setAttempted(false);
      setSaveError('');
      const remembered = readFormSession(key);
      applyDraft(remembered);
      if (remembered || !isPatientVaultUnlocked()) {
        setReady(true);
        return;
      }
      loadFormDraft(target())
        .then((draft) => {
          if (request === loadRequest && !editedSinceLoad) applyDraft(draft);
        })
        .catch((cause: unknown) => {
          if (request === loadRequest) {
            setSaveError(cause instanceof Error ? cause.message : 'Не удалось открыть черновик.');
          }
        })
        .finally(() => {
          if (request === loadRequest) setReady(true);
        });
    });
  });

  const onVaultLocked = (): void => {
    autosave.cancel();
    pending = undefined;
    applyDraft(undefined);
  };
  window.addEventListener(PATIENT_VAULT_LOCK_EVENT, onVaultLocked);
  onCleanup(() => window.removeEventListener(PATIENT_VAULT_LOCK_EVENT, onVaultLocked));

  const today = (): string => localIsoDate(new Date());
  const prefill = createMemo(() =>
    prefillFormValues(
      props.schema,
      buildFormPrefillContext({
        profile: profile(),
        episode: episode(),
        clinician: clinician(),
        now: new Date(),
      }),
    ),
  );
  const values = createMemo<FormValues>(() => ({ ...prefill().values, ...edits() }));
  const isPrefilled = (fieldId: string): boolean => {
    const filled = prefill().values[fieldId];
    return filled !== undefined && sameValue(values()[fieldId], filled);
  };
  const validation = createMemo(() => validateForm(props.schema, values(), { today: today() }));
  const requiredTotal = createMemo(
    () => fillableFields(props.schema).filter((field) => field.required).length,
  );
  const changedFromPrefill = createMemo(() =>
    Object.entries(edits()).some(
      ([fieldId, value]) => !sameValue(prefill().values[fieldId], value),
    ),
  );

  /** Records new edits as the current draft; the vault write follows once typing pauses. */
  const commit = (
    nextEdits: Readonly<Record<string, FormValue>>,
    nextStatus: FormDraftStatus,
    approvedAt?: string,
  ): void => {
    const draft: FormDraft = {
      edits: nextEdits,
      status: nextStatus,
      updatedAt: new Date().toISOString(),
      ...(approvedAt ? { savedAt: approvedAt } : {}),
    };
    setEdits(nextEdits);
    setStatus(nextStatus);
    setSavedAt(approvedAt);
    writeFormSession(sessionKey(), draft);
    pending = { target: target(), draft };
    autosave.call();
  };
  const setValue = (fieldId: string, value: FormValue): void => {
    editedSinceLoad = true;
    commit({ ...edits(), [fieldId]: value }, 'draft');
  };
  const resetEdits = (): void => {
    editedSinceLoad = true;
    setAttempted(false);
    commit({}, 'draft');
  };
  const scrollToField = (fieldId: string | undefined): void => {
    const element = fieldId ? document.getElementById(`form-field-${fieldId}`) : null;
    element?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };
  const firstProblem = (): string | undefined =>
    validation().missing[0] ?? Object.keys(validation().invalid)[0];
  const jumpToFirstMissing = (): void => {
    setAttempted(true);
    scrollToField(validation().missing[0]);
  };
  /** «Сохранить»: approves a complete form; an incomplete one shows where it is not. */
  const save = (): void => {
    setAttempted(true);
    const problem = firstProblem();
    if (problem) {
      scrollToField(problem);
      return;
    }
    editedSinceLoad = true;
    commit({ ...values() }, 'saved', new Date().toISOString());
    void flushDraft();
  };

  const needsVault = (): boolean => Boolean(props.patientId);
  const back = (): void =>
    props.onNavigate(props.patientId ? notesPatientsPath(props.patientId) : notesFormsPath());
  const reference = (): string =>
    `${orderReference(props.schema.source)}, ${registrationReference(props.schema.source)}, приложение № ${props.schema.source.blankAppendix.number}. ${validityLine(props.schema.source, localToday())}`;

  return (
    <section class="forms-workspace" aria-label={`Форма № ${props.schema.formNumber}`}>
      <Page
        navigation={
          <NavBack
            class="knowledge-back-button"
            aria-label={props.patientId ? 'К карточке пациента' : 'К списку форм'}
            onClick={back}
          />
        }
        title={<Heading depth={1}>Форма № {props.schema.formNumber}</Heading>}
        description={props.schema.title}
        actions={
          <FormThumbnail
            schema={props.schema}
            values={values()}
            onOpen={() => setPreviewOpen(true)}
          />
        }
        help={
          <>
            <p>Поля подставляются из карточки пациента и профиля «Врач и организация».</p>
            <p>
              Черновик сохраняется сам. «Сохранить» внизу утверждает заполненную форму; после правки
              она снова становится черновиком.
            </p>
            <p>
              Бланк печатается для подписи и печати организации: приложение не создаёт электронный
              документ.
            </p>
          </>
        }
        helpTitle="О форме"
      />

      <div class="forms-workspace__patient">
        <PatientPickerRow
          profiles={vault.snapshot()?.profiles ?? []}
          patientId={props.patientId ?? ''}
          unlocked={vault.unlocked()}
          onPatientChange={(next) =>
            props.onNavigate(notesFormsPath(props.schema.id, next ? { patientId: next } : {}))
          }
          onSnapshotChange={vault.adopt}
        />
        <Show when={props.patientId && vault.unlocked() && !profile()}>
          <p class="forms-workspace__error" role="alert">
            Пациент не найден.
          </p>
        </Show>
        <Show when={patientEpisodes().length > 1}>
          <SelectField
            label="Осмотр"
            value={episode()?.id ?? ''}
            options={patientEpisodes().map((item) => ({
              value: item.id,
              label: `${item.title} · ${displayDate(item.startedAt.slice(0, 10))}`,
            }))}
            controlClass="form-field__input"
            onChange={(event) =>
              props.onNavigate(
                notesFormsPath(props.schema.id, {
                  ...(props.patientId ? { patientId: props.patientId } : {}),
                  episodeId: event.currentTarget.value,
                }),
              )
            }
          />
        </Show>
        <Show when={profile() && !profile()?.fullName}>
          <p class="forms-workspace__muted">
            В карточке нет полного ФИО — добавьте его в «Данные для справок и форм».
          </p>
        </Show>
      </div>

      <Show when={needsVault() && !vault.unlocked()}>
        <PatientVaultUnlock
          onUnlocked={vault.adopt}
          dialog={{
            title: 'Пациенты',
            onClose: () => {
              if (props.patientId) props.onNavigate(notesFormsPath(props.schema.id));
            },
          }}
        />
      </Show>

      <FormProgress
        total={requiredTotal()}
        done={requiredTotal() - validation().missing.length}
        stateText={formDraftStateText({
          status: status(),
          savedAt: savedAt(),
          error: saveError() || undefined,
        })}
        stateError={saveError() !== ''}
        attention={attempted()}
        canReset={changedFromPrefill()}
        onJump={jumpToFirstMissing}
        onReset={resetEdits}
      />

      <Show when={ready()}>
        <For each={props.schema.sections}>
          {(section) => (
            <section class="form-section paper-card" aria-label={section.title}>
              <Heading depth={2} class="form-section__title">
                {section.title}
              </Heading>
              <Show when={section.description}>
                {(description) => <p class="form-section__description">{description()}</p>}
              </Show>
              <div class="form-section__fields">
                <For each={sectionFields(props.schema, section)}>
                  {(field) => (
                    <FormFieldControl
                      schema={props.schema}
                      field={field}
                      value={values()[field.id]}
                      prefilled={isPrefilled(field.id)}
                      missing={attempted() && validation().missing.includes(field.id)}
                      error={validation().invalid[field.id]}
                      onChange={(value) => setValue(field.id, value)}
                    />
                  )}
                </For>
              </div>
            </section>
          )}
        </For>

        <div class="forms-workspace__actions">
          <Button
            type="button"
            variant="primary"
            class="forms-workspace__save"
            icon={<AppGlyph name="check" />}
            disabled={status() === 'saved'}
            onClick={save}
          >
            Сохранить
          </Button>
        </div>

        <p class="forms-workspace__reference">
          {reference()}{' '}
          <a
            class="forms-workspace__reference-link"
            href={props.schema.source.publicationUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Официальная публикация
          </a>
        </p>
      </Show>

      <FormPreviewDialog
        open={previewOpen()}
        schema={props.schema}
        values={values()}
        missingCount={validation().missing.length}
        invalidCount={Object.keys(validation().invalid).length}
        onClose={() => setPreviewOpen(false)}
      />
    </section>
  );
}
