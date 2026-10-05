import {
  CalculatorExpressionError,
  type ExpressionNode,
  parseCalculatorExpression,
} from '@/features/calculators/calculator-expression';
import { USER_CALCULATOR_LIMITS } from '@/features/calculators/user-calculator/user-calculator-limits';
import { pluralRu } from '@/i18n/labels';

/**
 * The formula text a doctor types («масса / (рост / 100) ^ 2») is never executed. It is read by the
 * tokenizer and parser below, which accept a small closed grammar, and written back out as the
 * restricted expression string the calculator engine already parses (`parseCalculatorExpression`),
 * with every input name replaced by the input's internal id. Nothing outside the whitelist — no
 * property access, strings, brackets, template syntax or unknown function — can pass this module.
 */

export const USER_FORMULA_MAX_LENGTH = USER_CALCULATOR_LIMITS.formula;
/** Nesting of parentheses and function calls. */
export const USER_FORMULA_MAX_DEPTH = 30;
export const USER_INPUT_NAME_MAX_LENGTH = USER_CALCULATOR_LIMITS.name;
const MAX_NUMBER_DIGITS = 15;

/** The functions a formula may call, with the number of values each one takes. */
const FUNCTION_ARITY: ReadonlyMap<string, number> = new Map([
  ['min', 2],
  ['max', 2],
  ['abs', 1],
  ['sqrt', 1],
  ['round', 1],
  ['floor', 1],
  ['pow', 2],
  ['exp', 1],
  ['cond', 3],
]);

export interface UserFormulaFunction {
  readonly name: string;
  readonly arity: number;
  /** An example the author can read at a glance. */
  readonly example: string;
  readonly hint: string;
}

/** The function chips of the editor, in the order they are offered. */
export const USER_FORMULA_FUNCTIONS: readonly UserFormulaFunction[] = [
  { name: 'min', arity: 2, example: 'min(a; b)', hint: 'Меньшее из двух значений' },
  { name: 'max', arity: 2, example: 'max(a; b)', hint: 'Большее из двух значений' },
  { name: 'abs', arity: 1, example: 'abs(a)', hint: 'Модуль числа' },
  { name: 'sqrt', arity: 1, example: 'sqrt(a)', hint: 'Квадратный корень' },
  { name: 'round', arity: 1, example: 'round(a)', hint: 'Округление до целого' },
  { name: 'floor', arity: 1, example: 'floor(a)', hint: 'Округление вниз' },
  { name: 'pow', arity: 2, example: 'pow(a; b)', hint: 'Степень: a в степени b' },
  { name: 'exp', arity: 1, example: 'exp(a)', hint: 'Экспонента' },
  {
    name: 'cond',
    arity: 3,
    example: 'cond(a > 1; b; c)',
    hint: 'Если условие верно — второе значение, иначе третье',
  },
];

export const USER_FORMULA_FUNCTION_NAMES: readonly string[] = [...FUNCTION_ARITY.keys()];

export type UserFormulaResult =
  | {
      readonly ok: true;
      /** The expression for the calculator engine, input names replaced by ids. */
      readonly expression: string;
      /** Ids of the inputs the formula uses, in order of first use. */
      readonly usedIds: readonly string[];
    }
  | { readonly ok: false; readonly error: string; readonly position?: number };

export interface UserFormulaInput {
  readonly id: string;
  readonly name: string;
}

class FormulaError extends Error {
  constructor(
    message: string,
    readonly position?: number,
  ) {
    super(message);
  }
}

// --- Names ---------------------------------------------------------------------------------------

const NAME_PATTERN = /^[\p{L}_][\p{L}\p{N}_]*$/u;

function normalizeName(name: string): string {
  return name.toLocaleLowerCase('ru-RU');
}

/**
 * Why `name` cannot be an input's name in formulas, in plain Russian, or null when it can. `others`
 * are the names of the other inputs; comparison ignores case, so «Вес» and «вес» are one name.
 */
