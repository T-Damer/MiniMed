import type { CalculatorSchema } from '@localmed/contracts';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { toast } from 'solid-sonner';

import { AppBreadcrumbs } from '@/components/AppBreadcrumbs';
import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { ConfirmationDialog } from '@/components/ConfirmationDialog';
import { NavBack } from '@/components/NavBack';
import { OverlayDialog } from '@/components/OverlayDialog';
import { PatientCaseCombobox } from '@/components/PatientCaseCombobox';
import { QueryEmptyState } from '@/components/QueryEmptyState';
import { SearchField } from '@/components/SearchField';
import { Heading } from '@/components/Text';
import { CalculatorChart } from '@/features/calculators/CalculatorChart';
import type {
  CalculatorInstallationState,
  CalculatorSectionId,
} from '@/features/calculators/calculator-packs';
import {
  CALCULATOR_PACKS_EVENT,
  CALCULATOR_SECTION_CATEGORY_IDS,
  CALCULATOR_SECTIONS,
  calculatorsInSection,
  installCalculator,
  installCalculatorSection,
  isCalculatorSectionComplete,
  isCalculatorSectionCore,
  isCalculatorSectionFromDatabase,
  loadCalculatorInstallationState,
  moduleIdForCalculatorSection,
  removeCalculatorSection,
  setDatabaseCalculatorIds,
} from '@/features/calculators/calculator-packs';
import {
  calculationRecordOutputs,
  printCalculationRecord,
  shareCalculationRecord,
} from '@/features/calculators/calculator-print';
import {
  CALCULATOR_REGISTRY,
  clearDownloadedCalculators,
  ECG_PHOTO_CALIPER_ID,
  findCalculator,
  getCalculatorRegistry,
  registerDownloadedCalculator,
  searchCalculators,
} from '@/features/calculators/calculator-registry';
import {
  calculatorSectionCrumbs,
  calculatorSectionPath,
  calculatorWorkspaceCrumbs,
} from '@/features/calculators/calculator-routing';
import { getCalculatorSchema } from '@/features/calculators/calculator-schema-catalog';
import {
  type CalculatorSchemaEvaluation,
  evaluateCalculatorSchema,
  toStoredCalculationResult,
} from '@/features/calculators/calculator-schema-engine';
import type {
  AvailableCalculatorDefinition,
  CalculatorDefinition,
} from '@/features/calculators/calculator-types';
import type { StoredCalculationResult } from '@/features/calculators/clinical-calculations';
import { EcgPhotoCaliper } from '@/features/calculators/EcgPhotoCaliper';
import {
  PEDIATRIC_FEEDING_PLAN_ID,
  parsePediatricFeedingPlan,
} from '@/features/calculators/pediatric-feeding-plan';
import {
  convertQuantity,
  type QuantityFamily,
  unitsForFamily,
} from '@/features/calculators/unit-conversion';
import { MODULE_CATALOG } from '@/features/modules/module-catalog';
import { getContentModuleRuntime } from '@/features/modules/module-runtime-service';
import {
  attachedResultNoteTitle,
  snapshotCalculationForNote,
} from '@/features/notes/note-attached-results';
import { notesPatientsPath } from '@/features/notes/notes-routing';
import {
  type CalculationRecord,
  createCalculationRecord,
  deleteCalculationRecord,
  loadCalculationHistory,
  saveCalculationRecord,
} from '@/state/calculation-history';
import type { PatientProfile, PatientVaultSnapshot } from '@/state/patient-domain';
import { addPatientNote, createPatientCard, loadPatientNotes } from '@/state/patient-notes';
import {
  patientBoundCalculatorInputs,
  recordCalculatorResultForPatient,
} from '@/state/patient-tool-recording';
import {
  acknowledgePatientVaultUiCleared,
  isPatientVaultUnlocked,
  PATIENT_VAULT_EVENT,
  PATIENT_VAULT_LOCK_EVENT,
  readPatientVault,
} from '@/state/patient-vault';

function currentRoute(): string {
  return window.location.hash.replace(/^#\/?/u, '');
}

function relatedCategoriesForSection(
  sectionId: CalculatorSectionId,
): readonly { readonly id: string; readonly title: string }[] {
  return CALCULATOR_SECTION_CATEGORY_IDS[sectionId]
    .map((categoryId) => MODULE_CATALOG.categories.find((category) => category.id === categoryId))
    .filter((category) => category !== undefined)
    .map((category) => ({ id: category.id, title: category.title }));
}

function openRecommendationCategory(categoryId: string): void {
  window.location.hash = `#/modules/documents/category/${encodeURIComponent(categoryId)}`;
}

function parseNumber(value: string): number {
  const normalized = value.trim().replace(',', '.');
  return normalized ? Number(normalized) : Number.NaN;
}

function formatNumber(value: number, precision = 4): string {
  return new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: precision,
    minimumFractionDigits: 0,
  }).format(value);
}

function maxSchemaStep(schema: CalculatorSchema): number {
  return Math.max(
    0,
    ...schema.inputs.map((input) => input.step),
    ...schema.steps.map((step) => step.stepRequired),
  );
}

function audienceLabel(definition: CalculatorDefinition): string {
  if (definition.audience === 'adult') return 'Взрослые';
  if (definition.audience === 'pediatric') return 'Дети';
  return 'Все';
}

function CalculatorCard(props: {
  readonly definition: CalculatorDefinition;
  readonly installed: boolean;
  readonly onOpen: (definition: AvailableCalculatorDefinition) => void;
  readonly onInstall: (definition: AvailableCalculatorDefinition) => void;
}): JSX.Element {
  const definition = props.definition;
  const disabled = (): boolean => definition.state !== 'available' || !props.installed;
  const availableDefinition = (): AvailableCalculatorDefinition | undefined =>
    definition.state === 'available' ? definition : undefined;
  return (
    <Card class={`calculator-card${disabled() ? ' calculator-card--disabled' : ''}`}>
      <div class="calculator-card-meta" classList={{ 'calculator-card__muted': disabled() }}>
        <span>{audienceLabel(definition)}</span>
        <span>{definition.clinical ? 'Клинический' : 'Служебный'}</span>
        <span>
          {definition.state === 'planned'
            ? 'В плане'
            : props.installed
              ? 'На устройстве'
              : 'После скачивания'}
        </span>
      </div>
      <h2 classList={{ 'calculator-card__muted': disabled() }}>{definition.title}</h2>
      <p classList={{ 'calculator-card__muted': disabled() }}>{definition.summary}</p>
      <Show when={definition.state === 'available' && props.installed}>
        <button
          type="button"
          class="calculator-card-open-hit-area"
          aria-label={`Открыть «${definition.title}»`}
          data-testid={`calculator-open-${definition.id}`}
          onClick={() => {
            const available = availableDefinition();
            if (available) props.onOpen(available);
          }}
        />
      </Show>
      {definition.state === 'available' ? (
        !props.installed ? (
          <div class="calculator-card__actions">
            <Button
              type="button"
              variant="icon"
              class="calculator-card__download"
              aria-label={`Скачать «${definition.title}»`}
              title={`Скачать «${definition.title}»`}
              onClick={() => {
                const available = availableDefinition();
                if (available) props.onInstall(available);
              }}
              icon={<AppGlyph class="calculator-card__download-icon" name="download" />}
            />
          </div>
        ) : null
      ) : (
        <small class="calculator-card__muted">{definition.sourceRequirement}</small>
      )}
    </Card>
  );
}

