import { describe, expect, it } from 'vitest';

import { extractRows } from './comparison-sections';
import { fixtureIndex, instruction, section } from './comparison-test-fixtures';
import {
  type CompareItem,
  choicesOf,
  chooseDocuments,
  clusterLabel,
  columnViews,
  type DocumentState,
  instructionsOf,
  isDifference,
  readsOwnProduct,
  rowSummary,
  sectionRowViews,
} from './comparison-view';

const index = fixtureIndex();
const item = (
  id: string,
  card: number,
  label: string,
  product: string | null = null,
): CompareItem => ({
  id,
  card,
  label,
  product,
});
const ibuprofen = item('ибупрофен', 0, 'Ибупрофен');
const paracetamol = item('парацетамол', 1, 'Парацетамол');

describe('which instruction is read', () => {
  it('reads the same dosage-form class in every drug where there is one', () => {
    const chosen = chooseDocuments(index, [ibuprofen, paracetamol], new Map());
    const form = (id: string | null | undefined): number =>
      index.asset.documents[id ?? '']?.f ?? -1;
    expect(form(chosen.get('ибупрофен'))).toBe(0);
    expect(form(chosen.get('парацетамол'))).toBe(0);
    expect(chosen.get('парацетамол')).toBe('drug.rf.b1.instruction');
  });

  it('reads the product the doctor asked for, whatever form the others are', () => {
    const gel = item('ибупрофен|Ибупрофен гель', 0, 'Ибупрофен гель · Ибупрофен', 'Ибупрофен гель');
    expect(instructionsOf(index, gel)[0]).toBe('drug.rf.a3.instruction');
    expect(readsOwnProduct(index, gel, 'drug.rf.a3.instruction')).toBe(true);
    const chosen = chooseDocuments(index, [gel, paracetamol], new Map());
    expect(chosen.get(gel.id)).toBe('drug.rf.a3.instruction');
  });

  it('keeps an instruction the doctor chose', () => {
    const chosen = chooseDocuments(
      index,
      [ibuprofen, paracetamol],
      new Map([['парацетамол', 'drug.rf.b2.instruction']]),
    );
    expect(chosen.get('парацетамол')).toBe('drug.rf.b2.instruction');
  });

  it('is the same for the same input, and lists the other instructions to switch to', () => {
    const first = chooseDocuments(index, [ibuprofen, paracetamol], new Map());
    const second = chooseDocuments(index, [ibuprofen, paracetamol], new Map());
    expect([...first]).toEqual([...second]);
    const choices = choicesOf(index, ibuprofen, 'drug.rf.a1.instruction');
    expect(choices.filter((choice) => choice.selected)).toHaveLength(1);
    expect(choices.map((choice) => choice.label).join(' ')).toContain('гель');
  });

  it('says a card without an instruction has none', () => {
    const asset = { ...index.asset, documents: {} };
    const empty = { ...index, asset, documentsOfCard: new Map<number, readonly string[]>() };
    expect(chooseDocuments(empty, [ibuprofen], new Map()).get('ибупрофен')).toBeNull();
  });
});

describe('the marks', () => {
  it('words a mark without a judgement', () => {
    expect(clusterLabel('shared', true, ['A', 'B'], 2)).toBe('у обоих');
    expect(clusterLabel('shared', true, ['A', 'B', 'C'], 3)).toBe('у всех');
    expect(clusterLabel('only', true, ['Нурофен'], 2)).toBe('только у Нурофен');
    expect(clusterLabel('partial', true, ['A', 'B'], 3)).toBe('у A, B');
    expect(clusterLabel('shared', false, ['A', 'B'], 2)).toBe('у обоих, формулировки различаются');
  });

  it('matches statements across two read instructions and counts them', () => {
    const left = instruction('l', [
      section('contraindications', 'Противопоказания', [
        ' Гиперчувствительность к ибупрофену.\n\n Беременность в третьем триместре.',
      ]),
    ]);
    const right = instruction('r', [
      section('contraindications', 'Противопоказания', [
        ' Гиперчувствительность к парацетамолу.\n\n Тяжелая печеночная недостаточность.',
      ]),
    ]);
    const chosen = new Map([
      ['ибупрофен', 'drug.rf.a1.instruction'],
      ['парацетамол', 'drug.rf.b1.instruction'],
    ]);
    const documents = new Map<string, DocumentState>([
      ['drug.rf.a1.instruction', { document: left }],
      ['drug.rf.b1.instruction', { document: right }],
    ]);
    const columns = columnViews(index, [ibuprofen, paracetamol], chosen, documents);
    expect(columns.map((column) => column.state)).toEqual(['ready', 'ready']);
    const rows = sectionRowViews(
      columns,
      new Map([
        [0, extractRows(left)],
        [1, extractRows(right)],
      ]),
      new Map([
        [0, ['ИБУПРОФЕН']],
        [1, ['ПАРАЦЕТАМОЛ']],
      ]),
    );
    const row = rows.find((entry) => entry.id === 'contraindications');
    expect(row?.compared).toBe(true);
    expect(row?.counts.identical).toBe(1);
    expect(row?.counts.only).toEqual([1, 1]);
    expect(row?.clusters.filter(isDifference)).toHaveLength(2);
    expect(rowSummary(row as never, columns)).toContain('одинаковых: 1');
    const indications = rows.find((entry) => entry.id === 'indications');
    expect(indications?.columns.every((column) => !column.hasSection)).toBe(true);
  });

  it('gives no marks until two instructions are read', () => {
    const document = instruction('l', [
      section('indications', 'Показания', ['Боль слабой степени.']),
    ]);
    const chosen = new Map([
      ['ибупрофен', 'drug.rf.a1.instruction'],
      ['парацетамол', 'drug.rf.b1.instruction'],
    ]);
    const columns = columnViews(
      index,
      [ibuprofen, paracetamol],
      chosen,
      new Map<string, DocumentState>([
        ['drug.rf.a1.instruction', { document }],
        ['drug.rf.b1.instruction', 'missing'],
      ]),
    );
    expect(columns.map((column) => column.state)).toEqual(['ready', 'not-installed']);
    const rows = sectionRowViews(columns, new Map([[0, extractRows(document)]]), new Map());
    expect(rows.every((row) => !row.compared && row.clusters.length === 0)).toBe(true);
  });
});
