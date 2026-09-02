import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import ecgPhotoExample from '@/assets/ecg-photo-example.jpg';
import { AppGlyph } from '@/components/AppGlyph';
import { OverlayDialog } from '@/components/OverlayDialog';
import {
  analyzeEcgAvSequence,
  type EcgAvSequenceMorphologyPatch,
  parseEcgEventTimes,
} from '@/features/calculators/ecg-av-sequence';
import {
  ECG_NUMERIC_FEATURES,
  type EcgDiagnosticEstimate,
  type EcgDiagnosticModelDescriptor,
  type EcgNumericFeatureId,
  estimateEcgFromNumericFeatures,
  readEcgDiagnosticModelDescriptor,
  subscribeEcgDiagnosticModel,
} from '@/features/calculators/ecg-numeric-diagnostic';
import {
  crossCheckEcgEstimatesWithRules,
  interpretEcgNumericRules,
} from '@/features/calculators/ecg-numeric-rules';
import {
  calculateEcgPatientAge,
  ECG_PATIENT_AGE_GROUP_LABELS,
  ECG_PEDIATRIC_QRS_REFERENCE_SOURCE_URL,
  type EcgPatientRoute,
  getEcgPediatricQrsReferenceFlag,
} from '@/features/calculators/ecg-patient-age';
import type { EcgMeasurements } from '@/features/calculators/ecg-photo-caliper';
import {
  type EcgMorphologyObservations,
  type EcgObservationState,
  type EcgPatientSex,
  interpretAdultEcgMeasurements,
} from '@/features/calculators/ecg-photo-interpreter';
import { rememberReturnTo } from '@/state/return-navigation';

const STATUS_LABELS = {
  negative: 'ниже порога',
  positive: 'выше порога',
  uncertain: 'неопределённая зона',
} as const;

interface EcgFieldHelp {
  readonly example: string;
  readonly kind?: 'amplitude' | 'context' | 'interval' | 'observation' | 'sequence';
  readonly method: string;
  readonly target: string;
  readonly title: string;
}

const EXAMPLE_NUMERIC_VALUES: Partial<Record<EcgNumericFeatureId, string>> = {
  PR_Int_Global: '138',
  QRS_Dur_Global: '112',
  QT_Int_Global: '398',
  QT_IntFramingham_Global: '395',
  RR_Mean_Global: '968',
};

const EXAMPLE_DATE_OF_BIRTH = '1990-01-01';
const EXAMPLE_ECG_DATE = '2016-01-01';

const INTERVAL_HELP: Partial<Record<EcgNumericFeatureId, Omit<EcgFieldHelp, 'title'>>> = {
  P_Dur_Global: {
    target: 'Один хорошо различимый зубец P, лучше во II отведении.',
    method:
      'Измерьте от начала отклонения P от изолинии до его возвращения. При 50 мм/с одна малая клетка равна 20 мс.',
    example: '4 малые клетки: 4 × 20 = 80 мс. Введите 80.',
  },
  PR_Int_Global: {
    target: 'Комплекс с отчётливыми P и началом QRS.',
    method: 'Измерьте от начала P до самого раннего начала QRS в этом комплексе.',
    example: '8 малых клеток: 8 × 20 = 160 мс. Введите 160.',
  },
  QRS_Dur_Global: {
    target: 'Комплекс QRS, начало и конец которого хорошо видны.',
    method:
      'Измерьте от самого раннего начала Q/R до самого позднего окончания S. Одна малая клетка при 50 мм/с — 20 мс.',
    example: 'На демонстрационном снимке аппарат напечатал QRS 0,112 с. Введите 112.',
  },
  QT_Int_Global: {
    target: 'Комплекс с хорошо видимым окончанием T.',
    method: 'Измерьте от начала QRS до конца T по касательной к нисходящей части T.',
    example: '20 малых клеток: 20 × 20 = 400 мс. Введите 400.',
  },
  QT_IntFramingham_Global: {
    target: 'Подтверждённые QT и средний RR из той же записи.',
    method: 'QTc = QT + 154 × (1 − RR в секундах). QT вводится в миллисекундах.',
    example: 'QT 400 мс, RR 0,8 с: 400 + 154 × 0,2 = 431 мс. Введите 431.',
  },
  RR_Mean_Global: {
    target: 'Несколько последовательных пиков R в одном ритм-отведении.',
    method: 'Измерьте интервалы R–R и возьмите среднее. При 50 мм/с одна малая клетка равна 20 мс.',
    example: 'На демонстрационном снимке ЧСС 62/мин: 60 000 ÷ 62 ≈ 968 мс. Введите 968.',
  },
};

function numericFeatureHelp(feature: (typeof ECG_NUMERIC_FEATURES)[number]): EcgFieldHelp {
  const interval = INTERVAL_HELP[feature.id];
  if (interval) return { title: `${feature.label}, мс`, kind: 'interval', ...interval };
  const [wave = 'зубца', lead = 'нужном отведении'] = feature.label.split(' · ');
  return {
    title: `${feature.label}, мВ`,
    kind: 'amplitude',
    target: `Зубец ${wave} в отведении ${lead}; изолинию берите по сегменту TP или PR.`,
    method:
      'Измерьте вертикальное расстояние от изолинии до вершины зубца. При 10 мм/мВ одна малая клетка равна 0,1 мВ; вниз — отрицательное значение.',
    example: `Вершина ${wave} на 6 малых клеток выше изолинии: +0,6 мВ. Введите 0.6.`,
  };
}

