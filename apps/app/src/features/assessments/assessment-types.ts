import type {
  AssessmentVisualDefinition,
  EvaluationStatus,
  ObservationMapping,
  ReferenceVerdict,
  ToolEvaluation,
  ToolSourceLink,
} from '@localmed/contracts';
import type { CalculationChartSpec } from '@/features/calculators/clinical-calculations';

export type AssessmentResponseValue = number;

export interface AssessmentResponseOption {
  readonly value: AssessmentResponseValue;
  readonly label: string;
  /** Shows a local questionnaire answer without its internal response value. */
  readonly hideValue?: true;
}

export interface AssessmentImage {
  readonly id: string;
  readonly alt: string;
  readonly dataUrl: string;
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
  /** Optional explanatory text supplied by a local user-created questionnaire. */
  readonly text?: string;
  readonly images?: readonly AssessmentImage[];
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

export interface AssessmentInterpretationBand {
  readonly minScore?: number | undefined;
  readonly maxScore?: number | undefined;
  readonly scaleId?: string;
  readonly when?: string | undefined;
  readonly headline: string;
  readonly message: string;
}

export interface AssessmentDefinition {
  /** v2 is the only persisted tool contract. Local drafts may omit this while being edited. */
  readonly schemaVersion?: 2;
  /** Immutable content-pack version captured with completed results. */
  readonly version?: string;
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly shortTitle: string;
  readonly aliases: readonly string[];
  readonly bankId: string;
  readonly bankLabel: string;
  readonly category: string;
  readonly description: string;
  readonly estimatedMinutes: number;
  readonly audience: string;
  /** Optional explanatory text and images supplied by a local user-created questionnaire. */
  readonly intro?: string;
  readonly images?: readonly AssessmentImage[];
  readonly responseOptions: readonly AssessmentResponseOption[];
  readonly scales: readonly AssessmentScaleDefinition[];
  /** Local questionnaires may record chosen answers without calculating a score. */
  readonly scoringMode?: 'responses-only';
  readonly questions: readonly AssessmentQuestion[];
  readonly disclaimer: string;
  readonly evidenceNote: string;
  readonly interpretations?: readonly AssessmentInterpretationBand[];
  readonly visuals?: readonly AssessmentVisualDefinition[];
  readonly evaluation?: ToolEvaluation;
  readonly observationMappings?: readonly ObservationMapping[];
  readonly license: AssessmentLicense;
  readonly sourceLinks?: readonly ToolSourceLink[];
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

export interface AssessmentEvaluation {
  readonly status: EvaluationStatus;
  readonly verdict?: ReferenceVerdict;
  readonly missingContext: readonly string[];
  readonly reason?: string;
  readonly sourceIds: readonly string[];
}

export interface ScoredAssessment {
  readonly assessmentId: string;
  readonly completedAt: string;
  readonly scores: readonly AssessmentScaleScore[];
  readonly primaryScaleIds: readonly string[];
  readonly headline: string;
  readonly summary: string;
  readonly disclaimer: string;
  readonly visuals?: readonly CalculationChartSpec[];
  readonly evaluation?: AssessmentEvaluation;
}

export type AssessmentAnswers = Readonly<Record<string, AssessmentResponseValue>>;

interface AssessmentRecordBase {
  readonly id: string;
  readonly assessmentId: string;
  readonly subjectLabel: string;
  readonly createdAt: string;
  /** Set only after an explicit protected patient selection. */
  readonly patientId?: string;
  readonly episodeId?: string;
  readonly definitionVersion?: string;
  readonly contextSnapshot?: Readonly<Record<string, string | number>>;
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
