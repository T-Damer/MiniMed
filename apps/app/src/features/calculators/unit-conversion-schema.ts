import { anyAgeScope, type CalculatorSchema, CalculatorSchemaSchema } from '@localmed/contracts';

const MASS = 'mass';
const LENGTH = 'length';
const VOLUME = 'volume';

/** Each unit is its factor to the base unit of its quantity: the option value is the factor. */
const SOURCE_UNITS = [
  { value: 1, label: 'кг', group: MASS },
  { value: 0.001, label: 'г', group: MASS },
  { value: 0.000001, label: 'мг', group: MASS },
  { value: 0.000000001, label: 'мкг', group: MASS },
  { value: 1, label: 'м', group: LENGTH },
  { value: 0.01, label: 'см', group: LENGTH },
  { value: 0.001, label: 'мм', group: LENGTH },
  { value: 1, label: 'л', group: VOLUME },
  { value: 0.001, label: 'мл', group: VOLUME },
] as const;

/** The target list opens on the second unit of each quantity, so the form starts as кг → г. */
const TARGET_UNITS = [1, 2, 3, 0, 5, 6, 4, 8, 7].map((index) => SOURCE_UNITS[index]);

/**
 * The unit converter is an ordinary declarative calculator that ships inside the app: the quantity
 * picks which units the two unit selects offer and each step takes its unit from the chosen option.
 * Nothing about it lives in the screen.
 */
export const UNIT_CONVERSION_SCHEMA: CalculatorSchema = CalculatorSchemaSchema.parse({
  schemaVersion: 2,
  id: 'unit-conversion',
  slug: 'unit-conversion',
  title: 'Преобразование единиц',
  shortTitle: 'Единицы',
  aliases: ['конвертер единиц', 'мг в мл', 'кг в граммы', 'мкг мг'],
  summary: 'Масса, длина и объём с явным промежуточным значением в базовой единице.',
  ageScope: anyAgeScope('Определение: «Любой пользователь; не является клинической формулой».'),
  category: 'unit-conversion',
  clinical: false,
  bundled: true,
  formulaDisplay: 'Линейное преобразование через базовую единицу выбранной величины.',
  population: 'Любой пользователь; не является клинической формулой.',
  limitations: ['Не преобразует массу в объём без отдельно заданной концентрации или плотности.'],
  inputs: [
    {
      id: 'quantity',
      label: 'Величина',
      kind: 'select',
      options: [
        { value: MASS, label: 'Масса' },
        { value: LENGTH, label: 'Длина' },
        { value: VOLUME, label: 'Объём' },
      ],
      required: true,
    },
    { id: 'amount', label: 'Значение', kind: 'number', minimum: 0, required: true },
    {
      id: 'sourceUnit',
      label: 'Из единицы',
      kind: 'select',
      optionGroupInput: 'quantity',
      options: SOURCE_UNITS,
      required: true,
    },
    {
      id: 'targetUnit',
      label: 'В единицу',
      kind: 'select',
      optionGroupInput: 'quantity',
      options: TARGET_UNITS,
      required: true,
    },
  ],
  steps: [
    {
      id: 'source',
      label: 'Исходное значение',
      unit: 'ед.',
      unitFromInput: 'sourceUnit',
      expression: 'amount',
      displayPrecision: 8,
    },
    {
      id: 'base',
      label: 'В базовой единице',
      unit: 'базовых ед.',
      expression: 'amount * sourceUnit',
      displayPrecision: 8,
    },
    {
      id: 'converted',
      label: 'Результат',
      unit: 'ед.',
      unitFromInput: 'targetUnit',
      expression: 'base / targetUnit',
      displayPrecision: 8,
      isOutput: true,
    },
  ],
  evaluation: {
    status: 'not-applicable',
    reason: 'Преобразование единиц не имеет клинического вердикта.',
  },
  sources: [
    {
      title: 'The International System of Units (SI Brochure)',
      publisher: 'BIPM',
      version: '9th edition',
      url: 'https://www.bipm.org/en/publications/si-brochure',
      reviewedAt: '2026-10-09',
    },
  ],
});
