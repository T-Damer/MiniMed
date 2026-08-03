import {
  createMemo,
  createSignal,
  For,
  type JSX,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
} from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import {
  formatCalculationRecord,
  printCalculationRecord,
  shareCalculationRecord,
} from '@/features/calculators/calculator-print';
import { findCalculator, searchCalculators } from '@/features/calculators/calculator-registry';
import type { AvailableCalculatorDefinition } from '@/features/calculators/calculator-types';
import {
  type ClinicalCalculationResult,
  type CreatinineUnit,
  calculateAdultEgfrCkdEpi2021,
  calculateMostellerBsa,
  calculatePediatricEgfrSchwartz2009,
  calculatePediatricMaintenanceFluids,
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
  type StoredCalculationResult,
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

function isSuccessfulResult(value: ClinicalCalculationResult): value is StoredCalculationResult {
  return value.ok;
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
    setFamily(next);
    const units = unitsForFamily(next);
    setFromUnit(units[0] ?? '');
    setToUnit(units[1] ?? units[0] ?? '');
  };

  const submit = (): void => {
    let result: StoredCalculationResult | undefined;
    let inputSummary = '';

    if (props.definition.id === 'unit-conversion') {
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
    } else {
      let clinical: ClinicalCalculationResult;
      switch (props.definition.id) {
        case 'body-surface-area-mosteller':
          clinical = calculateMostellerBsa({
            heightCm: parseNumber(heightCm()),
            weightKg: parseNumber(weightKg()),
          });
          inputSummary = `рост ${heightCm()} см, масса ${weightKg()} кг`;
          break;
        case 'adult-egfr-ckd-epi-2021':
          clinical = calculateAdultEgfrCkdEpi2021({
            ageYears: parseNumber(ageYears()),
            sex: sex(),
            creatinine: parseNumber(creatinine()),
            creatinineUnit: creatinineUnit(),
          });
          inputSummary = `возраст ${ageYears()} лет, пол ${sex() === 'female' ? 'женский' : 'мужской'}, креатинин ${creatinine()} ${creatinineUnit() === 'umol/l' ? 'мкмоль/л' : 'мг/дл'}`;
          break;
        case 'pediatric-egfr-schwartz-2009':
          clinical = calculatePediatricEgfrSchwartz2009({
            ageYears: parseNumber(ageYears()),
            heightCm: parseNumber(heightCm()),
            creatinine: parseNumber(creatinine()),
            creatinineUnit: creatinineUnit(),
          });
          inputSummary = `возраст ${ageYears()} лет, рост ${heightCm()} см, креатинин ${creatinine()} ${creatinineUnit() === 'umol/l' ? 'мкмоль/л' : 'мг/дл'}`;
          break;
        case 'pediatric-maintenance-fluids':
          clinical = calculatePediatricMaintenanceFluids({ weightKg: parseNumber(weightKg()) });
          inputSummary = `масса ${weightKg()} кг`;
          break;
        default:
          props.onMessage('Этот калькулятор пока недоступен.');
          return;
      }
      if (!isSuccessfulResult(clinical)) {
        props.onMessage(clinical.error);
        return;
      }
      result = clinical;
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
          value={subjectLabel()}
          placeholder="Имя, номер карты или псевдоним"
          onInput={(event) => setSubjectLabel(event.currentTarget.value)}
        />
      </label>

      <Switch>
        <Match when={props.definition.id === 'unit-conversion'}>
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
        </Match>

        <Match when={props.definition.id === 'body-surface-area-mosteller'}>
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
        </Match>

        <Match when={props.definition.id === 'adult-egfr-ckd-epi-2021'}>
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
        </Match>

        <Match when={props.definition.id === 'pediatric-egfr-schwartz-2009'}>
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
        </Match>

        <Match when={props.definition.id === 'pediatric-maintenance-fluids'}>
          <label>
            <span>Масса, кг</span>
            <input
              inputmode="decimal"
              value={weightKg()}
              onInput={(event) => setWeightKg(event.currentTarget.value)}
            />
          </label>
        </Match>
      </Switch>

      <button class="calculator-submit" type="submit" data-testid="calculator-submit">
        Рассчитать и сохранить
      </button>
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
  const [selectedCardId, setSelectedCardId] = createSignal('');
  const [newCardTitle, setNewCardTitle] = createSignal('');

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
    const next = addPatientNote(cardId, formatCalculationRecord(props.record));
    setNotes(next);
    props.onMessage('Расчёт записан в карточку пациента.');
    setNoteOpen(false);
  };

  return (
    <section class="calculator-result paper-card" data-testid="calculator-result">
      <header>
        <p class="archive-kicker">Результат сохранён локально</p>
        <h2>{props.definition.shortTitle}</h2>
        <small>{props.record.inputSummary}</small>
      </header>

      <div class="calculator-output-list">
        <Show
          when={'value' in props.record.result}
          fallback={
            <For each={'values' in props.record.result ? props.record.result.values : []}>
              {(item) => (
                <div>
                  <span>{item.label}</span>
                  <strong>
                    {formatNumber(item.value, item.displayPrecision)} {item.unit}
                  </strong>
                </div>
              )}
            </For>
          }
        >
          <div>
            <span>Результат</span>
            <strong>
              {'value' in props.record.result
                ? `${formatNumber(props.record.result.value, props.record.result.displayPrecision)} ${props.record.result.unit}`
                : ''}
            </strong>
          </div>
        </Show>
      </div>

      <details>
        <summary>Формула и промежуточные шаги</summary>
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
      </details>

      <Show when={props.record.result.warnings.length > 0}>
        <div class="calculator-warnings">
          <For each={props.record.result.warnings}>{(warning) => <p>{warning.message}</p>}</For>
        </div>
      </Show>

      <details>
        <summary>Источники и границы применения</summary>
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
      </details>

      <div class="calculator-result-actions">
        <button type="button" onClick={() => printCalculationRecord(props.record)}>
          Распечатать / PDF
        </button>
        <button
          type="button"
          onClick={() => {
            void shareCalculationRecord(props.record)
              .then((mode) =>
                props.onMessage(
                  mode === 'shared' ? 'Расчёт передан.' : 'Расчёт скопирован в буфер обмена.',
                ),
              )
              .catch(() => props.onMessage('Не удалось поделиться расчётом.'));
          }}
        >
          Поделиться
        </button>
        <button
          type="button"
          data-testid="calculator-save-note"
          onClick={() => setNoteOpen((open) => !open)}
        >
          Записать в заметку
        </button>
        <button type="button" onClick={props.onDelete}>
          Удалить
        </button>
      </div>

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
  const [history, setHistory] = createSignal<readonly CalculationRecord[]>(
    loadCalculationHistory(),
  );
  const [activeRecord, setActiveRecord] = createSignal<CalculationRecord>();
  const [message, setMessage] = createSignal('');
  let messageTimer: ReturnType<typeof setTimeout> | undefined;

  const refresh = (): void => setRoute(currentRoute());
  onMount(() => window.addEventListener('hashchange', refresh));
  onCleanup(() => window.removeEventListener('hashchange', refresh));
  onCleanup(() => {
    if (messageTimer) clearTimeout(messageTimer);
  });

  const notify = (text: string): void => {
    setMessage(text);
    if (messageTimer) clearTimeout(messageTimer);
    messageTimer = setTimeout(() => setMessage(''), 3200);
  };

  const slug = createMemo(() => route().split('/')[1] ?? '');
  const selected = createMemo(() => {
    const definition = slug() ? findCalculator(slug()) : undefined;
    return definition?.state === 'available' ? definition : undefined;
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

  return (
    <main class="calculators-page">
      <Show when={message()}>{(text) => <div class="calculator-message">{text()}</div>}</Show>

      <Show
        when={selected()}
        fallback={
          <>
            <header class="subpage-heading calculators-heading">
              <div>
                <p class="archive-kicker">Клинические инструменты с явными формулами</p>
                <h1>Медицинские калькуляторы</h1>
                <p>
                  Единицы, промежуточные шаги, версия источника и границы применения сохраняются
                  вместе с результатом.
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

            <div class="calculator-catalog-grid">
              <For each={filtered()}>
                {(definition) => (
                  <article class="calculator-card paper-card">
                    <div class="calculator-card-meta">
                      <span>
                        {definition.audience === 'adult'
                          ? 'Взрослые'
                          : definition.audience === 'pediatric'
                            ? 'Дети'
                            : 'Все'}
                      </span>
                      <span>{definition.clinical ? 'Клинический' : 'Служебный'}</span>
                      <span>{definition.state === 'available' ? 'Доступен' : 'В плане'}</span>
                    </div>
                    <h2>{definition.title}</h2>
                    <p>{definition.summary}</p>
                    <Show
                      when={definition.state === 'available'}
                      fallback={
                        <small>
                          {definition.state === 'planned' ? definition.sourceRequirement : ''}
                        </small>
                      }
                    >
                      {(available) => (
                        <button
                          type="button"
                          data-testid={`calculator-open-${available().slug}`}
                          onClick={() => openCalculator(available())}
                        >
                          Открыть
                        </button>
                      )}
                    </Show>
                  </article>
                )}
              </For>
            </div>

            <Show when={history().length > 0}>
              <section class="calculator-history">
                <h2>Последние расчёты</h2>
                <div>
                  <For each={history()}>
                    {(record) => {
                      const definition = findCalculator(record.calculatorId);
                      return (
                        <Show when={definition?.state === 'available' ? definition : undefined}>
                          {(available) => (
                            <button
                              type="button"
                              onClick={() => {
                                setActiveRecord(record);
                                window.location.hash = `#/calculators/${available().slug}`;
                              }}
                            >
                              <strong>{available().shortTitle}</strong>
                              <span>{record.subjectLabel || record.inputSummary}</span>
                              <small>
                                {new Intl.DateTimeFormat('ru-RU', {
                                  dateStyle: 'short',
                                  timeStyle: 'short',
                                }).format(new Date(record.createdAt))}
                              </small>
                            </button>
                          )}
                        </Show>
                      );
                    }}
                  </For>
                </div>
              </section>
            </Show>
          </>
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
                  {definition().audience === 'adult'
                    ? 'Взрослые'
                    : definition().audience === 'pediatric'
                      ? 'Педиатрия'
                      : 'Общие расчёты'}
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
                    setHistory(deleteCalculationRecord(record().id));
                    setActiveRecord(undefined);
                    notify('Расчёт удалён.');
                  }}
                />
              )}
            </Show>
          </div>
        )}
      </Show>
    </main>
  );
}
