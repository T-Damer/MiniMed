import { type CalculatorSchema, CalculatorSchemaSchema } from '@localmed/contracts';

// Relative import (not the usual `@/` alias): this module is also run standalone via
// `bun scripts/lint-calculator-schema.ts`, and `@/` only resolves inside Vite/Vitest, not bare `bun run`.
import {
  CalculatorExpressionError,
  type ExpressionNode,
  parseCalculatorExpression,
} from './calculator-expression';

export interface CalculatorSchemaValidation {
  readonly ok: boolean;
  readonly schema?: CalculatorSchema;
  readonly errors: readonly string[];
}

function referencedVariables(node: ExpressionNode, into: Set<string>): void {
  if (node.kind === 'variable') {
    into.add(node.name);
    return;
  }
  if (node.kind === 'unary') {
    referencedVariables(node.operand, into);
    return;
  }
  if (node.kind === 'binary') {
    referencedVariables(node.left, into);
    referencedVariables(node.right, into);
    return;
  }
  if (node.kind === 'call') {
    for (const arg of node.args) referencedVariables(arg, into);
  }
}

const CALCULATOR_CATEGORY_ALIASES = {
  'neonatal-respiratory': 'neonatology',
  'pediatric-gastroenterology': 'gastroenterology',
} as const;

function withCanonicalCategory(candidate: unknown): unknown {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return candidate;
  const category = 'category' in candidate ? candidate.category : undefined;
  if (typeof category !== 'string' || !(category in CALCULATOR_CATEGORY_ALIASES)) return candidate;
  return {
    ...candidate,
    category: CALCULATOR_CATEGORY_ALIASES[category as keyof typeof CALCULATOR_CATEGORY_ALIASES],
  };
}

/**
 * Validates a candidate calculator definition: schema shape (Zod), then that every step's expression
 * actually parses under the restricted grammar, and that every variable it references is either a
 * declared input or an earlier step's id — no forward references, no typos into an undeclared name.
 * This is the trust boundary for accepting a calculator definition from outside the app (a content
 * module, or eventually an LLM-authored draft): passing this check is necessary before the definition
 * is ever evaluated.
 */
export function validateCalculatorSchema(candidate: unknown): CalculatorSchemaValidation {
  const parsed = CalculatorSchemaSchema.safeParse(withCanonicalCategory(candidate));
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    };
  }
  const schema = parsed.data;
  const errors: string[] = [];
  const knownIds = new Set(schema.inputs.map((input) => input.id));

  for (const step of schema.steps) {
    let node: ExpressionNode;
    try {
      node = parseCalculatorExpression(step.expression);
    } catch (error) {
      const message = error instanceof CalculatorExpressionError ? error.message : String(error);
      errors.push(`step "${step.id}": ${message}`);
      continue;
    }
    const referenced = new Set<string>();
    referencedVariables(node, referenced);
    for (const name of referenced) {
      if (!knownIds.has(name)) {
        errors.push(`step "${step.id}": references unknown variable "${name}".`);
      }
    }
    knownIds.add(step.id);
  }

  return errors.length === 0 ? { ok: true, schema, errors: [] } : { ok: false, errors };
}
