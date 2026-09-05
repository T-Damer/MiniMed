import type { CalculatorInputDefinition, CalculatorInputOption } from '@localmed/contracts';
import { createEffect, createMemo, createSignal, For, type JSX, Show } from 'solid-js';

import { Button } from '@/components/Button';
import type {
  CalculatorSchemaWithSearch,
  CalculatorSuggestion,
  CalculatorSuggestionCandidate,
} from '@/features/search/calculator-suggestion';

export interface CalculatorSuggestionCardProps {
  readonly suggestion: CalculatorSuggestion;
  readonly schemas: readonly CalculatorSchemaWithSearch[];
  readonly onCalculate: (
    calculatorId: string,
    values: Readonly<Record<string, string | number>>,
  ) => void;
}

function searchBindingIds(schema: CalculatorSchemaWithSearch | undefined): ReadonlySet<string> {
  if (!schema?.search) return new Set();
  return new Set(
    [
      schema.search.bindings.ageYearsInputId,
      schema.search.bindings.weightKgInputId,
      schema.search.bindings.formInputId,
      schema.search.bindings.routeInputId,
      schema.search.bindings.indicationInputId,
    ].filter((id): id is string => id !== undefined),
  );
}

function inputValue(value: string | number | undefined): string {
  return value === undefined ? '' : String(value);
}

