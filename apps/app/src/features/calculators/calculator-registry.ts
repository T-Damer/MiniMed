import type { CalculatorToolPreview, ToolDefinitionRecord } from '@localmed/contracts';
import {
  clearDownloadedCalculatorSchemas,
  registerDownloadedCalculatorSchema,
} from '@/features/calculators/calculator-schema-catalog';
import { validateCalculatorSchema } from '@/features/calculators/calculator-schema-validate';
import type {
  AvailableCalculatorDefinition,
  CalculatorDefinition,
} from '@/features/calculators/calculator-types';

import { TOOL_CATALOG } from '@/features/modules/module-catalog';

const DOWNLOADED_CALCULATORS = new Map<string, AvailableCalculatorDefinition>();

export const ECG_PHOTO_CALIPER_ID = 'ecg-photo-caliper';

export function clearDownloadedCalculators(): void {
  DOWNLOADED_CALCULATORS.clear();
  clearDownloadedCalculatorSchemas();
}

export const CALCULATOR_REGISTRY: readonly CalculatorDefinition[] = [
  {
    id: 'unit-conversion',
    version: '2.0.0',
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
  {
    id: ECG_PHOTO_CALIPER_ID,
    version: '1.3.0',
    slug: ECG_PHOTO_CALIPER_ID,
    state: 'available',
    title: 'Измерения по фото ЭКГ',
    shortTitle: 'Фото ЭКГ',
    aliases: ['ЭКГ фото', 'интервалы ЭКГ', 'RR', 'P', 'PR', 'QRS', 'QTc', 'оценка ЭКГ'],
    summary:
      'Локальная калибровка сетки, ручные интервалы, объяснимые правила и опциональные вероятностные гипотезы по подтверждённым цифрам.',
    audience: 'all',
    category: 'cardiology',
    clinical: true,
    formula:
      'Профиль фиксирован: 50 мм/с и 10 мм/мВ; 1 мм = 20 мс; ЧСС = 60 000 / RR; QTc по Bazett, Fridericia и Framingham с половыми порогами; ручные критерии ритма/AF, AV-проведения и предвозбуждения; ось QRS и Sokolow–Lyon; опциональный HGB по 30 подтверждённым полям.',
    population:
      'Только взрослые 18+; горизонтальная фотография или скриншот стандартной 12-отведённой ЭКГ.',
    limitations: [
      'Перспектива, изгиб бумаги, размытие и неправильная калибровка искажают интервалы.',
      'Правила доступны только после подтверждения возраста 18+, профиля 50 мм/с и 10 мм/мВ, проверки изображения и калибровки.',
      'Интерпретатор не выводит тип блокады из длительности QRS: гипотеза БПНПГ/БЛНПГ появляется только после ручного подтверждения полного набора морфологических критериев.',
      'Паттерн предвозбуждения WPW-типа появляется только при PR <120 мс, QRS >120 мс и вручную подтверждённой дельта-волне; это не устанавливает клинический синдром WPW.',
      'Паттерн фибрилляции предсердий требует ручного подтверждения нерегулярных RR, отсутствия различимых P-волн и нерегулярной предсердной активности; первичный диагноз должен поставить врач по самой записи.',
      'Совпадение одного вольтажного критерия Sokolow–Lyon не подтверждает гипертрофию, а его отсутствие не исключает её.',
      'Без указанного пола QTc оценивается по консервативному порогу >470 мс; при QRS ≥120 мс требуется отдельная оценка QT/JT.',
      'Фото не диагностирует ритм, инфаркт и другую морфологию; числовая модель выдаёт только широкие вероятностные гипотезы и не подтверждает острый инфаркт.',
      'Результат требует проверки по исходной ЭКГ специалистом.',
    ],
    inputs: [
      { input: 'image', required: false },
      { input: 'gridCalibration', unit: 'px/мм', required: false, minimum: 0 },
      { input: 'numericMeasurements', unit: 'мс/мВ', required: false },
    ],
    sources: [
      {
        title: 'AHA/ACCF/HRS ECG standardization, Part I: technology and measurements',
        publisher: 'Journal of the American College of Cardiology',
        version: '2007',
        url: 'https://www.jacc.org/doi/10.1016/j.jacc.2007.01.024',
        reviewedAt: '2026-08-30',
      },
      {
        title: 'AHA/ACCF/HRS ECG standardization, Part III: conduction disturbances',
        publisher: 'Journal of the American College of Cardiology',
        version: '2009',
        url: 'https://www.jacc.org/doi/10.1016/j.jacc.2008.12.013',
        reviewedAt: '2026-08-31',
      },
      {
        title: '2018 ACC/AHA/HRS Guideline on Bradycardia and Cardiac Conduction Delay',
        publisher: 'Circulation',
        version: '2018',
        url: 'https://www.ahajournals.org/doi/10.1161/CIR.0000000000000628',
        reviewedAt: '2026-08-31',
      },
      {
        title: '2023 ACC/AHA/ACCP/HRS Guideline for Atrial Fibrillation',
        publisher: 'Circulation',
        version: '2023',
        url: 'https://www.ahajournals.org/doi/10.1161/CIR.0000000000001193',
        reviewedAt: '2026-08-31',
      },
      {
        title: 'AHA/ACCF/HRS ECG standardization, Part IV: ST, T, U and QT',
        publisher: 'Journal of the American College of Cardiology',
        version: '2009',
        url: 'https://www.jacc.org/doi/10.1016/j.jacc.2008.12.014',
        reviewedAt: '2026-08-30',
      },
      {
        title: 'AHA/ACCF/HRS ECG standardization, Part V: cardiac chamber hypertrophy',
        publisher: 'Journal of the American College of Cardiology',
        version: '2009',
        url: 'https://www.jacc.org/doi/10.1016/j.jacc.2008.12.015',
        reviewedAt: '2026-08-31',
      },
      {
        title: 'Optimal QT interval correction formula in sinus tachycardia',
        publisher: 'PubMed',
        version: '2015',
        url: 'https://pubmed.ncbi.nlm.nih.gov/26552754/',
        reviewedAt: '2026-08-30',
      },
      {
        title: 'PTB-XL+, a comprehensive electrocardiographic feature dataset',
        publisher: 'PhysioNet',
        version: '1.0.1',
        url: 'https://physionet.org/content/ptb-xl-plus/1.0.1/',
        reviewedAt: '2026-08-31',
      },
    ],
  },
];

const CORE_CALCULATOR_CATALOG = TOOL_CATALOG.filter((entry) => entry.kind === 'calculator').map(
  (entry) => calculatorCatalogDefinition(entry, entry.preview),
);

export function getCalculatorRegistry(): readonly CalculatorDefinition[] {
  return [
    ...new Map<string, CalculatorDefinition>(
      [...CALCULATOR_REGISTRY, ...CORE_CALCULATOR_CATALOG, ...DOWNLOADED_CALCULATORS.values()].map(
        (definition) => [definition.id, definition],
      ),
    ).values(),
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
  DOWNLOADED_CALCULATORS.set(record.id, calculatorCatalogDefinition(record, schema));
}

function calculatorCatalogDefinition(
  record: Pick<
    ToolDefinitionRecord,
    'id' | 'version' | 'slug' | 'title' | 'shortTitle' | 'aliases'
  >,
  schema: CalculatorToolPreview,
): AvailableCalculatorDefinition {
  return {
    id: record.id,
    version: record.version,
    slug: record.slug,
    state: 'available',
    title: record.title,
    shortTitle: record.shortTitle,
    aliases: record.aliases,
    summary: schema.summary,
    audience: schema.audience,
    category: schema.category,
    tags: schema.tags,
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
  };
}

export const AVAILABLE_CALCULATORS: readonly AvailableCalculatorDefinition[] =
  CALCULATOR_REGISTRY.filter(
    (calculator): calculator is AvailableCalculatorDefinition => calculator.state === 'available',
  );

export function findCalculator(
  idOrSlug: string,
  registry: readonly CalculatorDefinition[] = getCalculatorRegistry(),
): CalculatorDefinition | undefined {
  return registry.find(
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
      ...(calculator.tags ?? []),
      ...(calculator.state === 'available' ? calculator.aliases : []),
    ]
      .join(' ')
      .toLocaleLowerCase('ru-RU')
      .replaceAll('ё', 'е');
    return searchable.includes(normalized);
  });
}
