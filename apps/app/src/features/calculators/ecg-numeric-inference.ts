export const ECG_NUMERIC_FEATURES = [
  { id: 'P_Dur_Global', label: 'P', unit: 'ms', min: 20, max: 400 },
  { id: 'PR_Int_Global', label: 'PR', unit: 'ms', min: 40, max: 600 },
  { id: 'QRS_Dur_Global', label: 'QRS', unit: 'ms', min: 20, max: 500 },
  { id: 'QT_Int_Global', label: 'QT', unit: 'ms', min: 100, max: 900 },
  { id: 'QT_IntFramingham_Global', label: 'QTc Framingham', unit: 'ms', min: 100, max: 900 },
  { id: 'RR_Mean_Global', label: 'RR средний', unit: 'ms', min: 200, max: 5_000 },
  { id: 'T_Amp_aVR', label: 'T · aVR', unit: 'mV', min: -20, max: 20 },
  { id: 'R_Amp_V6', label: 'R · V6', unit: 'mV', min: -20, max: 20 },
  { id: 'T_Amp_V6', label: 'T · V6', unit: 'mV', min: -20, max: 20 },
  { id: 'R_Amp_V5', label: 'R · V5', unit: 'mV', min: -20, max: 20 },
  { id: 'R_Amp_II', label: 'R · II', unit: 'mV', min: -20, max: 20 },
  { id: 'T_Amp_V5', label: 'T · V5', unit: 'mV', min: -20, max: 20 },
  { id: 'R_Amp_V1', label: 'R · V1', unit: 'mV', min: -20, max: 20 },
  { id: 'T_Amp_I', label: 'T · I', unit: 'mV', min: -20, max: 20 },
  { id: 'R_Amp_aVR', label: 'R · aVR', unit: 'mV', min: -20, max: 20 },
  { id: 'Q_Amp_V2', label: 'Q · V2', unit: 'mV', min: -20, max: 20 },
  { id: 'Q_Amp_II', label: 'Q · II', unit: 'mV', min: -20, max: 20 },
  { id: 'S_Amp_V1', label: 'S · V1', unit: 'mV', min: -20, max: 20 },
  { id: 'Q_Amp_V1', label: 'Q · V1', unit: 'mV', min: -20, max: 20 },
  { id: 'T_Amp_II', label: 'T · II', unit: 'mV', min: -20, max: 20 },
  { id: 'R_Amp_aVF', label: 'R · aVF', unit: 'mV', min: -20, max: 20 },
  { id: 'R_Amp_III', label: 'R · III', unit: 'mV', min: -20, max: 20 },
  { id: 'T_Amp_V1', label: 'T · V1', unit: 'mV', min: -20, max: 20 },
  { id: 'R_Amp_V4', label: 'R · V4', unit: 'mV', min: -20, max: 20 },
  { id: 'R_Amp_V2', label: 'R · V2', unit: 'mV', min: -20, max: 20 },
  { id: 'R_Amp_I', label: 'R · I', unit: 'mV', min: -20, max: 20 },
  { id: 'R_Amp_V3', label: 'R · V3', unit: 'mV', min: -20, max: 20 },
  { id: 'R_Amp_aVL', label: 'R · aVL', unit: 'mV', min: -20, max: 20 },
  { id: 'T_Amp_aVL', label: 'T · aVL', unit: 'mV', min: -20, max: 20 },
  { id: 'S_Amp_V2', label: 'S · V2', unit: 'mV', min: -20, max: 20 },
] as const;

export type EcgNumericFeatureId = (typeof ECG_NUMERIC_FEATURES)[number]['id'];
export type EcgNumericUnit = (typeof ECG_NUMERIC_FEATURES)[number]['unit'];

export interface EcgDiagnosticEstimate {
  readonly id: 'NORM' | 'MI' | 'STTC' | 'CD' | 'HYP';
  readonly label: string;
  readonly probability: number;
  readonly status: 'negative' | 'positive' | 'uncertain';
  readonly threshold: number;
}

export interface EcgNumericInferenceClass {
  readonly calibrationCoefficient: number;
  readonly calibrationIntercept: number;
  readonly id: EcgDiagnosticEstimate['id'];
  readonly label: string;
  readonly negativeThreshold: number;
  readonly positiveThreshold: number;
  readonly threshold: number;
}

export type EcgNumericTreeNode = readonly [
  number,
  number,
  number,
  boolean,
  number,
  number,
  boolean,
];

export interface EcgNumericInferenceModel {
  readonly baseline: number;
  readonly trees: readonly (readonly EcgNumericTreeNode[])[];
}

