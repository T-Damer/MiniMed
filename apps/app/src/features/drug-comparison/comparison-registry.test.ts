import { describe, expect, it } from 'vitest';
import type { AssetCard } from './comparison-index';
import { REGISTRY_ROWS, registryCell, registrySourceLine } from './comparison-registry';
import { fixtureAsset } from './comparison-test-fixtures';

const asset = fixtureAsset();
const catalog = {
  source: 'НСИ Минздрава, справочник АТХ',
  version: '3.8',
  publishDate: '2025-07-15',
  names: {
    M01: 'Противовоспалительные и противоревматические препараты',
    M01A: 'Нестероидные противовоспалительные и противоревматические препараты',
    M01AE: 'Производные пропионовой кислоты',
  },
};
const [ibuprofen, paracetamol] = asset.cards;

const cell = (id: (typeof REGISTRY_ROWS)[number]['id'], card = ibuprofen as AssetCard) =>
  registryCell(id, card, asset, catalog);

describe('registryCell', () => {
  it('gives the МНН and the ATC code with the НСИ names of its groups', () => {
    expect(cell('mnn').lines).toEqual(['Ибупрофен']);
    expect(cell('atc').lines[0]).toBe(
      'M01AE01 — Нестероидные противовоспалительные и противоревматические препараты › Производные пропионовой кислоты',
    );
    expect(registryCell('atc', ibuprofen as AssetCard, asset, null).lines).toEqual(['M01AE01']);
  });

  it('lists forms with their strengths', () => {
    expect(cell('forms').lines).toEqual([
      'Таблетки: 200 мг, 400 мг',
      'Гель для наружного применения: 50 мг/г',
    ]);
  });

  it('counts registrations by conditions of dispensing, with the right plural', () => {
    expect(cell('dispensing').lines).toEqual([
      'По рецепту: 120 регистраций',
      'Без рецепта: 8 регистраций',
      'Условия не указаны: 3 регистрации',
    ]);
    expect(cell('dispensing', paracetamol as AssetCard).empty).toBe(true);
  });

  it('words the ЖНВЛП flag per form without a verdict', () => {
    expect(cell('essential').lines).toEqual([
      'Входит: Таблетки',
      'Не входит: Гель для наружного применения',
    ]);
    expect(cell('essential', paracetamol as AssetCard).lines).toEqual([
      'Входит: все формы, указанные в реестре',
    ]);
  });

  it('says the registry has nothing where it has nothing, and counts in the right form', () => {
    expect(cell('group', paracetamol as AssetCard)).toMatchObject({ empty: true });
    expect(cell('counts').lines[0]).toBe('155 регистрационных удостоверений');
    expect(
      cell('counts', { ...(paracetamol as AssetCard), r: 1, t: 21, m: 2, h: 22 }).lines,
    ).toEqual([
      '1 регистрационное удостоверение',
      '21 торговое наименование',
      '2 производителя',
      '22 держателя удостоверения',
    ]);
  });

  it('cites its sources', () => {
    expect(registrySourceLine(asset, catalog)).toBe(
      'ЕСКЛП (выгрузка 2026-08-28) · ГРЛС (02.10.2026) · НСИ «АТХ» (версия 3.8)',
    );
    expect(REGISTRY_ROWS.every((row) => row.source !== '')).toBe(true);
  });
});