export function userInputNameError(name: string, others: readonly string[]): string | null {
  if (name.trim() === '') return 'Имя в формуле: заполните это поле.';
  if (name.length > USER_INPUT_NAME_MAX_LENGTH) {
    return `Имя в формуле: не длиннее ${USER_INPUT_NAME_MAX_LENGTH} символов.`;
  }
  if (!NAME_PATTERN.test(name)) {
    return 'Имя в формуле: только буквы, цифры и «_», первой должна быть буква.';
  }
  const normalized = normalizeName(name);
  if (FUNCTION_ARITY.has(normalized)) {
    return `Имя «${name}» занято функцией: выберите другое.`;
  }
  if (others.some((other) => normalizeName(other) === normalized)) {
    return `Имя «${name}» уже используется другими данными.`;
  }
  return null;
}

/** The name a label asks for before it is made unique: «Масса тела, кг» → «масса». */
export function inputNameBase(label: string): string {
  const word = /[\p{L}_][\p{L}\p{N}_]*/u.exec(label)?.[0] ?? '';
  return (word === '' ? 'значение' : word.toLocaleLowerCase('ru-RU')).slice(0, 20);
}

/** First word of the label, as a name unused by `taken`: «Масса тела, кг» → «масса». */
export function suggestInputName(label: string, taken: readonly string[]): string {
  const base = inputNameBase(label);
  for (let attempt = 1; attempt < 1000; attempt += 1) {
    const candidate = attempt === 1 ? base : `${base}_${attempt}`;
    if (userInputNameError(candidate, taken) === null) return candidate;
  }
  return `${base}_${taken.length + 1}`;
}

// --- Tokenizer -----------------------------------------------------------------------------------

type CompareOperator = '<' | '<=' | '>' | '>=' | '==' | '!=';
type ArithmeticOperator = '+' | '-' | '*' | '/' | '^';

type Token =
  | { readonly kind: 'number'; readonly text: string; readonly position: number }
  | { readonly kind: 'name'; readonly text: string; readonly position: number }
  | {
      readonly kind: 'arithmetic';
      readonly operator: ArithmeticOperator;
      readonly text: string;
      readonly position: number;
    }
  | {
      readonly kind: 'compare';
      readonly operator: CompareOperator;
      readonly text: string;
      readonly position: number;
    }
  | { readonly kind: 'lparen' | 'rparen' | 'semicolon'; readonly position: number };

const MINUS_SIGNS = new Set(['-', '−', '–', '—', '‐', '‑']);
const MULTIPLY_SIGNS = new Set(['*', '×', '·', '⋅', '∙']);
const DIVIDE_SIGNS = new Set(['/', '÷', '∕']);
const FOREIGN_BRACKETS = new Set(['[', ']', '{', '}']);

function isDigit(char: string | undefined): boolean {
  return char !== undefined && char >= '0' && char <= '9';
}

function describeChar(char: string): string {
  return /[\p{C}\p{Z}]/u.test(char)
    ? `U+${(char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`
    : char;
}

