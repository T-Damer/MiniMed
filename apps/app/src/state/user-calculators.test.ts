import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CALCULATOR_PACKS_EVENT,
  USER_CALCULATORS_EVENT,
} from '@/features/calculators/calculator-events';
import { USER_CALCULATOR_LIMITS } from '@/features/calculators/user-calculator/user-calculator-limits';
import {
  createUserCalculator,
  deleteUserCalculator,
  duplicateUserCalculator,
  exportUserCalculator,
  getUserCalculator,
  importUserCalculator,
  listUserCalculators,
  newUserCalculator,
  parseUserCalculator,
  parseUserCalculatorFile,
  saveUserCalculator,
  serializeUserCalculatorFile,
  USER_CALCULATOR_FILE_EXTENSION,
  USER_CALCULATOR_FORMAT,
  USER_CALCULATOR_MIME_TYPE,
  USER_CALCULATORS_STORAGE_KEY,
  type UserCalculator,
  userCalculatorStorageProblems,
} from '@/state/user-calculators';

class FakeStorage implements Storage {
  readonly values = new Map<string, string>();
  failWrites = false;
  get length(): number {
    return this.values.size;
  }
  clear(): void {
    this.values.clear();
  }
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
  setItem(key: string, value: string): void {
    if (this.failWrites) throw new DOMException('quota', 'QuotaExceededError');
    this.values.set(key, value);
  }
}

let storage: FakeStorage;
let events: string[];

beforeEach(() => {
  storage = new FakeStorage();
  const target = new EventTarget();
  events = [];
  for (const name of [USER_CALCULATORS_EVENT, CALCULATOR_PACKS_EVENT]) {
    target.addEventListener(name, () => events.push(name));
  }
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('window', target);
});

afterEach(() => vi.unstubAllGlobals());

function bmi(overrides: Partial<UserCalculator> = {}): UserCalculator {
  return {
    ...newUserCalculator('2026-10-05T10:00:00.000Z'),
    title: 'ИМТ',
    description: 'Индекс массы тела',
    population: { group: 'adults' },
    inputs: [
      {
        id: 'x1',
        name: 'масса',
        label: 'Масса',
        unit: 'кг',
        minimum: 20,
        maximum: 300,
        integer: false,
      },
      {
        id: 'x2',
        name: 'рост',
        label: 'Рост',
        unit: 'см',
        minimum: 50,
        maximum: 250,
        integer: true,
      },
    ],
    result: { label: 'ИМТ', unit: 'кг/м²', decimals: 1 },
    formula: 'масса / (рост / 100) ^ 2',
    bands: [
      { id: 'b1', max: 18.4, headline: 'Дефицит', message: 'ИМТ ниже нормы.' },
      { id: 'b2', min: 18.5, max: 24.9, headline: 'Норма', message: '' },
    ],
    ...overrides,
  };
}

