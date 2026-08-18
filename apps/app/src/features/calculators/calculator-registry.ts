import type { ToolDefinitionRecord } from '@localmed/contracts';
import {
  clearDownloadedCalculatorSchemas,
  registerDownloadedCalculatorSchema,
} from '@/features/calculators/calculator-schema-catalog';
import { validateCalculatorSchema } from '@/features/calculators/calculator-schema-validate';
import type {
  AvailableCalculatorDefinition,
  CalculatorDefinition,
} from '@/features/calculators/calculator-types';

const DOWNLOADED_CALCULATORS = new Map<string, AvailableCalculatorDefinition>();

export function clearDownloadedCalculators(): void {
  DOWNLOADED_CALCULATORS.clear();
  clearDownloadedCalculatorSchemas();
}

export const CALCULATOR_REGISTRY: readonly CalculatorDefinition[] = [
  {
    id: 'unit-conversion',
    slug: 'unit-conversion',
    state: 'available',
    title: 'Преобразование единиц',
    shortTitle: 'Единицы',
    aliases: ['конвертер единиц', 'мг в мл', 'кг в граммы', 'мкг мг'],
    summary: 'Масса, длина и объём с явным промежуточным значением в базовой единице.',
    audience: 'all',
    category: 'unit-conversion',
    clinical: false,
    formula: 'Линейное преобразование через базовую единицу выбранной величины.',
    population: 'Любой пользователь; не является клинической формулой.',
    limitations: ['Не преобразует массу в объём без отдельно заданной концентрации или плотности.'],
    inputs: [
      { input: 'value', required: true, minimum: 0 },
      { input: 'sourceUnit', required: true },
      { input: 'targetUnit', required: true },
    ],
    sources: [],
  },
];

export function getCalculatorRegistry(): readonly CalculatorDefinition[] {
  return [
    ...CALCULATOR_REGISTRY.filter((definition) => !DOWNLOADED_CALCULATORS.has(definition.id)),
    ...DOWNLOADED_CALCULATORS.values(),
  ];
}

export function registerDownloadedCalculator(record: ToolDefinitionRecord): void {
  if (record.kind !== 'calculator') return;
  const validation = validateCalculatorSchema(record.definition);
  if (!validation.ok || !validation.schema) {
    throw new Error(`Calculator payload is invalid: ${validation.errors.join('; ')}`);
  }
  const schema = validation.schema;
  registerDownloadedCalculatorSchema(record);
  DOWNLOADED_CALCULATORS.set(record.id, {
    id: record.id,
    slug: record.slug,
    state: 'available',
    title: record.title,
    shortTitle: record.shortTitle,
    aliases: record.aliases,
    summary: schema.summary,
    audience: schema.audience,
    category: schema.category,
    clinical: schema.clinical,
    formula: schema.formulaDisplay,
    population: schema.population,
    limitations: schema.limitations,
    inputs: schema.inputs.map((input) => ({
      input: input.id,
      ...(input.unit ? { unit: input.unit } : {}),
      ...(input.minimum !== undefined ? { minimum: input.minimum } : {}),
      ...(input.maximum !== undefined ? { maximum: input.maximum } : {}),
      required: input.required,
      ...(input.note ? { note: input.note } : {}),
    })),
    sources: schema.sources.map((source) => ({
      title: source.title,
      publisher: source.publisher,
      version: source.version,
      url: source.url ?? '',
      reviewedAt: source.reviewedAt,
    })),
  });
}

export const AVAILABLE_CALCULATORS: readonly AvailableCalculatorDefinition[] =
  CALCULATOR_REGISTRY.filter(
    (calculator): calculator is AvailableCalculatorDefinition => calculator.state === 'available',
  );

export function findCalculator(idOrSlug: string): CalculatorDefinition | undefined {
  return getCalculatorRegistry().find(
    (calculator) =>
      calculator.id === idOrSlug ||
      (calculator.state === 'available' && calculator.slug === idOrSlug),
  );
}

export function searchCalculators(query: string): readonly CalculatorDefinition[] {
  const normalized = query.trim().toLocaleLowerCase('ru-RU').replaceAll('ё', 'е');
  const registry = getCalculatorRegistry();
  if (!normalized) return registry;
  return registry.filter((calculator) => {
    const searchable = [
      calculator.title,
      calculator.summary,
      calculator.audience,
      calculator.category,
      ...(calculator.state === 'available' ? calculator.aliases : []),
    ]
      .join(' ')
      .toLocaleLowerCase('ru-RU')
      .replaceAll('ё', 'е');
    return searchable.includes(normalized);
  });
}
