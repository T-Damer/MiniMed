import type {
  CalculatorInputOption,
  CalculatorSchema,
  CalculatorSearch,
  ClinicalContextFact,
  QueryAnalysis,
  QueryCalculation,
} from '@localmed/contracts';
import { lightStemRussian, tokenize } from '@localmed/search-lexical';

export type CalculatorSchemaWithSearch = CalculatorSchema;

export interface CalculatorSuggestionCandidate {
  readonly calculatorId: string;
  readonly label: string;
  readonly canonicalTerm?: string;
  readonly matchedText?: string;
  readonly matchType?: 'exact' | 'fuzzy';
  readonly draftInputs: Readonly<Record<string, string | number>>;
  readonly formOptions: readonly CalculatorInputOption[];
  readonly routeOptions: readonly CalculatorInputOption[];
  readonly indicationOptions: readonly CalculatorInputOption[];
}

export interface CalculatorSuggestion {
  readonly kind: QueryCalculation['kind'];
  readonly candidates: readonly CalculatorSuggestionCandidate[];
  readonly selectedCalculatorId?: string;
  readonly requiresConfirmation: boolean;
  readonly draftInputs: Readonly<Record<string, string | number>>;
  readonly formOptions: readonly CalculatorInputOption[];
  readonly routeOptions: readonly CalculatorInputOption[];
  readonly indicationOptions: readonly CalculatorInputOption[];
}

interface ClinicalFactLike {
  readonly value: string;
  readonly normalizedValue: string;
  readonly polarity: 'positive' | 'negative' | 'uncertain';
}

function normalizeRussian(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .replace(/\s+/gu, ' ')
    .toLocaleLowerCase('ru-RU')
    .replaceAll('ё', 'е');
}

function analysisCalculation(analysis: QueryAnalysis): QueryCalculation | undefined {
  const calculation = analysis.calculation;
  if (!calculation) return undefined;
  if (calculation.kind === 'infusion-volume') return calculation;
  if (!Array.isArray(calculation.medicationCandidates)) return undefined;
  return calculation;
}

function schemaSearch(schema: CalculatorSchema): CalculatorSearch | undefined {
  const search = schema.search;
  if (!search) return undefined;
  if (search.kind === 'infusion-volume') return search;
  if (
    typeof search.medication?.canonicalTerm !== 'string' ||
    !Array.isArray(search.medication.aliases) ||
    !search.medication.aliases.every((alias) => typeof alias === 'string')
  ) {
    return undefined;
  }
  return search;
}

function sourceBacked(schema: CalculatorSchema): boolean {
  return Array.isArray(schema.sources) && schema.sources.length > 0;
}

function inputForId(schema: CalculatorSchema, id: string | undefined) {
  if (!id) return undefined;
  return schema.inputs.find((input) => input.id === id);
}

function optionsForInput(
  schema: CalculatorSchema,
  id: string | undefined,
): readonly CalculatorInputOption[] {
  const input = inputForId(schema, id);
  return input?.options ? [...input.options] : [];
}

function parseNumberWithUnit(value: string, unitPattern: RegExp): number | undefined {
  const normalized = normalizeRussian(value).replace(',', '.');
  const match = unitPattern.exec(normalized);
  if (!match) return undefined;
  const amount = Number(match[1]);
  return Number.isFinite(amount) ? amount : undefined;
}

function ageYearsFromContext(age: readonly ClinicalContextFact<'age'>[]): number | undefined {
  const values = age
    .filter((fact) => fact.polarity === 'positive')
    .map((fact) =>
      parseNumberWithUnit(
        fact.normalizedValue || fact.value,
        /^(\d+(?:\.\d+)?)\s+(?:год|года|лет)$/u,
      ),
    )
    .filter((value): value is number => value !== undefined && value >= 0);
  return values.length === 1 ? values[0] : undefined;
}

