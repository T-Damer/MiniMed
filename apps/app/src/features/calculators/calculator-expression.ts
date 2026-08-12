/**
 * A restricted expression language for calculator formulas. Deliberately not `eval`/`new Function`:
 * expressions are data (parsed into an AST and interpreted), so a downloaded or LLM-authored calculator
 * schema can never gain arbitrary code execution — only the operations declared below are reachable.
 */

export type CalculatorValue = number | string;
export type CalculatorScope = Readonly<Record<string, CalculatorValue>>;

export class CalculatorExpressionError extends Error {}

type Token =
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'string'; readonly value: string }
  | { readonly kind: 'identifier'; readonly value: string }
  | { readonly kind: 'operator'; readonly value: string }
  | { readonly kind: 'lparen' }
  | { readonly kind: 'rparen' }
  | { readonly kind: 'comma' };

const OPERATORS = ['==', '!=', '<=', '>=', '<', '>', '+', '-', '*', '/', '^'] as const;

function tokenize(source: string): readonly Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index] ?? '';
    if (/\s/u.test(char)) {
      index += 1;
      continue;
    }
    if (char === '(') {
      tokens.push({ kind: 'lparen' });
      index += 1;
      continue;
    }
    if (char === ')') {
      tokens.push({ kind: 'rparen' });
      index += 1;
      continue;
    }
    if (char === ',') {
      tokens.push({ kind: 'comma' });
      index += 1;
      continue;
    }
    if (char === '"') {
      const end = source.indexOf('"', index + 1);
      if (end < 0) throw new CalculatorExpressionError(`Unterminated string literal at ${index}.`);
      tokens.push({ kind: 'string', value: source.slice(index + 1, end) });
      index = end + 1;
      continue;
    }
    if (/[0-9.]/u.test(char)) {
      const match = /^\d+(?:\.\d+)?/u.exec(source.slice(index));
      if (!match) throw new CalculatorExpressionError(`Invalid number at ${index}.`);
      tokens.push({ kind: 'number', value: Number(match[0]) });
      index += match[0].length;
      continue;
    }
    if (/[a-zA-Z_]/u.test(char)) {
      const match = /^[a-zA-Z_][a-zA-Z0-9_]*/u.exec(source.slice(index));
      if (!match) throw new CalculatorExpressionError(`Invalid identifier at ${index}.`);
      tokens.push({ kind: 'identifier', value: match[0] });
      index += match[0].length;
      continue;
    }
    const operator = OPERATORS.find((candidate) => source.startsWith(candidate, index));
    if (operator) {
      tokens.push({ kind: 'operator', value: operator });
      index += operator.length;
      continue;
    }
    throw new CalculatorExpressionError(`Unexpected character "${char}" at ${index}.`);
  }
  return tokens;
}

export type ExpressionNode =
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'string'; readonly value: string }
  | { readonly kind: 'variable'; readonly name: string }
  | { readonly kind: 'unary'; readonly operator: '-'; readonly operand: ExpressionNode }
  | {
      readonly kind: 'binary';
      readonly operator: '+' | '-' | '*' | '/' | '^' | '==' | '!=' | '<' | '<=' | '>' | '>=';
      readonly left: ExpressionNode;
      readonly right: ExpressionNode;
    }
  | { readonly kind: 'call'; readonly name: string; readonly args: readonly ExpressionNode[] };

type ComparisonOperator = '==' | '!=' | '<' | '<=' | '>' | '>=';
const COMPARISON_OPERATOR_VALUES = new Set<string>(['==', '!=', '<', '<=', '>', '>=']);
function isComparisonOperator(operator: string): operator is ComparisonOperator {
  return COMPARISON_OPERATOR_VALUES.has(operator);
}
const KNOWN_FUNCTIONS: Readonly<Record<string, number>> = {
  min: 2,
  max: 2,
  abs: 1,
  sqrt: 1,
  round: 1,
  floor: 1,
  pow: 2,
  cond: 3,
  today: 0,
  addDays: 2,
  daysBetween: 2,
};

class Parser {
  private position = 0;

  constructor(private readonly tokens: readonly Token[]) {}

  private peek(): Token | undefined {
    return this.tokens[this.position];
  }

  private next(): Token {
    const token = this.tokens[this.position];
    if (!token) throw new CalculatorExpressionError('Unexpected end of expression.');
    this.position += 1;
    return token;
  }

  parse(): ExpressionNode {
    const node = this.parseComparison();
    if (this.position !== this.tokens.length) {
      throw new CalculatorExpressionError('Unexpected trailing tokens in expression.');
    }
    return node;
  }

  private parseComparison(): ExpressionNode {
    let left = this.parseAdditive();
    while (
      this.peek()?.kind === 'operator' &&
      isComparisonOperator((this.peek() as { readonly value: string }).value)
    ) {
      const operator = this.next() as { readonly kind: 'operator'; readonly value: string };
      const right = this.parseAdditive();
      left = {
        kind: 'binary',
        operator: operator.value as '==' | '!=' | '<' | '<=' | '>' | '>=',
        left,
        right,
      };
    }
    return left;
  }

