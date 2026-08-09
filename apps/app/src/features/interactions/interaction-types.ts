export type InteractionConclusion =
  | 'contraindicated'
  | 'avoid'
  | 'management-required'
  | 'monitor'
  | 'separate-administration'
  | 'documented-minor'
  | 'documented-no-significant-interaction'
  | 'potential-mechanistic-interaction'
  | 'conflicting-evidence'
  | 'unknown';

export type InteractionSeverity = 'critical' | 'high' | 'moderate' | 'low' | 'none' | 'unknown';
export type InteractionCertainty = 'established' | 'probable' | 'possible' | 'theoretical';
export type InteractionDirection =
  | 'bidirectional'
  | 'subject-affects-interactant'
  | 'interactant-affects-subject';

export interface MedicationConcept {
  readonly id: string;
  readonly preferredName: string;
  readonly aliases: readonly string[];
  readonly classes: readonly string[];
  readonly externalIds?: Readonly<Record<string, string>>;
}

export interface MedicationClass {
  readonly id: string;
  readonly title: string;
}

export interface InteractionTarget {
  readonly kind: 'medication' | 'class';
  readonly id: string;
}

export interface InteractionAssertion {
  readonly id: string;
  readonly subjectMedicationId: string;
  readonly interactant: InteractionTarget;
  readonly direction: InteractionDirection;
  readonly conclusion: Exclude<InteractionConclusion, 'unknown' | 'conflicting-evidence'>;
  readonly severity: Exclude<InteractionSeverity, 'unknown'>;
  readonly certainty: InteractionCertainty;
  readonly interactionType: 'pharmacodynamic' | 'pharmacokinetic' | 'pharmaceutical';
  readonly mechanism: string;
  readonly effect: string;
  readonly recommendation: string;
  readonly evidenceIds: readonly string[];
  readonly reviewStatus: 'reviewed';
  readonly reviewedAt: string;
}

export interface InteractionEvidence {
  readonly id: string;
  readonly sourceTitle: string;
  readonly sourceUrl: string;
  readonly sourceType: 'official-label' | 'clinical-guideline' | 'peer-reviewed';
  readonly issuer: string;
  readonly jurisdiction: string;
  readonly sourceVersion: string;
  readonly reviewedAt: string;
  readonly quote: string;
}

export interface MedicationInteractionKnowledgeBase {
  readonly schemaVersion: 1;
  readonly classes: readonly MedicationClass[];
  readonly medications: readonly MedicationConcept[];
  readonly assertions: readonly InteractionAssertion[];
  readonly evidence: readonly InteractionEvidence[];
}

export interface ResolvedMedication {
  readonly input: string;
  readonly concept: MedicationConcept;
}

export interface UnresolvedMedication {
  readonly input: string;
}

export interface InteractionParticipant {
  readonly input: string;
  readonly label: string;
  readonly concept?: MedicationConcept;
}

export interface InteractionPairResult {
  readonly left: InteractionParticipant;
  readonly right: InteractionParticipant;
  readonly conclusion: InteractionConclusion;
  readonly severity: InteractionSeverity;
  readonly certainty?: InteractionCertainty;
  readonly interactionType?: InteractionAssertion['interactionType'];
  readonly direction?: InteractionDirection;
  readonly mechanism?: string;
  readonly effect?: string;
  readonly recommendation: string;
  readonly assertionId?: string;
  readonly evidence: readonly InteractionEvidence[];
}

export interface MedicationInteractionCheckResult {
  readonly participants: readonly InteractionParticipant[];
  readonly resolved: readonly ResolvedMedication[];
  readonly unresolved: readonly UnresolvedMedication[];
  readonly duplicateInputs: readonly string[];
  readonly pairs: readonly InteractionPairResult[];
  readonly truncated: boolean;
}
