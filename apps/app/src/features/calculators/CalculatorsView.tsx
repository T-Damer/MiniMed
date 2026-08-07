import { createMemo, createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { ConfirmationDialog } from '@/components/ConfirmationDialog';
import { OverlayDialog } from '@/components/OverlayDialog';
import type {
  CalculatorInstallationState,
  CalculatorSectionId,
} from '@/features/calculators/calculator-packs';
import {
  CALCULATOR_PACKS_EVENT,
  CALCULATOR_SECTIONS,
  calculatorsInSection,
  installCalculatorSection,
  isCalculatorSectionComplete,
  loadCalculatorInstallationState,
  removeCalculatorSection,
} from '@/features/calculators/calculator-packs';
import {
  formatCalculationRecord,
  printCalculationRecord,
  shareCalculationRecord,
} from '@/features/calculators/calculator-print';
import {
  CALCULATOR_REGISTRY,
  findCalculator,
  searchCalculators,
} from '@/features/calculators/calculator-registry';
import type {
  AvailableCalculatorDefinition,
  CalculatorDefinition,
} from '@/features/calculators/calculator-types';
import {
  type CreatinineUnit,
  calculateAdultEgfrCkdEpi2021,
  calculateMostellerBsa,
  calculatePediatricEgfrSchwartz2009,
  calculatePediatricMaintenanceFluids,
  type StoredCalculationResult,
} from '@/features/calculators/clinical-calculations';
import {
  convertQuantity,
  type QuantityFamily,
  unitsForFamily,
} from '@/features/calculators/unit-conversion';
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

function audienceLabel(definition: CalculatorDefinition): string {
  if (definition.audience === 'adult') return 'Взрослые';
  if (definition.audience === 'pediatric') return 'Дети';
  return 'Все';
}

function CalculatorCard(props: {
  readonly definition: CalculatorDefinition;
  readonly installed: boolean;
  readonly sectionTitle: string;
  readonly onOpen: (definition: AvailableCalculatorDefinition) => void;
}): JSX.Element {
  const definition = props.definition;
  const availableDefinition = (): AvailableCalculatorDefinition | undefined =>
    definition.state === 'available' ? definition : undefined;
  return (
    <Card class="calculator-card">
      <div class="calculator-card-meta">
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
      <h2>{definition.title}</h2>
      <p>{definition.summary}</p>
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
          <small>Скачайте раздел «{props.sectionTitle}», чтобы открыть инструмент.</small>
        ) : null
      ) : (
        <small>{definition.sourceRequirement}</small>
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
            {availableCount() > 0
              ? `${installedCount()}/${availableCount()} скачано на устройство`
              : 'Доступных инструментов пока нет'}
          </small>
        </div>
        <div class="calculator-section-actions">
          <Show
            when={availableCount() > 0}
            fallback={<small>Источники и правила ещё проверяются.</small>}
          >
            <button
              type="button"
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
            >
              <AppGlyph
                class="calculator-section-action-icon"
                name={complete() ? 'trash' : 'download'}
              />
            </button>
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
  readonly onBack: () => void;
  readonly onInstall: (sectionId: CalculatorSectionId) => void;
  readonly onRemove: (sectionId: CalculatorSectionId) => void;
}): JSX.Element {
  const definitions = () => calculatorsInSection(props.section.id, props.definitions);
  const complete = () =>
    isCalculatorSectionComplete(props.section.id, props.installation, props.definitions);

  return (
    <section class="calculator-section-page">
      <header class="calculator-section-page-header">
        <button
          type="button"
          class="calculator-section-back"
          aria-label="К разделам калькуляторов"
          title="К разделам"
          onClick={props.onBack}
        >
          <AppGlyph class="calculator-section-back-icon" name="arrow-left" />
        </button>
        <div>
          <p class="archive-kicker">Раздел инструментов</p>
          <h1>{props.section.title}</h1>
          <p>{props.section.description}</p>
        </div>
        <button
          type="button"
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
        >
          <AppGlyph
            class="calculator-section-action-icon"
            name={complete() ? 'trash' : 'download'}
          />
        </button>
      </header>
      <div class="calculator-catalog-grid">
        <For each={definitions()}>
          {(definition) => (
            <CalculatorCard
              definition={definition}
              installed={props.installation.installedIds.has(definition.id)}
              sectionTitle={props.section.title}
              onOpen={props.onOpen}
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
  const [heightCm, setHeightCm] = createSignal('');
  const [weightKg, setWeightKg] = createSignal('');
  const [ageYears, setAgeYears] = createSignal('');
  const [sex, setSex] = createSignal<'female' | 'male'>('female');
  const [creatinine, setCreatinine] = createSignal('');
  const [creatinineUnit, setCreatinineUnit] = createSignal<CreatinineUnit>('umol/l');

  const changeFamily = (next: QuantityFamily): void => {
    const units = unitsForFamily(next);
    setFamily(next);
    setFromUnit(units[0] ?? '');
    setToUnit(units[1] ?? units[0] ?? '');
  };

  const submit = (): void => {
    let result: StoredCalculationResult;
    let inputSummary: string;

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
      case 'body-surface-area-mosteller': {
        const calculation = calculateMostellerBsa({
          heightCm: parseNumber(heightCm()),
          weightKg: parseNumber(weightKg()),
        });
        if (!calculation.ok) {
          props.onMessage(calculation.error);
          return;
        }
        result = calculation;
        inputSummary = `рост ${heightCm()} см, масса ${weightKg()} кг`;
        break;
      }
      case 'adult-egfr-ckd-epi-2021': {
        const calculation = calculateAdultEgfrCkdEpi2021({
          ageYears: parseNumber(ageYears()),
          sex: sex(),
          creatinine: parseNumber(creatinine()),
          creatinineUnit: creatinineUnit(),
        });
        if (!calculation.ok) {
          props.onMessage(calculation.error);
          return;
        }
        result = calculation;
        inputSummary = `возраст ${ageYears()} лет, пол ${sex() === 'female' ? 'женский' : 'мужской'}, креатинин ${creatinine()} ${creatinineUnit() === 'umol/l' ? 'мкмоль/л' : 'мг/дл'}`;
        break;
      }
      case 'pediatric-egfr-schwartz-2009': {
        const calculation = calculatePediatricEgfrSchwartz2009({
          ageYears: parseNumber(ageYears()),
          heightCm: parseNumber(heightCm()),
          creatinine: parseNumber(creatinine()),
          creatinineUnit: creatinineUnit(),
        });
        if (!calculation.ok) {
          props.onMessage(calculation.error);
          return;
        }
        result = calculation;
        inputSummary = `возраст ${ageYears()} лет, рост ${heightCm()} см, креатинин ${creatinine()} ${creatinineUnit() === 'umol/l' ? 'мкмоль/л' : 'мг/дл'}`;
        break;
      }
      case 'pediatric-maintenance-fluids': {
        const calculation = calculatePediatricMaintenanceFluids({
          weightKg: parseNumber(weightKg()),
        });
        if (!calculation.ok) {
          props.onMessage(calculation.error);
          return;
        }
        result = calculation;
        inputSummary = `масса ${weightKg()} кг`;
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

  const creatinineFields = () => (
    <>
      <label>
        <span>Креатинин</span>
        <input
          inputmode="decimal"
          value={creatinine()}
          onInput={(event) => setCreatinine(event.currentTarget.value)}
        />
      </label>
      <label>
        <span>Единицы креатинина</span>
        <select
          value={creatinineUnit()}
          onChange={(event) => setCreatinineUnit(event.currentTarget.value as CreatinineUnit)}
        >
          <option value="umol/l">мкмоль/л</option>
          <option value="mg/dl">мг/дл</option>
        </select>
      </label>
    </>
  );

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
          <select value={fromUnit()} onChange={(event) => setFromUnit(event.currentTarget.value)}>
            <For each={unitsForFamily(family())}>
              {(unit) => <option value={unit}>{unit}</option>}
            </For>
          </select>
        </label>
        <label>
          <span>В единицу</span>
          <select value={toUnit()} onChange={(event) => setToUnit(event.currentTarget.value)}>
            <For each={unitsForFamily(family())}>
              {(unit) => <option value={unit}>{unit}</option>}
            </For>
          </select>
        </label>
      </Show>

      <Show when={props.definition.id === 'body-surface-area-mosteller'}>
        <label>
          <span>Рост, см</span>
          <input
            inputmode="decimal"
            value={heightCm()}
            onInput={(event) => setHeightCm(event.currentTarget.value)}
          />
        </label>
        <label>
          <span>Масса, кг</span>
          <input
            inputmode="decimal"
            value={weightKg()}
            onInput={(event) => setWeightKg(event.currentTarget.value)}
          />
        </label>
      </Show>

      <Show when={props.definition.id === 'adult-egfr-ckd-epi-2021'}>
        <label>
          <span>Возраст, лет</span>
          <input
            inputmode="decimal"
            value={ageYears()}
            onInput={(event) => setAgeYears(event.currentTarget.value)}
          />
        </label>
        <label>
          <span>Пол в формуле</span>
          <select
            value={sex()}
            onChange={(event) => setSex(event.currentTarget.value as 'female' | 'male')}
          >
            <option value="female">Женский</option>
            <option value="male">Мужской</option>
          </select>
        </label>
        {creatinineFields()}
      </Show>

      <Show when={props.definition.id === 'pediatric-egfr-schwartz-2009'}>
        <label>
          <span>Возраст, лет</span>
          <input
            inputmode="decimal"
            value={ageYears()}
            onInput={(event) => setAgeYears(event.currentTarget.value)}
          />
        </label>
        <label>
          <span>Рост, см</span>
          <input
            inputmode="decimal"
            value={heightCm()}
            onInput={(event) => setHeightCm(event.currentTarget.value)}
          />
        </label>
        {creatinineFields()}
      </Show>

      <Show when={props.definition.id === 'pediatric-maintenance-fluids'}>
        <label>
          <span>Масса, кг</span>
          <input
            inputmode="decimal"
            value={weightKg()}
            onInput={(event) => setWeightKg(event.currentTarget.value)}
          />
        </label>
      </Show>

      <Button
        class="calculator-submit"
        type="submit"
        data-testid="calculator-submit"
        icon={<AppGlyph name="calculator" />}
      >
        Рассчитать и сохранить
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

  const outputs = () => {
    const result = props.record.result;
    return 'value' in result
      ? [
          {
            label: 'Результат',
            value: result.value,
            unit: result.unit,
            displayPrecision: result.displayPrecision,
          },
        ]
      : result.values;
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
              <strong>
                {formatNumber(item.value, item.displayPrecision)} {item.unit}
              </strong>
            </div>
          )}
        </For>
      </div>

      <Button
        variant="quiet"
        icon={<AppGlyph name="list" />}
        onClick={() => setDetailsOpen('formula')}
      >
        Формула и шаги
      </Button>

      <Show when={props.record.result.warnings.length > 0}>
        <div class="calculator-warnings">
          <For each={props.record.result.warnings}>{(warning) => <p>{warning.message}</p>}</For>
        </div>
      </Show>

      <Button
        variant="quiet"
        icon={<AppGlyph name="book-open" />}
        onClick={() => setDetailsOpen('sources')}
      >
        Источники и ограничения
      </Button>

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
          variant="quiet"
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
                value={newCardTitle()}
                placeholder={props.record.subjectLabel || 'Пациент'}
                onInput={(event) => setNewCardTitle(event.currentTarget.value)}
              />
            </label>
          </Show>
          <button type="button" onClick={saveToNote}>
            Записать результат
          </button>
        </div>
      </Show>
    </section>
  );
}

export function CalculatorsView(): JSX.Element {
  const [route, setRoute] = createSignal(currentRoute());
  const [query, setQuery] = createSignal('');
  const [installation, setInstallation] = createSignal<CalculatorInstallationState>(
    loadCalculatorInstallationState(),
  );
  const [history, setHistory] = createSignal<readonly CalculationRecord[]>(
    loadCalculationHistory(),
  );
  const [activeRecord, setActiveRecord] = createSignal<CalculationRecord>();
  const [message, setMessage] = createSignal('');
  const [pendingDeletion, setPendingDeletion] = createSignal<{
    readonly kind: 'section' | 'record';
    readonly id: string;
    readonly title: string;
  } | null>(null);
  let messageTimer: ReturnType<typeof setTimeout> | undefined;

  const refresh = (): void => {
    setRoute(currentRoute());
  };
  const refreshInstallation = (): void => {
    setInstallation(loadCalculatorInstallationState());
  };
  const handleStorage = (event: StorageEvent): void => {
    if (!event.key || event.key === 'minimed.calculator-packs.v1') refreshInstallation();
  };
  onMount(() => {
    window.addEventListener('hashchange', refresh);
    window.addEventListener('storage', handleStorage);
    window.addEventListener(CALCULATOR_PACKS_EVENT, refreshInstallation);
  });
  onCleanup(() => window.removeEventListener('hashchange', refresh));
  onCleanup(() => window.removeEventListener('storage', handleStorage));
  onCleanup(() => window.removeEventListener(CALCULATOR_PACKS_EVENT, refreshInstallation));
  onCleanup(() => {
    if (messageTimer) clearTimeout(messageTimer);
  });

  const notify = (text: string): void => {
    setMessage(text);
    if (messageTimer) clearTimeout(messageTimer);
    messageTimer = setTimeout(() => {
      setMessage('');
    }, 3200);
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

  const openSection = (sectionId: CalculatorSectionId): void => {
    setQuery('');
    window.location.hash = `#/calculators/section/${sectionId}`;
  };

  const installSection = (sectionId: CalculatorSectionId): void => {
    setInstallation(installCalculatorSection(sectionId));
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
    <section class="calculators-page page-surface" aria-label="Медицинские калькуляторы">
      <Show when={message()}>{(text) => <div class="calculator-message">{text()}</div>}</Show>

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

                    <label class="calculator-search">
                      <span>Найти калькулятор</span>
                      <input
                        type="search"
                        value={query()}
                        placeholder="Например: СКФ, 4-2-1, ППТ"
                        onInput={(event) => setQuery(event.currentTarget.value)}
                      />
                    </label>

                    <Show
                      when={filtered().length > 0}
                      fallback={<p>По этому запросу ничего не найдено.</p>}
                    >
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
                              definitions={CALCULATOR_REGISTRY}
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
                definitions={CALCULATOR_REGISTRY}
                onOpen={openCalculator}
                onBack={backToCatalog}
                onInstall={installSection}
                onRemove={removeSection}
              />
            )}
          </Show>
        }
      >
        {(definition) => (
          <div class="calculator-workspace">
            <header class="calculator-subpage-header">
              <button type="button" aria-label="К каталогу калькуляторов" onClick={backToCatalog}>
                <AppGlyph name="arrow-left" />
              </button>
              <div>
                <p class="archive-kicker">
                  {
                    CALCULATOR_SECTIONS.find((section) => section.id === definition().category)
                      ?.title
                  }
                  {' · скачано на устройство'}
                </p>
                <h1>{definition().title}</h1>
                <p>{definition().summary}</p>
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
