import { type ToolAgeBound, ToolAgeBoundSchema } from '@localmed/contracts';
import {
  CALCULATOR_PACKS_EVENT,
  USER_CALCULATORS_EVENT,
} from '@/features/calculators/calculator-events';
import { USER_CALCULATOR_MODEL_ID } from '@/features/calculators/user-calculator/user-calculator-ids';
import {
  USER_CALCULATOR_DEFAULT_DISCLAIMER,
  USER_CALCULATOR_LIMITS,
} from '@/features/calculators/user-calculator/user-calculator-limits';
import {
  parseUserToolPopulation,
  type UserToolPopulation,
} from '@/features/tools/user-tool-population';

/**
 * The doctor's own calculators. A calculator is a small document — inputs, a formula typed as text,
 * a result and its ranges — that lives in the browser's `localStorage` (not in the user library) and
 * travels as a `.minimed-calculator` JSON file. Everything that comes from storage or a file is
 * validated here, at the boundary; the formula text itself is only ever read by the safe formula
 * compiler (`compileUserFormula`), never executed.
 */

export const USER_CALCULATOR_FORMAT = 'minimed-calculator';
export const USER_CALCULATOR_VERSION = 1;
export const USER_CALCULATOR_FILE_EXTENSION = '.minimed-calculator';
export const USER_CALCULATOR_MIME_TYPE = 'application/vnd.minimed.calculator+json';
export const USER_CALCULATORS_STORAGE_KEY = 'minimed.user-calculators.v1';
/** Where the unreadable raw text goes before it is overwritten, so nothing is lost silently. */
const CORRUPT_BACKUP_KEY = `${USER_CALCULATORS_STORAGE_KEY}.corrupt`;

export { USER_CALCULATORS_EVENT };

export interface UserCalculatorInput {
  /** Stable internal id (`x1`, `x2`…): what the compiled formula refers to. */
  readonly id: string;
  /** The variable the formula uses for this value. */
  readonly name: string;
  readonly label: string;
  readonly unit: string;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly integer: boolean;
}

export interface UserCalculatorBand {
  readonly id: string;
  /** Inclusive lower limit of the (rounded) result; absent means no lower limit. */
  readonly min?: number;
  /** Inclusive upper limit; absent means no upper limit. */
  readonly max?: number;
  readonly headline: string;
  readonly message: string;
}

export interface UserCalculatorResult {
  readonly label: string;
  readonly unit: string;
  readonly decimals: number;
}

export interface UserCalculator {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly disclaimer: string;
  /** Unset until the author chooses: a calculator cannot run without it. */
  readonly population?: UserToolPopulation;
  readonly inputs: readonly UserCalculatorInput[];
  readonly result: UserCalculatorResult;
  readonly formula: string;
  readonly bands: readonly UserCalculatorBand[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

const INPUT_ID = /^x\d{1,4}$/u;
const BAND_ID = /^b\d{1,4}$/u;

// --- Validation ----------------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(message: string): never {
  throw new Error(message);
}

function readText(
  value: unknown,
  label: string,
  maximum: number,
  options: { readonly fallback?: string; readonly required?: boolean } = {},
): string {
  if (value === undefined || value === null) {
    if (options.fallback !== undefined) return options.fallback;
    return fail(`${label}: заполните это поле.`);
  }
  if (typeof value !== 'string') return fail(`${label}: ожидается текст.`);
  if (value.length > maximum) return fail(`${label}: не длиннее ${maximum} символов.`);
  if (options.required && value.trim() === '') return fail(`${label}: заполните это поле.`);
  return value;
}

function readLimit(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fail(`${label}: ожидается число.`);
  }
  if (Math.abs(value) > USER_CALCULATOR_LIMITS.magnitude) {
    return fail(`${label}: число слишком большое (не больше ${USER_CALCULATOR_LIMITS.magnitude}).`);
  }
  return value;
}

function readDate(value: unknown, label: string, fallback: string | undefined): string {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'string' || value.length > 40 || Number.isNaN(Date.parse(value))) {
    return fail(`${label}: ожидается дата.`);
  }
  return value;
}

function nextFreeId(prefix: 'x' | 'b', used: ReadonlySet<string>): string {
  for (let number = 1; number < 10_000; number += 1) {
    const candidate = `${prefix}${number}`;
    if (!used.has(candidate)) return candidate;
  }
  return fail('Слишком много элементов.');
}

function readId(
  value: unknown,
  pattern: RegExp,
  prefix: 'x' | 'b',
  label: string,
  used: Set<string>,
  generate: boolean,
): string {
  let id: string;
  if (value === undefined && generate) id = nextFreeId(prefix, used);
  else if (typeof value === 'string' && pattern.test(value)) id = value;
  else return fail(`${label}: неверный идентификатор.`);
  if (used.has(id)) return fail(`${label}: идентификатор «${id}» повторяется.`);
  used.add(id);
  return id;
}