function CalculatorSectionCard(props: {
  readonly section: (typeof CALCULATOR_SECTIONS)[number];
  readonly installation: CalculatorInstallationState;
  readonly definitions: readonly CalculatorDefinition[];
  readonly onOpenSection: (sectionId: CalculatorSectionId) => void;
  readonly onInstall: (sectionId: CalculatorSectionId) => void;
  readonly onRemove: (sectionId: CalculatorSectionId) => void;
}): JSX.Element {
  const allSectionDefinitions = () => calculatorsInSection(props.section.id, props.definitions);
  const availableCount = () =>
    allSectionDefinitions().filter((definition) => definition.state === 'available').length;
  const installedCount = () =>
    allSectionDefinitions().filter(
      (definition) =>
        definition.state === 'available' && props.installation.installedIds.has(definition.id),
    ).length;
  const complete = () =>
    isCalculatorSectionComplete(props.section.id, props.installation, props.definitions);
  const core = () => isCalculatorSectionCore(props.section.id, props.definitions);
  const bundled = () =>
    core() || isCalculatorSectionFromDatabase(props.section.id, props.definitions);

  return (
    <section
      class="calculator-section paper-card"
      data-testid={`calculator-section-${props.section.id}`}
    >
      <button
        type="button"
        class="calculator-section-open-hit-area"
        aria-label={`Открыть раздел «${props.section.title}»`}
        onClick={() => props.onOpenSection(props.section.id)}
      />
      <header class="calculator-section-header">
        <div>
          <p class="archive-kicker">Инструменты раздела</p>
          <h2>{props.section.title}</h2>
          <p>{props.section.description}</p>
          <small>
            {availableCount() === 0
              ? 'Доступных инструментов пока нет · источники и правила ещё проверяются'
              : core() || isCalculatorSectionFromDatabase(props.section.id, props.definitions)
                ? 'Всегда доступно, без скачивания'
                : `${installedCount()}/${availableCount()} скачано на устройство`}
          </small>
        </div>
        <div class="calculator-section-actions">
          <Show when={availableCount() > 0 && !bundled()}>
            <Button
              type="button"
              variant="icon"
              class="calculator-section-action"
              classList={{ 'calculator-section-remove': complete() }}
              aria-label={
                complete()
                  ? `Удалить раздел «${props.section.title}»`
                  : `Скачать раздел «${props.section.title}»`
              }
              title={complete() ? 'Удалить раздел' : 'Скачать раздел'}
              onClick={() =>
                complete() ? props.onRemove(props.section.id) : props.onInstall(props.section.id)
              }
              icon={
                <AppGlyph
                  class="calculator-section-action-icon"
                  name={complete() ? 'trash' : 'download'}
                />
              }
            />
          </Show>
        </div>
      </header>
    </section>
  );
}

function CalculatorSectionPage(props: {
  readonly section: (typeof CALCULATOR_SECTIONS)[number];
  readonly installation: CalculatorInstallationState;
  readonly definitions: readonly CalculatorDefinition[];
  readonly onOpen: (definition: AvailableCalculatorDefinition) => void;
  readonly onInstallCalculator: (definition: AvailableCalculatorDefinition) => void;
  readonly onBack: () => void;
  readonly onInstall: (sectionId: CalculatorSectionId) => void;
  readonly onRemove: (sectionId: CalculatorSectionId) => void;
}): JSX.Element {
  const definitions = () => calculatorsInSection(props.section.id, props.definitions);
  const availableCount = () =>
    definitions().filter((definition) => definition.state === 'available').length;
  const complete = () =>
    isCalculatorSectionComplete(props.section.id, props.installation, props.definitions);
  const core = () => isCalculatorSectionCore(props.section.id, props.definitions);
  const bundled = () =>
    core() || isCalculatorSectionFromDatabase(props.section.id, props.definitions);

  return (
    <section class="calculator-section-page">
      <header class="calculator-section-page-header">
        <NavBack
          class="calculator-section-back"
          aria-label="К разделам калькуляторов"
          title="К разделам"
          onClick={props.onBack}
        />
        <div>
          <AppBreadcrumbs
            items={calculatorSectionCrumbs(props.section.title)}
            onNavigate={(href) => {
              window.location.hash = href;
            }}
          />
          <Heading depth={2}>{props.section.title}</Heading>
          <p>{props.section.description}</p>
        </div>
        <Show when={!bundled() && availableCount() > 0}>
          <Button
            type="button"
            variant="icon"
            class="calculator-section-action"
            classList={{ 'calculator-section-remove': complete() }}
            aria-label={
              complete()
                ? `Удалить раздел «${props.section.title}»`
                : `Скачать раздел «${props.section.title}»`
            }
            title={complete() ? 'Удалить раздел' : 'Скачать раздел'}
            onClick={() =>
              complete() ? props.onRemove(props.section.id) : props.onInstall(props.section.id)
            }
            icon={
              <AppGlyph
                class="calculator-section-action-icon"
                name={complete() ? 'trash' : 'download'}
              />
            }
          />
        </Show>
      </header>
      <Show when={availableCount() === 0}>
        <p class="calculator-section-page__status" role="status">
          В этом разделе пока нет доступных калькуляторов. Инструменты находятся в подготовке.
        </p>
      </Show>
      <Show when={relatedCategoriesForSection(props.section.id).length > 0}>
        <div class="calculator-section-related">
          <span>По теме:</span>
          <For each={relatedCategoriesForSection(props.section.id)}>
            {(category) => (
              <button type="button" onClick={() => openRecommendationCategory(category.id)}>
                {category.title}
              </button>
            )}
          </For>
        </div>
      </Show>
      <div class="calculator-catalog-grid">
        <For each={definitions()}>
          {(definition) => (
            <CalculatorCard
              definition={definition}
              installed={props.installation.installedIds.has(definition.id)}
              onOpen={props.onOpen}
              onInstall={props.onInstallCalculator}
            />
          )}
        </For>
      </div>
    </section>
  );
}

