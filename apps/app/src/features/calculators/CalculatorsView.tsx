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
import { QueryEmptyState } from '@/components/QueryEmptyState';
import { SearchField } from '@/components/SearchField';
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
  formatCalculationRecord,
  printCalculationRecord,
  shareCalculationRecord,
} from '@/features/calculators/calculator-print';
import {
  CALCULATOR_REGISTRY,
  clearDownloadedCalculators,
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
import {
  convertQuantity,
  type QuantityFamily,
  unitsForFamily,
} from '@/features/calculators/unit-conversion';
import { MODULE_CATALOG } from '@/features/modules/module-catalog';
import { getContentModuleRuntime } from '@/features/modules/module-runtime-service';
import {
  type CalculationRecord,
  createCalculationRecord,
  deleteCalculationRecord,
  loadCalculationHistory,
  saveCalculationRecord,
} from '@/state/calculation-history';
import { addPatientNote, createPatientCard, loadPatientNotes } from '@/state/patient-notes';

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
          <h1>{props.section.title}</h1>
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
  const [value, setValue] = createSignal('');
  const [family, setFamily] = createSignal<QuantityFamily>('mass');
  const [fromUnit, setFromUnit] = createSignal('kg');
  const [toUnit, setToUnit] = createSignal('g');
  // Generic input store for every schema-driven calculator (CALCULATOR_SCHEMA_BY_ID) — one field per
  // `schema.inputs[].id`, rendered dynamically below. Adding a new schema calculator needs no new signal.
  const [schemaValues, setSchemaValues] = createSignal<Record<string, string>>({});
  const [schemaStep, setSchemaStep] = createSignal(0);
  const [schemaPreview, setSchemaPreview] = createSignal<CalculatorSchemaEvaluation>();
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

  const submit = (): void => {
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
      const record = createCalculationRecord({
        calculatorId: props.definition.id,
        subjectLabel: subjectLabel(),
        inputSummary,
        result,
      });
      saveCalculationRecord(record);
      props.onRecord(record);
      props.onMessage('Расчёт сохранён локально.');
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

    const record = createCalculationRecord({
      calculatorId: props.definition.id,
      subjectLabel: subjectLabel(),
      inputSummary,
      result,
    });
    saveCalculationRecord(record);
    props.onRecord(record);
    props.onMessage('Расчёт сохранён локально.');
  };

  return (
    <form
      class="calculator-form paper-card"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <label class="calculator-wide-field">
        <span>Пациент / случай — необязательно</span>
        <input
          list="calculator-patient-suggestions"
          value={subjectLabel()}
          placeholder="Имя, номер карты или псевдоним"
          onInput={(event) => setSubjectLabel(event.currentTarget.value)}
        />
        <datalist id="calculator-patient-suggestions">
          <For each={loadPatientNotes().cards}>{(card) => <option value={card.title} />}</For>
        </datalist>
      </label>

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
            inputmode="decimal"
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
              <label>
                <span>
                  {input.label}
                  {input.unit ? `, ${input.unit}` : ''}
                  {input.note ? ` — ${input.note}` : ''}
                </span>
                <Show
                  when={(input.options?.length ?? 0) > 0}
                  fallback={
                    <Show
                      when={input.kind === 'date'}
                      fallback={
                        <input
                          inputmode="decimal"
                          value={schemaValues()[input.id] ?? ''}
                          onInput={(event) => setSchemaValue(input.id, event.currentTarget.value)}
                        />
                      }
                    >
                      <input
                        type="date"
                        value={schemaValues()[input.id] ?? ''}
                        onInput={(event) => setSchemaValue(input.id, event.currentTarget.value)}
                      />
                    </Show>
                  }
                >
                  <select
                    class="calculator-form__select"
                    value={schemaValues()[input.id] ?? String(input.options?.[0]?.value ?? '')}
                    onChange={(event) => setSchemaValue(input.id, event.currentTarget.value)}
                  >
                    <For each={input.options ?? []}>
                      {(option) => <option value={String(option.value)}>{option.label}</option>}
                    </For>
                  </select>
                </Show>
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
                {(output) => (
                  <div>
                    <span>{output.label}</span>
                    <strong>
                      {output.kind === 'text'
                        ? output.text
                        : `${formatNumber(output.value, output.displayPrecision)} ${output.unit}`}
                    </strong>
                  </div>
                )}
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

  const outputs = (): readonly { readonly label: string; readonly display: string }[] => {
    const result = props.record.result;
    if ('textValues' in result) {
      return result.textValues.map((item) => ({ label: item.label, display: item.text }));
    }
    if ('value' in result) {
      return [
        {
          label: 'Результат',
          display: `${formatNumber(result.value, result.displayPrecision)} ${result.unit}`,
        },
      ];
    }
    return result.values.map((item) => ({
      label: item.label,
      display: `${formatNumber(item.value, item.displayPrecision)} ${item.unit}`,
    }));
  };

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
    setNotes(addPatientNote(cardId, formatCalculationRecord(props.record)));
    setNoteOpen(false);
    props.onMessage('Расчёт записан в карточку пациента.');
  };

  return (
    <section class="calculator-result paper-card" data-testid="calculator-result">
      <header>
        <p class="archive-kicker">Результат сохранён локально</p>
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
          <For each={props.record.result.warnings}>{(warning) => <p>{warning.message}</p>}</For>
        </div>
      </Show>

      <div class="calculator-result-actions">
        <Button
          icon={<AppGlyph name="printer" />}
          onClick={() => printCalculationRecord(props.record)}
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
              <p>
                <a href={source.url} target="_blank" rel="noreferrer">
                  {source.title}
                </a>{' '}
                · {source.version} · проверено {source.reviewedAt}
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
    void refreshDownloadedTools();
  };
  const refreshInstallation = (): void => {
    setInstallation(loadCalculatorInstallationState(calculatorRegistry()));
  };
  const refreshDownloadedTools = async (): Promise<void> => {
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
  };
  let unsubscribeToolTasks: (() => void) | undefined;
  const handleStorage = (event: StorageEvent): void => {
    if (!event.key || event.key === 'minimed.calculator-packs.v1') refreshInstallation();
  };
  onMount(() => {
    window.addEventListener('hashchange', refresh);
    window.addEventListener('storage', handleStorage);
    window.addEventListener(CALCULATOR_PACKS_EVENT, refreshInstallation);
    unsubscribeToolTasks = getContentModuleRuntime(MODULE_CATALOG).subscribe((task) => {
      if (task.state === 'completed') void refreshDownloadedTools();
    });
    void refreshDownloadedTools();
  });
  onCleanup(() => window.removeEventListener('hashchange', refresh));
  onCleanup(() => window.removeEventListener('storage', handleStorage));
  onCleanup(() => window.removeEventListener(CALCULATOR_PACKS_EVENT, refreshInstallation));
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
  const routeDefinition = createMemo(() => (slug() ? findCalculator(slug()) : undefined));
  const selected = createMemo<AvailableCalculatorDefinition | undefined>(() => {
    const definition = routeDefinition();
    return definition?.state === 'available' && installation().installedIds.has(definition.id)
      ? definition
      : undefined;
  });
  const filtered = createMemo(() => searchCalculators(query()));

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
                        <h1>Калькуляторы</h1>
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
                                  {findCalculator(record.calculatorId)?.title ??
                                    record.calculatorId}
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
                      <h1>{definition().title}</h1>
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
                <h1 class="calculator-subpage-title">{definition().title}</h1>
                <p class="calculator-subpage-summary">{definition().summary}</p>
              </div>
            </header>

            <CalculatorForm
              definition={definition()}
              onMessage={notify}
              onRecord={(record) => {
                setActiveRecord(record);
                setHistory(loadCalculationHistory());
              }}
            />

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