export type UserCalculatorSource = 'storage' | 'file';

/**
 * A draft keeps whatever age limits the author typed so far, even contradictory ones (the editor
 * reports them); only a file must carry a population that is valid on its own.
 */
function readDraftPopulation(value: unknown): UserToolPopulation {
  if (!isRecord(value)) return fail('Возраст пациентов указан неверно.');
  const group = value['group'];
  if (group !== 'children' && group !== 'adults' && group !== 'any') {
    return fail('Возраст пациентов: выберите детей, взрослых или любой возраст.');
  }
  const bound = (raw: unknown, label: string): ToolAgeBound | undefined => {
    if (raw === undefined) return undefined;
    const parsed = ToolAgeBoundSchema.safeParse(raw);
    return parsed.success ? parsed.data : fail(`Возраст пациентов: ${label} указана неверно.`);
  };
  const minAge = bound(value['minAge'], 'нижняя граница');
  const maxAge = bound(value['maxAge'], 'верхняя граница');
  return {
    group,
    ...(group === 'children' && value['neonates'] === true ? { neonates: true } : {}),
    ...(minAge ? { minAge } : {}),
    ...(maxAge ? { maxAge } : {}),
  };
}

/**
 * Reads one calculator from untrusted JSON. Structure, types and bounds are checked; whether the
 * calculator is *finished* (a formula that compiles, a population…) is a separate question answered
 * by the editor, because a half-written draft must survive a reload. A file must name its calculator;
 * its ids and dates, if absent, are generated.
 */
export function parseUserCalculator(
  value: unknown,
  source: UserCalculatorSource = 'storage',
): UserCalculator {
  if (!isRecord(value)) return fail('Калькулятор: ожидается объект.');
  const fromFile = source === 'file';
  const limits = USER_CALCULATOR_LIMITS;
  const now = new Date().toISOString();

  const id =
    fromFile && value['id'] === undefined
      ? createUserCalculatorId()
      : typeof value['id'] === 'string' && USER_CALCULATOR_MODEL_ID.test(value['id'])
        ? value['id']
        : fail('Калькулятор: неверный идентификатор.');
  const title = readText(value['title'], 'Название', limits.title, { required: fromFile });
  const description = readText(value['description'], 'Описание', limits.description, {
    fallback: '',
  });
  const disclaimer = readText(value['disclaimer'], 'Ограничение', limits.disclaimer, {
    fallback: USER_CALCULATOR_DEFAULT_DISCLAIMER,
  });
  const formula = readText(value['formula'], 'Формула', limits.formula, {
    ...(fromFile ? {} : { fallback: '' }),
  });

  const rawInputs = value['inputs'];
  if (!Array.isArray(rawInputs)) return fail('Входные данные: ожидается список.');
  if (rawInputs.length > limits.inputs) {
    return fail(`Входные данные: не больше ${limits.inputs}.`);
  }
  const inputIds = new Set<string>();
  const inputs = rawInputs.map((raw, index): UserCalculatorInput => {
    const label = `Данные ${index + 1}`;
    if (!isRecord(raw)) return fail(`${label}: ожидается объект.`);
    const minimum = readLimit(raw['minimum'], `${label}, минимум`);
    const maximum = readLimit(raw['maximum'], `${label}, максимум`);
    if (raw['integer'] !== undefined && typeof raw['integer'] !== 'boolean') {
      return fail(`${label}: «целое число» — это да или нет.`);
    }
    return {
      id: readId(raw['id'], INPUT_ID, 'x', label, inputIds, fromFile),
      name: readText(raw['name'], `${label}, имя в формуле`, limits.name, { fallback: '' }),
      label: readText(raw['label'], `${label}, подпись`, limits.label, { fallback: '' }),
      unit: readText(raw['unit'], `${label}, единица`, limits.unit, { fallback: '' }),
      ...(minimum === undefined ? {} : { minimum }),
      ...(maximum === undefined ? {} : { maximum }),
      integer: raw['integer'] === true,
    };
  });

  const rawResult = value['result'];
  if (!isRecord(rawResult)) return fail('Результат: ожидается объект.');
  const decimals = rawResult['decimals'] ?? 1;
  if (
    typeof decimals !== 'number' ||
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > limits.decimals
  ) {
    return fail(`Результат, знаков после запятой: целое число от 0 до ${limits.decimals}.`);
  }
  const result: UserCalculatorResult = {
    label: readText(rawResult['label'], 'Результат, название', limits.label, {
      fallback: 'Результат',
    }),
    unit: readText(rawResult['unit'], 'Результат, единица', limits.unit, { fallback: '' }),
    decimals,
  };

  const rawBands = value['bands'] ?? [];
  if (!Array.isArray(rawBands)) return fail('Диапазоны: ожидается список.');
  if (rawBands.length > limits.bands) return fail(`Диапазоны: не больше ${limits.bands}.`);
  const bandIds = new Set<string>();
  const bands = rawBands.map((raw, index): UserCalculatorBand => {
    const label = `Диапазон ${index + 1}`;
    if (!isRecord(raw)) return fail(`${label}: ожидается объект.`);
    const min = readLimit(raw['min'], `${label}, «от»`);
    const max = readLimit(raw['max'], `${label}, «до»`);
    return {
      id: readId(raw['id'], BAND_ID, 'b', label, bandIds, fromFile),
      ...(min === undefined ? {} : { min }),
      ...(max === undefined ? {} : { max }),
      headline: readText(raw['headline'], `${label}, заголовок`, limits.headline, {
        fallback: '',
      }),
      message: readText(raw['message'], `${label}, пояснение`, limits.message, { fallback: '' }),
    };
  });

  const rawPopulation = value['population'];
  const population =
    rawPopulation === undefined || rawPopulation === null
      ? undefined
      : fromFile
        ? parseUserToolPopulation(rawPopulation)
        : readDraftPopulation(rawPopulation);

  return {
    id,
    title,
    description,
    disclaimer,
    ...(population ? { population } : {}),
    inputs,
    result,
    formula,
    bands,
    createdAt: readDate(value['createdAt'], 'Дата создания', fromFile ? now : undefined),
    updatedAt: readDate(value['updatedAt'], 'Дата изменения', fromFile ? now : undefined),
  };
}