function CalculatorForm(props: {
  readonly definition: AvailableCalculatorDefinition;
  readonly onRecord: (record: CalculationRecord) => void;
  readonly onMessage: (message: string) => void;
}): JSX.Element {
  const [subjectLabel, setSubjectLabel] = createSignal('');
  const [patientId, setPatientId] = createSignal('');
  const [episodeId, setEpisodeId] = createSignal('');
  const [patientSnapshot, setPatientSnapshot] = createSignal<PatientVaultSnapshot>();
  const [value, setValue] = createSignal('');
  const [family, setFamily] = createSignal<QuantityFamily>('mass');
  const [fromUnit, setFromUnit] = createSignal('kg');
  const [toUnit, setToUnit] = createSignal('g');
  // Generic input store for every schema-driven calculator (CALCULATOR_SCHEMA_BY_ID) — one field per
  // `schema.inputs[].id`, rendered dynamically below. Adding a new schema calculator needs no new signal.
  const [schemaValues, setSchemaValues] = createSignal<Record<string, string>>({});
  const [schemaStep, setSchemaStep] = createSignal(0);
  const [schemaPreview, setSchemaPreview] = createSignal<CalculatorSchemaEvaluation>();
  const refreshPatients = (): void => {
    if (!isPatientVaultUnlocked()) {
      setPatientSnapshot(undefined);
      setPatientId('');
      setEpisodeId('');
      setSubjectLabel('');
      acknowledgePatientVaultUiCleared();
      return;
    }
    void readPatientVault().then(setPatientSnapshot);
  };
  onMount(() => {
    refreshPatients();
    window.addEventListener(PATIENT_VAULT_EVENT, refreshPatients);
    window.addEventListener(PATIENT_VAULT_LOCK_EVENT, refreshPatients);
  });
  onCleanup(() => {
    window.removeEventListener(PATIENT_VAULT_EVENT, refreshPatients);
    window.removeEventListener(PATIENT_VAULT_LOCK_EVENT, refreshPatients);
  });
  const schemaHasNextStep = (): boolean => {
    const schema = getCalculatorSchema(props.definition.id);
    return schema !== undefined && schemaStep() < maxSchemaStep(schema);
  };
  const setSchemaValue = (id: string, fieldValue: string): void => {
    setSchemaValues((previous) => ({ ...previous, [id]: fieldValue }));
  };
  // A <select> shows its first <option> by default without firing onChange, so the reactive store never
  // learns that value on its own — without this, submitting before touching every dropdown reports the
  // untouched ones as missing. Reset to each select input's first option whenever the calculator changes.
  createEffect(() => {
    const schema = getCalculatorSchema(props.definition.id);
    if (!schema) return;
    const defaults: Record<string, string> = {};
    for (const input of schema.inputs) {
      if (input.options?.[0]) {
        defaults[input.id] = String(input.options[0].value);
      } else if (input.kind === 'checkbox') {
        defaults[input.id] = '0';
      }
    }
    setSchemaValues(defaults);
    setSchemaStep(0);
    setSchemaPreview(undefined);
  });
  const changeFamily = (next: QuantityFamily): void => {
    const units = unitsForFamily(next);
    setFamily(next);
    setFromUnit(units[0] ?? '');
    setToUnit(units[1] ?? units[0] ?? '');
  };

  const patientProfiles = (): readonly PatientProfile[] => patientSnapshot()?.profiles ?? [];
  const selectedPatient = (): PatientProfile | undefined =>
    patientProfiles().find((profile) => profile.id === patientId());
  const patientEpisodes = () =>
    patientSnapshot()?.episodes.filter(
      (episode) => episode.patientId === patientId() && episode.status === 'open',
    ) ?? [];
  const selectPatient = (nextPatientId: string): void => {
    setPatientId(nextPatientId);
    setEpisodeId('');
    const patient = patientProfiles().find((profile) => profile.id === nextPatientId);
    setSubjectLabel(patient?.displayName ?? '');
    const schema = getCalculatorSchema(props.definition.id);
    const snapshot = patientSnapshot();
    if (patient && schema && snapshot) {
      const bound = patientBoundCalculatorInputs(schema, patient, snapshot);
      setSchemaValues((previous) => ({
        ...previous,
        ...Object.fromEntries(Object.entries(bound).map(([key, value]) => [key, String(value)])),
      }));
    }
  };

  const saveRecord = async (
    result: StoredCalculationResult,
    inputSummary: string,
    rawInputs: Readonly<Record<string, string | number>>,
  ): Promise<void> => {
    const record = createCalculationRecord({
      calculatorId: props.definition.id,
      subjectLabel: subjectLabel(),
      inputSummary,
      result,
      ...(patientId() ? { patientId: patientId() } : {}),
      ...(episodeId() ? { episodeId: episodeId() } : {}),
      definitionVersion: props.definition.version,
      normalizedInputs: rawInputs,
    });
    if (patientId()) {
      try {
        const schema = getCalculatorSchema(props.definition.id);
        const saved = await recordCalculatorResultForPatient({
          patientId: patientId(),
          ...(episodeId() ? { episodeId: episodeId() } : {}),
          recordId: record.id,
          calculatorId: props.definition.id,
          calculatorVersion: props.definition.version,
          title: props.definition.title,
          ...(schema ? { schema } : {}),
          result,
          rawInputs,
          occurredAt: record.createdAt,
        });
        props.onMessage(
          saved.created
            ? 'Результат записан в защищённую карточку.'
            : (saved.reason ?? 'Результат рассчитан без записи в динамику.'),
        );
      } catch (cause) {
        props.onMessage(
          cause instanceof Error ? cause.message : 'Не удалось записать результат в карточку.',
        );
        return;
      }
    } else {
      saveCalculationRecord(record);
      props.onMessage('Расчёт сохранён локально.');
    }
    props.onRecord(record);
  };

  const submit = async (): Promise<void> => {
    let result: StoredCalculationResult;
    let inputSummary: string;

    // Any calculator with a declarative schema (CALCULATOR_SCHEMA_BY_ID) renders and submits through this
    // one generic path — no per-calculator case below. See calculator-schema-catalog.ts to add one.
    const schema = getCalculatorSchema(props.definition.id);
    if (schema) {
      const isFinalStep = schemaStep() >= maxSchemaStep(schema);
      const evaluation = isFinalStep
        ? evaluateCalculatorSchema(schema, schemaValues())
        : evaluateCalculatorSchema(schema, schemaValues(), { maxStep: schemaStep() });
      if (!evaluation.ok) {
        props.onMessage(evaluation.error);
        return;
      }
      if (!isFinalStep) {
        setSchemaPreview(evaluation);
        setSchemaStep((step) => step + 1);
        props.onMessage('Базовая схема готова. Введите текущие потери для пересчёта.');
        return;
      }
      setSchemaPreview(undefined);
      result = toStoredCalculationResult(evaluation);
      inputSummary = schema.inputs
        .map((input) => {
          const raw = schemaValues()[input.id];
          if (raw === undefined || raw === '') return null;
          const optionLabel = input.options?.find((option) => String(option.value) === raw)?.label;
          return `${input.label} ${optionLabel ?? raw}${input.unit ? ` ${input.unit}` : ''}`;
        })
        .filter((part): part is string => part !== null)
        .join(', ');
      await saveRecord(result, inputSummary, schemaValues());
      return;
    }

    switch (props.definition.id) {
      case 'unit-conversion': {
        const conversion = convertQuantity({
          family: family(),
          value: parseNumber(value()),
          from: fromUnit(),
          to: toUnit(),
        });
        if (!conversion.ok) {
          props.onMessage(conversion.error.message);
          return;
        }
        result = {
          ok: true,
          calculatorId: props.definition.id,
          formula: props.definition.formula,
          value: conversion.value,
          unit: conversion.unit,
          displayPrecision: 8,
          trace: conversion.trace,
          warnings: [],
        };
        inputSummary = `${value()} ${fromUnit()} → ${toUnit()}`;
        break;
      }
      default:
        props.onMessage('Этот калькулятор пока недоступен.');
        return;
    }

    await saveRecord(result, inputSummary, { value: value(), family: family() });
  };

  return (
    <form
      class="calculator-form paper-card"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <PatientCaseCombobox
        profiles={patientProfiles()}
        patientId={patientId()}
        subjectLabel={subjectLabel()}
        unlocked={isPatientVaultUnlocked()}
        onPatientChange={selectPatient}
        onSubjectLabelChange={setSubjectLabel}
        onUnlock={() => {
          window.location.hash = notesPatientsPath();
        }}
      />

      <Show when={selectedPatient()}>
        <label class="calculator-wide-field">
          <span>Осмотр — необязательно</span>
          <select
            class="calculator-form__select"
            data-testid="calculator-episode-select"
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

      <Show when={props.definition.id === 'unit-conversion'}>
        <label>
          <span>Величина</span>
          <select
            class="calculator-form__select calculator-form__select--compact"
            value={family()}
            onChange={(event) => changeFamily(event.currentTarget.value as QuantityFamily)}
          >
            <option value="mass">Масса</option>
            <option value="length">Длина</option>
            <option value="volume">Объём</option>
          </select>
        </label>
        <label>
          <span>Значение</span>
          <input
            type="number"
            inputmode="decimal"
            min="0"
            step="any"
            value={value()}
            onInput={(event) => setValue(event.currentTarget.value)}
          />
        </label>
        <label>
          <span>Из единицы</span>
          <select
            class="calculator-form__select calculator-form__select--compact"
            value={fromUnit()}
            onChange={(event) => setFromUnit(event.currentTarget.value)}
          >
            <For each={unitsForFamily(family())}>
              {(unit) => <option value={unit}>{unit}</option>}
            </For>
          </select>
        </label>
        <label>
          <span>В единицу</span>
          <select
            class="calculator-form__select calculator-form__select--compact"
            value={toUnit()}
            onChange={(event) => setToUnit(event.currentTarget.value)}
          >
            <For each={unitsForFamily(family())}>
              {(unit) => <option value={unit}>{unit}</option>}
            </For>
          </select>
        </label>
      </Show>

      {/* Every declarative calculator (CALCULATOR_SCHEMA_BY_ID) renders its form here from
         schema.inputs — no hand-coded fields per calculator. Add one to calculator-schema-catalog.ts
         and it appears with no changes to this component. */}
      <Show when={getCalculatorSchema(props.definition.id)}>
        {(schema) => (
          <For each={schema().inputs.filter((input) => input.step <= schemaStep())}>
            {(input) => (
              <label
                for={`calculator-input-${input.id}`}
                classList={{ 'calculator-form__field--checkbox': input.kind === 'checkbox' }}
              >
                <span>
                  {input.label}
                  {input.unit ? `, ${input.unit}` : ''}
                  {input.note ? ` — ${input.note}` : ''}
                </span>
                {input.kind === 'checkbox' ? (
                  <input
                    id={`calculator-input-${input.id}`}
                    class="calculator-form__checkbox"
                    type="checkbox"
                    checked={(schemaValues()[input.id] ?? '0') === '1'}
                    onChange={(event) =>
                      setSchemaValue(input.id, event.currentTarget.checked ? '1' : '0')
                    }
                  />
                ) : (input.options?.length ?? 0) > 0 ? (
                  <select
                    id={`calculator-input-${input.id}`}
                    class="calculator-form__select"
                    value={schemaValues()[input.id] ?? String(input.options?.[0]?.value ?? '')}
                    onChange={(event) => setSchemaValue(input.id, event.currentTarget.value)}
                  >
                    <For each={input.options ?? []}>
                      {(option) => <option value={String(option.value)}>{option.label}</option>}
                    </For>
                  </select>
                ) : input.kind === 'date' ? (
                  <input
                    id={`calculator-input-${input.id}`}
                    type="date"
                    value={schemaValues()[input.id] ?? ''}
                    onInput={(event) => setSchemaValue(input.id, event.currentTarget.value)}
                  />
                ) : input.kind === 'text' ? (
                  <input
                    id={`calculator-input-${input.id}`}
                    type="text"
                    value={schemaValues()[input.id] ?? ''}
                    onInput={(event) => setSchemaValue(input.id, event.currentTarget.value)}
                  />
                ) : (
                  <input
                    id={`calculator-input-${input.id}`}
                    type="number"
                    inputmode={input.integer ? 'numeric' : 'decimal'}
                    min={input.minimum}
                    max={input.maximum}
                    step={input.inputStep ?? (input.integer ? 1 : 'any')}
                    value={schemaValues()[input.id] ?? ''}
                    onInput={(event) => setSchemaValue(input.id, event.currentTarget.value)}
                  />
                )}
              </label>
            )}
          </For>
        )}
      </Show>

      <Show when={schemaPreview()}>
        {(preview) => (
          <section class="calculator-step-preview" aria-live="polite">
            <p class="calculator-step-preview__title">Базовая схема</p>
            <div class="calculator-output-list">
              <For each={preview().outputs}>
                {(output) =>
                  output.kind === 'visual' ? (
                    <CalculatorChart title={output.label} spec={output.chart} />
                  ) : (
                    <div>
                      <span>{output.label}</span>
                      <strong>
                        {output.kind === 'text'
                          ? output.text
                          : output.kind === 'number'
                            ? `${formatNumber(output.value, output.displayPrecision)} ${output.unit}`
                            : ''}
                      </strong>
                    </div>
                  )
                }
              </For>
            </div>
            <Button
              type="button"
              variant="quiet"
              onClick={() => {
                setSchemaStep(0);
                setSchemaPreview(undefined);
              }}
            >
              Изменить возраст и массу
            </Button>
            <Show when={preview().warnings.length > 0}>
              <div class="calculator-warnings">
                <For each={preview().warnings}>{(warning) => <p>{warning.message}</p>}</For>
              </div>
            </Show>
          </section>
        )}
      </Show>

      <Button
        class="calculator-submit"
        type="submit"
        variant="primary"
        data-testid="calculator-submit"
        icon={<AppGlyph name="calculator" />}
      >
        <Show when={schemaHasNextStep()} fallback="Рассчитать и сохранить">
          Показать схему
        </Show>
      </Button>
    </form>
  );
}

