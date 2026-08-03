import { describe, expect, it } from 'vitest';

import {
  checkMedicationInteractions,
  extractMedicationNames,
  resolveMedication,
} from '@/features/interactions/interaction-engine';
import { MEDICATION_INTERACTION_KNOWLEDGE } from '@/features/interactions/interaction-knowledge';

describe('medication interaction engine', () => {
  it('normalizes aliases and extracts medications from a natural-language question', () => {
    expect(resolveMedication('Ципралекс', MEDICATION_INTERACTION_KNOWLEDGE)?.id).toBe(
      'med.escitalopram',
    );
    expect(
      extractMedicationNames(
        'Можно ли принимать эсциталопрам с фосфомицином?',
        MEDICATION_INTERACTION_KNOWLEDGE,
      ),
    ).toEqual(['Эсциталопрам', 'Фосфомицин']);
  });

  it('returns unknown rather than claiming compatibility when no reviewed relation exists', () => {
    const result = checkMedicationInteractions(
      ['эсциталопрам', 'фосфомицин'],
      MEDICATION_INTERACTION_KNOWLEDGE,
    );

    expect(result.unresolved).toEqual([]);
    expect(result.pairs).toHaveLength(1);
    expect(result.pairs[0]).toMatchObject({
      conclusion: 'unknown',
      severity: 'unknown',
      evidence: [],
    });
    expect(result.pairs[0]?.recommendation).toContain('не подтверждает отсутствие');
  });

  it('resolves a reviewed class interaction', () => {
    const result = checkMedicationInteractions(
      ['эсциталопрам', 'линезолид'],
      MEDICATION_INTERACTION_KNOWLEDGE,
    );

    expect(result.pairs[0]).toMatchObject({
      conclusion: 'contraindicated',
      severity: 'critical',
      certainty: 'established',
      assertionId: 'interaction.escitalopram.maoi',
    });
    expect(result.pairs[0]?.evidence).toHaveLength(1);
  });

  it('returns an explicit reviewed negative assertion only when it exists', () => {
    const result = checkMedicationInteractions(
      ['фосфомицин', 'циметидин'],
      MEDICATION_INTERACTION_KNOWLEDGE,
    );

    expect(result.pairs[0]).toMatchObject({
      conclusion: 'documented-no-significant-interaction',
      severity: 'none',
      certainty: 'established',
    });
    expect(result.pairs[0]?.evidence[0]?.sourceType).toBe('official-label');
  });

  it('checks every unique pair and reports unresolved or duplicate inputs', () => {
    const result = checkMedicationInteractions(
      ['эсциталопрам', 'пимозид', 'фосфомицин', 'Ципралекс', 'неизвестный препарат'],
      MEDICATION_INTERACTION_KNOWLEDGE,
    );

    expect(result.resolved).toHaveLength(3);
    expect(result.pairs).toHaveLength(3);
    expect(result.duplicateInputs).toEqual(['Ципралекс']);
    expect(result.unresolved).toEqual([{ input: 'неизвестный препарат' }]);
  });
});
