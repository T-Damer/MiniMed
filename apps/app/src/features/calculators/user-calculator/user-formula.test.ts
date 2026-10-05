import { describe, expect, it } from 'vitest';
import { evaluateCalculatorExpression } from '@/features/calculators/calculator-expression';
import {
  compileUserFormula,
  suggestInputName,
  USER_FORMULA_FUNCTION_NAMES,
  USER_FORMULA_MAX_DEPTH,
  USER_FORMULA_MAX_LENGTH,
  userInputNameError,
} from '@/features/calculators/user-calculator/user-formula';

const INPUTS: readonly { id: string; name: string }[] = [
  { id: 'x1', name: 'масса' },
  { id: 'x2', name: 'рост' },
  { id: 'x3', name: 'возраст' },
  { id: 'x4', name: 'a' },
  { id: 'x5', name: 'b' },
];

function compile(text: string, inputs = INPUTS) {
  return compileUserFormula(text, inputs);
}

function expressionOf(text: string): string {
  const result = compile(text);
  if (!result.ok) throw new Error(`Не скомпилировалось: ${result.error}`);
  return result.expression;
}

function evaluate(text: string, scope: Record<string, number>): number {
  const value = evaluateCalculatorExpression(expressionOf(text), scope);
  if (typeof value !== 'number') throw new Error('не число');
  return value;
}

function errorOf(text: string, inputs = INPUTS): string {
  const result = compile(text, inputs);
  if (result.ok) throw new Error(`Формула «${text}» неожиданно принята: ${result.expression}`);
  return result.error;
}

describe('compileUserFormula: what it accepts', () => {
  it('replaces names with input ids and keeps the structure', () => {
    expect(expressionOf('масса / (рост / 100) ^ 2')).toBe('x1 / (x2 / 100)^2');
    expect(compile('масса / (рост / 100) ^ 2')).toMatchObject({ ok: true, usedIds: ['x1', 'x2'] });
  });

  it('computes the same numbers as mathematics does', () => {
    const scope = { x1: 70, x2: 170, x3: 40, x4: 3, x5: 4 };
    expect(evaluate('масса / (рост / 100) ^ 2', scope)).toBeCloseTo(70 / 1.7 ** 2, 10);
    expect(evaluate('(140 − возраст) × масса / (72 × 1)', scope)).toBeCloseTo(
      ((140 - 40) * 70) / 72,
      10,
    );
    expect(evaluate('sqrt(a ^ 2 + b ^ 2)', scope)).toBe(5);
    expect(evaluate('max(a; b) - min(a; b)', scope)).toBe(1);
  });

  it('follows the precedence of mathematics: signs, powers and associativity', () => {
    const scope = { x4: 3, x5: 2 };
    expect(evaluate('-a ^ 2', scope)).toBe(-9);
    expect(evaluate('(-a) ^ 2', scope)).toBe(9);
    expect(evaluate('2 ^ 3 ^ 2', scope)).toBe(512);
    expect(evaluate('2 ^ -1', scope)).toBe(0.5);
    expect(evaluate('a - b - 1', scope)).toBe(0);
    expect(evaluate('a - (b - 1)', scope)).toBe(2);
    expect(evaluate('a / b / 3', scope)).toBe(0.5);
    expect(evaluate('a / (b / 3)', scope)).toBeCloseTo(4.5, 12);
    expect(evaluate('2 * a ^ b', scope)).toBe(18);
    expect(evaluate('--a', scope)).toBe(3);
    expect(evaluate('+a - -b', scope)).toBe(5);
    expect(evaluate('a - b * 2 + 1', scope)).toBe(0);
  });

  it('accepts a decimal dot or comma, only between digits', () => {
    expect(expressionOf('масса * 2,5')).toBe('x1 * 2.5');
    expect(expressionOf('масса * 2.5')).toBe('x1 * 2.5');
    expect(evaluate('1,5 + 0,25', {})).toBe(1.75);
  });

  it('accepts the unicode signs a keyboard or a paste produces', () => {
    const scope = { x4: 6, x5: 3 };
    expect(evaluate('a − b', scope)).toBe(3);
    expect(evaluate('a – b', scope)).toBe(3);
    expect(evaluate('a — b', scope)).toBe(3);
    expect(evaluate('a × b', scope)).toBe(18);
    expect(evaluate('a · b', scope)).toBe(18);
    expect(evaluate('a ÷ b', scope)).toBe(2);
    expect(evaluate('a * b', scope)).toBe(18);
  });

  it('calls the whitelisted functions with ; between values', () => {
    const scope = { x4: 4, x5: -9 };
    expect(evaluate('abs(b)', scope)).toBe(9);
    expect(evaluate('sqrt(a)', scope)).toBe(2);
    expect(evaluate('round(2,6)', scope)).toBe(3);
    expect(evaluate('floor(2,6)', scope)).toBe(2);
    expect(evaluate('pow(a; 3)', scope)).toBe(64);
    expect(evaluate('exp(0)', scope)).toBe(1);
    expect(evaluate('MAX(a; b)', scope)).toBe(4);
    expect(evaluate('max(min(a; 10); abs(b))', scope)).toBe(9);
  });

  it('allows comparisons so that cond() can choose a branch', () => {
    expect(evaluate('cond(a >= 18; 1; 2)', { x4: 20 })).toBe(1);
    expect(evaluate('cond(a >= 18; 1; 2)', { x4: 10 })).toBe(2);
    expect(evaluate('cond(a ≥ 18; 1; 2)', { x4: 18 })).toBe(1);
    expect(evaluate('cond(a = 5; 1; 2)', { x4: 5 })).toBe(1);
    expect(evaluate('cond(a ≠ 5; 1; 2)', { x4: 5 })).toBe(2);
    expect(evaluate('cond(a <> 5; 1; 2)', { x4: 4 })).toBe(1);
    expect(evaluate('cond(a <= 5; a; 5)', { x4: 4 })).toBe(4);
    expect(evaluate('(a > 1) * 10', { x4: 2 })).toBe(10);
  });

  it('matches names regardless of case, and a name with a digit or underscore', () => {
    const inputs = [{ id: 'x1', name: 'Вес_кг2' }];
    expect(compileUserFormula('вес_кг2 * 2', inputs)).toMatchObject({ expression: 'x1 * 2' });
  });

  it('nests parentheses up to the limit', () => {
    const deep = `${'('.repeat(USER_FORMULA_MAX_DEPTH)}a${')'.repeat(USER_FORMULA_MAX_DEPTH)}`;
    expect(compile(deep).ok).toBe(true);
  });
});