describe('parsing at the boundary', () => {
  it('reads a calculator it wrote itself', () => {
    const model = bmi();
    expect(parseUserCalculator(JSON.parse(JSON.stringify(model)))).toEqual(model);
  });

  it('keeps a half-written draft: nothing is required but its shape', () => {
    const draft = newUserCalculator();
    expect(parseUserCalculator({ ...draft, title: '' })).toMatchObject({ title: '', inputs: [] });
  });

  it.each([
    [
      'a title longer than the limit',
      { title: 'я'.repeat(USER_CALCULATOR_LIMITS.title + 1) },
      'Название: не длиннее 120 символов.',
    ],
    ['a title that is not text', { title: 5 }, 'Название: ожидается текст.'],
    [
      'a formula longer than the limit',
      { formula: 'a'.repeat(501) },
      'Формула: не длиннее 500 символов.',
    ],
    ['an id that is not ours', { id: 'x; drop' }, 'Калькулятор: неверный идентификатор.'],
    ['inputs that are not a list', { inputs: {} }, 'Входные данные: ожидается список.'],
    [
      'too many inputs',
      {
        inputs: Array.from({ length: 21 }, (_, index) => ({
          id: `x${index + 1}`,
          name: `n${index}`,
          label: 'a',
          unit: '',
          integer: false,
        })),
      },
      'Входные данные: не больше 20.',
    ],
    [
      'too many bands',
      {
        bands: Array.from({ length: 13 }, (_, index) => ({
          id: `b${index + 1}`,
          headline: 'a',
          message: '',
        })),
      },
      'Диапазоны: не больше 12.',
    ],
    [
      'a limit that is not a number',
      { inputs: [{ id: 'x1', name: 'a', label: 'A', unit: '', minimum: 'low', integer: false }] },
      'Данные 1, минимум: ожидается число.',
    ],
    [
      'a limit beyond the magnitude',
      { inputs: [{ id: 'x1', name: 'a', label: 'A', unit: '', maximum: 1e12, integer: false }] },
      'Данные 1, максимум: число слишком большое',
    ],
    [
      'an infinite limit',
      { bands: [{ id: 'b1', min: Number.POSITIVE_INFINITY, headline: 'a', message: '' }] },
      'Диапазон 1, «от»: ожидается число.',
    ],
    [
      'a duplicated input id',
      {
        inputs: [
          { id: 'x1', name: 'a', label: 'A', unit: '', integer: false },
          { id: 'x1', name: 'b', label: 'B', unit: '', integer: false },
        ],
      },
      'Данные 2: идентификатор «x1» повторяется.',
    ],
    [
      'decimals out of range',
      { result: { label: 'R', unit: '', decimals: 9 } },
      'Результат, знаков после запятой: целое число от 0 до 6.',
    ],
    ['a date that is not a date', { updatedAt: 'yesterday' }, 'Дата изменения: ожидается дата.'],
    [
      'a population of nonsense',
      { population: { group: 'martians' } },
      'Возраст пациентов: выберите детей, взрослых или любой возраст.',
    ],
  ])('rejects %s', (_name, patch, message) => {
    expect(() => parseUserCalculator({ ...bmi(), ...patch })).toThrow(message);
  });

  it('rejects something that is not an object', () => {
    for (const value of [null, 'text', 5, [], undefined]) {
      expect(() => parseUserCalculator(value)).toThrow('Калькулятор: ожидается объект.');
    }
  });

  it('treats a null limit as no limit', () => {
    const parsed = parseUserCalculator({
      ...bmi(),
      inputs: [{ id: 'x1', name: 'a', label: 'A', unit: '', minimum: null, integer: false }],
    });
    expect(parsed.inputs[0]).not.toHaveProperty('minimum');
  });

  it('keeps contradictory age limits in a draft but not in a file', () => {
    const contradictory = {
      group: 'children',
      minAge: { value: 12, unit: 'years' },
      maxAge: { value: 3, unit: 'years' },
    };
    expect(parseUserCalculator({ ...bmi(), population: contradictory }).population).toEqual(
      contradictory,
    );
    expect(() => parseUserCalculator({ ...bmi(), population: contradictory }, 'file')).toThrow(
      'Нижняя граница возраста больше верхней',
    );
  });
});

