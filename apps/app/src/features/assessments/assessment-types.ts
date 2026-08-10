export type AssessmentResponseValue = 0 | 1 | 2 | 3 | 4 | 5;

export interface AssessmentResponseOption {
  readonly value: AssessmentResponseValue;
  readonly label: string;
}

export interface AssessmentScaleDefinition {
  readonly id: string;
  readonly label: string;
  readonly shortLabel: string;
  readonly description: string;
}

export interface AssessmentQuestion {
  readonly id: string;
  readonly prompt: string;
  readonly scaleId: string;
  readonly reverse?: true;
  /**
   * Overrides `AssessmentDefinition.responseOptions` for this question only. Real clinical
   * instruments (e.g. EPDS) give each item its own answer wording over the same point range,
   * unlike the project's original Likert-style questionnaires which reuse one option set.
   */
  readonly responseOptions?: readonly AssessmentResponseOption[];
}

export type AssessmentLicenseKind =
  | 'project-original'
  | 'public-domain-derived'
  | 'third-party-attributed';

export interface AssessmentLicense {
  readonly kind: AssessmentLicenseKind;
  readonly notice: string;
  readonly sourceUrl?: string;
}

export interface AssessmentDefinition {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly shortTitle: string;
  readonly aliases: readonly string[];
  readonly bankId: string;
  readonly bankLabel: string;
  readonly category:
    | 'self-reflection'
    | 'work-style'
    | 'team-role'
    | 'temperament'
    | 'newborn-screening'
    | 'perinatal-mood'
    | 'gynecologic-endocrinology';
  readonly description: string;
  readonly estimatedMinutes: number;
  readonly audience: string;
  readonly responseOptions: readonly AssessmentResponseOption[];
  readonly scales: readonly AssessmentScaleDefinition[];
  readonly questions: readonly AssessmentQuestion[];
  readonly disclaimer: string;
  readonly evidenceNote: string;
  readonly license: AssessmentLicense;
}

export interface AssessmentScaleScore {
  readonly scaleId: string;
  readonly label: string;
  readonly shortLabel: string;
  readonly rawScore: number;
  readonly minimumScore: number;
  readonly maximumScore: number;
  readonly percent: number;
}

export interface ScoredAssessment {
  readonly assessmentId: string;
  readonly completedAt: string;
  readonly scores: readonly AssessmentScaleScore[];
  readonly primaryScaleIds: readonly string[];
  readonly headline: string;
  readonly summary: string;
  readonly disclaimer: string;
}

export type AssessmentAnswers = Readonly<Record<string, AssessmentResponseValue>>;

interface AssessmentRecordBase {
  readonly id: string;
  readonly assessmentId: string;
  readonly subjectLabel: string;
  readonly createdAt: string;
}

export interface CompletedAssessmentRecord extends AssessmentRecordBase {
  readonly kind: 'completed';
  readonly answers: AssessmentAnswers;
  readonly result: ScoredAssessment;
}

export interface IncompleteAssessmentRecord extends AssessmentRecordBase {
  readonly kind: 'incomplete';
  readonly answers: AssessmentAnswers;
  readonly totalQuestions: number;
}

export interface ManualAssessmentRecord extends AssessmentRecordBase {
  readonly kind: 'manual';
  readonly text: string;
}

export type AssessmentRecord =
  | CompletedAssessmentRecord
  | IncompleteAssessmentRecord
  | ManualAssessmentRecord;
