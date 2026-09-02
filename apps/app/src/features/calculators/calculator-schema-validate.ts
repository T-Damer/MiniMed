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

  for (const visual of schema.visuals) {
    for (const dataset of visual.datasets) {
      for (const [index, entry] of dataset.data.entries()) {
        if (typeof entry === 'number') continue;
        let node: ExpressionNode;
        try {
          node = parseCalculatorExpression(entry);
        } catch (error) {
          const message =
            error instanceof CalculatorExpressionError ? error.message : String(error);
          errors.push(
            `visual "${visual.id}" dataset "${dataset.label}" point ${index + 1}: ${message}`,
          );
          continue;
        }
        const referenced = new Set<string>();
        referencedVariables(node, referenced);
        for (const name of referenced) {
          if (!knownIds.has(name)) {
            errors.push(
              `visual "${visual.id}" dataset "${dataset.label}" point ${index + 1}: references unknown variable "${name}".`,
            );
          }
        }
      }
    }
  }

  for (const [index, rule] of schema.evaluation.rules.entries()) {
    let node: ExpressionNode;
    try {
      node = parseCalculatorExpression(rule.when);
    } catch (error) {
      const message = error instanceof CalculatorExpressionError ? error.message : String(error);
      errors.push(`evaluation rule ${index + 1}: ${message}`);
      continue;
    }
    const referenced = new Set<string>();
    referencedVariables(node, referenced);
    for (const name of referenced) {
      if (!knownIds.has(name))
        errors.push(`evaluation rule ${index + 1}: references unknown variable "${name}".`);
    }
  }

  const inputIds = new Set(schema.inputs.map((input) => input.id));
  const stepIds = new Set(schema.steps.map((step) => step.id));
  const outputIds = new Set(schema.steps.filter((step) => step.isOutput).map((step) => step.id));
  for (const [index, mapping] of schema.observationMappings.entries()) {
    const sourceId = mapping.inputId ?? mapping.stepId ?? mapping.outputId;
    if (mapping.inputId && !inputIds.has(mapping.inputId)) {
      errors.push(`observationMappings.${index}: unknown input "${mapping.inputId}".`);
    } else if (
      mapping.inputId &&
      schema.inputs.find((input) => input.id === mapping.inputId)?.kind !== 'number'
    ) {
      errors.push(`observationMappings.${index}: input "${mapping.inputId}" is not numeric.`);
    }
    if (mapping.stepId && !stepIds.has(mapping.stepId)) {
      errors.push(`observationMappings.${index}: unknown step "${mapping.stepId}".`);
    } else if (
      mapping.stepId &&
      schema.steps.find((step) => step.id === mapping.stepId)?.valueKind !== 'number'
    ) {
      errors.push(`observationMappings.${index}: step "${mapping.stepId}" is not numeric.`);
    }
    if (mapping.outputId && !outputIds.has(mapping.outputId)) {
      errors.push(
        `observationMappings.${index}: output "${mapping.outputId}" is not a final output.`,
      );
    } else if (
      mapping.outputId &&
      schema.steps.find((step) => step.id === mapping.outputId)?.valueKind !== 'number'
    ) {
      errors.push(`observationMappings.${index}: output "${mapping.outputId}" is not numeric.`);
    }
    if (mapping.scaleId) {
      errors.push(`observationMappings.${index}: scaleId is not valid for calculator schemas.`);
    }
    if (!sourceId && !mapping.scaleId) {
      errors.push(`observationMappings.${index}: missing source reference.`);
    }
  }

  return errors.length === 0 ? { ok: true, schema, errors: [] } : { ok: false, errors };
}