function CalculationResultPanel(props: {
  readonly record: CalculationRecord;
  readonly definition: AvailableCalculatorDefinition;
  readonly onDelete: () => void;
  readonly onMessage: (message: string) => void;
}): JSX.Element {
  const [notes, setNotes] = createSignal(loadPatientNotes());
  const [noteOpen, setNoteOpen] = createSignal(false);
  const [detailsOpen, setDetailsOpen] = createSignal<'formula' | 'sources' | null>(null);
  const [selectedCardId, setSelectedCardId] = createSignal('');
  const [newCardTitle, setNewCardTitle] = createSignal('');

  const outputs = () => calculationRecordOutputs(props.record);
  const feedingPlan = () =>
    props.record.calculatorId === PEDIATRIC_FEEDING_PLAN_ID && 'textValues' in props.record.result
      ? parsePediatricFeedingPlan(props.record.result.textValues)
      : undefined;

  const saveToNote = (): void => {
    let cardId = selectedCardId();
    if (!cardId) {
      const title = newCardTitle().trim() || props.record.subjectLabel.trim();
      if (!title) {
        props.onMessage('Выберите карточку пациента или укажите название новой карточки.');
        return;
      }
      const next = createPatientCard(title, 'Карточка создана из медицинского калькулятора.');
      cardId = next.cards[0]?.id ?? '';
      setNotes(next);
      setSelectedCardId(cardId);
    }
    if (!cardId) {
      props.onMessage('Не удалось создать карточку пациента.');
      return;
    }
    const attachment = snapshotCalculationForNote(props.record);
    const next = addPatientNote(cardId, '', null, { attachedResults: [attachment] });
    const saved = next.notes
      .filter((note) => note.cardId === cardId)
      .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
    if (!saved?.attachedResults?.some((item) => item.recordId === attachment.recordId)) {
      props.onMessage('Не удалось записать расчёт в заметку.');
      return;
    }
    setNotes(next);
    setNoteOpen(false);
    props.onMessage('Расчёт записан в карточку пациента.');
  };

  return (
    <section class="calculator-result paper-card" data-testid="calculator-result">
      <Show
        when={feedingPlan()}
        fallback={
          <>
            <header>
              <p class="archive-kicker">
                {props.record.patientId
                  ? 'Результат в защищённой карточке'
                  : 'Результат сохранён локально'}
              </p>
              <h2>{props.definition.shortTitle}</h2>
              <small>{props.record.inputSummary}</small>
            </header>
            <div class="calculator-output-list">
              <For each={outputs()}>
                {(item) => (
                  <div>
                    <span>{item.label}</span>
                    <strong>{item.display}</strong>
                  </div>
                )}
              </For>
            </div>
            <For each={props.record.result.visuals ?? []}>
              {(chart, index) => (
                <CalculatorChart
                  title={`График ${index() + 1}`}
                  spec={chart}
                  {...(chart.heightPx === undefined ? {} : { heightPx: chart.heightPx })}
                />
              )}
            </For>
            <div class="calculator-result-details">
              <Button
                variant="secondary"
                icon={<AppGlyph name="list" />}
                onClick={() => setDetailsOpen('formula')}
              >
                Формула и шаги
              </Button>
              <Button
                variant="quiet"
                icon={<AppGlyph name="book-open" />}
                onClick={() => setDetailsOpen('sources')}
              >
                Источники и ограничения
              </Button>
            </div>
            <Show when={props.record.result.warnings.length > 0}>
              <div class="calculator-warnings">
                <For each={props.record.result.warnings}>
                  {(warning) => <p>{warning.message}</p>}
                </For>
              </div>
            </Show>
          </>
        }
      >
        {(plan) => (
          <article class="calculator-output-list calculator-output-list--feeding feeding-ration">
            <header class="feeding-ration__header">
              <p class="feeding-ration__kicker">Рацион на один день</p>
              <h2 class="feeding-ration__title">Рацион ребёнка</h2>
              <p class="feeding-ration__meta">
                {props.record.subjectLabel || 'Имя не указано'} · {plan().details}
              </p>
            </header>
            <p class="feeding-ration__guide">{plan().guide}</p>
            <dl class="feeding-ration__summary">
              <div class="feeding-ration__summary-item">
                <dt class="feeding-ration__summary-label">Частота</dt>
                <dd class="feeding-ration__summary-value">{plan().frequency}</dd>
              </div>
              <div class="feeding-ration__summary-item">
                <dt class="feeding-ration__summary-label">За сутки</dt>
                <dd class="feeding-ration__summary-value">{plan().dailyVolume}</dd>
              </div>
              <div class="feeding-ration__summary-item">
                <dt class="feeding-ration__summary-label">Калорийность</dt>
                <dd class="feeding-ration__summary-value">{plan().dailyCalories}</dd>
              </div>
            </dl>
            <Show when={plan().allergyPlan}>
              <p class="feeding-ration__allergy">{plan().allergyPlan}</p>
            </Show>
            <section class="feeding-ration__table-wrap" aria-label="Кормления">
              <table class="feeding-ration__table">
                <thead>
                  <tr>
                    <th class="feeding-ration__heading" scope="col">
                      Время
                    </th>
                    <th class="feeding-ration__heading" scope="col">
                      Что предложить
                    </th>
                    <th class="feeding-ration__heading" scope="col">
                      Объём
                    </th>
                    <th class="feeding-ration__heading" scope="col">
                      Ккал
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <For each={plan().meals}>
                    {(meal) => (
                      <tr class="feeding-ration__meal">
                        <th class="feeding-ration__cell feeding-ration__cell--time" scope="row">
                          {meal.time}
                        </th>
                        <td class="feeding-ration__cell">{meal.food}</td>
                        <td class="feeding-ration__cell feeding-ration__cell--number">
                          {meal.volume}
                        </td>
                        <td class="feeding-ration__cell feeding-ration__cell--number">
                          {meal.calories}
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </section>
            <Show when={plan().calendar.length > 0}>
              <section class="feeding-ration__calendar">
                <h3 class="feeding-ration__calendar-title">Календарь введения прикорма</h3>
                <ol class="feeding-ration__calendar-list">
                  <For each={plan().calendar}>
                    {(item) => (
                      <li class="feeding-ration__calendar-item">
                        <b class="feeding-ration__calendar-day">{item.day}</b>
                        {item.instruction}
                      </li>
                    )}
                  </For>
                </ol>
              </section>
            </Show>
            <span class="feeding-ration__emoji" aria-hidden="true">
              👩‍🍼
            </span>
          </article>
        )}
      </Show>

      <div class="calculator-result-actions">
        <Button
          icon={<AppGlyph name="printer" />}
          onClick={() =>
            printCalculationRecord(props.record, attachedResultNoteTitle(notes(), props.record.id))
          }
        >
          Распечатать
        </Button>
        <Button
          icon={<AppGlyph name="share" />}
          onClick={() => {
            void shareCalculationRecord(props.record)
              .then((mode) => {
                props.onMessage(
                  mode === 'shared' ? 'Расчёт передан.' : 'Расчёт скопирован в буфер обмена.',
                );
              })
              .catch(() => props.onMessage('Не удалось поделиться расчётом.'));
          }}
        >
          Поделиться
        </Button>
        <Button
          variant="primary"
          icon={<AppGlyph name="notes" />}
          data-testid="calculator-save-note"
          onClick={() => setNoteOpen((open) => !open)}
        >
          Записать
        </Button>
        <Button variant="danger" icon={<AppGlyph name="trash" />} onClick={props.onDelete}>
          Удалить
        </Button>
      </div>

      <OverlayDialog
        open={detailsOpen() !== null}
        title={detailsOpen() === 'formula' ? 'Формула и шаги' : 'Источники и ограничения'}
        onClose={() => setDetailsOpen(null)}
      >
        <Show when={detailsOpen() === 'formula'}>
          <p>{props.record.result.formula}</p>
          <ol class="calculator-trace">
            <For each={props.record.result.trace}>
              {(step) => (
                <li>
                  <strong>{step.label}</strong>
                  <code>{step.expression}</code>
                  <span>
                    {formatNumber(step.value, 8)} {step.unit}
                  </span>
                </li>
              )}
            </For>
          </ol>
        </Show>
        <Show when={detailsOpen() === 'sources'}>
          <p>{props.definition.population}</p>
          <ul>
            <For each={props.definition.limitations}>{(limitation) => <li>{limitation}</li>}</For>
          </ul>
          <For each={props.definition.sources}>
            {(source) => (
              <p class="calculator-source-reference">
                <Show
                  when={source.url}
                  fallback={<span class="calculator-source-reference__title">{source.title}</span>}
                >
                  <a
                    class="calculator-source-reference__link"
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {source.title}
                  </a>
                </Show>{' '}
                · {source.publisher} · {source.version} · проверено {source.reviewedAt}
              </p>
            )}
          </For>
        </Show>
      </OverlayDialog>

      <Show when={noteOpen()}>
        <div class="calculator-note-panel">
          <label>
            <span>Существующая карточка</span>
            <select
              class="calculator-note-panel__select"
              value={selectedCardId()}
              onChange={(event) => setSelectedCardId(event.currentTarget.value)}
            >
              <option value="">Создать новую карточку</option>
              <For each={notes().cards}>
                {(card) => <option value={card.id}>{card.title}</option>}
              </For>
            </select>
          </label>
          <Show when={!selectedCardId()}>
            <label>
              <span>Название новой карточки</span>
              <input
                class="calculator-note-panel__input"
                value={newCardTitle()}
                placeholder={props.record.subjectLabel || 'Пациент'}
                onInput={(event) => setNewCardTitle(event.currentTarget.value)}
              />
            </label>
          </Show>
          <Button
            type="button"
            class="calculator-note-panel__save"
            variant="primary"
            onClick={saveToNote}
          >
            Записать результат
          </Button>
        </div>
      </Show>
    </section>
  );
}

export function CalculatorsView(): JSX.Element {
  const [route, setRoute] = createSignal(currentRoute());
  const [query, setQuery] = createSignal('');
  const [installation, setInstallation] = createSignal<CalculatorInstallationState>(
    loadCalculatorInstallationState(CALCULATOR_REGISTRY),
  );
  const [calculatorRegistry, setCalculatorRegistry] = createSignal(CALCULATOR_REGISTRY);
  const [history, setHistory] = createSignal<readonly CalculationRecord[]>(
    loadCalculationHistory(),
  );
  const [activeRecord, setActiveRecord] = createSignal<CalculationRecord>();
  const [pendingDeletion, setPendingDeletion] = createSignal<{
    readonly kind: 'section' | 'record';
    readonly id: string;
    readonly title: string;
  } | null>(null);
  const refresh = (): void => {
    const next = currentRoute();
    // Every root tab shares one global location.hash, and this view stays mounted (hidden, not
    // unmounted) while another tab is active — a hashchange for a different tab is not our concern.
    // Reacting to it would null out `selected()` and unmount the open CalculatorForm, silently
    // discarding whatever the user had already typed in.
    if (next !== '' && !next.startsWith('calculators')) return;
    if (!document.documentElement.classList.contains('using-root-view-transition')) {
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
    setRoute(next);
  };
  const refreshInstallation = (): void => {
    setInstallation(loadCalculatorInstallationState(calculatorRegistry()));
  };
  let downloadedToolsRefresh: Promise<void> | undefined;
  const refreshDownloadedTools = (): Promise<void> => {
    if (downloadedToolsRefresh) return downloadedToolsRefresh;
    downloadedToolsRefresh = (async () => {
      const runtime = getContentModuleRuntime(MODULE_CATALOG);
      await runtime.whenLocalPackagedModulesReady();
      const definitions = await runtime.listInstalledToolDefinitions();
      clearDownloadedCalculators();
      definitions.forEach(registerDownloadedCalculator);
      const next = getCalculatorRegistry();
      setCalculatorRegistry(next);
      setDatabaseCalculatorIds(
        definitions
          .filter((definition) => definition.kind === 'calculator')
          .map((definition) => definition.id),
      );
      setInstallation(loadCalculatorInstallationState(next));
    })().finally(() => {
      downloadedToolsRefresh = undefined;
    });
    return downloadedToolsRefresh;
  };
  let unsubscribeToolTasks: (() => void) | undefined;
  const handleStorage = (event: StorageEvent): void => {
    if (!event.key || event.key === 'minimed.calculator-packs.v1') refreshInstallation();
  };
  const clearProtectedResult = (): void => {
    if (activeRecord()?.patientId) setActiveRecord(undefined);
  };
  onMount(() => {
    window.addEventListener('hashchange', refresh);
    window.addEventListener('storage', handleStorage);
    window.addEventListener(CALCULATOR_PACKS_EVENT, refreshInstallation);
    window.addEventListener(PATIENT_VAULT_LOCK_EVENT, clearProtectedResult);
    unsubscribeToolTasks = getContentModuleRuntime(MODULE_CATALOG).subscribe((task) => {
      if (task.state === 'completed') void refreshDownloadedTools();
    });
    void refreshDownloadedTools();
  });
  onCleanup(() => window.removeEventListener('hashchange', refresh));
  onCleanup(() => window.removeEventListener('storage', handleStorage));
  onCleanup(() => window.removeEventListener(CALCULATOR_PACKS_EVENT, refreshInstallation));
  onCleanup(() => window.removeEventListener(PATIENT_VAULT_LOCK_EVENT, clearProtectedResult));
  onCleanup(() => unsubscribeToolTasks?.());
  const notify = (text: string): void => {
    toast(text, { duration: 3200 });
  };

  const slug = createMemo(() => route().split('/')[1] ?? '');
  const selectedSection = createMemo(() => {
    const parts = route().split('/');
    if (parts[1] !== 'section') return undefined;
    return CALCULATOR_SECTIONS.find((section) => section.id === parts[2]);
  });
  const routeDefinition = createMemo(() => {
    calculatorRegistry();
    return slug() ? findCalculator(slug()) : undefined;
  });
  const selected = createMemo<AvailableCalculatorDefinition | undefined>(() => {
    const definition = routeDefinition();
    return definition?.state === 'available' && installation().installedIds.has(definition.id)
      ? definition
      : undefined;
  });
  const filtered = createMemo(() => {
    calculatorRegistry();
    return searchCalculators(query());
  });

  const openCalculator = (definition: AvailableCalculatorDefinition): void => {
    setActiveRecord(undefined);
    window.location.hash = `#/calculators/${definition.slug}`;
  };

  const backToCatalog = (): void => {
    setActiveRecord(undefined);
    window.location.hash = '#/calculators';
  };

  const backFromCalculator = (): void => {
    const definition = selected();
    setActiveRecord(undefined);
    if (definition?.state === 'available') {
      window.location.hash = calculatorSectionPath(definition.category);
      return;
    }
    backToCatalog();
  };

  const openSection = (sectionId: CalculatorSectionId): void => {
    setQuery('');
    window.location.hash = calculatorSectionPath(sectionId);
  };

  const installToolModule = async (moduleId: string | undefined): Promise<void> => {
    if (!moduleId) return;
    const runtime = getContentModuleRuntime(MODULE_CATALOG);
    if (runtime.listInstalled().some((item) => item.moduleId === moduleId)) return;
    const module = MODULE_CATALOG.modules.find((entry) => entry.id === moduleId);
    if (!module) throw new Error('Модуль инструментов не найден в каталоге.');
    const task = runtime.install(module);
    const completed = await runtime.wait(task.id);
    if (completed.state !== 'completed') {
      throw new Error('Не удалось скачать модуль инструментов.');
    }
    await refreshDownloadedTools();
  };

  const installSection = (sectionId: CalculatorSectionId): void => {
    const moduleId = moduleIdForCalculatorSection(sectionId);
    const hasBundledCalculator = calculatorsInSection(sectionId, calculatorRegistry()).some(
      (definition) => definition.state === 'available',
    );
    if (!moduleId && !hasBundledCalculator) return;
    void (async () => {
      try {
        notify('Скачиваем модуль…');
        await installToolModule(moduleId);
        setInstallation(installCalculatorSection(sectionId));
        const section = CALCULATOR_SECTIONS.find((candidate) => candidate.id === sectionId);
        notify(`«${section?.title ?? 'Раздел'}» скачан. Инструменты доступны офлайн.`);
      } catch (cause) {
        notify(cause instanceof Error ? cause.message : 'Не удалось скачать раздел.');
      }
    })();
  };
  const requestInstallCalculator = (definition: AvailableCalculatorDefinition): void => {
    void (async () => {
      try {
        notify('Скачиваем модуль…');
        await installToolModule(moduleIdForCalculatorSection(definition.category));
        setInstallation(installCalculator(definition.id));
        notify(`«${definition.title}» скачан. Инструмент доступен офлайн.`);
      } catch (cause) {
        notify(cause instanceof Error ? cause.message : 'Не удалось скачать инструмент.');
      }
    })();
  };

  const removeSection = (sectionId: CalculatorSectionId): void => {
    const section = CALCULATOR_SECTIONS.find((candidate) => candidate.id === sectionId);
    if (section) setPendingDeletion({ kind: 'section', id: sectionId, title: section.title });
  };

  const requestDeleteRecord = (record: CalculationRecord): void => {
    const definition = findCalculator(record.calculatorId);
    setPendingDeletion({
      kind: 'record',
      id: record.id,
      title: definition?.state === 'available' ? definition.shortTitle : 'Расчёт',
    });
  };

  const confirmDeletion = (): void => {
    const pending = pendingDeletion();
    setPendingDeletion(null);
    if (!pending) return;
    if (pending.kind === 'section') {
      setInstallation(removeCalculatorSection(pending.id as CalculatorSectionId));
      notify('Раздел удалён. История расчётов сохранена.');
      return;
    }
    setHistory(deleteCalculationRecord(pending.id));
    setActiveRecord(undefined);
    notify('Расчёт удалён.');
  };

  const openHistoryRecord = (record: CalculationRecord): void => {
    const definition = findCalculator(record.calculatorId);
    if (definition?.state !== 'available') return;
    setActiveRecord(record);
    window.location.hash = `#/calculators/${definition.slug}`;
  };

  return (
    <section class="calculators-page page-surface page-grain" aria-label="Медицинские калькуляторы">
      <Show
        when={selected()}
        fallback={
          <Show
            when={selectedSection()}
            fallback={
              <Show
                when={
                  routeDefinition()?.state === 'available' &&
                  !installation().installedIds.has(routeDefinition()?.id ?? '')
                    ? routeDefinition()
                    : undefined
                }
                fallback={
                  <>
                    <header class="subpage-heading calculators-heading">
                      <div>
                        <p class="archive-kicker">Разделы инструментов</p>
                        <Heading depth={1}>Калькуляторы</Heading>
                        <p>
                          Скачайте нужный раздел на устройство. После этого его инструменты работают
                          без сети, а каждый результат сохраняется с формулой и границами
                          применения.
                        </p>
                      </div>
                    </header>

                    <SearchField
                      class="calculator-search"
                      value={query()}
                      onInput={setQuery}
                      label="Поиск калькуляторов"
                      hideLabel
                      placeholder="Например: СКФ, 4-2-1, ППТ"
                    />

                    <Show when={filtered().length > 0} fallback={<QueryEmptyState />}>
                      <div class="calculator-section-list">
                        <For
                          each={CALCULATOR_SECTIONS.filter(
                            (section) => calculatorsInSection(section.id, filtered()).length > 0,
                          )}
                        >
                          {(section) => (
                            <CalculatorSectionCard
                              section={section}
                              installation={installation()}
                              definitions={calculatorRegistry()}
                              onOpenSection={openSection}
                              onInstall={installSection}
                              onRemove={removeSection}
                            />
                          )}
                        </For>
                      </div>
                    </Show>

                    <Show when={history().length > 0}>
                      <section class="calculator-history">
                        <h2>Последние расчёты</h2>
                        <div>
                          <For each={history()}>
                            {(record) => (
                              <button type="button" onClick={() => openHistoryRecord(record)}>
                                <strong>
                                  {findCalculator(record.calculatorId, calculatorRegistry())
                                    ?.title ?? record.calculatorId}
                                </strong>
                                <span>{record.subjectLabel || record.inputSummary}</span>
                                <small>
                                  {new Intl.DateTimeFormat('ru-RU', {
                                    dateStyle: 'short',
                                    timeStyle: 'short',
                                  }).format(new Date(record.createdAt))}
                                </small>
                              </button>
                            )}
                          </For>
                        </div>
                      </section>
                    </Show>
                  </>
                }
              >
                {(definition) => {
                  const section = CALCULATOR_SECTIONS.find(
                    (candidate) => candidate.id === definition().category,
                  );
                  return (
                    <section class="calculator-pack-required paper-card" role="status">
                      <p class="archive-kicker">{section?.title ?? 'Раздел калькуляторов'}</p>
                      <Heading depth={3}>{definition().title}</Heading>
                      <p>
                        Этот инструмент входит в скачиваемый раздел. Сначала скачайте раздел, затем
                        откройте калькулятор без сети.
                      </p>
                      <div>
                        <Button
                          icon={<AppGlyph name="download" />}
                          onClick={() => installSection(definition().category)}
                        >
                          Скачать
                        </Button>
                        <Button
                          variant="quiet"
                          icon={<AppGlyph name="arrow-left" />}
                          onClick={backToCatalog}
                        >
                          К разделам
                        </Button>
                      </div>
                    </section>
                  );
                }}
              </Show>
            }
          >
            {(section) => (
              <CalculatorSectionPage
                section={section()}
                installation={installation()}
                definitions={calculatorRegistry()}
                onOpen={openCalculator}
                onBack={backToCatalog}
                onInstall={installSection}
                onInstallCalculator={requestInstallCalculator}
                onRemove={removeSection}
              />
            )}
          </Show>
        }
      >
        {(definition) => (
          <div class="calculator-workspace">
            <header class="calculator-subpage-header">
              <NavBack
                class="knowledge-back-button"
                aria-label="К каталогу калькуляторов"
                onClick={backFromCalculator}
              />
              <div class="calculator-subpage-header__content">
                <AppBreadcrumbs
                  items={calculatorWorkspaceCrumbs({
                    title: definition().title,
                    sectionId: definition().category,
                    sectionTitle:
                      CALCULATOR_SECTIONS.find((section) => section.id === definition().category)
                        ?.title ?? 'Раздел калькуляторов',
                  })}
                  onNavigate={(href) => {
                    window.location.hash = href;
                  }}
                />
                <Heading depth={3} class="calculator-subpage-title">
                  {definition().title}
                </Heading>
                <p class="calculator-subpage-summary">{definition().summary}</p>
              </div>
            </header>

            <Show
              when={definition().id === ECG_PHOTO_CALIPER_ID}
              fallback={
                <CalculatorForm
                  definition={definition()}
                  onMessage={notify}
                  onRecord={(record) => {
                    setActiveRecord(record);
                    setHistory(loadCalculationHistory());
                  }}
                />
              }
            >
              <EcgPhotoCaliper />
            </Show>

            <Show when={activeRecord()}>
              {(record) => (
                <CalculationResultPanel
                  record={record()}
                  definition={definition()}
                  onMessage={notify}
                  onDelete={() => {
                    requestDeleteRecord(record());
                  }}
                />
              )}
            </Show>
          </div>
        )}
      </Show>

      <ConfirmationDialog
        open={pendingDeletion() !== null}
        title="Удалить?"
        description={`«${pendingDeletion()?.title ?? ''}» будет удалён. Это действие нельзя отменить.`}
        confirmLabel="Удалить"
        danger
        onConfirm={confirmDeletion}
        onOpenChange={(open) => {
          if (!open) setPendingDeletion(null);
        }}
      />
    </section>
  );
}