/** The `.minimed-calculator` text: the model plus the format marker. */
export function serializeUserCalculatorFile(model: UserCalculator): string {
  return `${JSON.stringify(
    { format: USER_CALCULATOR_FORMAT, version: USER_CALCULATOR_VERSION, ...model },
    null,
    2,
  )}\n`;
}

/** Reads a `.minimed-calculator` text; throws a plain Russian message when it is not one. */
export function parseUserCalculatorFile(text: string): UserCalculator {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fail('Выберите файл калькулятора MiniMed в формате JSON.');
  }
  if (!isRecord(parsed) || parsed['format'] !== USER_CALCULATOR_FORMAT) {
    return fail(`Это не файл калькулятора MiniMed: ожидается формат «${USER_CALCULATOR_FORMAT}».`);
  }
  const version = parsed['version'];
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return fail('Версия файла калькулятора указана неверно.');
  }
  if (version > USER_CALCULATOR_VERSION) {
    return fail(
      'Файл создан в более новой версии MiniMed. Обновите приложение, чтобы открыть его.',
    );
  }
  return parseUserCalculator(parsed, 'file');
}

// --- Identity ------------------------------------------------------------------------------------

function randomChars(length: number): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

export function createUserCalculatorId(): string {
  return `uc-${randomChars(12)}`;
}

export function newUserCalculator(now: string = new Date().toISOString()): UserCalculator {
  return {
    id: createUserCalculatorId(),
    title: 'Новый калькулятор',
    description: '',
    disclaimer: USER_CALCULATOR_DEFAULT_DISCLAIMER,
    inputs: [],
    result: { label: 'Результат', unit: '', decimals: 1 },
    formula: '',
    bands: [],
    createdAt: now,
    updatedAt: now,
  };
}

// --- Storage -------------------------------------------------------------------------------------

interface StoreContents {
  readonly items: readonly UserCalculator[];
  /** Entries that failed validation, kept as they were so a write does not drop them. */
  readonly rejected: readonly unknown[];
  /** The raw text when the whole value was unreadable. */
  readonly corruptRaw?: string;
}

let storageProblems: readonly string[] = [];

/** What could not be read from storage the last time it was read, in plain Russian. */
export function userCalculatorStorageProblems(): readonly string[] {
  return storageProblems;
}