function observationHelp(field: (typeof MANUAL_OBSERVATION_FIELDS)[number]): EcgFieldHelp {
  const common = {
    title: field.label,
    kind: 'observation' as const,
    example: `«${field.presentLabel}» — признак подтверждён; «${field.absentLabel}» — проверен и отсутствует.`,
  };
  if (
    [
      'oneToOneAvConduction',
      'periodicNonConductedPWaves',
      'progressivePrBeforeDroppedQrs',
      'constantPrAroundDroppedQrs',
      'everySecondPConducted',
      'twoOrMoreConsecutiveNonConductedPWaves',
      'someAvConductionPresent',
    ].includes(field.id)
  ) {
    return {
      ...common,
      target: 'Длинная непрерывная полоса II отведения, где видны P и следующие за ними QRS.',
      method:
        'Идите слева направо: отметьте каждый P, найдите следующий QRS и сравните PR в соседних циклах. Оценивайте паттерн минимум на трёх циклах.',
    };
  }
  const specific: Partial<
    Record<keyof EcgMorphologyObservations, Pick<EcgFieldHelp, 'method' | 'target'>>
  > = {
    avDissociation: {
      target: 'Длинный фрагмент, где P и QRS различимы одновременно.',
      method:
        'Сравните интервалы P–P и R–R: при AV-диссоциации оба ритма регулярны, но P постепенно смещаются относительно QRS.',
    },
    blockedPrematureAtrialBeatExcluded: {
      target: 'Зубец T непосредственно перед паузой и соседние нормальные P.',
      method:
        'Ищите ранний деформированный P, скрытый в T. Если он есть и после него нет QRS, выпадение может быть заблокированной предсердной экстрасистолой.',
    },
    deltaWave: {
      target: 'Первые 40 мс QRS, особенно в I, aVL и V4–V6.',
      method:
        'Ищите пологий, смазанный начальный подъём QRS вместо резкого старта; подтвердите одинаковый признак минимум в двух отведениях.',
    },
    dominantQrsSupraventricular: {
      target: 'Преобладающий тип QRS на всей записи и связь комплексов с P.',
      method:
        'Сравните ширину и форму большинства QRS. Не отмечайте признак только по одному широкому или преждевременному комплексу.',
    },
    pacedQrs: {
      target: 'Узкие вертикальные стимулы непосредственно перед широкими QRS.',
      method:
        'Увеличьте несколько отведений и проверьте, повторяется ли короткий стимул перед каждым однотипным QRS.',
    },
    avlQrPattern: {
      target: 'Комплекс QRS в aVL: маленький отрицательный q перед высоким положительным R.',
      method:
        'Проверьте, что первое отклонение отрицательное, а следующее положительное и выше него.',
    },
    inferiorRsPattern: {
      target: 'Комплексы QRS во II, III и aVF.',
      method:
        'В каждом из трёх отведений должен быть небольшой положительный r, за которым следует более глубокий отрицательный S.',
    },
    rrIntervalsIrregular: {
      target: 'Не меньше 10 последовательных R–R в длинном ритм-отведении.',
      method:
        'Сравните расстояния между соседними R: они должны меняться без повторяющегося короткого или длинного паттерна.',
    },
    distinctPWavesAbsent: {
      target: 'Участки перед QRS во II отведении и между комплексами в V1.',
      method:
        'Проверьте несколько циклов: одинакового повторяющегося P перед QRS быть не должно. Шум или дрейф изолинии не считайте отсутствием P.',
    },
    fibrillatoryAtrialActivity: {
      target: 'Изолиния между QRS, лучше во II и V1.',
      method:
        'Ищите мелкие нерегулярные колебания без одинаковой формы и периода; отличайте их от равномерных flutter-волн и сетевой помехи.',
    },
  };
  return {
    ...common,
    target:
      specific[field.id]?.target ??
      'Просмотрите несколько последовательных комплексов и все указанные в названии отведения.',
    method:
      specific[field.id]?.method ??
      'Выберите «есть» только если признак уверенно повторяется. При сомнении оставьте «Не оценено» — это не считается отсутствием.',
  };
}

function formatSequencePrRange(value: number | undefined): string {
  return value === undefined ? '' : ` · разброс PR: ${value.toFixed(0)} мс`;
}

const MANUAL_OBSERVATION_FIELDS: readonly {
  readonly absentLabel: string;
  readonly id: keyof EcgMorphologyObservations;
  readonly label: string;
  readonly presentLabel: string;
}[] = [
  {
    id: 'oneToOneAvConduction',
    label: 'Проведение P→QRS 1:1',
    presentLabel: 'Каждый P проводится в QRS',
    absentLabel: 'Проведение не 1:1',
  },
  {
    id: 'periodicNonConductedPWaves',
    label: 'Периодически есть P без следующего QRS',
    presentLabel: 'Есть непроведённые P',
    absentLabel: 'Нет',
  },
  {
    id: 'progressivePrBeforeDroppedQrs',
    label: 'PR прогрессивно удлиняется перед выпадением QRS',
    presentLabel: 'Да',
    absentLabel: 'Нет',
  },
  {
    id: 'constantPrAroundDroppedQrs',
    label: 'PR до и после выпадения QRS остаётся постоянным',
    presentLabel: 'Да',
    absentLabel: 'Нет',
  },
  {
    id: 'everySecondPConducted',
    label: 'Каждый второй P проводится в QRS',
    presentLabel: 'Да, проведение 2:1',
    absentLabel: 'Нет',
  },
  {
    id: 'twoOrMoreConsecutiveNonConductedPWaves',
    label: 'Два или больше последовательных P не проводятся в QRS',
    presentLabel: 'Да, подтверждено',
    absentLabel: 'Нет',
  },
  {
    id: 'someAvConductionPresent',
    label: 'Есть хотя бы отдельные проведённые P→QRS',
    presentLabel: 'Да, проведение есть',
    absentLabel: 'Нет признаков проведения',
  },
  {
    id: 'avDissociation',
    label: 'P и QRS идут независимо друг от друга',
    presentLabel: 'Да, AV-диссоциация',
    absentLabel: 'Нет',
  },
  {
    id: 'blockedPrematureAtrialBeatExcluded',
    label: 'Заблокированная предсердная экстрасистола исключена',
    presentLabel: 'Исключена',
    absentLabel: 'Не исключена',
  },
  {
    id: 'deltaWave',
    label: 'Дельта-волна в начале QRS',
    presentLabel: 'Есть',
    absentLabel: 'Нет',
  },
  {
    id: 'dominantQrsSupraventricular',
    label: 'Преобладающие QRS наджелудочкового происхождения',
    presentLabel: 'Подтверждено',
    absentLabel: 'Нет / желудочковые комплексы',
  },
  {
    id: 'pacedQrs',
    label: 'Желудочковая электрокардиостимуляция',
    presentLabel: 'Есть',
    absentLabel: 'Нет',
  },
  {
    id: 'avlQrPattern',
    label: 'aVL: комплекс qR',
    presentLabel: 'Есть',
    absentLabel: 'Нет',
  },
  {
    id: 'inferiorRsPattern',
    label: 'II, III и aVF: комплекс rS во всех трёх',
    presentLabel: 'Есть во всех трёх',
    absentLabel: 'Условие не выполнено',
  },
  {
    id: 'rrIntervalsIrregular',
    label: 'RR без повторяющегося паттерна',
    presentLabel: 'Нерегулярные',
    absentLabel: 'Регулярные или повторяются',
  },
  {
    id: 'distinctPWavesAbsent',
    label: 'Различимые повторяющиеся P-волны отсутствуют',
    presentLabel: 'Да, отсутствуют',
    absentLabel: 'Нет, P-волны различимы',
  },
  {
    id: 'fibrillatoryAtrialActivity',
    label: 'Нерегулярная предсердная активность / f-волны',
    presentLabel: 'Есть',
    absentLabel: 'Не подтверждены',
  },
];