export interface EcgNumericDiagnosticPack {
  readonly classes: readonly EcgNumericInferenceClass[];
  readonly features: readonly {
    readonly id: EcgNumericFeatureId;
    readonly unit: EcgNumericUnit;
  }[];
  readonly format: 'minimed-ecg-numeric-diagnostic';
  readonly formatVersion: 1 | 2;
  readonly models: readonly EcgNumericInferenceModel[];
  readonly population: { readonly minimumAgeYears: 18 };
  readonly version: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label}: неверное число.`);
  }
  return value;
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 500) {
    throw new Error(`${label}: отсутствует или имеет неверный формат.`);
  }
  return value.trim();
}

export function parseEcgNumericDiagnosticPack(bytes: Uint8Array): EcgNumericDiagnosticPack {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('hgb-model.json: неверный JSON.');
  }
  if (!isRecord(value)) throw new Error('Числовая модель должна быть JSON-объектом.');
  const candidate = value as {
    readonly classes?: unknown;
    readonly features?: unknown;
    readonly format?: unknown;
    readonly formatVersion?: unknown;
    readonly models?: unknown;
    readonly population?: unknown;
    readonly version?: unknown;
  };
  if (
    candidate.format !== 'minimed-ecg-numeric-diagnostic' ||
    (candidate.formatVersion !== 1 && candidate.formatVersion !== 2)
  ) {
    throw new Error('Неподдерживаемая числовая модель ЭКГ.');
  }
  if (!isRecord(candidate.population)) {
    throw new Error('Числовая модель должна быть ограничена взрослыми 18+.');
  }
  const population = candidate.population as { readonly minimumAgeYears?: unknown };
  if (population.minimumAgeYears !== 18) {
    throw new Error('Числовая модель должна быть ограничена взрослыми 18+.');
  }
  if (
    !Array.isArray(candidate.features) ||
    candidate.features.length !== ECG_NUMERIC_FEATURES.length
  ) {
    throw new Error('Числовая модель содержит неверный набор признаков.');
  }
  const features = candidate.features.map((item, index) => {
    const expected = ECG_NUMERIC_FEATURES[index];
    if (!expected || !isRecord(item)) {
      throw new Error('Числовая модель содержит несовместимый порядок или единицы признаков.');
    }
    const feature = item as { readonly id?: unknown; readonly unit?: unknown };
    if (feature.id !== expected.id || feature.unit !== expected.unit) {
      throw new Error('Числовая модель содержит несовместимый порядок или единицы признаков.');
    }
    return { id: expected.id, unit: expected.unit };
  });
  if (
    !Array.isArray(candidate.classes) ||
    !Array.isArray(candidate.models) ||
    candidate.classes.length !== 5 ||
    candidate.models.length !== 5
  ) {
    throw new Error('Числовая модель должна содержать пять диагностических классов.');
  }
  const allowedIds = ['NORM', 'MI', 'STTC', 'CD', 'HYP'] as const;
  const classes = candidate.classes.map((item, index): EcgNumericInferenceClass => {
    const expectedId = allowedIds[index];
    if (!expectedId || !isRecord(item)) {
      throw new Error('Числовая модель содержит неверный порядок классов.');
    }
    const classConfig = item as {
      readonly abstentionMargin?: unknown;
      readonly calibrationCoefficient?: unknown;
      readonly calibrationIntercept?: unknown;
      readonly id?: unknown;
      readonly label?: unknown;
      readonly negativeThreshold?: unknown;
      readonly positiveThreshold?: unknown;
      readonly threshold?: unknown;
    };
    if (classConfig.id !== expectedId) {
      throw new Error('Числовая модель содержит неверный порядок классов.');
    }
    const threshold = finite(classConfig.threshold, `${expectedId}.threshold`);
    let negativeThreshold: number;
    let positiveThreshold: number;
    if (candidate.formatVersion === 1) {
      const abstentionMargin = finite(
        classConfig.abstentionMargin,
        `${expectedId}.abstentionMargin`,
      );
      if (abstentionMargin < 0 || abstentionMargin > 0.25) {
        throw new Error(`Числовая модель содержит неверные пороги класса ${expectedId}.`);
      }
      negativeThreshold = threshold - abstentionMargin;
      positiveThreshold = threshold + abstentionMargin;
    } else {
      negativeThreshold = finite(classConfig.negativeThreshold, `${expectedId}.negativeThreshold`);
      positiveThreshold = finite(classConfig.positiveThreshold, `${expectedId}.positiveThreshold`);
    }
    if (
      threshold <= 0 ||
      threshold >= 1 ||
      negativeThreshold < 0 ||
      negativeThreshold >= threshold ||
      positiveThreshold <= threshold ||
      positiveThreshold > 1
    ) {
      throw new Error(`Числовая модель содержит неверные пороги класса ${expectedId}.`);
    }
    return {
      id: expectedId,
      label: requiredText(classConfig.label, `${expectedId}.label`),
      threshold,
      negativeThreshold,
      positiveThreshold,
      calibrationCoefficient: finite(
        classConfig.calibrationCoefficient,
        `${expectedId}.coefficient`,
      ),
      calibrationIntercept: finite(classConfig.calibrationIntercept, `${expectedId}.intercept`),
    };
  });
  const models = candidate.models.map((item, modelIndex): EcgNumericInferenceModel => {
    if (!isRecord(item)) {
      throw new Error(`Числовая модель ${modelIndex + 1} имеет неверную структуру деревьев.`);
    }
    const model = item as { readonly baseline?: unknown; readonly trees?: unknown };
    const rawTrees = model.trees;
    if (!Array.isArray(rawTrees) || rawTrees.length === 0 || rawTrees.length > 500) {
      throw new Error(`Числовая модель ${modelIndex + 1} имеет неверную структуру деревьев.`);
    }
    const trees = rawTrees.map((tree, treeIndex): readonly EcgNumericTreeNode[] => {
      if (!Array.isArray(tree) || tree.length === 0 || tree.length > 100) {
        throw new Error(`Дерево ${treeIndex + 1} модели ${modelIndex + 1} имеет неверный размер.`);
      }
      return tree.map((node): EcgNumericTreeNode => {
        if (!Array.isArray(node) || node.length !== 7) {
          throw new Error('Узел дерева имеет неверный формат.');
        }
        const [nodeValue, featureIndex, threshold, missingLeft, left, right, leaf] = node;
        if (
          typeof missingLeft !== 'boolean' ||
          typeof leaf !== 'boolean' ||
          !Number.isInteger(featureIndex) ||
          !Number.isInteger(left) ||
          !Number.isInteger(right) ||
          featureIndex < 0 ||
          featureIndex >= features.length ||
          left < 0 ||
          right < 0 ||
          left >= tree.length ||
          right >= tree.length
        ) {
          throw new Error('Узел дерева содержит неверные ссылки.');
        }
        return [
          finite(nodeValue, 'node.value'),
          featureIndex,
          finite(threshold, 'node.threshold'),
          missingLeft,
          left,
          right,
          leaf,
        ];
      });
    });
    return { baseline: finite(model.baseline, `model.${modelIndex + 1}.baseline`), trees };
  });
  return {
    format: 'minimed-ecg-numeric-diagnostic',
    formatVersion: candidate.formatVersion,
    version: requiredText(candidate.version, 'version'),
    population: { minimumAgeYears: 18 },
    features,
    classes,
    models,
  };
}

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

function treeValue(tree: readonly EcgNumericTreeNode[], row: readonly number[]): number {
  let nodeIndex = 0;
  for (let steps = 0; steps <= tree.length; steps += 1) {
    const node = tree[nodeIndex];
    if (!node) throw new Error('Числовая модель содержит неверный переход дерева.');
    const [value, featureIndex, threshold, , left, right, leaf] = node;
    if (leaf) return value;
    nodeIndex = (row[featureIndex] ?? Number.NaN) <= threshold ? left : right;
  }
  throw new Error('Числовая модель содержит цикл дерева.');
}

export function inferEcgNumericDiagnostic(
  classes: readonly EcgNumericInferenceClass[],
  models: readonly EcgNumericInferenceModel[],
  row: readonly number[],
): readonly EcgDiagnosticEstimate[] {
  return models.map((model, index): EcgDiagnosticEstimate => {
    const classConfig = classes[index];
    if (!classConfig) throw new Error('Числовая модель содержит неполный список классов.');
    const raw = model.trees.reduce((sum, tree) => sum + treeValue(tree, row), model.baseline);
    const probability = sigmoid(
      classConfig.calibrationCoefficient * sigmoid(raw) + classConfig.calibrationIntercept,
    );
    return {
      id: classConfig.id,
      label: classConfig.label,
      probability,
      threshold: classConfig.threshold,
      status:
        probability <= classConfig.negativeThreshold
          ? 'negative'
          : probability >= classConfig.positiveThreshold
            ? 'positive'
            : 'uncertain',
    };
  });
}