  private parseAdditive(): ExpressionNode {
    let left = this.parseMultiplicative();
    while (
      this.peek()?.kind === 'operator' &&
      ((this.peek() as { readonly value: string }).value === '+' ||
        (this.peek() as { readonly value: string }).value === '-')
    ) {
      const operator = this.next() as { readonly value: '+' | '-' };
      const right = this.parseMultiplicative();
      left = { kind: 'binary', operator: operator.value, left, right };
    }
    return left;
  }

  private parseMultiplicative(): ExpressionNode {
    let left = this.parsePower();
    while (
      this.peek()?.kind === 'operator' &&
      ((this.peek() as { readonly value: string }).value === '*' ||
        (this.peek() as { readonly value: string }).value === '/')
    ) {
      const operator = this.next() as { readonly value: '*' | '/' };
      const right = this.parsePower();
      left = { kind: 'binary', operator: operator.value, left, right };
    }
    return left;
  }

  private parsePower(): ExpressionNode {
    const left = this.parseUnary();
    if (
      this.peek()?.kind === 'operator' &&
      (this.peek() as { readonly value: string }).value === '^'
    ) {
      this.next();
      const right = this.parsePower();
      return { kind: 'binary', operator: '^', left, right };
    }
    return left;
  }

  private parseUnary(): ExpressionNode {
    const token = this.peek();
    if (token?.kind === 'operator' && token.value === '-') {
      this.next();
      return { kind: 'unary', operator: '-', operand: this.parseUnary() };
    }
    return this.parseAtom();
  }

  private parseAtom(): ExpressionNode {
    const token = this.next();
    if (token.kind === 'number') return { kind: 'number', value: token.value };
    if (token.kind === 'string') return { kind: 'string', value: token.value };
    if (token.kind === 'lparen') {
      const inner = this.parseComparison();
      const closing = this.next();
      if (closing.kind !== 'rparen') throw new CalculatorExpressionError('Expected ")".');
      return inner;
    }
    if (token.kind === 'identifier') {
      if (this.peek()?.kind === 'lparen') {
        this.next();
        const args: ExpressionNode[] = [];
        if (this.peek()?.kind !== 'rparen') {
          args.push(this.parseComparison());
          while (this.peek()?.kind === 'comma') {
            this.next();
            args.push(this.parseComparison());
          }
        }
        const closing = this.next();
        if (closing.kind !== 'rparen')
          throw new CalculatorExpressionError('Expected ")" after arguments.');
        const arity = KNOWN_FUNCTIONS[token.value];
        if (arity === undefined) {
          throw new CalculatorExpressionError(`Unknown function "${token.value}".`);
        }
        if (args.length !== arity) {
          throw new CalculatorExpressionError(
            `Function "${token.value}" expects ${arity} argument(s), got ${args.length}.`,
          );
        }
        return { kind: 'call', name: token.value, args };
      }
      return { kind: 'variable', name: token.value };
    }
    throw new CalculatorExpressionError('Unexpected token in expression.');
  }
}

export function parseCalculatorExpression(source: string): ExpressionNode {
  return new Parser(tokenize(source)).parse();
}

function asNumber(value: CalculatorValue): number {
  if (typeof value !== 'number') {
    throw new CalculatorExpressionError(`Expected a number, got a string ("${value}").`);
  }
  return value;
}

export function evaluateExpressionNode(
  node: ExpressionNode,
  scope: CalculatorScope,
): CalculatorValue {
  switch (node.kind) {
    case 'number':
      return node.value;
    case 'string':
      return node.value;
    case 'variable': {
      const value = scope[node.name];
      if (value === undefined) {
        throw new CalculatorExpressionError(`Unknown variable "${node.name}".`);
      }
      return value;
    }
    case 'unary':
      return -asNumber(evaluateExpressionNode(node.operand, scope));
    case 'call':
      return evaluateCall(node.name, node.args, scope);
    case 'binary': {
      if (isComparisonOperator(node.operator)) {
        const left = evaluateExpressionNode(node.left, scope);
        const right = evaluateExpressionNode(node.right, scope);
        return evaluateComparison(node.operator, left, right) ? 1 : 0;
      }
      const left = asNumber(evaluateExpressionNode(node.left, scope));
      const right = asNumber(evaluateExpressionNode(node.right, scope));
      switch (node.operator) {
        case '+':
          return left + right;
        case '-':
          return left - right;
        case '*':
          return left * right;
        case '/':
          return left / right;
        case '^':
          return left ** right;
        default:
          throw new CalculatorExpressionError(`Unsupported operator "${node.operator}".`);
      }
    }
    default:
      throw new CalculatorExpressionError('Unsupported expression node.');
  }
}