describe('the .minimed-calculator file', () => {
  it('names its format and version and survives export → import unchanged', () => {
    const model = bmi();
    const text = serializeUserCalculatorFile(model);
    const raw = JSON.parse(text) as Record<string, unknown>;
    expect(raw['format']).toBe(USER_CALCULATOR_FORMAT);
    expect(raw['version']).toBe(1);
    expect(parseUserCalculatorFile(text)).toEqual(model);
  });

  it('fills what a hand-written file leaves out and generates ids and dates', () => {
    const parsed = parseUserCalculatorFile(
      JSON.stringify({
        format: 'minimed-calculator',
        version: 1,
        title: 'Сумма',
        inputs: [
          { name: 'a', label: 'A' },
          { name: 'b', label: 'B' },
        ],
        formula: 'a + b',
        result: { label: 'Сумма' },
      }),
    );
    expect(parsed.inputs.map((input) => input.id)).toEqual(['x1', 'x2']);
    expect(parsed.id).toMatch(/^uc-[a-z0-9]{12}$/u);
    expect(parsed.disclaimer).toBe(
      'Авторский калькулятор. Результат не заменяет клиническую оценку.',
    );
    expect(parsed.result).toEqual({ label: 'Сумма', unit: '', decimals: 1 });
    expect(parsed.population).toBeUndefined();
    expect(parsed.bands).toEqual([]);
    expect(Date.parse(parsed.createdAt)).not.toBeNaN();
  });

  it('refuses what is not a calculator file, in plain Russian', () => {
    expect(() => parseUserCalculatorFile('{ not json')).toThrow(
      'Выберите файл калькулятора MiniMed в формате JSON.',
    );
    expect(() => parseUserCalculatorFile('{"format":"other","version":1}')).toThrow(
      'Это не файл калькулятора MiniMed',
    );
    expect(() => parseUserCalculatorFile('[]')).toThrow('Это не файл калькулятора MiniMed');
    expect(() =>
      parseUserCalculatorFile('{"format":"minimed-calculator","version":2,"title":"x"}'),
    ).toThrow('более новой версии');
    expect(() =>
      parseUserCalculatorFile('{"format":"minimed-calculator","version":"1","title":"x"}'),
    ).toThrow('Версия файла калькулятора указана неверно.');
    expect(() =>
      parseUserCalculatorFile(
        JSON.stringify({
          format: 'minimed-calculator',
          version: 1,
          inputs: [],
          formula: '',
          result: {},
        }),
      ),
    ).toThrow('Название: заполните это поле.');
    expect(() =>
      parseUserCalculatorFile(
        JSON.stringify({
          format: 'minimed-calculator',
          version: 1,
          title: '  ',
          inputs: [],
          formula: '',
          result: {},
        }),
      ),
    ).toThrow('Название: заполните это поле.');
  });

  it('makes a File with the right name, type and extension', async () => {
    const created = createUserCalculator(bmi());
    const file = exportUserCalculator(created.id);
    expect(file.name).toBe(`имт${USER_CALCULATOR_FILE_EXTENSION}`);
    expect(file.type).toBe(USER_CALCULATOR_MIME_TYPE);
    expect(parseUserCalculatorFile(await file.text())).toEqual(created);
  });

  it('imports a file as a new calculator without touching the original', async () => {
    const original = createUserCalculator(bmi());
    const imported = await importUserCalculator(exportUserCalculator(original.id));
    expect(imported.id).not.toBe(original.id);
    expect({ ...imported, id: '', createdAt: '', updatedAt: '' }).toEqual({
      ...original,
      id: '',
      createdAt: '',
      updatedAt: '',
    });
    expect(
      listUserCalculators()
        .map((item) => item.id)
        .toSorted(),
    ).toEqual([original.id, imported.id].toSorted());
  });

  it('refuses a file that is not a calculator or is too large, and stores nothing', async () => {
    await expect(
      importUserCalculator(new File(['not json'], 'x.minimed-calculator')),
    ).rejects.toThrow('Выберите файл калькулятора MiniMed в формате JSON.');
    await expect(
      importUserCalculator(
        new File(['x'.repeat(USER_CALCULATOR_LIMITS.fileBytes + 1)], 'big.json'),
      ),
    ).rejects.toThrow('слишком большой');
    expect(listUserCalculators()).toEqual([]);
  });
});

