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
  readonly calculatorIds: ReadonlySet<string>;
  readonly installedIds: ReadonlySet<string>;
}

interface StoredCalculatorInstallationSnapshot {
  readonly schemaVersion: 1 | 2;
  readonly sectionIds: readonly CalculatorSectionId[];
  readonly calculatorIds?: readonly string[];
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
  'emergency',
  'cardiology',
  'gastroenterology',
  'hematology',
  'neonatology',
]);

export const CALCULATOR_PACKS_EVENT = 'minimed:calculator-packs-changed';
let databaseCalculatorIds: ReadonlySet<string> = new Set();

export function setDatabaseCalculatorIds(ids: readonly string[]): void {
  databaseCalculatorIds = new Set(ids);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CALCULATOR_PACKS_EVENT));
}

/**
 * Calculators with no specialty tie (unlike renal/obstetrics/etc.) that stay usable without an
 * explicit section download. Keep this list short and only add calculators nothing else depends on.
 */
export const CORE_CALCULATOR_IDS: ReadonlySet<string> = new Set(['unit-conversion']);

/** Maps calculator sections to downloadable tool-module catalog ids. */
export const CALCULATOR_SECTION_MODULE_IDS: Readonly<Partial<Record<CalculatorSectionId, string>>> =
  {
    anthropometry: 'minimed.tools.core-clinical.ru',
    renal: 'minimed.tools.core-clinical.ru',
    fluids: 'minimed.tools.core-clinical.ru',
    cardiology: 'minimed.tools.core-clinical.ru',
    hematology: 'minimed.tools.core-clinical.ru',
    gastroenterology: 'minimed.tools.gastroenterology.ru',
    emergency: 'minimed.tools.emergency.ru',
    neonatology: 'minimed.tools.neonatology.ru',
    obstetrics: 'minimed.tools.obstetrics-gynecology.ru',
    gynecology: 'minimed.tools.obstetrics-gynecology.ru',
  };

export function moduleIdForCalculatorSection(sectionId: CalculatorSectionId): string | undefined {
  return CALCULATOR_SECTION_MODULE_IDS[sectionId];
}

/**
 * Links a calculator section to the clinical-recommendation categories (real ids from
 * catalog.preview.json) it's most relevant to. Sections without an unambiguous specialty match
 * (unit-conversion, medication) are intentionally left unlinked.
 */
export const CALCULATOR_SECTION_CATEGORY_IDS: Readonly<
  Record<CalculatorSectionId, readonly string[]>
> = {
  'unit-conversion': [],
  anthropometry: ['minimed.clinical.pediatrics-general.ru'],
  renal: ['minimed.clinical.nephrology-urology.ru'],
  fluids: ['minimed.clinical.pediatrics-general.ru'],
  medication: [],
  screening: [],
  obstetrics: ['minimed.clinical.obstetrics-gynecology.ru'],
  gynecology: ['minimed.clinical.obstetrics-gynecology.ru'],
  emergency: ['minimed.clinical.pediatrics.surgery-trauma'],
  cardiology: [],
  gastroenterology: ['minimed.clinical.pediatrics.gastro-nutrition'],
  hematology: [],
  neonatology: ['minimed.clinical.neonatology.ru'],
};

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
    description: 'Поддерживающая жидкость и пероральная регидратация у детей.',
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
  {
    id: 'emergency',
    title: 'Неотложная помощь',
    description: 'Электролиты, кислотно-основное состояние, шок и ожоговая травма.',
  },
  {
    id: 'cardiology',
    title: 'Кардиология',
    description: 'Риск инсульта при фибрилляции предсердий и коррекция QT.',
  },
  {
    id: 'gastroenterology',
    title: 'Гастроэнтерология',
    description: 'Неинвазивные индексы фиброза и оценка функции печени.',
  },
  {
    id: 'hematology',
    title: 'Гематология',
    description: 'Базовые расчёты нейтрофилов, ретикулоцитов и эритроцитарных индексов.',
  },
  {
    id: 'neonatology',
    title: 'Неонатология',
    description: 'Инфузия глюкозы, физиологическая убыль массы и гестационный возраст.',
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
  if (
    (snapshot.schemaVersion !== 1 && snapshot.schemaVersion !== 2) ||
    !Array.isArray(snapshot.sectionIds)
  )
    return [];
  return [
    ...new Set(
      snapshot.sectionIds.filter(
        (id): id is CalculatorSectionId =>
          typeof id === 'string' && SECTION_IDS.has(id as CalculatorSectionId),
      ),
    ),
  ].toSorted();
}

function calculatorIdsFromSnapshot(value: unknown): readonly string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const snapshot = value as Partial<StoredCalculatorInstallationSnapshot>;
  if (snapshot.schemaVersion !== 2 || !Array.isArray(snapshot.calculatorIds)) return [];
  return [...new Set(snapshot.calculatorIds.filter((id): id is string => typeof id === 'string'))];
}