describe('compileUserFormula: plain Russian errors with positions', () => {
  it('points at an unknown symbol', () => {
    expect(errorOf('масса @ 2')).toBe('Не понимаю символ «@» в позиции 7.');
  });

  it('reports parentheses', () => {
    expect(errorOf('(масса + 1')).toBe('Незакрытая скобка в позиции 1.');
    expect(errorOf('масса + 1)')).toBe('Лишняя закрывающая скобка в позиции 10.');
    expect(errorOf('max(a; b')).toContain('Незакрытая скобка');
    expect(errorOf('()')).toContain('Перед «)»');
  });

  it('names the variables that do exist', () => {
    expect(errorOf('вес * 2')).toBe(
      'Нет такой переменной «вес». Доступны: масса, рост, возраст, a, b.',
    );
    expect(errorOf('вес * 2', [{ id: 'x1', name: 'масса' }])).toBe(
      'Нет такой переменной «вес». Доступны: масса.',
    );
    expect(errorOf('вес * 2', [])).toBe(
      'Нет такой переменной «вес». Сначала добавьте входные данные.',
    );
  });

  it('checks how many values a function takes', () => {
    expect(errorOf('max(a)')).toContain('Функция max ждёт 2 значения, а передано 1');
    expect(errorOf('sqrt(a; b)')).toContain('Функция sqrt ждёт 1 значение, а передано 2');
    expect(errorOf('cond(a; b)')).toContain('Функция cond ждёт 3 значения');
    expect(errorOf('abs()')).toContain('Функция abs ждёт 1 значение, а передано 0');
  });

  it('explains the comma, the semicolon and the missing sign', () => {
    expect(errorOf('max(a, b)')).toContain('точкой с запятой');
    expect(errorOf('a; b')).toContain('Точка с запятой нужна только между значениями функции');
    expect(errorOf('(a; b)')).toContain('Точка с запятой нужна только между значениями функции');
    expect(errorOf('2 a')).toContain('пропущен знак действия в позиции 3');
    expect(errorOf('2(a)')).toContain('пропущен знак действия');
    expect(errorOf('a b')).toContain('пропущен знак действия');
  });

  it('reports a dangling operator and an empty formula', () => {
    expect(errorOf('a +')).toContain('Формула оборвана');
    expect(errorOf('* a')).toContain('Перед знаком «*» в позиции 1 нет значения.');
    expect(errorOf('a * / b')).toContain('Перед знаком «/»');
    expect(errorOf('')).toBe('Введите формулу.');
    expect(errorOf('   ')).toBe('Введите формулу.');
  });

  it('refuses unknown functions and functions without parentheses', () => {
    expect(errorOf('foo(a)')).toContain('Неизвестная функция «foo»');
    expect(errorOf('foo(a)')).toContain(USER_FORMULA_FUNCTION_NAMES.join(', '));
    expect(errorOf('max * 2')).toContain('У функции max должны быть скобки');
    expect(errorOf('масса(2)')).toContain('не функция');
  });

  it('refuses a chained comparison and a number that is too long', () => {
    expect(errorOf('a < b < 3')).toContain('нельзя цеплять');
    expect(errorOf('1234567890123456')).toContain('Слишком длинное число');
  });
});

