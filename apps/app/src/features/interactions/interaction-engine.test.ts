import { describe, expect, it } from 'vitest';

import {
  checkMedicationInteractions,
  extractMedicationNames,
  resolveMedication,
  validateMedicationInteractionKnowledge,
} from '@/features/interactions/interaction-engine';
import { MEDICATION_INTERACTION_KNOWLEDGE } from '@/features/interactions/interaction-knowledge';
import type { MedicationInteractionKnowledgeBase } from '@/features/interactions/interaction-types';

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

  it('keeps unresolved medications in pair analysis and fails closed', () => {
    const result = checkMedicationInteractions(
      ['эсциталопрам', 'неизвестный препарат'],
      MEDICATION_INTERACTION_KNOWLEDGE,
    );

    expect(result.participants).toHaveLength(2);
    expect(result.unresolved).toEqual([{ input: 'неизвестный препарат' }]);
    expect(result.pairs).toHaveLength(1);
    expect(result.pairs[0]).toMatchObject({
      conclusion: 'unknown',
      severity: 'unknown',
      evidence: [],
      right: { label: 'неизвестный препарат' },
    });
    expect(result.pairs[0]?.recommendation).toContain('не распознаны');
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
    expect(result.pairs[0]?.evidence[0]?.jurisdiction).toBe('США');
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

  it('checks every unique input pair and reports unresolved or duplicate inputs', () => {
    const result = checkMedicationInteractions(
      ['эсциталопрам', 'пимозид', 'фосфомицин', 'Ципралекс', 'неизвестный препарат'],
      MEDICATION_INTERACTION_KNOWLEDGE,
    );

    expect(result.resolved).toHaveLength(3);
    expect(result.participants).toHaveLength(4);
    expect(result.pairs).toHaveLength(6);
    expect(result.pairs.filter((pair) => !pair.left.concept || !pair.right.concept)).toHaveLength(3);
    expect(result.duplicateInputs).toEqual(['Ципралекс']);
    expect(result.unresolved).toEqual([{ input: 'неизвестный препарат' }]);
  });

  it('reports truncation and never evaluates more than twenty unique inputs', () => {
    const inputs = Array.from({ length: 21 }, (_, index) => `неизвестный-${index}`);
    const result = checkMedicationInteractions(inputs, MEDICATION_INTERACTION_KNOWLEDGE);

    expect(result.truncated).toBe(true);
    expect(result.participants).toHaveLength(20);
    expect(result.pairs).toHaveLength(190);
  });

  it('rejects assertions without exact evidence', () => {
    const firstAssertion = MEDICATION_INTERACTION_KNOWLEDGE.assertions[0];
    expect(firstAssertion).toBeDefined();
    const invalid: MedicationInteractionKnowledgeBase = {
      ...MEDICATION_INTERACTION_KNOWLEDGE,
      assertions: firstAssertion ? [{ ...firstAssertion, evidenceIds: [] }] : [],
    };

    expect(() => validateMedicationInteractionKnowledge(invalid)).toThrow('has no evidence');
  });

  it('rejects aliases that resolve to multiple medications', () => {
    const firstMedication = MEDICATION_INTERACTION_KNOWLEDGE.medications[0];
    expect(firstMedication).toBeDefined();
    const invalid: MedicationInteractionKnowledgeBase = {
      ...MEDICATION_INTERACTION_KNOWLEDGE,
      medications: firstMedication
        ? [
            ...MEDICATION_INTERACTION_KNOWLEDGE.medications,
            {
              ...firstMedication,
              id: 'med.alias-collision',
              preferredName: 'Другой препарат',
              aliases: ['Ципралекс'],
              classes: [],
            },
          ]
        : [],
    };

    expect(() => validateMedicationInteractionKnowledge(invalid)).toThrow('belongs to both');
  });

  it('returns conflicting evidence instead of choosing between overlapping class assertions', () => {
    const linezolid = MEDICATION_INTERACTION_KNOWLEDGE.medications.find(
      (medication) => medication.id === 'med.linezolid',
    );
    const baseAssertion = MEDICATION_INTERACTION_KNOWLEDGE.assertions[0];
    expect(linezolid).toBeDefined();
    expect(baseAssertion).toBeDefined();
    const conflicting: MedicationInteractionKnowledgeBase = {
      ...MEDICATION_INTERACTION_KNOWLEDGE,
      classes: [
        ...MEDICATION_INTERACTION_KNOWLEDGE.classes,
        { id: 'class.conflicting', title: 'Тестовый пересекающийся класс' },
      ],
      medications: MEDICATION_INTERACTION_KNOWLEDGE.medications.map((medication) =>
        medication.id === 'med.linezolid'
          ? { ...medication, classes: [...medication.classes, 'class.conflicting'] }
          : medication,
      ),
      assertions: baseAssertion
        ? [
            ...MEDICATION_INTERACTION_KNOWLEDGE.assertions,
            {
              ...baseAssertion,
              id: 'interaction.escitalopram.conflicting-class',
              interactant: { kind: 'class', id: 'class.conflicting' },
              conclusion: 'monitor',
              severity: 'moderate',
            },
          ]
        : [],
    };

    const result = checkMedicationInteractions(['эсциталопрам', 'линезолид'], conflicting);
    expect(result.pairs[0]).toMatchObject({
      conclusion: 'conflicting-evidence',
      severity: 'unknown',
    });
    expect(result.pairs[0]?.evidence).not.toHaveLength(0);
  });
});
