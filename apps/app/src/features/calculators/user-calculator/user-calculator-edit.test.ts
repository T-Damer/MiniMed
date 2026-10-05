import { describe, expect, it } from 'vitest';
import {
  addBand,
  addInput,
  canAddBand,
  canAddInput,
  duplicateInput,
  insertIntoFormula,
  moveInput,
  removeBand,
  removeInput,
  setInputLabel,
  setInputName,
  sortBands,
  updateBand,
} from '@/features/calculators/user-calculator/user-calculator-edit';
import { USER_CALCULATOR_LIMITS } from '@/features/calculators/user-calculator/user-calculator-limits';
import { newUserCalculator, type UserCalculator } from '@/state/user-calculators';

function withInputs(count: number): UserCalculator {
  let model = newUserCalculator('2026-10-05T10:00:00.000Z');
  for (let index = 0; index < count; index += 1) model = addInput(model);
  return model;
}

describe('inputs', () => {
  it('adds inputs with unused ids and unused names', () => {
    const model = withInputs(3);
    expect(model.inputs.map((input) => input.id)).toEqual(['x1', 'x2', 'x3']);
    expect(model.inputs.map((input) => input.name)).toEqual([
      'значение',
      'значение_2',
      'значение_3',
    ]);
    expect(model.inputs.every((input) => input.label === '' && !input.integer)).toBe(true);
  });

  it('reuses the lowest free id after a delete and never clashes', () => {
    const model = removeInput(withInputs(3), 'x2');
    expect(addInput(model).inputs.map((input) => input.id)).toEqual(['x1', 'x3', 'x2']);
  });

  it('stops at the limit', () => {
    const full = withInputs(USER_CALCULATOR_LIMITS.inputs);
    expect(canAddInput(full)).toBe(false);
    expect(addInput(full)).toBe(full);
    expect(duplicateInput(full, 'x1')).toBe(full);
  });

  it('moves an input up and down and stops at the ends', () => {
    const model = withInputs(3);
    expect(moveInput(model, 'x2', -1).inputs.map((input) => input.id)).toEqual(['x2', 'x1', 'x3']);
    expect(moveInput(model, 'x2', 1).inputs.map((input) => input.id)).toEqual(['x1', 'x3', 'x2']);
    expect(moveInput(model, 'x1', -1)).toBe(model);
    expect(moveInput(model, 'x3', 1)).toBe(model);
    expect(moveInput(model, 'missing', 1)).toBe(model);
  });

  it('duplicates right after the original with a fresh id and name', () => {
    const named = setInputLabel(withInputs(2), 'x1', 'Масса');
    const copy = duplicateInput(named, 'x1');
    expect(copy.inputs.map((input) => input.id)).toEqual(['x1', 'x3', 'x2']);
    expect(copy.inputs[1]).toMatchObject({ label: 'Масса (копия)', name: 'масса_2' });
  });

  it('suggests the name from the label until the author chooses one', () => {
    let model = withInputs(1);
    model = setInputLabel(model, 'x1', 'Масса тела');
    expect(model.inputs[0]?.name).toBe('масса');
    model = setInputLabel(model, 'x1', 'Вес пациента');
    expect(model.inputs[0]?.name).toBe('вес');
    model = setInputName(model, 'x1', 'w');
    model = setInputLabel(model, 'x1', 'Масса');
    expect(model.inputs[0]?.name).toBe('w');
  });

  it('keeps a name that the formula already uses when the label changes', () => {
    let model = setInputLabel(withInputs(1), 'x1', 'Масса');
    model = { ...model, formula: 'масса * 2' };
    model = setInputLabel(model, 'x1', 'Вес');
    expect(model.inputs[0]).toMatchObject({ label: 'Вес', name: 'масса' });
  });

  it('keeps the suggested names of two inputs apart', () => {
    let model = setInputLabel(withInputs(2), 'x1', 'Масса');
    model = setInputLabel(model, 'x2', 'Масса тела');
    expect(model.inputs.map((input) => input.name)).toEqual(['масса', 'масса_2']);
  });

  it('carries a rename into the formula like a rename in an editor', () => {
    let model = setInputLabel(withInputs(2), 'x1', 'Масса');
    model = setInputLabel(model, 'x2', 'Рост');
    model = { ...model, formula: 'масса / (рост / 100) ^ 2 + массажист' };
    model = setInputName(model, 'x1', 'вес');
    expect(model.formula).toBe('вес / (рост / 100) ^ 2 + массажист');
    // A half-typed or taken name leaves the formula alone.
    expect(setInputName(model, 'x1', '').formula).toBe(model.formula);
    expect(setInputName(model, 'x1', 'рост').formula).toBe(model.formula);
    expect(setInputName(model, 'x1', 'max').formula).toBe(model.formula);
    expect(setInputName(model, 'x1', 'рост').inputs[0]?.name).toBe('рост');
  });

  it('does not rewrite a formula that would no longer fit', () => {
    let model = setInputLabel(withInputs(1), 'x1', 'Масса');
    model = { ...model, formula: `${'масса+'.repeat(80)}масса` };
    const renamed = setInputName(model, 'x1', 'массатела');
    expect(renamed.formula).toBe(model.formula);
  });
});

describe('ranges', () => {
  it('adds, edits, orders and removes ranges up to the limit', () => {
    let model = newUserCalculator();
    model = addBand(addBand(addBand(model)));
    expect(model.bands.map((band) => band.id)).toEqual(['b1', 'b2', 'b3']);
    model = updateBand(model, 'b1', (band) => ({ ...band, min: 30 }));
    model = updateBand(model, 'b2', (band) => ({ ...band, min: 10 }));
    model = updateBand(model, 'b3', (band) => ({ ...band, max: 5 }));
    expect(sortBands(model).bands.map((band) => band.id)).toEqual(['b3', 'b2', 'b1']);
    expect(removeBand(model, 'b2').bands.map((band) => band.id)).toEqual(['b1', 'b3']);
    let full = newUserCalculator();
    for (let index = 0; index < USER_CALCULATOR_LIMITS.bands; index += 1) full = addBand(full);
    expect(canAddBand(full)).toBe(false);
    expect(addBand(full)).toBe(full);
  });
});

describe('formula chips', () => {
  it('inserts a name at the caret, spaced from its neighbours', () => {
    expect(insertIntoFormula('', 'масса', null, null)).toEqual({ formula: 'масса', caret: 5 });
    expect(insertIntoFormula('a +', 'b', 3, 3)).toEqual({ formula: 'a + b', caret: 5 });
    expect(insertIntoFormula('a  c', 'b', 2, 2)).toEqual({ formula: 'a b c', caret: 3 });
    expect(insertIntoFormula('(', 'a', 1, 1)).toEqual({ formula: '(a', caret: 2 });
  });

  it('replaces a selection and puts the caret inside a function’s parentheses', () => {
    expect(insertIntoFormula('1 + xx', 'max()', 4, 6)).toEqual({
      formula: '1 + max()',
      caret: 8,
    });
    expect(insertIntoFormula('x', 'abs()', 0, 0)).toEqual({ formula: 'abs() x', caret: 4 });
  });

  it('refuses an insertion that would pass the length limit', () => {
    const long = 'a'.repeat(USER_CALCULATOR_LIMITS.formula);
    expect(insertIntoFormula(long, 'b', 3, 3)).toEqual({ formula: long, caret: 3 });
  });
});