describe('compileUserFormula: nothing outside the whitelist gets through', () => {
  const hostile = [
    'constructor',
    '__proto__',
    'prototype',
    'toString()',
    'window',
    'document.cookie',
    'globalThis',
    'alert(1)',
    `${'ev'}al("1")`,
    'Function("return 1")()',
    'a.b',
    "'a'",
    '"a"',
    '`a`',
    '${a}',
    '`${a}`',
    'a[0]',
    '[1,2]',
    '{a:1}',
    'a; b',
    'a ? b : c',
    'a && b',
    'a || b',
    'a % b',
    'a & b',
    'a | b',
    '~a',
    '!a',
    'a++',
    'a =>',
    'a\\nb',
    '1e3',
    '0x10',
    'a // b',
    '/* x */ a',
    'a #',
    'a $',
    'a @ b',
    'a ` b',
    'a\u0000b',
    'a‮b',
    'import("x")',
    `${'new'} ${'Func'}tion()`,
    'today()',
    'whoLmsZ(a; a; a; a)',
    'present(a)',
    'optional(a; b)',
    'daysBetween(a; b)',
    'aapBpCategory(a; a; a; a; a)',
  ];
  it.each(hostile)('rejects %j', (text) => {
    expect(compile(text).ok).toBe(false);
  });

  it('rejects names of the engine functions it does not offer, even as a variable call', () => {
    for (const name of ['today', 'present', 'optional', 'whoBand', 'gailRisk']) {
      expect(compile(`${name}(a)`).ok).toBe(false);
    }
  });

  it('rejects a formula longer than the limit and nesting deeper than the limit', () => {
    expect(errorOf('a+'.repeat(USER_FORMULA_MAX_LENGTH))).toContain('длиннее 500 символов');
    const tooDeep = `${'('.repeat(USER_FORMULA_MAX_DEPTH + 1)}a${')'.repeat(USER_FORMULA_MAX_DEPTH + 1)}`;
    expect(errorOf(tooDeep)).toContain('Слишком глубокая вложенность');
    const deepCalls = `${'abs('.repeat(USER_FORMULA_MAX_DEPTH + 1)}a${')'.repeat(USER_FORMULA_MAX_DEPTH + 1)}`;
    expect(errorOf(deepCalls)).toContain('Слишком глубокая вложенность');
    expect(errorOf(`${'-'.repeat(200)}a`)).toContain('Слишком глубокая вложенность');
  });

  it('only ever emits input ids, numbers, operators and whitelisted functions', () => {
    const allowed =
      /^(?:x\d+|\d+(?:\.\d+)?|[-+*/^(),<>=! ]|min|max|abs|sqrt|round|floor|pow|exp|cond)+$/u;
    for (const text of [
      'масса / (рост / 100) ^ 2',
      '(140 − возраст) × масса / (72 × a)',
      'cond(a >= 1; max(a; b); -b ^ 2)',
    ]) {
      expect(expressionOf(text)).toMatch(allowed);
    }
  });

  it('does not let a variable named like an object member reach a prototype', () => {
    const inputs = [{ id: 'x1', name: 'constructor' }];
    // The author really named an input «constructor»: it is only a label for x1.
    expect(compileUserFormula('constructor * 2', inputs)).toMatchObject({ expression: 'x1 * 2' });
    expect(compileUserFormula('__proto__ * 2', inputs).ok).toBe(false);
    expect(compileUserFormula('toString * 2', inputs).ok).toBe(false);
  });
});

describe('input names', () => {
  it('accepts letters, digits and underscores', () => {
    expect(userInputNameError('масса_тела', [])).toBeNull();
    expect(userInputNameError('x2', [])).toBeNull();
    expect(userInputNameError('_a', [])).toBeNull();
  });

  it('rejects empty, malformed, function and duplicate names', () => {
    expect(userInputNameError('', [])).toBe('Имя в формуле: заполните это поле.');
    expect(userInputNameError('2x', [])).toContain('первой должна быть буква');
    expect(userInputNameError('a b', [])).toContain('только буквы');
    expect(userInputNameError('a-b', [])).toContain('только буквы');
    expect(userInputNameError('max', [])).toBe('Имя «max» занято функцией: выберите другое.');
    expect(userInputNameError('MAX', [])).toContain('занято функцией');
    expect(userInputNameError('Вес', ['вес'])).toBe('Имя «Вес» уже используется другими данными.');
    expect(userInputNameError('я'.repeat(41), [])).toContain('не длиннее 40');
  });

  it('suggests the first word of the label, unique among the names taken', () => {
    expect(suggestInputName('Масса тела, кг', [])).toBe('масса');
    expect(suggestInputName('Масса тела, кг', ['масса'])).toBe('масса_2');
    expect(suggestInputName('Масса', ['масса', 'масса_2'])).toBe('масса_3');
    expect(suggestInputName('', [])).toBe('значение');
    expect(suggestInputName('12 кг', [])).toBe('кг');
    expect(suggestInputName('max', [])).toBe('max_2');
  });
});
