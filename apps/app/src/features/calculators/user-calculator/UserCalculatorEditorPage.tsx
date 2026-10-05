import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  on,
  onCleanup,
  Show,
} from 'solid-js';
import { AppBreadcrumbs } from '@/components/AppBreadcrumbs';
import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { Checkbox } from '@/components/Checkbox';
import { NavBack } from '@/components/NavBack';
import { Page } from '@/components/Page';
import { SelectField } from '@/components/SelectField';
import { Heading } from '@/components/Text';
import { TextArea } from '@/components/TextArea';
import { TextField } from '@/components/TextField';
import {
  addBand,
  addInput,
  canAddBand,
  canAddInput,
  duplicateInput,
  insertIntoFormula,
  moveInput,
  removeBand,
  removeInput,
  setInputLabel,
  setInputName,
  sortBands,
  updateBand,
  updateInput,
} from '@/features/calculators/user-calculator/user-calculator-edit';
import { USER_CALCULATOR_LIMITS } from '@/features/calculators/user-calculator/user-calculator-limits';
import {
  bandForResult,
  defaultSampleValues,
  formatUserNumber,
  formulaFor,
  previewUserCalculator,
  userCalculatorIssues,
} from '@/features/calculators/user-calculator/user-calculator-schema';
import {
  USER_FORMULA_FUNCTIONS,
  USER_FORMULA_HELP,
  userInputNameError,
} from '@/features/calculators/user-calculator/user-formula';
import { ToolPopulationField } from '@/features/tools/ToolPopulationField';
import { userToolPopulationError } from '@/features/tools/user-tool-population';
import { pluralRu } from '@/i18n/labels';
import {
  getUserCalculator,
  saveUserCalculator,
  type UserCalculator,
  type UserCalculatorInput,
} from '@/state/user-calculators';

import '@/features/calculators/user-calculator/user-calculator.css';

const AUTOSAVE_DELAY_MS = 350;

const DECIMAL_OPTIONS = Array.from({ length: USER_CALCULATOR_LIMITS.decimals + 1 }, (_, count) => ({
  value: String(count),
  label: count === 0 ? 'целое число' : `${count} ${pluralRu(count, 'знак', 'знака', 'знаков')}`,
}));

function numberToText(value: number | undefined): string {
  return value === undefined ? '' : formatUserNumber(value).replace(',', '.');
}

