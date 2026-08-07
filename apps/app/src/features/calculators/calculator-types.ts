export type CalculatorAudience = 'all' | 'adult' | 'pediatric';

export type CalculatorCategory =
  | 'unit-conversion'
  | 'renal'
  | 'anthropometry'
  | 'fluids'
  | 'medication'
  | 'screening'
  | 'obstetrics'
  | 'gynecology';

export interface CalculatorSourceReference {
  readonly title: string;
  readonly publisher: string;
  readonly version: string;
  readonly url: string;
  readonly reviewedAt: string;
}

export interface CalculatorInputConstraint {
  readonly input: string;
  readonly unit?: string;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly required: boolean;
  readonly note?: string;
}

export interface AvailableCalculatorDefinition {
  readonly id: string;
  readonly slug: string;
  readonly state: 'available';
  readonly title: string;
  readonly shortTitle: string;
  readonly aliases: readonly string[];
  readonly summary: string;
  readonly audience: CalculatorAudience;
  readonly category: CalculatorCategory;
  readonly clinical: boolean;
  readonly formula: string;
  readonly population: string;
  readonly limitations: readonly string[];
  readonly inputs: readonly CalculatorInputConstraint[];
  readonly sources: readonly CalculatorSourceReference[];
}

export interface PlannedCalculatorDefinition {
  readonly id: string;
  readonly state: 'planned';
  readonly title: string;
  readonly summary: string;
  readonly audience: CalculatorAudience;
  readonly category: CalculatorCategory;
  readonly clinical: boolean;
  readonly sourceRequirement: string;
}

export type CalculatorDefinition = AvailableCalculatorDefinition | PlannedCalculatorDefinition;

export interface CalculationTraceStep {
  readonly label: string;
  readonly expression: string;
  readonly value: number;
  readonly unit: string;
}
