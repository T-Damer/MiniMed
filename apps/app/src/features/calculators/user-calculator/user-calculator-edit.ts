import { USER_CALCULATOR_LIMITS } from '@/features/calculators/user-calculator/user-calculator-limits';
import {
  inputNameBase,
  suggestInputName,
  userInputNameError,
} from '@/features/calculators/user-calculator/user-formula';
import type {
  UserCalculator,
  UserCalculatorBand,
  UserCalculatorInput,
} from '@/state/user-calculators';

/** Pure edits of a calculator draft: each returns a new model and leaves the old one untouched. */

function nextId(prefix: 'x' | 'b', used: readonly string[]): string {
  const taken = new Set(used);
  for (let number = 1; number < 10_000; number += 1) {
    if (!taken.has(`${prefix}${number}`)) return `${prefix}${number}`;
  }
  throw new Error('Слишком много элементов.');
}

function otherNames(model: UserCalculator, exceptId: string): readonly string[] {
  return model.inputs.filter((input) => input.id !== exceptId).map((input) => input.name);
}

function escapeForPattern(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function wholeWord(name: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escapeForPattern(name)}(?![\\p{L}\\p{N}_])`, 'giu');
}

function formulaUses(formula: string, name: string): boolean {
  return name !== '' && wholeWord(name).test(formula);
}

/** A name the label asked for (possibly numbered to stay unique), as opposed to one the author typed. */
function isSuggestedName(name: string, label: string): boolean {
  const base = inputNameBase(label);
  return name === base || new RegExp(`^${escapeForPattern(base)}_\\d+$`, 'u').test(name);
}

export function canAddInput(model: UserCalculator): boolean {
  return model.inputs.length < USER_CALCULATOR_LIMITS.inputs;
}

export function addInput(model: UserCalculator): UserCalculator {
  if (!canAddInput(model)) return model;
  const input: UserCalculatorInput = {
    id: nextId(
      'x',
      model.inputs.map((item) => item.id),
    ),
    name: suggestInputName(
      '',
      model.inputs.map((item) => item.name),
    ),
    label: '',
    unit: '',
    integer: false,
  };
  return { ...model, inputs: [...model.inputs, input] };
}

export function duplicateInput(model: UserCalculator, inputId: string): UserCalculator {
  const index = model.inputs.findIndex((input) => input.id === inputId);
  const source = model.inputs[index];
  if (!source || !canAddInput(model)) return model;
  const copy: UserCalculatorInput = {
    ...source,
    id: nextId(
      'x',
      model.inputs.map((item) => item.id),
    ),
    name: suggestInputName(
      `${source.name}_2`,
      model.inputs.map((item) => item.name),
    ),
    label: source.label ? `${source.label} (копия)`.slice(0, USER_CALCULATOR_LIMITS.label) : '',
  };
  return {
    ...model,
    inputs: [...model.inputs.slice(0, index + 1), copy, ...model.inputs.slice(index + 1)],
  };
}

export function removeInput(model: UserCalculator, inputId: string): UserCalculator {
  return { ...model, inputs: model.inputs.filter((input) => input.id !== inputId) };
}

export function moveInput(
  model: UserCalculator,
  inputId: string,
  direction: -1 | 1,
): UserCalculator {
  const index = model.inputs.findIndex((input) => input.id === inputId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= model.inputs.length) return model;
  const inputs = [...model.inputs];
  const moved = inputs[index];
  const swapped = inputs[target];
  if (!moved || !swapped) return model;
  inputs[index] = swapped;
  inputs[target] = moved;
  return { ...model, inputs };
}

export function updateInput(
  model: UserCalculator,
  inputId: string,
  update: (input: UserCalculatorInput) => UserCalculatorInput,
): UserCalculator {
  return {
    ...model,
    inputs: model.inputs.map((input) => (input.id === inputId ? update(input) : input)),
  };
}

/**
 * A new label renames the variable too, as long as the name was the suggestion made from the old
 * label (the author never chose it) and no formula uses it yet.
 */
export function setInputLabel(
  model: UserCalculator,
  inputId: string,
  label: string,
): UserCalculator {
  const current = model.inputs.find((input) => input.id === inputId);
  if (!current) return model;
  const others = otherNames(model, inputId);
  const followsLabel =
    current.name === '' ||
    (isSuggestedName(current.name, current.label) && !formulaUses(model.formula, current.name));
  const name = followsLabel ? suggestInputName(label, others) : current.name;
  return updateInput(model, inputId, (input) => ({ ...input, label, name }));
}

/**
 * Renames the variable and carries the new name into the formula, like a rename in a code editor, so
 * a formula already written keeps working. The formula is left alone while either name is unusable
 * (half-typed, taken) or when the rewrite would not fit.
 */
export function setInputName(model: UserCalculator, inputId: string, name: string): UserCalculator {
  const current = model.inputs.find((input) => input.id === inputId);
  if (!current) return model;
  const others = otherNames(model, inputId);
  let formula = model.formula;
  if (
    current.name !== name &&
    userInputNameError(current.name, others) === null &&
    userInputNameError(name, others) === null
  ) {
    const rewritten = formula.replace(wholeWord(current.name), () => name);
    if (rewritten.length <= USER_CALCULATOR_LIMITS.formula) formula = rewritten;
  }
  return { ...updateInput(model, inputId, (input) => ({ ...input, name })), formula };
}

export function canAddBand(model: UserCalculator): boolean {
  return model.bands.length < USER_CALCULATOR_LIMITS.bands;
}

export function addBand(model: UserCalculator): UserCalculator {
  if (!canAddBand(model)) return model;
  const band: UserCalculatorBand = {
    id: nextId(
      'b',
      model.bands.map((item) => item.id),
    ),
    headline: '',
    message: '',
  };
  return { ...model, bands: [...model.bands, band] };
}

export function removeBand(model: UserCalculator, bandId: string): UserCalculator {
  return { ...model, bands: model.bands.filter((band) => band.id !== bandId) };
}

export function updateBand(
  model: UserCalculator,
  bandId: string,
  update: (band: UserCalculatorBand) => UserCalculatorBand,
): UserCalculator {
  return {
    ...model,
    bands: model.bands.map((band) => (band.id === bandId ? update(band) : band)),
  };
}

/** Bands ordered from the lowest limit up, which is how a table of ranges is read. */
export function sortBands(model: UserCalculator): UserCalculator {
  const key = (band: UserCalculatorBand): number =>
    band.min ?? band.max ?? Number.NEGATIVE_INFINITY;
  return { ...model, bands: model.bands.toSorted((left, right) => key(left) - key(right)) };
}

/** Inserts `text` into the formula at the caret (or the end), spaced so it reads as a separate token. */
export function insertIntoFormula(
  formula: string,
  text: string,
  selectionStart: number | null,
  selectionEnd: number | null,
): { readonly formula: string; readonly caret: number } {
  const start = selectionStart ?? formula.length;
  const end = selectionEnd ?? start;
  const before = formula.slice(0, start);
  const after = formula.slice(end);
  const lead = before === '' || /[\s(;]$/u.test(before) ? '' : ' ';
  const trail = after === '' || /^[\s);]/u.test(after) ? '' : ' ';
  const inserted = `${lead}${text}${trail}`;
  const next = `${before}${inserted}${after}`;
  if (next.length > USER_CALCULATOR_LIMITS.formula) return { formula, caret: start };
  // A function leaves the caret inside its parentheses, a name after itself.
  const inside = text.endsWith(')') ? text.length - 1 : text.length;
  return { formula: next, caret: before.length + lead.length + inside };
}