function tokenize(text: string): readonly Token[] {
  const chars = Array.from(text);
  const tokens: Token[] = [];
  let index = 0;
  while (index < chars.length) {
    const char = chars[index] ?? '';
    const position = index + 1;
    if (/\s/u.test(char)) {
      index += 1;
      continue;
    }
    if (isDigit(char)) {
      let end = index;
      while (isDigit(chars[end])) end += 1;
      // A decimal separator is a dot or a comma and only counts between two digits.
      if ((chars[end] === '.' || chars[end] === ',') && isDigit(chars[end + 1])) {
        end += 1;
        while (isDigit(chars[end])) end += 1;
      }
      const raw = chars.slice(index, end).join('');
      if (raw.replace(/[.,]/u, '').length > MAX_NUMBER_DIGITS) {
        throw new FormulaError(`Слишком длинное число в позиции ${position}.`, position);
      }
      tokens.push({ kind: 'number', text: raw.replace(',', '.'), position });
      index = end;
      continue;
    }
    if (/[\p{L}_]/u.test(char)) {
      let end = index;
      while (/[\p{L}\p{N}_]/u.test(chars[end] ?? '')) end += 1;
      tokens.push({ kind: 'name', text: chars.slice(index, end).join(''), position });
      index = end;
      continue;
    }
    index += 1;
    if (char === '(') tokens.push({ kind: 'lparen', position });
    else if (char === ')') tokens.push({ kind: 'rparen', position });
    else if (char === ';') tokens.push({ kind: 'semicolon', position });
    else if (char === '+') tokens.push({ kind: 'arithmetic', operator: '+', text: char, position });
    else if (char === '^') tokens.push({ kind: 'arithmetic', operator: '^', text: char, position });
    else if (MINUS_SIGNS.has(char)) {
      tokens.push({ kind: 'arithmetic', operator: '-', text: char, position });
    } else if (MULTIPLY_SIGNS.has(char)) {
      tokens.push({ kind: 'arithmetic', operator: '*', text: char, position });
    } else if (DIVIDE_SIGNS.has(char)) {
      tokens.push({ kind: 'arithmetic', operator: '/', text: char, position });
    } else if (char === '<' || char === '>' || char === '=' || char === '!') {
      const next = chars[index];
      let operator: CompareOperator | undefined;
      let text = char;
      if (char === '<' && next === '=') operator = '<=';
      else if (char === '<' && next === '>') operator = '!=';
      else if (char === '>' && next === '=') operator = '>=';
      else if (char === '=' && next === '=') operator = '==';
      else if (char === '!' && next === '=') operator = '!=';
      if (operator) {
        text = `${char}${next ?? ''}`;
        index += 1;
      } else if (char === '<' || char === '>') operator = char;
      else if (char === '=') operator = '==';
      else throw new FormulaError(`Не понимаю символ «!» в позиции ${position}.`, position);
      tokens.push({ kind: 'compare', operator, text, position });
    } else if (char === '≤') {
      tokens.push({ kind: 'compare', operator: '<=', text: char, position });
    } else if (char === '≥') {
      tokens.push({ kind: 'compare', operator: '>=', text: char, position });
    } else if (char === '≠') {
      tokens.push({ kind: 'compare', operator: '!=', text: char, position });
    } else if (char === ',') {
      throw new FormulaError(
        `Запятая в позиции ${position}: в числах она означает десятичную дробь (2,5), а значения функции разделяйте точкой с запятой: max(a; b).`,
        position,
      );
    } else if (FOREIGN_BRACKETS.has(char)) {
      throw new FormulaError(
        `Квадратные и фигурные скобки не поддерживаются (позиция ${position}): используйте круглые «( )».`,
        position,
      );
    } else {
      throw new FormulaError(
        `Не понимаю символ «${describeChar(char)}» в позиции ${position}.`,
        position,
      );
    }
  }
  return tokens;
}

// --- Parser --------------------------------------------------------------------------------------

type Node =
  | { readonly kind: 'number'; readonly text: string }
  | { readonly kind: 'variable'; readonly id: string }
  | { readonly kind: 'negate'; readonly operand: Node }
  | {
      readonly kind: 'binary';
      readonly operator: ArithmeticOperator | CompareOperator;
      readonly left: Node;
      readonly right: Node;
    }
  | { readonly kind: 'call'; readonly name: string; readonly args: readonly Node[] };

const SEMICOLON_OUTSIDE_CALL =
  'Точка с запятой нужна только между значениями функции, например max(a; b).';

function valuesLabel(count: number): string {
  return `${count} ${pluralRu(count, 'значение', 'значения', 'значений')}`;
}

class FormulaParser {
  private index = 0;
  private depth = 0;

  constructor(
    private readonly tokens: readonly Token[],
    private readonly variables: ReadonlyMap<string, UserFormulaInput>,
    private readonly endPosition: number,
  ) {}