/** A typed number: undefined for an empty field, null for text that is not a number (yet). */
function parseTyped(raw: string): number | undefined | null {
  const text = raw.trim().replace(',', '.');
  if (text === '') return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/**
 * A number field that keeps what the author is typing («-», «2.», «2,5») instead of rewriting it from
 * the model on every keystroke; the model only receives complete numbers, and an empty field means
 * «no limit».
 */
function OptionalNumberField(props: {
  readonly label: string;
  readonly value: number | undefined;
  readonly onChange: (value: number | undefined) => void;
  readonly placeholder?: string;
  readonly hint?: string;
  readonly class?: string;
  readonly testId?: string;
}): JSX.Element {
  const [text, setText] = createSignal(numberToText(props.value));
  createEffect(
    on(
      () => props.value,
      (value) => {
        // Another change of the model (e.g. a sort) wins; the author's own typing does not.
        if (parseTyped(text()) !== value) setText(numberToText(value));
      },
      { defer: true },
    ),
  );
  const invalid = () => parseTyped(text()) === null;
  return (
    <TextField
      class={props.class ?? ''}
      label={props.label}
      type="text"
      inputmode="decimal"
      autocomplete="off"
      value={text()}
      {...(props.placeholder === undefined ? {} : { placeholder: props.placeholder })}
      {...(props.hint === undefined ? {} : { hint: props.hint })}
      {...(props.testId === undefined ? {} : { 'data-testid': props.testId })}
      {...(invalid() ? { error: 'Введите число, например 2,5.' } : {})}
      onInput={(event) => {
        const raw = event.currentTarget.value;
        setText(raw);
        const parsed = parseTyped(raw);
        if (parsed !== null) props.onChange(parsed);
      }}
    />
  );
}

function missingEditor(props: { readonly onBack: () => void }): JSX.Element {
  return (
    <section class="user-calculator-editor__missing paper-card" role="alert">
      <Heading depth={2}>Калькулятор не найден</Heading>
      <p class="user-calculator-editor__missing-text">
        Возможно, он был удалён. Вернитесь к списку своих калькуляторов.
      </p>
      <Button type="button" variant="primary" onClick={props.onBack}>
        К списку
      </Button>
    </section>
  );
}

export function UserCalculatorEditorPage(props: {
  readonly id: string;
  readonly onBack: () => void;
  readonly onOpen: (model: UserCalculator) => void;
  readonly onMessage: (message: string) => void;
}): JSX.Element {
  const initial = getUserCalculator(props.id);
  if (!initial) return missingEditor(props);
  return (
    <CalculatorEditor
      initial={initial}
      onBack={props.onBack}
      onOpen={props.onOpen}
      onMessage={props.onMessage}
    />
  );
}

function CalculatorEditor(props: {
  readonly initial: UserCalculator;
  readonly onBack: () => void;
  readonly onOpen: (model: UserCalculator) => void;
  readonly onMessage: (message: string) => void;
}): JSX.Element {
  const [draft, setDraft] = createSignal(props.initial);
  const [saveState, setSaveState] = createSignal<'saved' | 'saving' | 'error'>('saved');
  const [saveError, setSaveError] = createSignal('');
  const [sample, setSample] = createSignal<Readonly<Record<string, string>>>({});
  const [testValue, setTestValue] = createSignal('');
  let pending: UserCalculator | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let formulaField: HTMLTextAreaElement | undefined;

  const flush = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    const model = pending;
    pending = undefined;
    if (!model) return;
    try {
      saveUserCalculator(model);
      setSaveState(pending === undefined ? 'saved' : 'saving');
      setSaveError('');
    } catch (cause) {
      setSaveState('error');
      setSaveError(cause instanceof Error ? cause.message : 'Не удалось сохранить калькулятор.');
    }
  };
  // Leaving the page (or opening the calculator) never drops the last keystrokes.
  onCleanup(flush);

  const change = (next: UserCalculator): void => {
    setDraft(next);
    pending = next;
    setSaveState('saving');
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(flush, AUTOSAVE_DELAY_MS);
  };

  const issues = createMemo(() => userCalculatorIssues(draft()));
  const errors = () => issues().filter((issue) => issue.severity === 'error');
  const warnings = () => issues().filter((issue) => issue.severity === 'warning');
  const blocking = () => errors()[0]?.message ?? null;
  const formula = createMemo(() => formulaFor(draft()));
  const sampleValues = createMemo(() => ({ ...defaultSampleValues(draft()), ...sample() }));
  const preview = createMemo(() => previewUserCalculator(draft(), sampleValues()));
  const nameError = (input: UserCalculatorInput): string | null =>
    userInputNameError(
      input.name,
      draft()
        .inputs.filter((item) => item.id !== input.id)
        .map((item) => item.name),
    );
  const previewOk = createMemo(() => {
    const result = preview();
    return result.ok ? result : undefined;
  });
  const previewError = (): string => {
    const result = preview();
    return result.ok ? '' : result.error;
  };
  const inputIds = createMemo(() => draft().inputs.map((input) => input.id));
  const bandIds = createMemo(() => draft().bands.map((band) => band.id));
  const testedBand = createMemo(() => {
    const typed = parseTyped(testValue());
    if (typed === undefined || typed === null) return undefined;
    return { value: typed, match: bandForResult(draft(), typed) };
  });

  const insertText = (text: string): void => {
    const field = formulaField;
    const result = insertIntoFormula(
      draft().formula,
      text,
      field?.selectionStart ?? null,
      field?.selectionEnd ?? null,
    );
    change({ ...draft(), formula: result.formula });
    queueMicrotask(() => {
      field?.focus();
      field?.setSelectionRange(result.caret, result.caret);
    });
  };

  const open = (): void => {
    flush();
    if (saveState() === 'error') return;
    props.onOpen(draft());
  };

  return (
    <div class="user-calculator-editor" data-testid="user-calculator-editor">
      <Page
        class="user-calculator-editor__header"
        navigation={
          <NavBack
            class="user-calculator-editor__back"
            aria-label="К моим калькуляторам"
            title="К моим калькуляторам"
            onClick={() => {
              flush();
              props.onBack();
            }}
          />
        }
        breadcrumbs={
          <AppBreadcrumbs
            items={[
              { label: 'Калькуляторы', href: '#/calculators' },
              { label: 'Мои калькуляторы', href: '#/calculators/mine' },
              { label: draft().title || 'Без названия' },
            ]}
            onNavigate={(href) => {
              flush();
              window.location.hash = href;
            }}
          />
        }
        icon={<AppGlyph name="calculator" class="page__icon-glyph" />}
        title={<Heading depth={2}>Редактирование калькулятора</Heading>}
        description={draft().description}
        actions={
          <Button
            type="button"
            variant="primary"
            class="user-calculator-editor__open"
            data-testid="user-calculator-editor-open"
            disabled={blocking() !== null || saveState() === 'error'}
            title={blocking() ?? (saveState() === 'error' ? saveError() : 'Открыть калькулятор')}
            onClick={open}
            icon={<AppGlyph name="calculator" class="user-calculator-editor__icon" />}
          >
            Открыть
          </Button>
        }
      />

      <p
        class="user-calculator-editor__save-state"
        classList={{ 'user-calculator-editor__save-state--error': saveState() === 'error' }}
        role="status"
        data-testid="user-calculator-save-state"
      >
        {saveState() === 'saving'
          ? 'Сохраняем…'
          : saveState() === 'error'
            ? saveError()
            : 'Сохранено'}
      </p>

      <Show when={issues().length > 0}>
        <section
          class="user-calculator-editor__issues paper-card"
          aria-label="Что нужно исправить"
          data-testid="user-calculator-issues"
        >
          <Show when={errors().length > 0}>
            <h2 class="user-calculator-editor__issues-title">Чтобы открыть калькулятор</h2>
            <ul class="user-calculator-editor__issue-list">
              <For each={errors()}>
                {(issue) => (
                  <li class="user-calculator-editor__issue user-calculator-editor__issue--error">
                    {issue.message}
                  </li>
                )}
              </For>
            </ul>
          </Show>
          <Show when={warnings().length > 0}>
            <h2 class="user-calculator-editor__issues-title">Стоит проверить</h2>
            <ul class="user-calculator-editor__issue-list">
              <For each={warnings()}>
                {(issue) => (
                  <li class="user-calculator-editor__issue user-calculator-editor__issue--warning">
                    {issue.message}
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </section>
      </Show>

      <section class="user-calculator-editor__section paper-card" aria-label="Основное">
        <h2 class="user-calculator-editor__section-title">Основное</h2>
        <TextField
          label="Название"
          value={draft().title}
          maxLength={USER_CALCULATOR_LIMITS.title}
          data-testid="user-calculator-title"
          onInput={(event) => change({ ...draft(), title: event.currentTarget.value })}
        />
        <TextArea
          label="Что считает калькулятор"
          hint="Это описание видно под названием калькулятора."
          value={draft().description}
          maxLength={USER_CALCULATOR_LIMITS.description}
          data-testid="user-calculator-description"
          onInput={(event) => change({ ...draft(), description: event.currentTarget.value })}
        />
        <TextArea
          label="Ограничение"
          hint="Печатается вместе с каждым результатом."
          value={draft().disclaimer}
          maxLength={USER_CALCULATOR_LIMITS.disclaimer}
          onInput={(event) => change({ ...draft(), disclaimer: event.currentTarget.value })}
        />
      </section>

      <section class="user-calculator-editor__section paper-card" aria-label="Для кого">
        <h2 class="user-calculator-editor__section-title">Для кого</h2>
        <ToolPopulationField
          value={draft().population}
          error={draft().population ? userToolPopulationError(draft().population) : null}
          onChange={(population) => change({ ...draft(), population })}
        />
      </section>

      <section class="user-calculator-editor__section paper-card" aria-label="Входные данные">
        <header class="user-calculator-editor__section-header">
          <h2 class="user-calculator-editor__section-title">Входные данные</h2>
          <Button
            type="button"
            variant="primary"
            class="user-calculator-editor__add"
            data-testid="user-calculator-add-input"
            disabled={!canAddInput(draft())}
            title={
              canAddInput(draft())
                ? undefined
                : `Не больше ${USER_CALCULATOR_LIMITS.inputs} значений в одном калькуляторе.`
            }
            onClick={() => change(addInput(draft()))}
            icon={<AppGlyph name="plus" class="user-calculator-editor__icon" />}
          >
            Добавить данные
          </Button>
        </header>
        <Show
          when={inputIds().length > 0}
          fallback={
            <p class="user-calculator-editor__hint">
              Добавьте значения, которые врач вводит при расчёте: например, массу и рост.
            </p>
          }
        >
          <div class="user-calculator-editor__list">
            <For each={inputIds()}>
              {(inputId, index) => {
                const input = () => draft().inputs.find((item) => item.id === inputId);
                return (
                  <Show when={input()}>
                    {(current) => (
                      <article
                        class="user-calculator-editor__item"
                        data-testid="user-calculator-input-card"
                      >
                        <header class="user-calculator-editor__item-header">
                          <h3 class="user-calculator-editor__item-title">Данные {index() + 1}</h3>
                          <div class="user-calculator-editor__item-actions">
                            <Button
                              type="button"
                              variant="icon"
                              class="user-calculator-editor__item-action"
                              aria-label={`Поднять данные ${index() + 1}`}
                              title="Выше"
                              disabled={index() === 0}
                              data-testid="user-calculator-input-up"
                              onClick={() => change(moveInput(draft(), inputId, -1))}
                              icon={
                                <AppGlyph name="caret-up" class="user-calculator-editor__icon" />
                              }
                            />
                            <Button
                              type="button"
                              variant="icon"
                              class="user-calculator-editor__item-action"
                              aria-label={`Опустить данные ${index() + 1}`}
                              title="Ниже"
                              disabled={index() === inputIds().length - 1}
                              data-testid="user-calculator-input-down"
                              onClick={() => change(moveInput(draft(), inputId, 1))}
                              icon={
                                <AppGlyph name="caret-down" class="user-calculator-editor__icon" />
                              }
                            />
                            <Button
                              type="button"
                              variant="icon"
                              class="user-calculator-editor__item-action"
                              aria-label={`Копировать данные ${index() + 1}`}
                              title="Копировать"
                              disabled={!canAddInput(draft())}
                              onClick={() => change(duplicateInput(draft(), inputId))}
                              icon={
                                <AppGlyph
                                  name="squares-four"
                                  class="user-calculator-editor__icon"
                                />
                              }
                            />
                            <Button
                              type="button"
                              variant="icon"
                              class="user-calculator-editor__item-action user-calculator-editor__item-action--danger"
                              aria-label={`Удалить данные ${index() + 1}`}
                              title="Удалить"
                              data-testid="user-calculator-input-remove"
                              onClick={() => change(removeInput(draft(), inputId))}
                              icon={<AppGlyph name="trash" class="user-calculator-editor__icon" />}
                            />
                          </div>
                        </header>
                        <div class="user-calculator-editor__grid">
                          <TextField
                            class="user-calculator-editor__wide"
                            label="Название данных"
                            placeholder="Например: Масса тела"
                            value={current().label}
                            maxLength={USER_CALCULATOR_LIMITS.label}
                            data-testid="user-calculator-input-label"
                            onInput={(event) =>
                              change(setInputLabel(draft(), inputId, event.currentTarget.value))
                            }
                          />
                          <TextField
                            label="Имя в формуле"
                            hint="Буквы, цифры и «_». При смене имени формула обновится."
                            value={current().name}
                            maxLength={USER_CALCULATOR_LIMITS.name}
                            autocomplete="off"
                            spellcheck={false}
                            data-testid="user-calculator-input-name"
                            {...(nameError(current()) === null
                              ? {}
                              : { error: nameError(current()) })}
                            onInput={(event) =>
                              change(setInputName(draft(), inputId, event.currentTarget.value))
                            }
                          />
                          <TextField
                            label="Единица"
                            placeholder="кг"
                            value={current().unit}
                            maxLength={USER_CALCULATOR_LIMITS.unit}
                            data-testid="user-calculator-input-unit"
                            onInput={(event) => {
                              const unit = event.currentTarget.value;
                              change(updateInput(draft(), inputId, (item) => ({ ...item, unit })));
                            }}
                          />
                          <OptionalNumberField
                            label="Минимум"
                            placeholder="не задан"
                            value={current().minimum}
                            testId="user-calculator-input-minimum"
                            onChange={(value) =>
                              change(
                                updateInput(draft(), inputId, (item) => {
                                  const { minimum: _removed, ...rest } = item;
                                  return value === undefined ? rest : { ...rest, minimum: value };
                                }),
                              )
                            }
                          />
                          <OptionalNumberField
                            label="Максимум"
                            placeholder="не задан"
                            value={current().maximum}
                            testId="user-calculator-input-maximum"
                            onChange={(value) =>
                              change(
                                updateInput(draft(), inputId, (item) => {
                                  const { maximum: _removed, ...rest } = item;
                                  return value === undefined ? rest : { ...rest, maximum: value };
                                }),
                              )
                            }
                          />
                        </div>
                        <Checkbox
                          label="Только целые числа"
                          checked={current().integer}
                          onChange={(event) => {
                            const integer = event.currentTarget.checked;
                            change(updateInput(draft(), inputId, (item) => ({ ...item, integer })));
                          }}
                        />
                      </article>
                    )}
                  </Show>
                );
              }}
            </For>
          </div>
        </Show>
      </section>

      <section class="user-calculator-editor__section paper-card" aria-label="Формула">
        <h2 class="user-calculator-editor__section-title">Формула</h2>
        <label class="user-calculator-editor__formula-field">
          <span class="user-calculator-editor__label">Формула расчёта</span>
          <textarea
            ref={(element) => {
              formulaField = element;
            }}
            class="user-calculator-editor__formula"
            classList={{
              'user-calculator-editor__formula--error':
                draft().formula.trim() !== '' && !formula().ok,
            }}
            rows={3}
            spellcheck={false}
            autocomplete="off"
            placeholder="масса / (рост / 100) ^ 2"
            maxLength={USER_CALCULATOR_LIMITS.formula}
            value={draft().formula}
            data-testid="user-calculator-formula"
            onInput={(event) => change({ ...draft(), formula: event.currentTarget.value })}
          />
        </label>
        <fieldset class="user-calculator-editor__chips" aria-label="Вставить в формулу">
          <For each={draft().inputs.filter((input) => userInputNameError(input.name, []) === null)}>
            {(input) => (
              <button
                type="button"
                class="user-calculator-editor__chip user-calculator-editor__chip--name"
                title={`${input.label || input.name}${input.unit ? `, ${input.unit}` : ''}`}
                onClick={() => insertText(input.name)}
              >
                {input.name}
              </button>
            )}
          </For>
          <For each={USER_FORMULA_FUNCTIONS}>
            {(item) => (
              <button
                type="button"
                class="user-calculator-editor__chip user-calculator-editor__chip--function"
                title={`${item.hint}: ${item.example}`}
                onClick={() => insertText(`${item.name}()`)}
              >
                {item.name}()
              </button>
            )}
          </For>
        </fieldset>
        <p
          class="user-calculator-editor__formula-message"
          classList={{
            'user-calculator-editor__formula-message--error':
              draft().formula.trim() !== '' && !formula().ok,
            'user-calculator-editor__formula-message--ok': formula().ok,
          }}
          role="status"
          data-testid="user-calculator-formula-message"
        >
          {(() => {
            const compiled = formula();
            if (draft().formula.trim() === '') return 'Введите формулу.';
            return compiled.ok ? 'Формула читается.' : compiled.error;
          })()}
        </p>
        <p class="user-calculator-editor__hint">{USER_FORMULA_HELP}</p>

        <div class="user-calculator-editor__preview" data-testid="user-calculator-preview">
          <h3 class="user-calculator-editor__subsection-title">Проверка на примере</h3>
          <Show
            when={draft().inputs.length > 0}
            fallback={<p class="user-calculator-editor__hint">Сначала добавьте входные данные.</p>}
          >
            <div class="user-calculator-editor__grid">
              <For each={inputIds()}>
                {(inputId) => {
                  const input = () => draft().inputs.find((item) => item.id === inputId);
                  return (
                    <Show when={input()}>
                      {(current) => (
                        <TextField
                          label={`${current().label || current().name}${current().unit ? `, ${current().unit}` : ''}`}
                          type="text"
                          inputmode="decimal"
                          autocomplete="off"
                          value={sampleValues()[inputId] ?? ''}
                          data-testid="user-calculator-sample"
                          onInput={(event) => {
                            const raw = event.currentTarget.value.replace(',', '.');
                            setSample((previous) => ({ ...previous, [inputId]: raw }));
                          }}
                        />
                      )}
                    </Show>
                  );
                }}
              </For>
            </div>
            <Show
              when={previewOk()}
              fallback={
                <p
                  class="user-calculator-editor__preview-error"
                  role="status"
                  data-testid="user-calculator-preview-error"
                >
                  {previewError()}
                </p>
              }
            >
              {(result) => (
                <div class="user-calculator-editor__preview-result" role="status">
                  <span class="user-calculator-editor__preview-label">
                    {draft().result.label || 'Результат'}
                  </span>
                  <strong
                    class="user-calculator-editor__preview-value"
                    data-testid="user-calculator-preview-value"
                  >
                    {result().display}
                  </strong>
                  <Show when={result().bandMessage}>
                    {(message) => (
                      <span
                        class="user-calculator-editor__preview-band"
                        data-testid="user-calculator-preview-band"
                      >
                        {message()}
                      </span>
                    )}
                  </Show>
                </div>
              )}
            </Show>
          </Show>
        </div>
      </section>

      <section class="user-calculator-editor__section paper-card" aria-label="Результат">
        <h2 class="user-calculator-editor__section-title">Результат</h2>
        <div class="user-calculator-editor__grid">
          <TextField
            class="user-calculator-editor__wide"
            label="Название результата"
            placeholder="Индекс массы тела"
            value={draft().result.label}
            maxLength={USER_CALCULATOR_LIMITS.label}
            data-testid="user-calculator-result-label"
            onInput={(event) =>
              change({
                ...draft(),
                result: { ...draft().result, label: event.currentTarget.value },
              })
            }
          />
          <TextField
            label="Единица результата"
            placeholder="кг/м²"
            value={draft().result.unit}
            maxLength={USER_CALCULATOR_LIMITS.unit}
            data-testid="user-calculator-result-unit"
            onInput={(event) =>
              change({
                ...draft(),
                result: { ...draft().result, unit: event.currentTarget.value },
              })
            }
          />
          <SelectField
            label="Точность"
            options={DECIMAL_OPTIONS}
            value={String(draft().result.decimals)}
            data-testid="user-calculator-result-decimals"
            onChange={(event) =>
              change({
                ...draft(),
                result: { ...draft().result, decimals: Number(event.currentTarget.value) },
              })
            }
          />
        </div>
      </section>

      <section class="user-calculator-editor__section paper-card" aria-label="Диапазоны результата">
        <header class="user-calculator-editor__section-header">
          <h2 class="user-calculator-editor__section-title">Диапазоны результата</h2>
          <div class="user-calculator-editor__item-actions">
            <Show when={draft().bands.length > 1}>
              <Button
                type="button"
                variant="quiet"
                class="user-calculator-editor__sort"
                onClick={() => change(sortBands(draft()))}
              >
                По возрастанию
              </Button>
            </Show>
            <Button
              type="button"
              variant="primary"
              class="user-calculator-editor__add"
              data-testid="user-calculator-add-band"
              disabled={!canAddBand(draft())}
              title={
                canAddBand(draft())
                  ? undefined
                  : `Не больше ${USER_CALCULATOR_LIMITS.bands} диапазонов.`
              }
              onClick={() => change(addBand(draft()))}
              icon={<AppGlyph name="plus" class="user-calculator-editor__icon" />}
            >
              Добавить диапазон
            </Button>
          </div>
        </header>
        <p class="user-calculator-editor__hint">
          Подпись под результатом: «Норма», «Дефицит»… Границы входят в диапазон и сравниваются с
          результатом, округлённым до выбранной точности ({draft().result.decimals}{' '}
          {pluralRu(draft().result.decimals, 'знак', 'знака', 'знаков')}). Пустая граница — без
          ограничения.
        </p>
        <Show when={bandIds().length > 0}>
          <div class="user-calculator-editor__list">
            <For each={bandIds()}>
              {(bandId, index) => {
                const band = () => draft().bands.find((item) => item.id === bandId);
                return (
                  <Show when={band()}>
                    {(current) => (
                      <article
                        class="user-calculator-editor__item"
                        data-testid="user-calculator-band-card"
                      >
                        <header class="user-calculator-editor__item-header">
                          <h3 class="user-calculator-editor__item-title">Диапазон {index() + 1}</h3>
                          <Button
                            type="button"
                            variant="icon"
                            class="user-calculator-editor__item-action user-calculator-editor__item-action--danger"
                            aria-label={`Удалить диапазон ${index() + 1}`}
                            title="Удалить"
                            data-testid="user-calculator-band-remove"
                            onClick={() => change(removeBand(draft(), bandId))}
                            icon={<AppGlyph name="trash" class="user-calculator-editor__icon" />}
                          />
                        </header>
                        <div class="user-calculator-editor__grid">
                          <OptionalNumberField
                            label="От (включая)"
                            placeholder="без нижней границы"
                            value={current().min}
                            testId="user-calculator-band-min"
                            onChange={(value) =>
                              change(
                                updateBand(draft(), bandId, (item) => {
                                  const { min: _removed, ...rest } = item;
                                  return value === undefined ? rest : { ...rest, min: value };
                                }),
                              )
                            }
                          />
                          <OptionalNumberField
                            label="До (включая)"
                            placeholder="без верхней границы"
                            value={current().max}
                            testId="user-calculator-band-max"
                            onChange={(value) =>
                              change(
                                updateBand(draft(), bandId, (item) => {
                                  const { max: _removed, ...rest } = item;
                                  return value === undefined ? rest : { ...rest, max: value };
                                }),
                              )
                            }
                          />
                          <TextField
                            class="user-calculator-editor__wide"
                            label="Заголовок"
                            placeholder="Норма"
                            value={current().headline}
                            maxLength={USER_CALCULATOR_LIMITS.headline}
                            data-testid="user-calculator-band-headline"
                            onInput={(event) => {
                              const headline = event.currentTarget.value;
                              change(
                                updateBand(draft(), bandId, (item) => ({ ...item, headline })),
                              );
                            }}
                          />
                          <TextArea
                            class="user-calculator-editor__wide"
                            label="Пояснение"
                            placeholder="Что значит результат в этом диапазоне"
                            value={current().message}
                            maxLength={USER_CALCULATOR_LIMITS.message}
                            data-testid="user-calculator-band-message"
                            onInput={(event) => {
                              const message = event.currentTarget.value;
                              change(updateBand(draft(), bandId, (item) => ({ ...item, message })));
                            }}
                          />
                        </div>
                      </article>
                    )}
                  </Show>
                );
              }}
            </For>
          </div>
          <div class="user-calculator-editor__tester" data-testid="user-calculator-band-tester">
            <TextField
              class="user-calculator-editor__tester-field"
              label="Проверить значение"
              type="text"
              inputmode="decimal"
              autocomplete="off"
              placeholder="Например, 22,5"
              value={testValue()}
              data-testid="user-calculator-band-test-value"
              onInput={(event) => setTestValue(event.currentTarget.value)}
            />
            <p
              class="user-calculator-editor__tester-result"
              role="status"
              data-testid="user-calculator-band-test-result"
            >
              {(() => {
                const tested = testedBand();
                if (!tested) return 'Введите результат, чтобы увидеть, какой диапазон сработает.';
                if (!tested.match) {
                  return `Результат ${formatUserNumber(tested.value)}: ни один диапазон не подходит.`;
                }
                const { band, index } = tested.match;
                return `Результат ${formatUserNumber(tested.value)}: диапазон ${index + 1} «${band.headline}»${band.message ? ` — ${band.message}` : ''}`;
              })()}
            </p>
          </div>
        </Show>
      </section>
    </div>
  );
}
