import type { FormSchema } from '@localmed/contracts';
import { createEffect, createMemo, createSignal, For, type JSX, onCleanup, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { NavBack } from '@/components/NavBack';
import { PatientVaultUnlock } from '@/components/PatientVaultUnlock';
import { SelectField } from '@/components/SelectField';
import { Heading } from '@/components/Text';
import { FormFieldControl } from '@/features/forms/FormFieldControl';
import { FormPreviewDialog } from '@/features/forms/FormPreviewDialog';
import {
  buildFormPrefillContext,
  localIsoDate,
  prefillFormValues,
} from '@/features/forms/form-prefill';
import { formSessionKey, readFormSession, writeFormSession } from '@/features/forms/form-session';
import { displayDate } from '@/features/forms/form-print';
import { localToday, orderReference, validityLine } from '@/features/forms/form-source-line';
import { validateForm } from '@/features/forms/form-validation';
import { type FormValue, type FormValues, fillableFields } from '@/features/forms/form-values';
import { defaultEpisode, sectionFields } from '@/features/forms/form-view-model';
import { usePatientVaultSnapshot } from '@/features/forms/use-patient-vault-snapshot';
import { notesFormsPath, notesPatientsPath } from '@/features/notes/notes-routing';
import { getPluralMessage } from '@/i18n/browser-i18n';
import {
  type ClinicianProfile,
  getClinicianProfile,
  subscribeClinicianProfile,
} from '@/state/clinician-profile';
import { PATIENT_VAULT_LOCK_EVENT } from '@/state/patient-vault';
import '@/styles/forms.css';

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
 * The filling screen of any schema-described form: prefilled values are marked, empty required
 * fields are highlighted, each field shows the paragraph of the order that governs it on demand.
 * It renders schema data only; nothing here knows a form number.
 */
export function FormFillPage(props: FormFillPageProps): JSX.Element {
  const vault = usePatientVaultSnapshot();
  const [clinician, setClinician] = createSignal<ClinicianProfile>(getClinicianProfile());
  const [wantsVault, setWantsVault] = createSignal(false);
  const [previewOpen, setPreviewOpen] = createSignal(false);
  const [edits, setEdits] = createSignal<Readonly<Record<string, FormValue>>>({});
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

  const sessionKey = createMemo(() =>
    formSessionKey(props.schema.id, props.patientId, episode()?.id),
  );
  // Typed values come back when the person returns to the same form, patient and episode.
  createEffect(() => {
    setEdits(readFormSession(sessionKey()));
  });
  const onVaultLocked = (): void => {
    setEdits({});
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
  const prefilledCount = createMemo(
    () => fillableFields(props.schema).filter((field) => isPrefilled(field.id)).length,
  );

  const setValue = (fieldId: string, value: FormValue): void => {
    const next = { ...edits(), [fieldId]: value };
    setEdits(next);
    writeFormSession(sessionKey(), next);
  };
  const resetEdits = (): void => {
    setEdits({});
    writeFormSession(sessionKey(), {});
  };
  const scrollToFirstMissing = (): void => {
    const first = validation().missing[0];
    const element = first ? document.getElementById(`form-field-${first}`) : null;
    element?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  const needsVault = (): boolean => Boolean(props.patientId) || wantsVault();
  const patientOptions = createMemo(() => [
    { value: '', label: 'Без пациента — пустой бланк' },
    ...(vault.snapshot()?.profiles ?? []).map((item) => ({
      value: item.id,
      label: item.displayName,
    })),
  ]);
  const back = (): void =>
    props.onNavigate(props.patientId ? notesPatientsPath(props.patientId) : notesFormsPath());

  return (
    <section class="forms-workspace" aria-label={`Форма № ${props.schema.formNumber}`}>
      <header class="forms-workspace__chrome">
        <NavBack
          class="forms-workspace__back knowledge-back-button"
          aria-label={props.patientId ? 'К карточке пациента' : 'К списку форм'}
          onClick={back}
        />
        <div class="forms-workspace__heading">
          <p class="forms-workspace__kicker">Форма № {props.schema.formNumber}</p>
          <Heading depth={1} class="forms-workspace__title">
            {props.schema.title}
          </Heading>
        </div>
      </header>

      <section class="forms-workspace__source paper-card" aria-label="Официальный источник">
        <p class="forms-workspace__source-line">
          {orderReference(props.schema.source)}, приложение №{' '}
          {props.schema.source.blankAppendix.number}.{' '}
          {validityLine(props.schema.source, localToday())}
        </p>
        <a
          class="forms-workspace__source-link"
          href={props.schema.source.publicationUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Официальная публикация
        </a>
      </section>

      <section class="forms-workspace__patient paper-card" aria-label="Данные пациента">
        <Heading depth={2} class="forms-workspace__section-title">
          Пациент
        </Heading>
        <Show
          when={vault.unlocked()}
          fallback={
            <div class="forms-workspace__patient-body">
              <p class="forms-workspace__muted">
                Данные пациента подставляются из карточки; она открывается отдельно.
              </p>
              <Show when={!needsVault()}>
                <Button
                  type="button"
                  variant="secondary"
                  icon={<AppGlyph name="users" />}
                  onClick={() => setWantsVault(true)}
                >
                  Выбрать пациента
                </Button>
              </Show>
            </div>
          }
        >
          <div class="forms-workspace__patient-body">
            <SelectField
              label="Пациент"
              value={props.patientId ?? ''}
              options={patientOptions()}
              onChange={(event) => {
                const next = event.currentTarget.value;
                props.onNavigate(notesFormsPath(props.schema.id, next ? { patientId: next } : {}));
              }}
            />
            <Show when={props.patientId && !profile()}>
              <p class="forms-workspace__error" role="alert">
                Пациент не найден.
              </p>
            </Show>
            <Show when={patientEpisodes().length > 1}>
              <SelectField
                label="Осмотр (из него берётся диагноз)"
                value={episode()?.id ?? ''}
                options={patientEpisodes().map((item) => ({
                  value: item.id,
                  label: `${item.title} · ${displayDate(item.startedAt.slice(0, 10))}`,
                }))}
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
                В карточке нет полного ФИО и данных для справок — добавьте их в блоке «Данные для
                справок и форм».
              </p>
            </Show>
          </div>
        </Show>
      </section>

      <Show when={needsVault() && !vault.unlocked()}>
        <PatientVaultUnlock
          onUnlocked={vault.adopt}
          dialog={{
            title: 'Пациенты',
            onClose: () => {
              setWantsVault(false);
              if (props.patientId) props.onNavigate(notesFormsPath(props.schema.id));
            },
          }}
        />
      </Show>

      <div class="forms-workspace__summary" role="status" aria-live="polite">
        <span class="forms-workspace__summary-item forms-workspace__summary-item--prefilled">
          {getPluralMessage('forms_prefilled_count', prefilledCount())}
        </span>
        <Show
          when={validation().missing.length > 0}
          fallback={
            <span class="forms-workspace__summary-item forms-workspace__summary-item--complete">
              Обязательные поля заполнены
            </span>
          }
        >
          <button
            type="button"
            class="forms-workspace__summary-item forms-workspace__summary-item--missing"
            onClick={scrollToFirstMissing}
          >
            {getPluralMessage('forms_missing_required_count', validation().missing.length)}
          </button>
        </Show>
        <Show when={Object.keys(edits()).length > 0}>
          <button type="button" class="forms-workspace__reset" onClick={resetEdits}>
            Вернуть подставленные значения
          </button>
        </Show>
      </div>

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
                    missing={validation().missing.includes(field.id)}
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
          class="forms-workspace__preview"
          icon={<AppGlyph name="printer" />}
          onClick={() => setPreviewOpen(true)}
        >
          Предпросмотр и печать
        </Button>
        <Show when={validation().missing.length > 0}>
          <p class="forms-workspace__actions-note">
            {getPluralMessage('forms_missing_required_count', validation().missing.length)} — печать
            не блокируется.
          </p>
        </Show>
      </div>

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
