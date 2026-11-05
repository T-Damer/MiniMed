import { describe, expect, it } from 'vitest';

import type { DrugScreenModel } from '@/features/medications/drug-screen';
import { buildCompoundIndex, parseCompoundFacts } from './compound-facts';
import chunk from './compound-facts.json';
import { componentRoleLabel, compositionComponents, drugActiveCompound } from './drug-compounds';

const index = buildCompoundIndex(parseCompoundFacts(chunk));

function screen(title: string, atc: readonly string[] = []): DrugScreenModel {
  return {
    header: { kind: 'substance', title },
    links: {
      substance: null,
      atc: atc.map((code) => ({ code, level: 5 })),
    },
  } as unknown as DrugScreenModel;
}

describe('drugActiveCompound', () => {
  it('finds a single substance by name, with its structure', () => {
    const found = drugActiveCompound(index, screen('Глимепирид'));
    expect(found?.ru.toLowerCase()).toContain('глимепирид');
    expect(found?.smiles).toBeTruthy();
  });

  it('gives no structure for a combination', () => {
    expect(drugActiveCompound(index, screen('Амлодипин + Лизиноприл'))).toBeNull();
  });
});

describe('compositionComponents', () => {
  it('names the active substance and the role of each excipient', () => {
    const components = compositionComponents(
      index,
      'Состав на одну таблетку: действующее вещество: глимепирид – 4,0 мг; вспомогательные вещества: лактозы моногидрат (сахар молочный) – 102,8 мг, целлюлоза микрокристаллическая – 14,0 мг, кроскармеллоза натрия – 4,0 мг, натрия лаурилсульфат – 0,2 мг, магния стеарат – 1,0 мг.',
    );
    const labels = new Map(
      components.map((component) => [component.compound.key, componentRoleLabel(component)]),
    );
    expect(components[0]?.role).toBe('active');
    expect(componentRoleLabel(components[0] as (typeof components)[number])).toBe('действующее');
    expect([...labels.values()]).toContain('разрыхлитель');
    expect([...labels.values()]).toContain('смазывающее вещество');
    expect(components.length).toBeGreaterThanOrEqual(5);
  });
});