  parse(): Node {
    const node = this.comparison();
    const rest = this.tokens[this.index];
    if (rest) this.rejectLeftover(rest);
    return node;
  }

  private rejectLeftover(token: Token): never {
    if (token.kind === 'rparen') {
      throw new FormulaError(
        `Лишняя закрывающая скобка в позиции ${token.position}.`,
        token.position,
      );
    }
    if (token.kind === 'semicolon') throw new FormulaError(SEMICOLON_OUTSIDE_CALL, token.position);
    throw new FormulaError(
      `Между значениями пропущен знак действия в позиции ${token.position} (например, «×»).`,
      token.position,
    );
  }

  private peek(): Token | undefined {
    return this.tokens[this.index];
  }

  private comparison(): Node {
    const left = this.additive();
    const token = this.peek();
    if (token?.kind !== 'compare') return left;
    this.index += 1;
    const right = this.additive();
    const again = this.peek();
    if (again?.kind === 'compare') {
      throw new FormulaError(
        `Сравнение в позиции ${again.position} нельзя цеплять к предыдущему: вложите условия в cond(…).`,
        again.position,
      );
    }
    return { kind: 'binary', operator: token.operator, left, right };
  }

  private additive(): Node {
    let left = this.term();
    for (;;) {
      const token = this.peek();
      if (token?.kind !== 'arithmetic' || (token.operator !== '+' && token.operator !== '-')) {
        return left;
      }
      this.index += 1;
      left = { kind: 'binary', operator: token.operator, left, right: this.term() };
    }
  }

  private term(): Node {
    let left = this.unary();
    for (;;) {
      const token = this.peek();
      if (token?.kind !== 'arithmetic' || (token.operator !== '*' && token.operator !== '/')) {
        return left;
      }
      this.index += 1;
      left = { kind: 'binary', operator: token.operator, left, right: this.unary() };
    }
  }

  /** A sign binds weaker than a power, as in mathematics: −2^2 is −(2^2). */
  private unary(): Node {
    const token = this.peek();
    if (token?.kind === 'arithmetic' && (token.operator === '-' || token.operator === '+')) {
      this.index += 1;
      this.enter(token.position);
      const operand = this.unary();
      this.depth -= 1;
      return token.operator === '-' ? { kind: 'negate', operand } : operand;
    }
    return this.power();
  }

  private power(): Node {
    const base = this.atom();
    const token = this.peek();
    if (token?.kind === 'arithmetic' && token.operator === '^') {
      this.index += 1;
      return { kind: 'binary', operator: '^', left: base, right: this.unary() };
    }
    return base;
  }

  private enter(position: number): void {
    this.depth += 1;
    if (this.depth > USER_FORMULA_MAX_DEPTH) {
      throw new FormulaError(
        `Слишком глубокая вложенность в позиции ${position}: не больше ${USER_FORMULA_MAX_DEPTH} уровней скобок.`,
        position,
      );
    }
  }

  private atom(): Node {
    const token = this.tokens[this.index];
    if (!token) {
      const previous = this.tokens[this.index - 1];
      if (previous?.kind === 'lparen') {
        throw new FormulaError(
          `Незакрытая скобка в позиции ${previous.position}.`,
          previous.position,
        );
      }
      throw new FormulaError(
        'Формула оборвана: после последнего знака ждём число, переменную или скобку.',
        this.endPosition,
      );
    }
    this.index += 1;
    switch (token.kind) {
      case 'number':
        return { kind: 'number', text: token.text };
      case 'name':
        return this.nameOrCall(token);
      case 'lparen':
        return this.group(token);
      case 'rparen':
        throw new FormulaError(
          `Перед «)» в позиции ${token.position} ждём число или переменную.`,
          token.position,
        );
      case 'semicolon':
        throw new FormulaError(SEMICOLON_OUTSIDE_CALL, token.position);
      default:
        throw new FormulaError(
          `Перед знаком «${token.text}» в позиции ${token.position} нет значения.`,
          token.position,
        );
    }
  }

