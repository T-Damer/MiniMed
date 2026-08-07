import { CALCULATOR_REGISTRY } from '@/features/calculators/calculator-registry';
import type {
  CalculatorCategory,
  CalculatorDefinition,
} from '@/features/calculators/calculator-types';

export type CalculatorSectionId = CalculatorCategory;

export interface CalculatorSectionDefinition {
  readonly id: CalculatorSectionId;
  readonly title: string;
  readonly description: string;
}

export interface CalculatorInstallationState {
  readonly sectionIds: ReadonlySet<CalculatorSectionId>;
  readonly installedIds: ReadonlySet<string>;
}

interface StoredCalculatorInstallationSnapshot {
  readonly schemaVersion: 1;
  readonly sectionIds: readonly CalculatorSectionId[];
}

const STORAGE_KEY = 'minimed.calculator-packs.v1';
const SECTION_IDS = new Set<CalculatorSectionId>([
  'unit-conversion',
  'anthropometry',
  'renal',
  'fluids',
  'medication',
  'screening',
  'obstetrics',
  'gynecology',
]);

export const CALCULATOR_PACKS_EVENT = 'minimed:calculator-packs-changed';

export const CALCULATOR_SECTIONS: readonly CalculatorSectionDefinition[] = [
  {
    id: 'unit-conversion',
    title: 'Преобразование единиц',
    description: 'Масса, длина и объём с переводом через базовую единицу.',
  },
  {
    id: 'anthropometry',
    title: 'Антропометрия',
    description: 'Площадь поверхности тела и будущие возрастные нормы роста и массы.',
  },
  {
    id: 'renal',
    title: 'Функция почек',
    description: 'Расчётная СКФ у взрослых и детей с явными возрастными ограничениями.',
  },
  {
    id: 'fluids',
    title: 'Жидкость и инфузии',
    description: 'Исходная оценка поддерживающей жидкости у детей.',
  },
  {
    id: 'medication',
    title: 'Лекарственные расчёты',
    description: 'Дозы, концентрации и правила округления после отдельной проверки источников.',
  },
  {
    id: 'obstetrics',
    title: 'Акушерство',
    description: 'Срок беременности, предполагаемая дата родов и оценка готовности к родам.',
  },
  {
    id: 'gynecology',
    title: 'Гинекология',
    description: 'Онкологический скрининг и другие гинекологические расчёты.',
  },
];

function storage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function availableDefinitions(
  definitions: readonly CalculatorDefinition[],
  sectionId: CalculatorSectionId,
): readonly CalculatorDefinition[] {
  return definitions.filter(
    (definition) => definition.category === sectionId && definition.state === 'available',
  );
}

function sectionIdsFromSnapshot(value: unknown): readonly CalculatorSectionId[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const snapshot = value as Partial<StoredCalculatorInstallationSnapshot>;
  if (snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.sectionIds)) return [];
  return [
    ...new Set(
      snapshot.sectionIds.filter(
        (id): id is CalculatorSectionId =>
          typeof id === 'string' && SECTION_IDS.has(id as CalculatorSectionId),
      ),
    ),
  ].toSorted();
}

function installedIdsFromSections(
  sectionIds: ReadonlySet<CalculatorSectionId>,
  definitions: readonly CalculatorDefinition[],
): ReadonlySet<string> {
  return new Set(
    definitions
      .filter(
        (definition) => definition.state === 'available' && sectionIds.has(definition.category),
      )
      .map((definition) => definition.id),
  );
}

function stateFromSectionIds(
  sectionIds: readonly CalculatorSectionId[],
  definitions: readonly CalculatorDefinition[],
): CalculatorInstallationState {
  const selected = new Set(sectionIds);
  return {
    sectionIds: selected,
    installedIds: installedIdsFromSections(selected, definitions),
  };
}

export function loadCalculatorInstallationState(
  definitions: readonly CalculatorDefinition[] = CALCULATOR_REGISTRY,
): CalculatorInstallationState {
  try {
    const raw = storage()?.getItem(STORAGE_KEY);
    return stateFromSectionIds(raw ? sectionIdsFromSnapshot(JSON.parse(raw)) : [], definitions);
  } catch {
    return stateFromSectionIds([], definitions);
  }
}

export function calculatorIdsInSection(
  sectionId: CalculatorSectionId,
  definitions: readonly CalculatorDefinition[] = CALCULATOR_REGISTRY,
): readonly string[] {
  return definitions
    .filter((definition) => definition.category === sectionId)
    .map((definition) => definition.id);
}

export function calculatorsInSection(
  sectionId: CalculatorSectionId,
  definitions: readonly CalculatorDefinition[] = CALCULATOR_REGISTRY,
): readonly CalculatorDefinition[] {
  return definitions.filter((definition) => definition.category === sectionId);
}

export function isCalculatorSectionComplete(
  sectionId: CalculatorSectionId,
  state: CalculatorInstallationState,
  definitions: readonly CalculatorDefinition[] = CALCULATOR_REGISTRY,
): boolean {
  const available = availableDefinitions(definitions, sectionId);
  return (
    state.sectionIds.has(sectionId) &&
    available.length > 0 &&
    available.every((definition) => state.installedIds.has(definition.id))
  );
}

function persist(
  sectionIds: ReadonlySet<CalculatorSectionId>,
  definitions: readonly CalculatorDefinition[],
): CalculatorInstallationState {
  const snapshot: StoredCalculatorInstallationSnapshot = {
    schemaVersion: 1,
    sectionIds: [...sectionIds].toSorted(),
  };
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {}
  const next = stateFromSectionIds(snapshot.sectionIds, definitions);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CALCULATOR_PACKS_EVENT));
  return next;
}

export function installCalculatorSection(
  sectionId: CalculatorSectionId,
  definitions: readonly CalculatorDefinition[] = CALCULATOR_REGISTRY,
): CalculatorInstallationState {
  if (!SECTION_IDS.has(sectionId)) return loadCalculatorInstallationState(definitions);
  const current = loadCalculatorInstallationState(definitions);
  const sectionIds = new Set(current.sectionIds);
  sectionIds.add(sectionId);
  return persist(sectionIds, definitions);
}

export function removeCalculatorSection(
  sectionId: CalculatorSectionId,
  definitions: readonly CalculatorDefinition[] = CALCULATOR_REGISTRY,
): CalculatorInstallationState {
  const current = loadCalculatorInstallationState(definitions);
  const sectionIds = new Set(current.sectionIds);
  sectionIds.delete(sectionId);
  return persist(sectionIds, definitions);
}
