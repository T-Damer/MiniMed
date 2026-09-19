import { createMemo, createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';

import { AppBreadcrumbs } from '@/components/AppBreadcrumbs';
import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { NavBack } from '@/components/NavBack';
import { Page } from '@/components/Page';
import { PatientCaseCombobox } from '@/components/PatientCaseCombobox';
import { Heading } from '@/components/Text';
import { AssessmentDefinitionNotice } from '@/features/assessments/AssessmentDefinitionNotice';
import {
  printBlankAssessment,
  printExternalAssessmentMaterial,
} from '@/features/assessments/assessment-print';
import { assessmentWorkspaceCrumbs } from '@/features/assessments/assessment-routing';
import type {
  AssessmentDefinition,
  AssessmentRecord,
} from '@/features/assessments/assessment-types';
import {
  isAcceptedExternalAssessmentMaterial,
  parseExternalAssessmentValues,
} from '@/features/assessments/external-assessment';
import { createExternalAssessmentRecord } from '@/state/assessment-results';
import type { PatientProfile, PatientVaultSnapshot } from '@/state/patient-domain';
import { recordExternalAssessmentResultForPatient } from '@/state/patient-tool-recording';
import {
  acknowledgePatientVaultUiCleared,
  isPatientVaultUnlocked,
  PATIENT_VAULT_EVENT,
  PATIENT_VAULT_LOCK_EVENT,
  readPatientVault,
} from '@/state/patient-vault';

export function ExternalAssessmentPage(props: {
  readonly definition: AssessmentDefinition;
  readonly onBack: () => void;
  readonly onSaved: (record: AssessmentRecord) => void;
  readonly onMessage: (message: string) => void;
}): JSX.Element {
  const administration = () => props.definition.externalAdministration;
  const firstVariantId = administration()?.variants[0]?.id ?? '';
  const [variantId, setVariantId] = createSignal(firstVariantId);
  const [subjectLabel, setSubjectLabel] = createSignal('');
  const [patientId, setPatientId] = createSignal('');
  const [episodeId, setEpisodeId] = createSignal('');
  const [patientSnapshot, setPatientSnapshot] = createSignal<PatientVaultSnapshot>();
  const [values, setValues] = createSignal<Record<string, string>>({});
  const [material, setMaterial] = createSignal<File>();
  const [methodologyOpen, setMethodologyOpen] = createSignal(false);
  const [materialBusy, setMaterialBusy] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  let materialInput: HTMLInputElement | undefined;
  let patientRefreshRequest = 0;

  const refreshPatients = (): void => {
    const request = ++patientRefreshRequest;
    if (!isPatientVaultUnlocked()) {
      const protectedForm = patientId() !== '';
      setPatientSnapshot(undefined);
      setPatientId('');
      setEpisodeId('');
      if (protectedForm) {
        setValues({});
        setSubjectLabel('');
        setMaterial(undefined);
      }
      acknowledgePatientVaultUiCleared();
      return;
    }
    void readPatientVault()
      .then((next) => {
        if (request === patientRefreshRequest && isPatientVaultUnlocked()) {
          setPatientSnapshot(next);
        }
      })
      .catch((cause) => {
        if (request === patientRefreshRequest && isPatientVaultUnlocked()) {
          setPatientSnapshot(undefined);
          props.onMessage(
            cause instanceof Error ? cause.message : 'Не удалось прочитать пациентов.',
          );
        }
      });
  };
  onMount(() => {
    refreshPatients();
    window.addEventListener(PATIENT_VAULT_EVENT, refreshPatients);
    window.addEventListener(PATIENT_VAULT_LOCK_EVENT, refreshPatients);
  });
  onCleanup(() => {
    patientRefreshRequest += 1;
    window.removeEventListener(PATIENT_VAULT_EVENT, refreshPatients);
    window.removeEventListener(PATIENT_VAULT_LOCK_EVENT, refreshPatients);
  });

  const patientProfiles = (): readonly PatientProfile[] => patientSnapshot()?.profiles ?? [];
  const selectedPatient = (): PatientProfile | undefined => {
    const id = patientId();
    return id ? patientProfiles().find((profile) => profile.id === id) : undefined;
  };
  const patientEpisodes = () =>
    patientSnapshot()?.episodes.filter(
      (episode) => episode.patientId === patientId() && episode.status === 'open',
    ) ?? [];

  const selectPatient = (nextPatientId: string): void => {
    const previousPatientId = patientId();
    if (nextPatientId !== previousPatientId) {
      // Do not carry clinical values across the ordinary/protected storage boundary.
      setValues({});
      setMaterial(undefined);
    }
    setPatientId(nextPatientId);
    setEpisodeId('');
    const patient = patientProfiles().find((candidate) => candidate.id === nextPatientId);
    setSubjectLabel(patient?.displayName ?? '');
  };

  const variant = createMemo(() => {
    const current = administration();
    return current?.variants.find((item) => item.id === variantId()) ?? current?.variants[0];
  });
  const acceptedMimeTypes = () => administration()?.material.acceptedMimeTypes.join(',') ?? '';

  const save = async (): Promise<void> => {
    if (saving()) return;
    const selected = variant();
    if (!selected) {
      props.onMessage('Вариант методики не выбран.');
      return;
    }
    const parsed = parseExternalAssessmentValues(selected, values());
    if (!parsed.ok) {
      props.onMessage(parsed.error);
      return;
    }
    setSaving(true);
    try {
      const record = createExternalAssessmentRecord({
        assessmentId: props.definition.id,
        subjectLabel: subjectLabel(),
        variantId: selected.id,
        values: parsed.values,
        ...(patientId() ? { patientId: patientId() } : {}),
        ...(episodeId() ? { episodeId: episodeId() } : {}),
        ...(props.definition.version ? { definitionVersion: props.definition.version } : {}),
        persist: !patientId(),
      });
      if (patientId()) {
        try {
          const saved = await recordExternalAssessmentResultForPatient({
            patientId: patientId(),
            ...(episodeId() ? { episodeId: episodeId() } : {}),
            record,
            definition: props.definition,
          });
          props.onMessage(
            saved.created
              ? 'Результат записан в защищённую карточку.'
              : (saved.reason ?? 'Результат уже присутствует в карточке пациента.'),
          );
        } catch (cause) {
          props.onMessage(
            cause instanceof Error
              ? cause.message
              : 'Не удалось записать результат в карточку пациента.',
          );
          return;
        }
      }
      props.onSaved(record);
    } finally {
      setSaving(false);
    }
  };

  const printMaterial = async (): Promise<void> => {
    const file = material();
    const selected = variant();
    if (!file || !selected || materialBusy()) return;
    setMaterialBusy(true);
    try {
      const printed = await printExternalAssessmentMaterial(
        file,
        `${props.definition.shortTitle} — ${selected.shortLabel}`,
      );
      props.onMessage(
        printed
          ? 'Материал передан на печать.'
          : 'Не удалось открыть локальный материал для печати.',
      );
    } catch (cause) {
      props.onMessage(
        cause instanceof Error ? cause.message : 'Не удалось подготовить локальный материал.',
      );
    } finally {
      setMaterialBusy(false);
    }
  };

  const printResultSheet = (): void => {
    props.onMessage(
      printBlankAssessment(props.definition)
        ? 'Лист результата подготовлен к печати.'
        : 'Не удалось открыть окно печати.',
    );
  };

  return (
    <article class="assessment-external-page">
      <Page
        class="assessment-page-header assessment-external-page__header"
        navigation={
          <NavBack class="knowledge-back-button" aria-label="К тестам" onClick={props.onBack} />
        }
        breadcrumbs={<AppBreadcrumbs items={assessmentWorkspaceCrumbs(props.definition)} />}
        icon={<AppGlyph name="list-checks" class="page__icon-glyph" />}
        title={
          <Heading depth={3} class="assessment-subpage-title">
            {props.definition.title}
          </Heading>
        }
        actions={
          <div class="assessment-subpage-header-actions assessment-subpage-header-actions--trailing">
            <Button
              type="button"
              variant="icon"
              class="knowledge-back-button"
              aria-label="Распечатать лист результата"
              title="Распечатать лист результата"
              onClick={printResultSheet}
              icon={<AppGlyph name="printer" />}
            />
            <Button
              type="button"
              variant="icon"
              class="knowledge-back-button assessment-help-button"
              aria-label="О методике и источниках"
              title="О методике и источниках"
              onClick={() => setMethodologyOpen(true)}
              icon={<AppGlyph name="question" class="assessment-help-button__icon" />}
            />
          </div>
        }
      />

      <section class="assessment-external-card paper-card">
        <p class="assessment-external-card__lead">
          Результат вносится по внешнему бланку. MiniMed не показывает защищённые задания и не
          пересчитывает нормы этой методики.
        </p>

        <div class="assessment-toolbar assessment-external-card__patient">
          <PatientCaseCombobox
            class="assessment-toolbar__field"
            profiles={patientProfiles()}
            patientId={patientId()}
            subjectLabel={subjectLabel()}
            unlocked={patientSnapshot() !== undefined && isPatientVaultUnlocked()}
            onPatientChange={selectPatient}
            onSubjectLabelChange={setSubjectLabel}
            onSnapshotChange={(snapshot) => {
              patientRefreshRequest += 1;
              setPatientSnapshot(snapshot);
            }}
          />
          <Show when={selectedPatient()}>
            <label class="assessment-toolbar__episode-field">
              <span class="assessment-toolbar__episode-label">Осмотр — необязательно</span>
              <select
                class="assessment-toolbar__episode-input assessment-toolbar__input"
                value={episodeId()}
                onChange={(event) => setEpisodeId(event.currentTarget.value)}
              >
                <option value="">Отдельное событие</option>
                <For each={patientEpisodes()}>
                  {(episode) => (
                    <option value={episode.id}>
                      {episode.title} · {new Date(episode.startedAt).toLocaleDateString('ru-RU')}
                    </option>
                  )}
                </For>
              </select>
            </label>
          </Show>
        </div>

        <Show when={(administration()?.variants.length ?? 0) > 1}>
          <label class="assessment-external-field">
            <span class="assessment-external-field__label">Вариант методики</span>
            <select
              class="assessment-external-field__control"
              value={variantId()}
              onChange={(event) => {
                setVariantId(event.currentTarget.value);
                setValues({});
                setMaterial(undefined);
              }}
            >
              <For each={administration()?.variants ?? []}>
                {(item) => <option value={item.id}>{item.label}</option>}
              </For>
            </select>
          </label>
        </Show>

        <Show when={variant()}>
          {(selected) => (
            <>
              <div class="assessment-external-variant">
                <strong>{selected().label}</strong>
                <p>{selected().description}</p>
                <small>{selected().audience}</small>
              </div>

              <div class="assessment-external-fields">
                <For each={selected().resultFields}>
                  {(field) => (
                    <label
                      class="assessment-external-field"
                      for={`external-assessment-${field.id}`}
                    >
                      <span class="assessment-external-field__label">
                        {field.label}
                        <Show when={field.kind === 'number' && field.unit}>
                          {(unit) => <> · {unit()}</>}
                        </Show>
                      </span>
                      <Show
                        when={field.kind === 'select' ? field : undefined}
                        fallback={
                          field.kind === 'text' && field.multiline ? (
                            <textarea
                              class="assessment-external-field__control assessment-external-field__control--textarea"
                              id={`external-assessment-${field.id}`}
                              value={values()[field.id] ?? ''}
                              placeholder={field.kind === 'text' ? field.placeholder : undefined}
                              onInput={(event) =>
                                setValues((current) => ({
                                  ...current,
                                  [field.id]: event.currentTarget.value,
                                }))
                              }
                            />
                          ) : (
                            <input
                              class="assessment-external-field__control"
                              type={field.kind === 'number' ? 'number' : 'text'}
                              id={`external-assessment-${field.id}`}
                              value={values()[field.id] ?? ''}
                              min={field.kind === 'number' ? field.minimum : undefined}
                              max={field.kind === 'number' ? field.maximum : undefined}
                              step={field.kind === 'number' && field.integer ? 1 : 'any'}
                              placeholder={field.kind === 'text' ? field.placeholder : undefined}
                              onInput={(event) =>
                                setValues((current) => ({
                                  ...current,
                                  [field.id]: event.currentTarget.value,
                                }))
                              }
                            />
                          )
                        }
                      >
                        {(selectField) => (
                          <select
                            class="assessment-external-field__control"
                            value={values()[selectField().id] ?? ''}
                            id={`external-assessment-${selectField().id}`}
                            onChange={(event) =>
                              setValues((current) => ({
                                ...current,
                                [selectField().id]: event.currentTarget.value,
                              }))
                            }
                          >
                            <option value="">Выберите…</option>
                            <For each={selectField().options}>
                              {(option) => <option value={option.value}>{option.label}</option>}
                            </For>
                          </select>
                        )}
                      </Show>
                    </label>
                  )}
                </For>
              </div>
            </>
          )}
        </Show>

        <div class="assessment-external-material">
          <strong>Стимульный материал / бланк</strong>
          <p>{administration()?.material.note}</p>
          <input
            ref={materialInput}
            class="assessment-external-material__input"
            type="file"
            accept={acceptedMimeTypes()}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (!file) return;
              if (
                !isAcceptedExternalAssessmentMaterial(
                  file,
                  administration()?.material.acceptedMimeTypes ?? [],
                )
              ) {
                props.onMessage('Выбран неподдерживаемый тип файла.');
                event.currentTarget.value = '';
                return;
              }
              setMaterial(file);
            }}
          />
          <div class="assessment-external-material__actions">
            <Button
              type="button"
              variant="secondary"
              onClick={() => materialInput?.click()}
              icon={<AppGlyph name="file-arrow-down" />}
            >
              {material() ? 'Заменить локальный файл' : 'Выбрать локальный файл'}
            </Button>
            <Show when={material()}>
              {(file) => (
                <>
                  <span class="assessment-external-material__name">{file().name}</span>
                  <Button
                    type="button"
                    variant="primary"
                    disabled={materialBusy()}
                    onClick={() => void printMaterial()}
                    icon={<AppGlyph name="printer" />}
                  >
                    {materialBusy() ? 'Подготавливаем…' : 'Печатать тест'}
                  </Button>
                </>
              )}
            </Show>
          </div>
        </div>

        <div class="assessment-external-actions">
          <Button
            type="button"
            variant="primary"
            disabled={saving()}
            onClick={() => void save()}
            icon={<AppGlyph name="check" />}
          >
            {saving() ? 'Сохраняем…' : 'Сохранить результат'}
          </Button>
        </div>
      </section>

      <AssessmentDefinitionNotice
        definition={props.definition}
        open={methodologyOpen()}
        showTrigger={false}
        onOpenChange={setMethodologyOpen}
      />
    </article>
  );
}