function installedIdsFromSections(
  sectionIds: ReadonlySet<CalculatorSectionId>,
  calculatorIds: ReadonlySet<string>,
  definitions: readonly CalculatorDefinition[],
): ReadonlySet<string> {
  return new Set(
    definitions
      .filter(
        (definition) =>
          definition.state === 'available' &&
          (CORE_CALCULATOR_IDS.has(definition.id) ||
            sectionIds.has(definition.category) ||
            calculatorIds.has(definition.id) ||
            databaseCalculatorIds.has(definition.id)),
      )
      .map((definition) => definition.id),
  );
}

function stateFromSectionIds(
  sectionIds: readonly CalculatorSectionId[],
  definitions: readonly CalculatorDefinition[],
  calculatorIds: readonly string[] = [],
): CalculatorInstallationState {
  const selected = new Set(sectionIds);
  const selectedCalculators = new Set(
    definitions
      .filter(
        (definition) => definition.state === 'available' && calculatorIds.includes(definition.id),
      )
      .map((definition) => definition.id),
  );
  return {
    sectionIds: selected,
    calculatorIds: selectedCalculators,
    installedIds: installedIdsFromSections(selected, selectedCalculators, definitions),
  };
}

export function loadCalculatorInstallationState(
  definitions: readonly CalculatorDefinition[] = CALCULATOR_REGISTRY,
): CalculatorInstallationState {
  try {
    const raw = storage()?.getItem(STORAGE_KEY);
    const snapshot = raw ? JSON.parse(raw) : null;
    return stateFromSectionIds(
      sectionIdsFromSnapshot(snapshot),
      definitions,
      calculatorIdsFromSnapshot(snapshot),
    );
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
    available.length > 0 && available.every((definition) => state.installedIds.has(definition.id))
  );
}

export function isCalculatorSectionCore(
  sectionId: CalculatorSectionId,
  definitions: readonly CalculatorDefinition[] = CALCULATOR_REGISTRY,
): boolean {
  const available = availableDefinitions(definitions, sectionId);
  return (
    available.length > 0 && available.every((definition) => CORE_CALCULATOR_IDS.has(definition.id))
  );
}

function persist(
  sectionIds: ReadonlySet<CalculatorSectionId>,
  calculatorIds: ReadonlySet<string>,
  definitions: readonly CalculatorDefinition[],
): CalculatorInstallationState {
  const snapshot: StoredCalculatorInstallationSnapshot = {
    schemaVersion: 2,
    sectionIds: [...sectionIds].toSorted(),
    calculatorIds: [...calculatorIds].toSorted(),
  };
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {}
  const next = stateFromSectionIds(snapshot.sectionIds, definitions, snapshot.calculatorIds);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CALCULATOR_PACKS_EVENT));
  return next;
}

export function installCalculatorSection(
  sectionId: CalculatorSectionId,
  definitions: readonly CalculatorDefinition[] = CALCULATOR_REGISTRY,
): CalculatorInstallationState {
  if (!SECTION_IDS.has(sectionId) || availableDefinitions(definitions, sectionId).length === 0) {
    return loadCalculatorInstallationState(definitions);
  }
  const current = loadCalculatorInstallationState(definitions);
  const sectionIds = new Set(current.sectionIds);
  const calculatorIds = new Set(current.calculatorIds);
  sectionIds.add(sectionId);
  for (const definition of availableDefinitions(definitions, sectionId)) {
    calculatorIds.delete(definition.id);
  }
  return persist(sectionIds, calculatorIds, definitions);
}

export function installCalculator(
  calculatorId: string,
  definitions: readonly CalculatorDefinition[] = CALCULATOR_REGISTRY,
): CalculatorInstallationState {
  const definition = definitions.find(
    (candidate) => candidate.id === calculatorId && candidate.state === 'available',
  );
  if (!definition) return loadCalculatorInstallationState(definitions);

  const current = loadCalculatorInstallationState(definitions);
  const sectionIds = new Set(current.sectionIds);
  const calculatorIds = new Set(current.calculatorIds);
  calculatorIds.add(definition.id);
  const available = availableDefinitions(definitions, definition.category);
  if (
    available.every(
      (candidate) => current.installedIds.has(candidate.id) || candidate.id === definition.id,
    )
  ) {
    sectionIds.add(definition.category);
    for (const candidate of available) calculatorIds.delete(candidate.id);
  }
  return persist(sectionIds, calculatorIds, definitions);
}

export function removeCalculatorSection(
  sectionId: CalculatorSectionId,
  definitions: readonly CalculatorDefinition[] = CALCULATOR_REGISTRY,
): CalculatorInstallationState {
  const current = loadCalculatorInstallationState(definitions);
  const sectionIds = new Set(current.sectionIds);
  const calculatorIds = new Set(current.calculatorIds);
  sectionIds.delete(sectionId);
  for (const definition of availableDefinitions(definitions, sectionId)) {
    calculatorIds.delete(definition.id);
  }
  return persist(sectionIds, calculatorIds, definitions);
}