  private group(open: Token): Node {
    this.enter(open.position);
    const inner = this.comparison();
    const closing = this.tokens[this.index];
    if (closing?.kind !== 'rparen') {
      this.rejectUnclosed(open, closing);
    }
    this.index += 1;
    this.depth -= 1;
    return inner;
  }

  private rejectUnclosed(open: Token, next: Token | undefined): never {
    if (next === undefined) {
      throw new FormulaError(`Незакрытая скобка в позиции ${open.position}.`, open.position);
    }
    this.rejectLeftover(next);
  }

  private nameOrCall(token: Extract<Token, { kind: 'name' }>): Node {
    const lowered = normalizeName(token.text);
    const next = this.peek();
    const variable = this.variables.get(lowered);
    if (next?.kind === 'lparen') {
      const arity = FUNCTION_ARITY.get(lowered);
      if (arity === undefined) {
        throw new FormulaError(
          variable
            ? `«${token.text}» — не функция. Чтобы умножить, поставьте «×»: ${token.text} × (…).`
            : `Неизвестная функция «${token.text}». Доступны: ${USER_FORMULA_FUNCTION_NAMES.join(', ')}.`,
          token.position,
        );
      }
      this.index += 1;
      return this.call(token, lowered, arity, next);
    }
    if (variable) return { kind: 'variable', id: variable.id };
    if (FUNCTION_ARITY.has(lowered)) {
      throw new FormulaError(
        `У функции ${lowered} должны быть скобки со значениями, например ${lowered}(…) (позиция ${token.position}).`,
        token.position,
      );
    }
    throw new FormulaError(
      `Нет такой переменной «${token.text}». ${this.availableNames()}`,
      token.position,
    );
  }

  private availableNames(): string {
    const names = [...this.variables.values()].map((input) => input.name);
    return names.length > 0 ? `Доступны: ${names.join(', ')}.` : 'Сначала добавьте входные данные.';
  }

  private call(
    nameToken: Extract<Token, { kind: 'name' }>,
    name: string,
    arity: number,
    open: Token,
  ): Node {
    this.enter(open.position);
    const args: Node[] = [];
    if (this.peek()?.kind !== 'rparen') {
      args.push(this.comparison());
      while (this.peek()?.kind === 'semicolon') {
        this.index += 1;
        args.push(this.comparison());
      }
    }
    const closing = this.tokens[this.index];
    if (closing?.kind !== 'rparen') this.rejectUnclosed(open, closing);
    this.index += 1;
    this.depth -= 1;
    if (args.length !== arity) {
      throw new FormulaError(
        `Функция ${name} ждёт ${valuesLabel(arity)}, а передано ${args.length} (позиция ${nameToken.position}).`,
        nameToken.position,
      );
    }
    return { kind: 'call', name, args };
  }
}

// --- Emitter -------------------------------------------------------------------------------------

/** Binding strength in the engine's grammar; 9 is a value that never needs parentheses. */
function level(node: Node): number {
  if (node.kind === 'binary') {
    switch (node.operator) {
      case '^':
        return 5;
      case '*':
      case '/':
        return 3;
      case '+':
      case '-':
        return 2;
      default:
        return 1;
    }
  }
  return 9;
}

function wrap(node: Node, minimum: number, strict: boolean): string {
  const text = emit(node);
  const needs = strict ? level(node) <= minimum : level(node) < minimum;
  return needs ? `(${text})` : text;
}

/** Written so the engine's parser reads it exactly as mathematics does, whatever the nesting. */
function emit(node: Node): string {
  switch (node.kind) {
    case 'number':
      return node.text;
    case 'variable':
      return node.id;
    case 'negate':
      // The engine's unary minus binds tighter than ^, so it always gets its own parentheses.
      return `(-${wrap(node.operand, 9, false)})`;
    case 'call':
      return `${node.name}(${node.args.map(emit).join(', ')})`;
    case 'binary': {
      const own = level(node);
      if (node.operator === '^') {
        return `${wrap(node.left, 9, false)}^${wrap(node.right, 9, false)}`;
      }
      return `${wrap(node.left, own, false)} ${node.operator} ${wrap(node.right, own, true)}`;
    }
  }
}