function deviceStorage(): Storage {
  let storage: Storage | undefined;
  try {
    storage = globalThis.localStorage;
  } catch (cause) {
    return fail(
      `Хранилище устройства недоступно: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  if (storage === undefined) return fail('Хранилище устройства недоступно.');
  return storage;
}

function readStore(): StoreContents {
  const problems: string[] = [];
  let contents: StoreContents = { items: [], rejected: [] };
  try {
    const raw = deviceStorage().getItem(USER_CALCULATORS_STORAGE_KEY);
    if (raw !== null) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        problems.push(
          'Список своих калькуляторов повреждён и не прочитан. Исходный текст сохранён.',
        );
        parsed = undefined;
        contents = { items: [], rejected: [], corruptRaw: raw };
      }
      if (parsed !== undefined) {
        if (!isRecord(parsed) || !Array.isArray(parsed['items'])) {
          problems.push('Список своих калькуляторов имеет неизвестный вид и не прочитан.');
          contents = { items: [], rejected: [], corruptRaw: raw };
        } else {
          const items: UserCalculator[] = [];
          const rejected: unknown[] = [];
          for (const [index, entry] of parsed['items'].entries()) {
            try {
              items.push(parseUserCalculator(entry, 'storage'));
            } catch (cause) {
              rejected.push(entry);
              problems.push(
                `Калькулятор ${index + 1} не прочитан: ${cause instanceof Error ? cause.message : String(cause)}`,
              );
            }
          }
          contents = { items, rejected };
        }
      }
    }
  } catch (cause) {
    problems.push(cause instanceof Error ? cause.message : String(cause));
  }
  storageProblems = problems;
  return contents;
}

function announceChange(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(USER_CALCULATORS_EVENT));
  window.dispatchEvent(new Event(CALCULATOR_PACKS_EVENT));
}

function writeStore(items: readonly UserCalculator[], before: StoreContents): void {
  try {
    const storage = deviceStorage();
    if (before.corruptRaw !== undefined) storage.setItem(CORRUPT_BACKUP_KEY, before.corruptRaw);
    storage.setItem(
      USER_CALCULATORS_STORAGE_KEY,
      JSON.stringify({ version: USER_CALCULATOR_VERSION, items: [...items, ...before.rejected] }),
    );
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    fail(`Не удалось сохранить калькуляторы на устройстве: ${reason}`);
  }
  announceChange();
}

export function listUserCalculators(): readonly UserCalculator[] {
  return readStore().items.toSorted(
    (left, right) =>
      right.updatedAt.localeCompare(left.updatedAt) || left.title.localeCompare(right.title, 'ru'),
  );
}

export function getUserCalculator(id: string): UserCalculator | undefined {
  return readStore().items.find((item) => item.id === id);
}

export function createUserCalculator(draft?: UserCalculator): UserCalculator {
  const store = readStore();
  if (store.items.length >= USER_CALCULATOR_LIMITS.calculators) {
    return fail(
      `Можно хранить не больше ${USER_CALCULATOR_LIMITS.calculators} своих калькуляторов.`,
    );
  }
  const model = parseUserCalculator(draft ?? newUserCalculator(), 'storage');
  writeStore([...store.items, model], store);
  return model;
}

/** Saves an edited calculator; the change time is set here. */
export function saveUserCalculator(model: UserCalculator): UserCalculator {
  const store = readStore();
  const checked = parseUserCalculator({ ...model, updatedAt: new Date().toISOString() }, 'storage');
  if (!store.items.some((item) => item.id === checked.id)) return fail('Калькулятор не найден.');
  writeStore(
    store.items.map((item) => (item.id === checked.id ? checked : item)),
    store,
  );
  return checked;
}

/** A copy under a new id and the name «… (копия)». */
export function duplicateUserCalculator(id: string): UserCalculator {
  const source = getUserCalculator(id);
  if (!source) return fail('Калькулятор не найден.');
  const now = new Date().toISOString();
  const suffix = ' (копия)';
  return createUserCalculator({
    ...source,
    id: createUserCalculatorId(),
    title: `${source.title.slice(0, USER_CALCULATOR_LIMITS.title - suffix.length)}${suffix}`,
    createdAt: now,
    updatedAt: now,
  });
}

export function deleteUserCalculator(id: string): void {
  const store = readStore();
  if (!store.items.some((item) => item.id === id)) fail('Калькулятор не найден.');
  writeStore(
    store.items.filter((item) => item.id !== id),
    store,
  );
}

// --- Files ---------------------------------------------------------------------------------------

function fileNameFor(title: string): string {
  const base = title
    .trim()
    .toLocaleLowerCase('ru-RU')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 60);
  return `${base || 'калькулятор'}${USER_CALCULATOR_FILE_EXTENSION}`;
}

export function exportUserCalculator(id: string): File {
  const model = getUserCalculator(id);
  if (!model) return fail('Калькулятор не найден.');
  return new File([serializeUserCalculatorFile(model)], fileNameFor(model.title), {
    type: USER_CALCULATOR_MIME_TYPE,
  });
}

/** Imports a `.minimed-calculator` file as a new calculator (new id, new dates). */
export async function importUserCalculator(file: File): Promise<UserCalculator> {
  if (file.size > USER_CALCULATOR_LIMITS.fileBytes) {
    return fail('Файл слишком большой для калькулятора MiniMed.');
  }
  const source = parseUserCalculatorFile(await file.text());
  const now = new Date().toISOString();
  return createUserCalculator({
    ...source,
    id: createUserCalculatorId(),
    createdAt: now,
    updatedAt: now,
  });
}