function weightKgFromContext(weight: readonly ClinicalContextFact<'weight'>[]): number | undefined {
  const values = weight
    .filter((fact) => fact.polarity === 'positive')
    .map((fact) =>
      parseNumberWithUnit(
        fact.normalizedValue || fact.value,
        /^(\d+(?:\.\d+)?)\s*(?:кг|килограмм(?:а|ов)?)$/u,
      ),
    )
    .filter((value): value is number => value !== undefined && value > 0);
  return values.length === 1 ? values[0] : undefined;
}

function optionKey(value: string | number): string {
  return `${typeof value}:${String(value)}`;
}

function optionValueFromContext(
  facts: readonly ClinicalFactLike[],
  options: readonly CalculatorInputOption[],
): string | number | undefined {
  const matches = new Map<string, CalculatorInputOption>();
  for (const fact of facts) {
    if (fact.polarity !== 'positive') continue;
    const normalizedFact = normalizeRussian(fact.normalizedValue || fact.value);
    if (!normalizedFact) continue;
    const matching = options.filter(
      (option) =>
        normalizeRussian(String(option.value)) === normalizedFact ||
        normalizeRussian(option.label) === normalizedFact,
    );
    if (matching.length !== 1) continue;
    const option = matching[0];
    if (option) matches.set(optionKey(option.value), option);
  }
  return matches.size === 1 ? [...matches.values()][0]?.value : undefined;
}

function optionValueFromQuery(
  query: string,
  options: readonly CalculatorInputOption[],
): string | number | undefined {
  const normalizedQuery = ` ${normalizeRussian(query)} `;
  const queryTerms = new Set(tokenize(normalizedQuery).map(lightStemRussian));
  const matches = options.filter((option) =>
    [String(option.value), option.label].some((term) => {
      const normalizedTerm = normalizeRussian(term);
      if (normalizedTerm.length <= 2) return false;
      if (normalizedQuery.includes(` ${normalizedTerm} `)) return true;
      const termTokens = tokenize(normalizedTerm).map(lightStemRussian);
      return termTokens.length > 0 && termTokens.every((token) => queryTerms.has(token));
    }),
  );
  return matches.length === 1 ? matches[0]?.value : undefined;
}

function buildDraftInputs(
  schema: CalculatorSchema,
  search: CalculatorSearch,
  analysis: QueryAnalysis,
): Readonly<Record<string, string | number>> {
  const draftInputs: Record<string, string | number> = {};
  const clinicalContext = analysis.clinicalContext;

  const indicationOptions = optionsForInput(schema, search.bindings.indicationInputId);
  const indicationValue = optionValueFromQuery(analysis.originalQuery, indicationOptions);
  if (search.bindings.indicationInputId && indicationValue !== undefined) {
    draftInputs[search.bindings.indicationInputId] = indicationValue;
  }

  if (!clinicalContext) return draftInputs;

  const ageInput = inputForId(schema, search.bindings.ageYearsInputId);
  const ageYears = ageYearsFromContext(clinicalContext.age);
  if (ageInput?.kind === 'number' && ageYears !== undefined) {
    draftInputs[ageInput.id] = ageYears;
  }

  const weightInput = inputForId(schema, search.bindings.weightKgInputId);
  const weightKg = weightKgFromContext(clinicalContext.weight);
  if (weightInput?.kind === 'number' && weightKg !== undefined) {
    draftInputs[weightInput.id] = weightKg;
  }

  const formOptions = optionsForInput(schema, search.bindings.formInputId);
  const formValue = optionValueFromContext(clinicalContext.doseForm, formOptions);
  if (search.bindings.formInputId && formValue !== undefined) {
    draftInputs[search.bindings.formInputId] = formValue;
  }

  const routeOptions = optionsForInput(schema, search.bindings.routeInputId);
  const routeValue = optionValueFromContext(clinicalContext.route, routeOptions);
  if (search.bindings.routeInputId && routeValue !== undefined) {
    draftInputs[search.bindings.routeInputId] = routeValue;
  }

  return draftInputs;
}