function usedVariableIds(node: Node, into: Set<string>): void {
  switch (node.kind) {
    case 'variable':
      into.add(node.id);
      return;
    case 'negate':
      usedVariableIds(node.operand, into);
      return;
    case 'binary':
      usedVariableIds(node.left, into);
      usedVariableIds(node.right, into);
      return;
    case 'call':
      for (const arg of node.args) usedVariableIds(arg, into);
      return;
    case 'number':
      return;
  }
}

/**
 * The last line of defence: whatever this module emitted is read back by the engine's own parser,
 * and only declared input ids and whitelisted functions may appear in it.
 */
function assertWhitelisted(
  node: ExpressionNode,
  ids: ReadonlySet<string>,
): readonly string[] | null {
  switch (node.kind) {
    case 'number':
      return null;
    case 'variable':
      return ids.has(node.name) ? null : [`переменная ${node.name}`];
    case 'unary':
      return assertWhitelisted(node.operand, ids);
    case 'binary':
      return assertWhitelisted(node.left, ids) ?? assertWhitelisted(node.right, ids);
    case 'call': {
      if (!FUNCTION_ARITY.has(node.name)) return [`функция ${node.name}`];
      for (const arg of node.args) {
        const problem = assertWhitelisted(arg, ids);
        if (problem) return problem;
      }
      return null;
    }
    case 'string':
      return ['строка'];
  }
}

// --- Public entry --------------------------------------------------------------------------------

/**
 * Compiles the author's formula into the engine's restricted expression. Never throws: a formula
 * that cannot be read comes back as `{ ok: false, error }` with a plain Russian message that names
 * the position of the problem.
 */
export function compileUserFormula(
  text: string,
  inputs: readonly UserFormulaInput[],
): UserFormulaResult {
  if (text.trim() === '') return { ok: false, error: 'Введите формулу.' };
  if (text.length > USER_FORMULA_MAX_LENGTH) {
    return {
      ok: false,
      error: `Формула длиннее ${USER_FORMULA_MAX_LENGTH} символов: сократите её или разбейте на шаги.`,
    };
  }
  const variables = new Map<string, UserFormulaInput>();
  for (const input of inputs) {
    if (userInputNameError(input.name, []) === null)
      variables.set(normalizeName(input.name), input);
  }
  try {
    const tokens = tokenize(text);
    const tree = new FormulaParser(tokens, variables, Array.from(text).length + 1).parse();
    const expression = emit(tree);
    const ids = new Set(inputs.map((input) => input.id));
    const forbidden = assertWhitelisted(parseCalculatorExpression(expression), ids);
    if (forbidden) {
      return { ok: false, error: `Формула не прошла проверку безопасности: ${forbidden[0]}.` };
    }
    const used = new Set<string>();
    usedVariableIds(tree, used);
    return { ok: true, expression, usedIds: [...used] };
  } catch (cause) {
    if (cause instanceof FormulaError) {
      return {
        ok: false,
        error: cause.message,
        ...(cause.position === undefined ? {} : { position: cause.position }),
      };
    }
    if (cause instanceof CalculatorExpressionError) {
      return { ok: false, error: `Формула не прошла проверку: ${cause.message}` };
    }
    throw cause;
  }
}

/** Shown near the formula field: what may be typed. */
export const USER_FORMULA_HELP =
  'Знаки: + − × ÷ ^ и скобки. Дробные числа — через точку или запятую (2,5). Значения функции разделяйте точкой с запятой: max(a; b). Сравнения < > ≤ ≥ = ≠ работают внутри cond(условие; если верно; если нет).';