export function EcgNumericDiagnosticPanel(props: {
  readonly automaticAmplitudeValues: Partial<Record<EcgNumericFeatureId, number>>;
  readonly automaticMeasurementsDraft: EcgMeasurements;
  readonly exampleMode: boolean;
  readonly measurements: EcgMeasurements;
  readonly morphology: EcgMorphologyObservations;
  readonly onMorphologyChange: (
    id: keyof EcgMorphologyObservations,
    value: EcgObservationState,
  ) => void;
  readonly onPatientRouteChange?: (route: EcgPatientRoute) => void;
  readonly studyRevision: number;
}): JSX.Element {
  const [model, setModel] = createSignal<EcgDiagnosticModelDescriptor | null>(null);
  const [dateOfBirth, setDateOfBirth] = createSignal(
    props.exampleMode ? EXAMPLE_DATE_OF_BIRTH : '',
  );
  const [ecgDate, setEcgDate] = createSignal(props.exampleMode ? EXAMPLE_ECG_DATE : '');
  const [sex, setSex] = createSignal<EcgPatientSex>(props.exampleMode ? 'male' : 'unknown');
  const [qrsAxisDegrees, setQrsAxisDegrees] = createSignal(props.exampleMode ? '80' : '');
  const [avlRPeakTimeMs, setAvlRPeakTimeMs] = createSignal('');
  const [pOnsetsMs, setPOnsetsMs] = createSignal('');
  const [qrsOnsetsMs, setQrsOnsetsMs] = createSignal('');
  const [measurementsConfirmed, setMeasurementsConfirmed] = createSignal(false);
  const [values, setValues] = createSignal<Partial<Record<EcgNumericFeatureId, string>>>(
    props.exampleMode ? EXAMPLE_NUMERIC_VALUES : {},
  );
  const [estimates, setEstimates] = createSignal<readonly EcgDiagnosticEstimate[]>();
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const [fieldHelp, setFieldHelp] = createSignal<EcgFieldHelp>();
  let previousStudyRevision = props.studyRevision;
  let previousDraftSignature = '';
  let previousSuggestionSignature = '';
  let appliedSequenceIds: (keyof EcgAvSequenceMorphologyPatch)[] = [];
  let previousAgeSignature = '';
  let previousPatientRoute: EcgPatientRoute | undefined;

  createEffect(() => {
    const nextRevision = props.studyRevision;
    if (nextRevision !== previousStudyRevision) {
      setDateOfBirth(props.exampleMode ? EXAMPLE_DATE_OF_BIRTH : '');
      setEcgDate(props.exampleMode ? EXAMPLE_ECG_DATE : '');
      setSex(props.exampleMode ? 'male' : 'unknown');
      setQrsAxisDegrees(props.exampleMode ? '80' : '');
      setAvlRPeakTimeMs('');
      setPOnsetsMs('');
      setQrsOnsetsMs('');
      setMeasurementsConfirmed(false);
      setValues(props.exampleMode ? EXAMPLE_NUMERIC_VALUES : {});
      setEstimates(undefined);
      setError('');
      appliedSequenceIds = [];
      previousStudyRevision = nextRevision;
    }
  });

  createEffect(() => {
    const nextSignature = JSON.stringify([
      props.automaticAmplitudeValues,
      props.measurements,
      props.morphology,
    ]);
    if (previousDraftSignature !== '' && nextSignature !== previousDraftSignature) {
      setMeasurementsConfirmed(false);
    }
    previousDraftSignature = nextSignature;
  });

  const patientAge = createMemo(() =>
    calculateEcgPatientAge({ dateOfBirth: dateOfBirth(), ecgDate: ecgDate() }),
  );

  createEffect(() => {
    const currentAge = patientAge();
    const nextAgeSignature = JSON.stringify(currentAge);
    if (previousAgeSignature !== '' && nextAgeSignature !== previousAgeSignature) {
      setMeasurementsConfirmed(false);
      setEstimates(undefined);
      setError('');
    }
    previousAgeSignature = nextAgeSignature;
    if (currentAge.route !== previousPatientRoute) {
      previousPatientRoute = currentAge.route;
      props.onPatientRouteChange?.(currentAge.route);
    }
  });

  onMount(() => {
    const sync = (): void => {
      setModel(readEcgDiagnosticModelDescriptor());
    };
    sync();
    const unsubscribe = subscribeEcgDiagnosticModel(sync);
    onCleanup(unsubscribe);
  });

  const suggestedValues = createMemo(() => {
    const measurements = { ...props.automaticMeasurementsDraft, ...props.measurements };
    const automatic: Partial<Record<EcgNumericFeatureId, string>> = {};
    for (const [id, value] of Object.entries(props.automaticAmplitudeValues)) {
      if (Number.isFinite(value)) automatic[id as EcgNumericFeatureId] = value.toString();
    }
    return {
      ...automatic,
      ...(measurements.pDurationMs ? { P_Dur_Global: measurements.pDurationMs.toString() } : {}),
      ...(measurements.prMs ? { PR_Int_Global: measurements.prMs.toString() } : {}),
      ...(measurements.qrsMs ? { QRS_Dur_Global: measurements.qrsMs.toString() } : {}),
      ...(measurements.qtMs ? { QT_Int_Global: measurements.qtMs.toString() } : {}),
      ...(measurements.qtcFraminghamMs
        ? { QT_IntFramingham_Global: measurements.qtcFraminghamMs.toString() }
        : {}),
      ...(measurements.rrMs ? { RR_Mean_Global: measurements.rrMs.toString() } : {}),
    } satisfies Partial<Record<EcgNumericFeatureId, string>>;
  });

  createEffect(() => {
    if (props.exampleMode) return;
    const suggestions = suggestedValues();
    const signature = JSON.stringify(suggestions);
    if (signature === previousSuggestionSignature || Object.keys(suggestions).length === 0) return;
    previousSuggestionSignature = signature;
    setValues((current) => ({ ...suggestions, ...current }));
  });

  const parsed = createMemo(() => {
    const current = values();
    const result = {} as Record<EcgNumericFeatureId, number>;
    const invalid: EcgNumericFeatureId[] = [];
    for (const feature of ECG_NUMERIC_FEATURES) {
      const value = Number(current[feature.id]);
      if (
        current[feature.id]?.trim() === '' ||
        !Number.isFinite(value) ||
        value < feature.min ||
        value > feature.max
      ) {
        invalid.push(feature.id);
      } else {
        result[feature.id] = value;
      }
    }
    return { invalid, result };
  });

  const updateValue = (id: EcgNumericFeatureId, value: string): void => {
    setValues((current) => ({ ...current, [id]: value }));
    setMeasurementsConfirmed(false);
    setEstimates(undefined);
    setError('');
  };

  const applyMeasuredIntervals = (): void => {
    setValues((current) => ({ ...current, ...suggestedValues() }));
    setMeasurementsConfirmed(false);
    setEstimates(undefined);
    setError('');
  };

  const estimate = async (): Promise<void> => {
    const age = patientAge();
    if (
      age.route !== 'adult' ||
      !measurementsConfirmed() ||
      parsed().invalid.length > 0 ||
      age.ageYears === undefined
    ) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      const nextEstimates = await estimateEcgFromNumericFeatures({
        ageYears: age.ageYears,
        values: parsed().result,
      });
      const currentAge = patientAge();
      if (currentAge.route === 'adult' && currentAge.ageDays === age.ageDays) {
        setEstimates(nextEstimates);
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Не удалось выполнить числовую оценку ЭКГ.',
      );
    } finally {
      setBusy(false);
    }
  };

  const adultRoute = createMemo(() => patientAge().route === 'adult');
  const patientAgeGroupLabel = createMemo(() => {
    const age = patientAge();
    return age.route === 'unknown' ? 'не определена' : ECG_PATIENT_AGE_GROUP_LABELS[age.group];
  });

  const axisIsValid = createMemo(() => {
    const raw = qrsAxisDegrees().trim();
    if (raw === '') return true;
    const axis = Number(raw);
    return Number.isFinite(axis) && axis >= -180 && axis <= 180;
  });

  const avlRPeakTimeIsValid = createMemo(() => {
    const raw = avlRPeakTimeMs().trim();
    if (raw === '') return true;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 && value <= 300;
  });

  const parsedPOnsets = createMemo(() => parseEcgEventTimes(pOnsetsMs()));
  const parsedQrsOnsets = createMemo(() => parseEcgEventTimes(qrsOnsetsMs()));
  const sequenceError = createMemo(() => parsedPOnsets().error ?? parsedQrsOnsets().error ?? '');
  const sequenceAnalysis = createMemo(() => {
    if (sequenceError()) return undefined;
    return analyzeEcgAvSequence({
      pOnsetsMs: parsedPOnsets().values,
      qrsOnsetsMs: parsedQrsOnsets().values,
    });
  });
  const sequenceHasInput = createMemo(
    () => pOnsetsMs().trim() !== '' || qrsOnsetsMs().trim() !== '',
  );
  const sequenceCanApply = createMemo(() => {
    const analysis = sequenceAnalysis();
    return analysis !== undefined && !['insufficient', 'unclassified'].includes(analysis.pattern);
  });

  const clearAppliedSequenceDraft = (): void => {
    for (const id of appliedSequenceIds) props.onMorphologyChange(id, 'unknown');
    appliedSequenceIds = [];
  };

  const updateSequenceInput = (kind: 'p' | 'qrs', value: string): void => {
    clearAppliedSequenceDraft();
    if (kind === 'p') setPOnsetsMs(value);
    else setQrsOnsetsMs(value);
    setMeasurementsConfirmed(false);
    setEstimates(undefined);
    setError('');
  };

  const applySequenceDraft = (): void => {
    const analysis = sequenceAnalysis();
    if (!analysis || !sequenceCanApply()) return;
    clearAppliedSequenceDraft();
    const entries = Object.entries(analysis.morphology) as [
      keyof EcgAvSequenceMorphologyPatch,
      EcgObservationState,
    ][];
    for (const [id, value] of entries) props.onMorphologyChange(id, value);
    appliedSequenceIds = entries.map(([id]) => id);
    setMeasurementsConfirmed(false);
    setEstimates(undefined);
  };

  const ruleFindings = createMemo(() => {
    const age = patientAge();
    if (
      age.route !== 'adult' ||
      age.ageYears === undefined ||
      !measurementsConfirmed() ||
      !axisIsValid() ||
      !avlRPeakTimeIsValid()
    ) {
      return [];
    }
    const rawAxis = qrsAxisDegrees().trim();
    const rawRPeak = avlRPeakTimeMs().trim();
    return interpretEcgNumericRules({
      ageYears: age.ageYears,
      measurementsConfirmed: true,
      morphology: props.morphology,
      ...(rawRPeak === '' ? {} : { avlRPeakTimeMs: Number(rawRPeak) }),
      ...(rawAxis === '' ? {} : { qrsAxisDegrees: Number(rawAxis) }),
      values: parsed().result,
    });
  });

  const intervalInterpretation = createMemo(() => {
    if (!measurementsConfirmed() || !adultRoute()) return undefined;
    const current = parsed();
    const value = (id: EcgNumericFeatureId): number | undefined =>
      current.invalid.includes(id) ? undefined : current.result[id];
    const pDurationMs = value('P_Dur_Global');
    const prMs = value('PR_Int_Global');
    const qrsMs = value('QRS_Dur_Global');
    const qtMs = value('QT_Int_Global');
    const qtcFraminghamMs = value('QT_IntFramingham_Global');
    const rrMs = value('RR_Mean_Global');
    return interpretAdultEcgMeasurements({
      sex: sex(),
      morphology: props.morphology,
      measurements: {
        ...(pDurationMs === undefined ? {} : { pDurationMs }),
        ...(prMs === undefined ? {} : { prMs }),
        ...(qrsMs === undefined ? {} : { qrsMs }),
        ...(qtMs === undefined ? {} : { qtMs }),
        ...(qtcFraminghamMs === undefined ? {} : { qtcFraminghamMs }),
        ...(rrMs === undefined ? {} : { rrMs }),
      },
    });
  });

  const estimateCrossChecks = createMemo(() => {
    const currentEstimates = estimates();
    if (!currentEstimates || !adultRoute()) return [];
    const intervalFindings = intervalInterpretation()?.findings ?? [];
    const numericFindings = ruleFindings();
    return crossCheckEcgEstimatesWithRules({
      estimates: currentEstimates,
      hasDeterministicFinding:
        intervalFindings.some((finding) => finding.status !== 'normal') ||
        numericFindings.some((finding) => finding.status === 'finding'),
      qrsWide: intervalFindings.some((finding) => finding.id === 'qrs-wide'),
      sokolowLyon: numericFindings.some((finding) => finding.id === 'sokolow-lyon-matched')
        ? 'matched'
        : 'not-matched',
    });
  });

  const pediatricQrsReferenceFlag = createMemo(() => {
    const age = patientAge();
    if (!measurementsConfirmed() || age.route !== 'pediatric') return undefined;
    const current = parsed();
    if (current.invalid.includes('QRS_Dur_Global')) return undefined;
    return getEcgPediatricQrsReferenceFlag(age, current.result.QRS_Dur_Global);
  });

  const helpButton = (help: EcgFieldHelp): JSX.Element => (
    <button
      class="ecg-numeric__help-button"
      type="button"
      aria-label={`Как заполнить поле «${help.title}»`}
      title="Как измерить"
      onClick={() => setFieldHelp(help)}
    >
      <AppGlyph name="question" class="ecg-numeric__help-icon" />
    </button>
  );

  return (
    <section class="ecg-numeric" aria-labelledby="ecg-numeric-title">
      <div class="ecg-numeric__header">
        <div class="ecg-numeric__heading-copy">
          <h3 id="ecg-numeric-title" class="ecg-numeric__title">
            3. Расчёт и предполагаемые гипотезы
          </h3>
          <p class="ecg-numeric__description">
            Объяснимые критерии работают без модели. Устанавливаемая табличная модель добавляет
            вероятностные гипотезы по подтверждённым интервалам и амплитудам. Фото не обязательно.
          </p>
        </div>
        <Show when={Object.keys(suggestedValues()).length > 0}>
          <button class="ecg-numeric__apply" type="button" onClick={applyMeasuredIntervals}>
            Подставить черновые измерения
          </button>
        </Show>
      </div>

      <Show when={Object.keys(props.automaticAmplitudeValues).length > 0}>
        <p class="ecg-numeric__draft-note">
          Оцифровщик предложил амплитуды по извлечённым кривым. Кнопка только копирует их в
          редактируемые поля — проверьте точки Q/R/S/T перед расчётом.
        </p>
      </Show>
      <Show when={props.exampleMode}>
        <p class="ecg-numeric__example-note">
          В примере уже внесены даты рождения 01.01.1990 и ЭКГ 01.01.2016 (26 лет), мужской пол, ось
          QRS 80°, PR 138 мс, QRS 112 мс, QT 398 мс, QTc 395 мс и расчётный RR 968 мс. Это учебные
          значения, не данные пациента.
        </p>
      </Show>

      <div class="ecg-numeric__patient-grid">
        <div class="ecg-numeric__field">
          <div class="ecg-numeric__field-heading">
            <label class="ecg-numeric__label" for="ecg-patient-date-of-birth">
              Дата рождения
            </label>
            {helpButton({
              title: 'Дата рождения',
              target: 'Дата рождения пациента в календарном формате.',
              method:
                'Выберите дату рождения. Возраст рассчитывается точно на дату регистрации ЭКГ, без локального времени.',
              example: 'Для учебного примера: 01.01.1990.',
            })}
          </div>
          <input
            id="ecg-patient-date-of-birth"
            class="ecg-numeric__input"
            type="date"
            value={dateOfBirth()}
            onInput={(event) => {
              setDateOfBirth(event.currentTarget.value);
              setEstimates(undefined);
              setError('');
              setMeasurementsConfirmed(false);
            }}
          />
        </div>

        <div class="ecg-numeric__field">
          <div class="ecg-numeric__field-heading">
            <label class="ecg-numeric__label" for="ecg-date">
              Дата ЭКГ
            </label>
            {helpButton({
              title: 'Дата ЭКГ',
              target: 'Дата регистрации этой ЭКГ.',
              method:
                'Выберите дату записи. Она должна быть не раньше даты рождения и не старше 120 лет от неё.',
              example: 'Для учебного примера: 01.01.2016.',
            })}
          </div>
          <input
            id="ecg-date"
            class="ecg-numeric__input"
            type="date"
            value={ecgDate()}
            onInput={(event) => {
              setEcgDate(event.currentTarget.value);
              setEstimates(undefined);
              setError('');
              setMeasurementsConfirmed(false);
            }}
          />
        </div>

        <div class="ecg-numeric__field">
          <div class="ecg-numeric__field-heading">
            <label class="ecg-numeric__label" for="ecg-patient-sex">
              Пол для порога QTc
            </label>
            {helpButton({
              title: 'Пол для порога QTc',
              target: 'Пол пациента, используемый только для порога скорректированного QT.',
              method:
                'Выберите указанный в медицинской записи пол. Если данных нет, оставьте консервативный порог.',
              example: 'Если в карте указан мужской пол, выберите «Мужской».',
            })}
          </div>
          <select
            id="ecg-patient-sex"
            class="ecg-numeric__input"
            value={sex()}
            onChange={(event) => setSex(event.currentTarget.value as EcgPatientSex)}
          >
            <option value="unknown">Не указан — консервативный порог</option>
            <option value="female">Женский</option>
            <option value="male">Мужской</option>
          </select>
        </div>

        <div class="ecg-numeric__field">
          <div class="ecg-numeric__field-heading">
            <label class="ecg-numeric__label" for="ecg-qrs-axis">
              Ось QRS, градусы
            </label>
            {helpButton({
              title: 'Ось QRS, градусы',
              target: 'Фронтальная электрическая ось QRS.',
              method:
                'Лучше перенесите готовое значение из отчёта аппарата. При ручной оценке используйте полярность QRS в I и aVF, затем уточните по наиболее изоэлектрическому отведению.',
              example: 'В отчёте указано «QRS axis +35°»: введите 35.',
            })}
          </div>
          <input
            id="ecg-qrs-axis"
            class="ecg-numeric__input"
            type="number"
            min="-180"
            max="180"
            step="1"
            inputmode="numeric"
            value={qrsAxisDegrees()}
            aria-invalid={!axisIsValid()}
            onInput={(event) => {
              setQrsAxisDegrees(event.currentTarget.value);
              setMeasurementsConfirmed(false);
            }}
          />
        </div>

        <div class="ecg-numeric__field">
          <div class="ecg-numeric__field-heading">
            <label class="ecg-numeric__label" for="ecg-avl-r-peak">
              Время до пика R в aVL, мс
            </label>
            {helpButton({
              title: 'Время до пика R в aVL, мс',
              kind: 'interval',
              target: 'Комплекс QRS в отведении aVL.',
              method:
                'Измерьте от начала QRS до вершины R. При скорости 50 мм/с одна малая клетка равна 20 мс.',
              example: '2,5 малой клетки: 2,5 × 20 = 50 мс. Введите 50.',
            })}
          </div>
          <input
            id="ecg-avl-r-peak"
            class="ecg-numeric__input"
            type="number"
            min="1"
            max="300"
            step="1"
            inputmode="numeric"
            value={avlRPeakTimeMs()}
            aria-invalid={!avlRPeakTimeIsValid()}
            onInput={(event) => {
              setAvlRPeakTimeMs(event.currentTarget.value);
              setMeasurementsConfirmed(false);
            }}
          />
        </div>
      </div>

      <p class="ecg-numeric__hint" aria-live="polite">
        Возрастная группа: {patientAgeGroupLabel()}
        <Show when={patientAge().route !== 'unknown'}>
          {' · '}полных лет: {patientAge().ageYears} · дней: {patientAge().ageDays}
        </Show>
      </p>
      <Show when={patientAge().route === 'unknown'}>
        <p class="ecg-numeric__warning" role="note">
          Укажите действительные даты рождения и ЭКГ; дата ЭКГ не может быть раньше даты рождения, а
          возраст не должен превышать 120 лет.
        </p>
      </Show>
      <Show when={patientAge().route === 'pediatric'}>
        <p class="ecg-numeric__warning" role="note">
          Детский маршрут: доступны измерения и атрибутированные reference-flags. Взрослые правила и
          HGB-модель не запускаются.
        </p>
      </Show>
      <Show when={pediatricQrsReferenceFlag()}>
        {(flag) => (
          <p class="ecg-numeric__hint" role="note">
            QRS reference-flag:{' '}
            {flag().status === 'not-applied'
              ? 'порог не применяется для переходной группы 16–17 лет.'
              : flag().status === 'at-or-above-reference'
                ? `QRS ${flag().qrsMs} мс ≥ ${flag().thresholdMs} мс.`
                : `QRS ${flag().qrsMs} мс < ${flag().thresholdMs} мс.`}{' '}
            <a
              class="ecg-numeric__link"
              href={ECG_PEDIATRIC_QRS_REFERENCE_SOURCE_URL}
              target="_blank"
              rel="noreferrer"
            >
              AHA/ACCF/HRS reference
            </a>
            . Это screening/reference-flag, не диагноз.
          </p>
        )}
      </Show>

      <details class="ecg-numeric__fieldset ecg-av-sequence">
        <summary class="ecg-numeric__legend">Последовательность P/QRS</summary>
        <p class="ecg-numeric__hint">
          Введите времена начала P и QRS от начала фрагмента в миллисекундах. Это может быть экспорт
          аппарата или ручная разметка; длина записи не фиксирована.
        </p>
        <div class="ecg-av-sequence__editor-grid">
          <div class="ecg-av-sequence__field">
            <div class="ecg-numeric__field-heading">
              <label class="ecg-numeric__label" for="ecg-p-onsets">
                Начала P, мс
              </label>
              {helpButton({
                title: 'Начала P, мс',
                kind: 'sequence',
                target: 'Начало каждого различимого зубца P в одном непрерывном фрагменте.',
                method:
                  'Первую отметку можно принять за 0. Для следующих умножайте расстояние от первой отметки в малых клетках на 20 мс.',
                example: 'P находятся через 40 клеток: 0, 800, 1600, 2400.',
              })}
            </div>
            <textarea
              id="ecg-p-onsets"
              class="ecg-av-sequence__textarea"
              rows="3"
              spellcheck={false}
              placeholder="0, 800, 1600, 2400…"
              value={pOnsetsMs()}
              onInput={(event) => updateSequenceInput('p', event.currentTarget.value)}
            />
          </div>
          <div class="ecg-av-sequence__field">
            <div class="ecg-numeric__field-heading">
              <label class="ecg-numeric__label" for="ecg-qrs-onsets">
                Начала QRS, мс
              </label>
              {helpButton({
                title: 'Начала QRS, мс',
                kind: 'sequence',
                target:
                  'Самое раннее начало каждого QRS в том же фрагменте и от той же нулевой точки.',
                method:
                  'Умножьте расстояние от нулевой точки в малых клетках на 20 мс и перечислите значения по порядку.',
                example: 'QRS через 8, 48 и 88 клеток: 160, 960, 1760.',
              })}
            </div>
            <textarea
              id="ecg-qrs-onsets"
              class="ecg-av-sequence__textarea"
              rows="3"
              spellcheck={false}
              placeholder="180, 980, 1780, 2580…"
              value={qrsOnsetsMs()}
              onInput={(event) => updateSequenceInput('qrs', event.currentTarget.value)}
            />
          </div>
        </div>
        <Show when={sequenceError()}>
          <p class="ecg-av-sequence__error" role="alert">
            {sequenceError()}
          </p>
        </Show>
        <Show when={sequenceHasInput() && sequenceAnalysis()}>
          {(analysis) => (
            <div class="ecg-av-sequence__preview" aria-live="polite">
              <strong class="ecg-av-sequence__summary">{analysis().summary}</strong>
              <span class="ecg-av-sequence__metrics">
                P: {analysis().pCount} · QRS: {analysis().qrsCount} · связанных P:{' '}
                {analysis().conductedPCount} · устойчивость связи:{' '}
                {(analysis().couplingCoverage * 100).toFixed(0)}%
                {formatSequencePrRange(analysis().prRangeMs)}
              </span>
              <button
                class="ecg-av-sequence__apply"
                type="button"
                disabled={!sequenceCanApply()}
                onClick={applySequenceDraft}
              >
                Перенести черновик в наблюдения
              </button>
            </div>
          )}
        </Show>
        <p class="ecg-av-sequence__note">
          Расчёт не исключает стимуляцию и заблокированную предсердную экстрасистолу — эти поля
          остаются ручными. После переноса проверьте каждое наблюдение ниже и подтвердите измерения.
        </p>
      </details>

      <details class="ecg-numeric__fieldset">
        <summary class="ecg-numeric__legend">Наблюдения по записи</summary>
        <p class="ecg-numeric__hint">
          Отмечайте только визуально подтверждённые признаки. «Не оценено» не считается нормой.
        </p>
        <div class="ecg-numeric__grid ecg-numeric__grid--intervals">
          <For each={MANUAL_OBSERVATION_FIELDS}>
            {(field) => (
              <div class="ecg-numeric__field">
                <div class="ecg-numeric__field-heading">
                  <label class="ecg-numeric__label" for={`ecg-observation-${field.id}`}>
                    {field.label}
                  </label>
                  {helpButton(observationHelp(field))}
                </div>
                <select
                  id={`ecg-observation-${field.id}`}
                  class="ecg-numeric__input"
                  value={props.morphology[field.id] ?? 'unknown'}
                  onChange={(event) => {
                    setMeasurementsConfirmed(false);
                    props.onMorphologyChange(
                      field.id,
                      event.currentTarget.value as EcgObservationState,
                    );
                  }}
                >
                  <option value="unknown">Не оценено</option>
                  <option value="present">{field.presentLabel}</option>
                  <option value="absent">{field.absentLabel}</option>
                </select>
              </div>
            )}
          </For>
        </div>
      </details>

      <Show when={!axisIsValid()}>
        <p class="ecg-numeric__error" role="alert">
          Ось QRS должна быть в диапазоне от −180° до +180°.
        </p>
      </Show>
      <Show when={!avlRPeakTimeIsValid()}>
        <p class="ecg-numeric__error" role="alert">
          Время до пика R в aVL должно быть в диапазоне 1–300 мс.
        </p>
      </Show>

      <details class="ecg-numeric__fieldset">
        <summary class="ecg-numeric__legend">
          Интервалы ·{' '}
          {ECG_NUMERIC_FEATURES.slice(0, 6).filter((feature) => values()[feature.id]).length}
          /6
        </summary>
        <div class="ecg-numeric__grid ecg-numeric__grid--intervals">
          <For each={ECG_NUMERIC_FEATURES.slice(0, 6)}>
            {(feature) => (
              <div class="ecg-numeric__field">
                <div class="ecg-numeric__field-heading">
                  <label class="ecg-numeric__label" for={`ecg-feature-${feature.id}`}>
                    {feature.label}, мс
                  </label>
                  {helpButton(numericFeatureHelp(feature))}
                </div>
                <input
                  id={`ecg-feature-${feature.id}`}
                  class="ecg-numeric__input"
                  type="number"
                  min={feature.min}
                  max={feature.max}
                  step="1"
                  inputmode="numeric"
                  value={values()[feature.id] ?? ''}
                  onInput={(event) => updateValue(feature.id, event.currentTarget.value)}
                />
              </div>
            )}
          </For>
        </div>
      </details>

      <details class="ecg-numeric__fieldset">
        <summary class="ecg-numeric__legend">
          Амплитуды зубцов ·{' '}
          {ECG_NUMERIC_FEATURES.slice(6).filter((feature) => values()[feature.id]).length}/24
        </summary>
        <p class="ecg-numeric__hint">
          Вводите значения в мВ со знаком из отчёта аппарата или после ручного подтверждения.
        </p>
        <div class="ecg-numeric__grid ecg-numeric__grid--amplitudes">
          <For each={ECG_NUMERIC_FEATURES.slice(6)}>
            {(feature) => (
              <div class="ecg-numeric__field">
                <div class="ecg-numeric__field-heading">
                  <label class="ecg-numeric__label" for={`ecg-feature-${feature.id}`}>
                    {feature.label}, мВ
                  </label>
                  {helpButton(numericFeatureHelp(feature))}
                </div>
                <input
                  id={`ecg-feature-${feature.id}`}
                  class="ecg-numeric__input"
                  type="number"
                  min={feature.min}
                  max={feature.max}
                  step="0.001"
                  inputmode="decimal"
                  value={values()[feature.id] ?? ''}
                  onInput={(event) => updateValue(feature.id, event.currentTarget.value)}
                />
              </div>
            )}
          </For>
        </div>
      </details>

      <label class="ecg-numeric__confirmation">
        <input
          class="ecg-numeric__confirmation-input"
          type="checkbox"
          checked={measurementsConfirmed()}
          onChange={(event) => setMeasurementsConfirmed(event.currentTarget.checked)}
        />
        <span class="ecg-numeric__confirmation-text">
          Я сверил(а) интервалы, последовательность P/QRS, ось, амплитуды и морфологию с исходной
          ЭКГ. Черновые значения без такой проверки не используются для выводов.
        </span>
      </label>

      <div class="ecg-numeric__actions">
        <button
          class="ecg-numeric__estimate"
          type="button"
          disabled={
            !model() ||
            !measurementsConfirmed() ||
            !adultRoute() ||
            parsed().invalid.length > 0 ||
            busy()
          }
          onClick={() => void estimate()}
        >
          {busy() ? 'Расчёт…' : 'Оценить гипотезы'}
        </button>
        <span class="ecg-numeric__completion">
          {parsed().invalid.length === 0
            ? 'Все 30 значений заполнены'
            : `Осталось заполнить: ${parsed().invalid.length}`}
        </span>
      </div>

      <Show when={(intervalInterpretation()?.findings.length ?? 0) + ruleFindings().length > 0}>
        <div class="ecg-numeric__results" aria-live="polite">
          <h4 class="ecg-numeric__results-title">Объяснимые критерии</h4>
          <ul class="ecg-numeric__result-list">
            <For each={intervalInterpretation()?.findings ?? []}>
              {(item) => (
                <li
                  class={`ecg-numeric__result ecg-numeric__result--${item.status === 'normal' ? 'negative' : 'positive'}`}
                >
                  <strong class="ecg-numeric__result-label">{item.text}</strong>
                  <span class="ecg-numeric__result-threshold">
                    {item.evidence.measurement} {item.evidence.value} {item.evidence.unit ?? ''} ·
                    порог {item.evidence.threshold}
                  </span>
                  <Show when={item.criteria?.length}>
                    <span class="ecg-numeric__result-threshold">{item.criteria?.join(' · ')}</span>
                  </Show>
                </li>
              )}
            </For>
            <For each={ruleFindings()}>
              {(item) => (
                <li
                  class={`ecg-numeric__result ecg-numeric__result--${item.status === 'finding' ? 'positive' : 'negative'}`}
                >
                  <strong class="ecg-numeric__result-label">{item.label}</strong>
                  <span class="ecg-numeric__result-value">{item.text}</span>
                  <span class="ecg-numeric__result-threshold">{item.evidence.join(' · ')}</span>
                </li>
              )}
            </For>
          </ul>
          <Show when={(intervalInterpretation()?.missingData.length ?? 0) > 0}>
            <p class="ecg-numeric__hint">
              Не оценено:{' '}
              {intervalInterpretation()
                ?.missingData.map((item) => item.text)
                .join(' ')}
            </p>
          </Show>
        </div>
      </Show>

      <Show
        when={model()}
        fallback={
          <p class="ecg-numeric__model-note">
            Числовая модель не установлена. Выберите её в{' '}
            <button
              class="ecg-numeric__link"
              type="button"
              onClick={() => {
                rememberReturnTo();
                window.location.hash = '#/settings';
              }}
            >
              настройках
            </button>
            . Ручные правила выше работают без модели.
          </p>
        }
      >
        {(installed) => (
          <p class="ecg-numeric__model-note">
            {installed().name} · {installed().version} · работает офлайн
          </p>
        )}
      </Show>

      <Show when={estimates()}>
        {(items) => (
          <div class="ecg-numeric__results" aria-live="polite">
            <h4 class="ecg-numeric__results-title">Исследовательские гипотезы</h4>
            <ul class="ecg-numeric__result-list">
              <For each={items()}>
                {(item) => (
                  <li class={`ecg-numeric__result ecg-numeric__result--${item.status}`}>
                    <strong class="ecg-numeric__result-label">{item.label}</strong>
                    <span class="ecg-numeric__result-value">
                      {(item.probability * 100).toFixed(1)}% · {STATUS_LABELS[item.status]}
                    </span>
                    <span class="ecg-numeric__result-threshold">
                      рабочий порог {(item.threshold * 100).toFixed(1)}%
                    </span>
                  </li>
                )}
              </For>
            </ul>
            <Show when={estimateCrossChecks().length > 0}>
              <p class="ecg-numeric__hint">Сверка вероятностей с независимыми правилами:</p>
              <ul class="ecg-numeric__result-list">
                <For each={estimateCrossChecks()}>
                  {(check) => (
                    <li class="ecg-numeric__result ecg-numeric__result--uncertain">
                      <strong class="ecg-numeric__result-label">
                        {check.status === 'supports' ? 'Есть независимая опора' : 'Ограничение'}
                      </strong>
                      <span class="ecg-numeric__result-value">{check.text}</span>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </div>
        )}
      </Show>

      <p class="ecg-numeric__warning" role="note">
        Это поддержка решения, не диагноз. Класс MI означает общий паттерн инфаркта в обучающей
        разметке и не подтверждает острый инфаркт. Результат «ниже порога» не исключает состояние и
        не является отрицательным заключением. Неопределённая зона означает отказ модели от
        уверенного вывода.
      </p>
      <Show when={error()}>
        <p class="ecg-numeric__error" role="alert">
          {error()}
        </p>
      </Show>
      <OverlayDialog
        open={Boolean(fieldHelp())}
        title={fieldHelp()?.title ?? 'Как заполнить поле'}
        subtitle="Подсказка для ручной разметки"
        class="ecg-field-help"
        bodyClass="ecg-field-help__body"
        onClose={() => setFieldHelp(undefined)}
      >
        <Show when={fieldHelp()}>
          {(help) => (
            <>
              <figure class="ecg-field-help__figure">
                <div
                  class={`ecg-field-help__example ecg-field-help__example--${help().kind ?? 'context'}`}
                >
                  <img
                    class="ecg-field-help__image"
                    src={ecgPhotoExample}
                    alt="Увеличенный фрагмент двенадцатиканальной ЭКГ"
                  />
                  <div class="ecg-field-help__overlay" aria-hidden="true">
                    <Show when={['interval', 'sequence'].includes(help().kind ?? '')}>
                      <span class="ecg-field-help__range" />
                      <span class="ecg-field-help__marker ecg-field-help__marker--start">
                        начало
                      </span>
                      <span class="ecg-field-help__marker ecg-field-help__marker--end">конец</span>
                    </Show>
                    <Show when={help().kind === 'amplitude'}>
                      <span class="ecg-field-help__baseline">изолиния</span>
                      <span class="ecg-field-help__height">амплитуда</span>
                    </Show>
                    <Show when={help().kind === 'observation'}>
                      <span class="ecg-field-help__focus">сравните несколько циклов</span>
                    </Show>
                  </div>
                </div>
                <figcaption class="ecg-field-help__caption">
                  Красные метки показывают принцип измерения, а не готовые точки на ЭКГ пациента.
                  Увеличьте исходник и выберите участок с наиболее чёткими границами.
                </figcaption>
              </figure>
              <dl class="ecg-field-help__steps">
                <div class="ecg-field-help__step">
                  <dt class="ecg-field-help__term">Что найти</dt>
                  <dd class="ecg-field-help__description">{help().target}</dd>
                </div>
                <div class="ecg-field-help__step">
                  <dt class="ecg-field-help__term">Как измерить</dt>
                  <dd class="ecg-field-help__description">{help().method}</dd>
                </div>
                <div class="ecg-field-help__step ecg-field-help__step--example">
                  <dt class="ecg-field-help__term">Пример ввода</dt>
                  <dd class="ecg-field-help__description">{help().example}</dd>
                </div>
              </dl>
            </>
          )}
        </Show>
      </OverlayDialog>
    </section>
  );
}