export function resolveCalculatorSuggestion(
  analysis: QueryAnalysis,
  installedSchemas: readonly CalculatorSchema[],
): CalculatorSuggestion | undefined {
  const calculation = analysisCalculation(analysis);
  if (
    !calculation ||
    (calculation.kind === 'medication-dose' && calculation.medicationCandidates.length === 0)
  ) {
    return undefined;
  }

  const available = installedSchemas
    .map((schema) => ({ schema, search: schemaSearch(schema) }))
    .filter(
      (
        item,
      ): item is {
        readonly schema: CalculatorSchema;
        readonly search: CalculatorSearch;
      } =>
        sourceBacked(item.schema) &&
        item.search !== undefined &&
        item.search.kind === calculation.kind,
    );
  if (available.length === 0) return undefined;

  const candidates: CalculatorSuggestionCandidate[] = [];
  if (calculation.kind === 'infusion-volume') {
    for (const item of available) {
      candidates.push({
        calculatorId: item.schema.id,
        label: item.schema.shortTitle,
        draftInputs: buildDraftInputs(item.schema, item.search, analysis),
        formOptions: optionsForInput(item.schema, item.search.bindings.formInputId),
        routeOptions: optionsForInput(item.schema, item.search.bindings.routeInputId),
        indicationOptions: optionsForInput(item.schema, item.search.bindings.indicationInputId),
      });
    }
  } else {
    for (const medicationCandidate of calculation.medicationCandidates) {
      if (
        typeof medicationCandidate.canonicalTerm !== 'string' ||
        typeof medicationCandidate.matchedText !== 'string' ||
        (medicationCandidate.matchType !== 'exact' && medicationCandidate.matchType !== 'fuzzy')
      ) {
        continue;
      }
      const canonicalTerm = normalizeRussian(medicationCandidate.canonicalTerm);
      if (!canonicalTerm) continue;
      for (const item of available) {
        if (item.search.kind !== 'medication-dose') continue;
        const terms = [item.search.medication.canonicalTerm, ...item.search.medication.aliases];
        if (!terms.some((term) => normalizeRussian(term) === canonicalTerm)) continue;
        candidates.push({
          calculatorId: item.schema.id,
          label: item.search.medication.canonicalTerm,
          canonicalTerm: item.search.medication.canonicalTerm,
          matchedText: medicationCandidate.matchedText,
          matchType: medicationCandidate.matchType,
          draftInputs: buildDraftInputs(item.schema, item.search, analysis),
          formOptions: optionsForInput(item.schema, item.search.bindings.formInputId),
          routeOptions: optionsForInput(item.schema, item.search.bindings.routeInputId),
          indicationOptions: optionsForInput(item.schema, item.search.bindings.indicationInputId),
        });
      }
    }
  }
  if (candidates.length === 0) return undefined;

  const calculatorIds = new Set(candidates.map((candidate) => candidate.calculatorId));
  const requiresConfirmation =
    candidates.length !== 1 ||
    (calculation.kind === 'medication-dose' &&
      (calculation.medicationCandidates.length !== 1 ||
        candidates.some((candidate) => candidate.matchType === 'fuzzy')));
  const selectedCalculatorId =
    !requiresConfirmation && calculatorIds.size === 1 ? candidates[0]?.calculatorId : undefined;
  const selectedSchema =
    calculatorIds.size === 1
      ? available.find((item) => item.schema.id === [...calculatorIds][0])
      : undefined;

  const formOptions = selectedSchema
    ? optionsForInput(selectedSchema.schema, selectedSchema.search.bindings.formInputId)
    : [];
  const routeOptions = selectedSchema
    ? optionsForInput(selectedSchema.schema, selectedSchema.search.bindings.routeInputId)
    : [];
  const indicationOptions = selectedSchema
    ? optionsForInput(selectedSchema.schema, selectedSchema.search.bindings.indicationInputId)
    : [];
  const draftInputs = selectedSchema
    ? buildDraftInputs(selectedSchema.schema, selectedSchema.search, analysis)
    : {};

  return {
    kind: calculation.kind,
    candidates,
    ...(selectedCalculatorId ? { selectedCalculatorId } : {}),
    requiresConfirmation,
    draftInputs,
    formOptions,
    routeOptions,
    indicationOptions,
  };
}