describe('storage', () => {
  it('creates, lists, reads, saves, duplicates and deletes', () => {
    const created = createUserCalculator(bmi());
    expect(getUserCalculator(created.id)).toEqual(created);
    expect(listUserCalculators()).toEqual([created]);

    const saved = saveUserCalculator({ ...created, title: 'Индекс массы тела' });
    expect(saved.title).toBe('Индекс массы тела');
    expect(saved.updatedAt >= created.updatedAt).toBe(true);
    expect(getUserCalculator(created.id)?.title).toBe('Индекс массы тела');

    const copy = duplicateUserCalculator(created.id);
    expect(copy.id).not.toBe(created.id);
    expect(copy.title).toBe('Индекс массы тела (копия)');
    expect(copy.inputs).toEqual(created.inputs);
    expect(listUserCalculators()).toHaveLength(2);

    deleteUserCalculator(created.id);
    expect(listUserCalculators().map((item) => item.id)).toEqual([copy.id]);
    expect(getUserCalculator(created.id)).toBeUndefined();
  });

  it('seeds nothing and starts a new calculator as an empty draft', () => {
    expect(listUserCalculators()).toEqual([]);
    expect(storage.values.size).toBe(0);
    const draft = createUserCalculator();
    expect(draft).toMatchObject({ title: 'Новый калькулятор', inputs: [], formula: '', bands: [] });
    expect(draft.population).toBeUndefined();
  });

  it('keeps a copy title within the limit', () => {
    const created = createUserCalculator(bmi({ title: 'я'.repeat(USER_CALCULATOR_LIMITS.title) }));
    expect(duplicateUserCalculator(created.id).title.length).toBe(USER_CALCULATOR_LIMITS.title);
  });

  it('tells lists to refresh after every change', () => {
    const created = createUserCalculator(bmi());
    expect(events).toEqual([USER_CALCULATORS_EVENT, CALCULATOR_PACKS_EVENT]);
    events.length = 0;
    saveUserCalculator(created);
    deleteUserCalculator(created.id);
    expect(events).toHaveLength(4);
  });

  it('refuses to save or delete what is not there, and a model that breaks the format', () => {
    expect(() => saveUserCalculator(bmi())).toThrow('Калькулятор не найден.');
    expect(() => deleteUserCalculator('uc-aaaaaaaaaaaa')).toThrow('Калькулятор не найден.');
    expect(() => duplicateUserCalculator('uc-aaaaaaaaaaaa')).toThrow('Калькулятор не найден.');
    const created = createUserCalculator(bmi());
    expect(() => saveUserCalculator({ ...created, formula: 'a'.repeat(501) })).toThrow(
      'Формула: не длиннее 500 символов.',
    );
    expect(getUserCalculator(created.id)?.formula).toBe(created.formula);
  });

  it('refuses a second thousand calculators', () => {
    const items = Array.from({ length: USER_CALCULATOR_LIMITS.calculators }, () => ({
      ...bmi(),
      id: `uc-${Math.random().toString(36).slice(2, 14).padEnd(12, 'a')}`,
    }));
    storage.setItem(USER_CALCULATORS_STORAGE_KEY, JSON.stringify({ version: 1, items }));
    expect(() => createUserCalculator()).toThrow('Можно хранить не больше 200');
  });

  it('reports a failed write instead of swallowing it', () => {
    storage.failWrites = true;
    expect(() => createUserCalculator(bmi())).toThrow(
      'Не удалось сохранить калькуляторы на устройстве',
    );
    expect(events).toEqual([]);
  });

  it('reports an unreadable entry, keeps it through a write, and still lists the rest', () => {
    const good = bmi();
    const broken = { ...bmi(), id: 'uc-bbbbbbbbbbbb', title: 5 };
    storage.setItem(
      USER_CALCULATORS_STORAGE_KEY,
      JSON.stringify({ version: 1, items: [broken, good] }),
    );
    expect(listUserCalculators().map((item) => item.id)).toEqual([good.id]);
    expect(userCalculatorStorageProblems()).toEqual([
      'Калькулятор 1 не прочитан: Название: ожидается текст.',
    ]);

    saveUserCalculator({ ...good, title: 'Изменён' });
    const stored = JSON.parse(storage.getItem(USER_CALCULATORS_STORAGE_KEY) ?? '{}') as {
      items: { id: string }[];
    };
    expect(stored.items.map((item) => item.id).toSorted()).toEqual(
      [good.id, 'uc-bbbbbbbbbbbb'].toSorted(),
    );
  });

  it('backs up a list it cannot parse before it writes over it', () => {
    storage.setItem(USER_CALCULATORS_STORAGE_KEY, '{ broken');
    expect(listUserCalculators()).toEqual([]);
    expect(userCalculatorStorageProblems()[0]).toContain('повреждён');
    createUserCalculator(bmi());
    expect(storage.getItem(`${USER_CALCULATORS_STORAGE_KEY}.corrupt`)).toBe('{ broken');
    expect(listUserCalculators()).toHaveLength(1);
    expect(userCalculatorStorageProblems()).toEqual([]);
  });

  it('reports storage that is not available at all', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(listUserCalculators()).toEqual([]);
    expect(userCalculatorStorageProblems()).toEqual(['Хранилище устройства недоступно.']);
    expect(() => createUserCalculator(bmi())).toThrow('Хранилище устройства недоступно.');
  });
});
