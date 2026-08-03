import type { CalculatorDefinition } from '@/features/calculators/calculator-types';

export const CALCULATOR_REGISTRY = [
  {
    id: 'unit-conversion',
    state: 'available',
    title: 'Преобразование единиц',
    summary: 'Масса, длина и объём с явным промежуточным значением в базовой единице.',
    audience: 'all',
    category: 'unit-conversion',
    clinical: false,
    inputs: [
      { input: 'value', required: true, minimum: 0 },
      { input: 'sourceUnit', required: true },
      { input: 'targetUnit', required: true },
    ],
    sources: [],
  },
  {
    id: 'adult-renal-function',
    state: 'planned',
    title: 'Почечная функция у взрослых',
    summary: 'Расчётный блок для взрослых с явным выбором формулы и единиц креатинина.',
    audience: 'adult',
    category: 'renal',
    clinical: true,
    sourceRequirement:
      'Зафиксировать версию формулы, популяцию, единицы креатинина и правила интерпретации.',
  },
  {
    id: 'pediatric-renal-function',
    state: 'planned',
    title: 'Почечная функция у детей',
    summary: 'Педиатрический расчёт с обязательными возрастом, ростом и единицами лаборатории.',
    audience: 'pediatric',
    category: 'renal',
    clinical: true,
    sourceRequirement:
      'Зафиксировать версию педиатрической формулы, возрастные границы и допустимые анализаторы.',
  },
  {
    id: 'pediatric-anthropometry',
    state: 'planned',
    title: 'Антропометрия детей',
    summary: 'Возрастные показатели роста и массы без смешивания разных эталонных наборов.',
    audience: 'pediatric',
    category: 'anthropometry',
    clinical: true,
    sourceRequirement:
      'Закрепить конкретный набор эталонов, таблицы LMS, возрастной диапазон и правила недоношенности.',
  },
] as const satisfies readonly CalculatorDefinition[];

export function findCalculator(id: string): CalculatorDefinition | undefined {
  return CALCULATOR_REGISTRY.find((calculator) => calculator.id === id);
}