export function CalculatorSuggestionCard(props: CalculatorSuggestionCardProps): JSX.Element {
  const [selectedCalculatorId, setSelectedCalculatorId] = createSignal(
    props.suggestion.selectedCalculatorId ?? '',
  );
  const [values, setValues] = createSignal<Record<string, string | number>>({
    ...props.suggestion.draftInputs,
  });

  createEffect(() => {
    setSelectedCalculatorId(props.suggestion.selectedCalculatorId ?? '');
    setValues({ ...props.suggestion.draftInputs });
  });

  const selectedSchema = createMemo(() =>
    props.schemas.find((schema) => schema.id === selectedCalculatorId()),
  );
  const selectedCandidate = createMemo<CalculatorSuggestionCandidate | undefined>(() =>
    props.suggestion.candidates.find(
      (candidate) => candidate.calculatorId === selectedCalculatorId(),
    ),
  );
  const candidateLabel = createMemo(
    () =>
      selectedCandidate()?.label ??
      (props.suggestion.requiresConfirmation
        ? props.suggestion.kind === 'medication-dose'
          ? 'Выберите препарат'
          : 'Выберите калькулятор'
        : (props.suggestion.candidates[0]?.label ?? '')),
  );
  const title = createMemo(() =>
    props.suggestion.kind === 'medication-dose' ? 'Рассчитать дозу' : 'Рассчитать объём инфузии',
  );
  const candidateFieldLabel = createMemo(() =>
    props.suggestion.kind === 'medication-dose' ? 'Препарат' : 'Калькулятор',
  );
  const bindingIds = createMemo(() => searchBindingIds(selectedSchema()));
  const boundInputs = createMemo(() =>
    (selectedSchema()?.inputs ?? []).filter((input) => bindingIds().has(input.id)),
  );
  const recognizedInputs = createMemo(() => {
    const schema = selectedSchema();
    if (!schema?.search) return [];
    const recognizedIds = new Set(
      [schema.search.bindings.ageYearsInputId, schema.search.bindings.weightKgInputId].filter(
        (id): id is string => id !== undefined && values()[id] !== undefined,
      ),
    );
    return boundInputs().filter((input) => input.kind === 'number' && recognizedIds.has(input.id));
  });
  const selectInputs = createMemo(() => {
    const schema = selectedSchema();
    if (!schema?.search) return [];
    const selectIds = new Set(
      [
        schema.search.bindings.formInputId,
        schema.search.bindings.routeInputId,
        schema.search.bindings.indicationInputId,
      ].filter((id): id is string => id !== undefined),
    );
    return boundInputs().filter(
      (input) => selectIds.has(input.id) && (input.options?.length ?? 0) > 0,
    );
  });

  const inputOptions = (input: CalculatorInputDefinition): readonly CalculatorInputOption[] => {
    const schema = selectedSchema();
    const search = schema?.search;
    const candidate = selectedCandidate();
    if (search?.bindings.formInputId === input.id) {
      const options = candidate?.formOptions ?? props.suggestion.formOptions;
      return options.length > 0 ? options : (input.options ?? []);
    }
    if (search?.bindings.routeInputId === input.id) {
      const options = candidate?.routeOptions ?? props.suggestion.routeOptions;
      return options.length > 0 ? options : (input.options ?? []);
    }
    if (search?.bindings.indicationInputId === input.id) {
      const options = candidate?.indicationOptions ?? props.suggestion.indicationOptions;
      return options.length > 0 ? options : (input.options ?? []);
    }
    return input.options ?? [];
  };

  const updateValue = (id: string, value: string): void => {
    setValues((previous) => ({ ...previous, [id]: value }));
  };

  const selectCalculator = (id: string): void => {
    setSelectedCalculatorId(id);
    const candidate = props.suggestion.candidates.find((item) => item.calculatorId === id);
    setValues({ ...(candidate?.draftInputs ?? props.suggestion.draftInputs) });
  };

  const submit = (event: SubmitEvent): void => {
    event.preventDefault();
    const id = selectedCalculatorId();
    const schema = selectedSchema();
    if (!id || !schema?.search) return;

    const allowedIds = searchBindingIds(schema);
    const nextValues: Record<string, string | number> = {};
    for (const input of schema.inputs) {
      if (!allowedIds.has(input.id)) continue;
      const value = values()[input.id];
      if (value !== undefined && value !== '') nextValues[input.id] = value;
      else {
        const firstOption = inputOptions(input)[0];
        if (firstOption) nextValues[input.id] = firstOption.value;
      }
    }
    props.onCalculate(id, nextValues);
  };

  return (
    <section class="calculator-suggestion-card" aria-label={title()}>
      <header class="calculator-suggestion-card__header">
        <p class="calculator-suggestion-card__kicker">Подходящий калькулятор</p>
        <h2 class="calculator-suggestion-card__title">{title()}</h2>
        <p class="calculator-suggestion-card__medicine">{candidateLabel()}</p>
      </header>
      <form class="calculator-suggestion-card__form" onSubmit={submit}>
        <Show
          when={props.suggestion.requiresConfirmation || !props.suggestion.selectedCalculatorId}
        >
          <label class="calculator-suggestion-card__field">
            <span class="calculator-suggestion-card__label">{candidateFieldLabel()}</span>
            <select
              class="calculator-suggestion-card__select"
              aria-label={candidateFieldLabel()}
              data-testid="calculator-suggestion-medication"
              value={selectedCalculatorId()}
              onChange={(event) => selectCalculator(event.currentTarget.value)}
            >
              <option class="calculator-suggestion-card__option" value="">
                {candidateLabel()}
              </option>
              <For each={props.suggestion.candidates}>
                {(candidate) => (
                  <option class="calculator-suggestion-card__option" value={candidate.calculatorId}>
                    {candidate.label}
                  </option>
                )}
              </For>
            </select>
          </label>
        </Show>

        <Show when={recognizedInputs().length > 0}>
          <fieldset class="calculator-suggestion-card__recognized">
            <legend class="calculator-suggestion-card__legend">Распознанные данные</legend>
            <For each={recognizedInputs()}>
              {(input) => (
                <label class="calculator-suggestion-card__field calculator-suggestion-card__field--compact">
                  <span class="calculator-suggestion-card__label">
                    {input.label}
                    {input.unit ? `, ${input.unit}` : ''}
                  </span>
                  <input
                    class="calculator-suggestion-card__input"
                    type="number"
                    inputmode={input.integer ? 'numeric' : 'decimal'}
                    min={input.minimum}
                    max={input.maximum}
                    step={input.inputStep ?? (input.integer ? 1 : 'any')}
                    value={inputValue(values()[input.id])}
                    aria-label={input.label}
                    onInput={(event) => updateValue(input.id, event.currentTarget.value)}
                  />
                </label>
              )}
            </For>
          </fieldset>
        </Show>

        <For each={selectInputs()}>
          {(input) => (
            <label class="calculator-suggestion-card__field">
              <span class="calculator-suggestion-card__label">{input.label}</span>
              <select
                class="calculator-suggestion-card__select"
                aria-label={input.label}
                value={inputValue(values()[input.id] ?? inputOptions(input)[0]?.value)}
                onChange={(event) => updateValue(input.id, event.currentTarget.value)}
              >
                <For each={inputOptions(input)}>
                  {(option) => (
                    <option class="calculator-suggestion-card__option" value={String(option.value)}>
                      {option.label}
                    </option>
                  )}
                </For>
              </select>
            </label>
          )}
        </For>

        <Button
          class="calculator-suggestion-card__submit"
          type="submit"
          variant="primary"
          disabled={!selectedCalculatorId()}
          data-testid="calculator-suggestion-submit"
        >
          Рассчитать
        </Button>
      </form>
    </section>
  );
}