function evaluateComparison(
  operator: ComparisonOperator,
  left: CalculatorValue,
  right: CalculatorValue,
): boolean {
  if (operator === '==') return left === right;
  if (operator === '!=') return left !== right;
  const leftNumber = asNumber(left);
  const rightNumber = asNumber(right);
  switch (operator) {
    case '<':
      return leftNumber < rightNumber;
    case '<=':
      return leftNumber <= rightNumber;
    case '>':
      return leftNumber > rightNumber;
    case '>=':
      return leftNumber >= rightNumber;
    default:
      throw new CalculatorExpressionError(`Unsupported comparison "${operator}".`);
  }
}

export const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const DAY_MS = 86_400_000;

export function parseIsoDateValue(value: CalculatorValue, context: string): Date {
  if (typeof value !== 'string' || !ISO_DATE_PATTERN.test(value)) {
    throw new CalculatorExpressionError(`${context}: expected an ISO date string (YYYY-MM-DD).`);
  }
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    throw new CalculatorExpressionError(`${context}: invalid date "${value}".`);
  }
  return date;
}

function formatIsoDateValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function evaluateCall(
  name: string,
  args: readonly ExpressionNode[],
  scope: CalculatorScope,
): CalculatorValue {
  if (name === 'cond') {
    const test = args[0];
    const whenTrue = args[1];
    const whenFalse = args[2];
    if (!test || !whenTrue || !whenFalse) {
      throw new CalculatorExpressionError('cond() requires 3 arguments.');
    }
    const testValue = evaluateExpressionNode(test, scope);
    const chosen = testValue === 1 ? whenTrue : whenFalse;
    return evaluateExpressionNode(chosen, scope);
  }
  if (name === 'today') {
    return formatIsoDateValue(new Date());
  }
  if (name === 'addDays') {
    const dateArg = args[0];
    const daysArg = args[1];
    if (!dateArg || !daysArg)
      throw new CalculatorExpressionError('addDays() requires 2 arguments.');
    const date = parseIsoDateValue(evaluateExpressionNode(dateArg, scope), 'addDays');
    const days = asNumber(evaluateExpressionNode(daysArg, scope));
    return formatIsoDateValue(new Date(date.getTime() + days * DAY_MS));
  }
  if (name === 'daysBetween') {
    const fromArg = args[0];
    const toArg = args[1];
    if (!fromArg || !toArg)
      throw new CalculatorExpressionError('daysBetween() requires 2 arguments.');
    const from = parseIsoDateValue(evaluateExpressionNode(fromArg, scope), 'daysBetween');
    const to = parseIsoDateValue(evaluateExpressionNode(toArg, scope), 'daysBetween');
    return Math.round((to.getTime() - from.getTime()) / DAY_MS);
  }
  const values = args.map((arg) => asNumber(evaluateExpressionNode(arg, scope)));
  switch (name) {
    case 'min':
      return Math.min(values[0] ?? NaN, values[1] ?? NaN);
    case 'max':
      return Math.max(values[0] ?? NaN, values[1] ?? NaN);
    case 'abs':
      return Math.abs(values[0] ?? NaN);
    case 'sqrt':
      return Math.sqrt(values[0] ?? NaN);
    case 'round':
      return Math.round(values[0] ?? NaN);
    case 'floor':
      return Math.floor(values[0] ?? NaN);
    case 'pow':
      return (values[0] ?? NaN) ** (values[1] ?? NaN);
    default:
      throw new CalculatorExpressionError(`Unknown function "${name}".`);
  }
}

export function evaluateCalculatorExpression(
  source: string,
  scope: CalculatorScope,
): CalculatorValue {
  return evaluateExpressionNode(parseCalculatorExpression(source), scope);
}

function formatValue(value: CalculatorValue): string {
  if (typeof value === 'string') return `"${value}"`;
  return Number.isInteger(value)
    ? String(value)
    : value.toPrecision(6).replace(/0+$/u, '').replace(/\.$/u, '');
}

/** Renders an expression with variable names replaced by their current scope values, for a readable trace. */
export function renderExpressionWithValues(node: ExpressionNode, scope: CalculatorScope): string {
  switch (node.kind) {
    case 'number':
      return formatValue(node.value);
    case 'string':
      return `"${node.value}"`;
    case 'variable':
      return formatValue(scope[node.name] ?? node.name);
    case 'unary':
      return `-${renderExpressionWithValues(node.operand, scope)}`;
    case 'call':
      return `${node.name}(${node.args.map((arg) => renderExpressionWithValues(arg, scope)).join(', ')})`;
    case 'binary':
      return `${renderExpressionWithValues(node.left, scope)} ${node.operator} ${renderExpressionWithValues(node.right, scope)}`;
    default:
      return '?';
  }
}
