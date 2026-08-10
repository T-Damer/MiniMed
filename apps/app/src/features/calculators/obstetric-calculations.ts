import type { CalculationTraceStep } from '@/features/calculators/calculator-types';
import type {
  CalculationFailure,
  CalculatorWarning,
  ClinicalCalculationResult,
} from '@/features/calculators/clinical-calculations';

export type Parity = 'primigravida' | 'multigravida';
export type PregnancyType = 'single' | 'multiple';

const DAY_MS = 86_400_000;
const DAYS_PER_WEEK = 7;
const NAEGELE_DAYS = 280;
const POST_CONCEPTION_DAYS = 266;
const PRIMIGRAVIDA_QUICKENING_WEEKS_TO_TERM = 22;
const MULTIGRAVIDA_QUICKENING_WEEKS_TO_TERM = 24;

const EDD_ESTIMATE_WARNING: CalculatorWarning = {
  code: 'edd-estimate',
  message:
    'Предполагаемая дата родов — расчётный ориентир на основе среднего срока беременности 280 дней. Роды в срок ±2 недели от ПДР считаются нормой.',
};

function failure(error: string): CalculationFailure {
  return { ok: false, error };
}

function isFailure(value: unknown): value is CalculationFailure {
  return (
    typeof value === 'object' &&
    value !== null &&
    'ok' in value &&
    (value as { ok: unknown }).ok === false
  );
}

function parseIsoDate(value: string, label: string): Date | CalculationFailure {
  if (!value) return failure(`${label}: укажите дату.`);
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return failure(`${label}: некорректная дата.`);
  return date;
}

function integerInRange(
  value: number,
  label: string,
  minimum: number,
  maximum: number,
): CalculationFailure | undefined {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    return failure(`${label}: требуется целое число от ${minimum} до ${maximum}.`);
  }
  return undefined;
}

function positiveFinite(value: number, label: string): CalculationFailure | undefined {
  if (!Number.isFinite(value) || value <= 0) {
    return failure(`${label}: требуется положительное конечное число.`);
  }
  return undefined;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / DAY_MS);
}

function formatDateRu(date: Date): string {
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long' }).format(date);
}

function weeksAndDaysText(totalDays: number): string {
  const clamped = Math.max(0, totalDays);
  const weeks = Math.floor(clamped / DAYS_PER_WEEK);
  const days = clamped - weeks * DAYS_PER_WEEK;
  return `${weeks} нед ${days} дн`;
}

function startOfToday(): Date {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now;
}

/** Rounds to the given number of decimals without leaving floating-point noise in traces. */
function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function calculateEddByLmp(input: { readonly lmpDate: string }): ClinicalCalculationResult {
  const lmp = parseIsoDate(input.lmpDate, 'Дата последней менструации');
  if (isFailure(lmp)) return lmp;

  const edd = addDays(lmp, NAEGELE_DAYS);
  const gaToday = Math.max(0, daysBetween(lmp, startOfToday()));

  return {
    ok: true,
    calculatorId: 'obstetric-edd-lmp',
    formula: 'Правило Негеле: ПДР = дата последней менструации + 280 дней (40 нед)',
    textValues: [
      { label: 'Предполагаемая дата родов', text: formatDateRu(edd) },
      { label: 'Срок беременности на сегодня', text: weeksAndDaysText(gaToday) },
    ],
    trace: [
      {
        label: 'Добавление 280 дней к дате последней менструации',
        expression: '280 дней (40 нед 0 дн)',
        value: NAEGELE_DAYS,
        unit: 'дней',
      },
    ],
    warnings: [
      EDD_ESTIMATE_WARNING,
      {
        code: 'regular-cycle-assumption',
        message: 'Формула предполагает регулярный менструальный цикл длиной 28 дней.',
      },
    ],
  };
}

export function calculateEddByUltrasound(input: {
  readonly examDate: string;
  readonly gaWeeks: number;
  readonly gaDays: number;
}): ClinicalCalculationResult {
  const examDate = parseIsoDate(input.examDate, 'Дата УЗИ');
  if (isFailure(examDate)) return examDate;
  const weeksError = integerInRange(input.gaWeeks, 'Срок, недели', 0, 42);
  if (weeksError) return weeksError;
  const daysError = integerInRange(input.gaDays, 'Срок, дни', 0, 6);
  if (daysError) return daysError;

  const gaAtExam = input.gaWeeks * DAYS_PER_WEEK + input.gaDays;
  if (gaAtExam > NAEGELE_DAYS) return failure('Срок беременности на дату УЗИ превышает 40 недель.');
  const edd = addDays(examDate, NAEGELE_DAYS - gaAtExam);

  return {
    ok: true,
    calculatorId: 'obstetric-edd-ultrasound',
    formula: 'ПДР = дата УЗИ + (280 − срок на дату УЗИ, дней)',
    textValues: [{ label: 'Предполагаемая дата родов', text: formatDateRu(edd) }],
    trace: [
      {
        label: 'Срок на дату УЗИ',
        expression: `${input.gaWeeks} нед × 7 + ${input.gaDays} дн`,
        value: gaAtExam,
        unit: 'дней',
      },
      {
        label: 'Остаток до 280 дней',
        expression: `280 − ${gaAtExam}`,
        value: NAEGELE_DAYS - gaAtExam,
        unit: 'дней',
      },
    ],
    warnings: [
      EDD_ESTIMATE_WARNING,
      {
        code: 'first-accurate-scan',
        message:
          'По принятой практике ПДР фиксируется по первому надёжному УЗИ и обычно не пересчитывается по более поздним сканированиям.',
      },
    ],
  };
}

export function calculateEddByConception(input: {
  readonly conceptionDate: string;
}): ClinicalCalculationResult {
  const conception = parseIsoDate(input.conceptionDate, 'Дата зачатия');
  if (isFailure(conception)) return conception;

  const edd = addDays(conception, POST_CONCEPTION_DAYS);
  return {
    ok: true,
    calculatorId: 'obstetric-edd-conception',
    formula: 'ПДР = дата зачатия + 266 дней (38 нед от зачатия)',
    textValues: [{ label: 'Предполагаемая дата родов', text: formatDateRu(edd) }],
    trace: [
      {
        label: 'Добавление 266 дней к дате зачатия',
        expression: '266 дней (38 нед 0 дн от зачатия)',
        value: POST_CONCEPTION_DAYS,
        unit: 'дней',
      },
    ],
    warnings: [EDD_ESTIMATE_WARNING],
  };
}

export function calculateEddByQuickening(input: {
  readonly quickeningDate: string;
  readonly parity: Parity;
}): ClinicalCalculationResult {
  const quickening = parseIsoDate(input.quickeningDate, 'Дата первого шевеления');
  if (isFailure(quickening)) return quickening;

  const weeksToAdd =
    input.parity === 'primigravida'
      ? PRIMIGRAVIDA_QUICKENING_WEEKS_TO_TERM
      : MULTIGRAVIDA_QUICKENING_WEEKS_TO_TERM;
  const edd = addDays(quickening, weeksToAdd * DAYS_PER_WEEK);

  return {
    ok: true,
    calculatorId: 'obstetric-edd-quickening',
    formula:
      'ПДР = дата первого шевеления + 22 нед (первобеременные) или + 24 нед (повторнобеременные)',
    textValues: [{ label: 'Предполагаемая дата родов', text: formatDateRu(edd) }],
    trace: [
      {
        label:
          input.parity === 'primigravida'
            ? 'Первобеременная: +22 нед'
            : 'Повторнобеременная: +24 нед',
        expression: `${weeksToAdd} нед × 7`,
        value: weeksToAdd * DAYS_PER_WEEK,
        unit: 'дней',
      },
    ],
    warnings: [
      EDD_ESTIMATE_WARNING,
      {
        code: 'unreliable-method',
        message:
          'Дата первого шевеления — субъективный и ненадёжный ориентир. ACOG рекомендует УЗИ первого триместра как основной метод датирования беременности; используйте этот метод только при отсутствии более точных данных.',
      },
    ],
  };
}

export function calculateEddForGivenDate(input: {
  readonly referenceDate: string;
  readonly gaWeeks: number;
  readonly gaDays: number;
}): ClinicalCalculationResult {
  const referenceDate = parseIsoDate(input.referenceDate, 'Дата отсчёта');
  if (isFailure(referenceDate)) return referenceDate;
  const weeksError = integerInRange(input.gaWeeks, 'Срок, недели', 0, 42);
  if (weeksError) return weeksError;
  const daysError = integerInRange(input.gaDays, 'Срок, дни', 0, 6);
  if (daysError) return daysError;

  const gaAtDate = input.gaWeeks * DAYS_PER_WEEK + input.gaDays;
  if (gaAtDate > NAEGELE_DAYS) return failure('Указанный срок беременности превышает 40 недель.');
  const edd = addDays(referenceDate, NAEGELE_DAYS - gaAtDate);

  return {
    ok: true,
    calculatorId: 'obstetric-edd-given-date',
    formula: 'ПДР = заданная дата + (280 − известный срок на эту дату, дней)',
    textValues: [{ label: 'Предполагаемая дата родов', text: formatDateRu(edd) }],
    trace: [
      {
        label: 'Срок на заданную дату',
        expression: `${input.gaWeeks} нед × 7 + ${input.gaDays} дн`,
        value: gaAtDate,
        unit: 'дней',
      },
      {
        label: 'Остаток до 280 дней',
        expression: `280 − ${gaAtDate}`,
        value: NAEGELE_DAYS - gaAtDate,
        unit: 'дней',
      },
    ],
    warnings: [EDD_ESTIMATE_WARNING],
  };
}

export function calculateGestationalAgeFromEdd(input: {
  readonly eddDate: string;
  readonly asOfDate?: string | undefined;
}): ClinicalCalculationResult {
  const edd = parseIsoDate(input.eddDate, 'Предполагаемая дата родов');
  if (isFailure(edd)) return edd;
  const asOf = input.asOfDate ? parseIsoDate(input.asOfDate, 'Дата расчёта') : startOfToday();
  if (isFailure(asOf)) return asOf;

  const impliedLmp = addDays(edd, -NAEGELE_DAYS);
  const gaDays = daysBetween(impliedLmp, asOf);
  if (gaDays < 0) return failure('Указанная дата расчёта раньше начала беременности по этому ПДР.');
  if (gaDays > NAEGELE_DAYS + 21) {
    return failure('Указанная дата расчёта более чем на 3 недели позже ПДР.');
  }

  const weeks = Math.floor(gaDays / DAYS_PER_WEEK);
  const days = gaDays - weeks * DAYS_PER_WEEK;

  return {
    ok: true,
    calculatorId: 'obstetric-ga-from-edd',
    formula: 'Срок беременности = (дата расчёта) − (ПДР − 280 дней)',
    values: [
      { label: 'Недели', value: weeks, unit: 'нед', displayPrecision: 0 },
      { label: 'Дни', value: days, unit: 'дн', displayPrecision: 0 },
    ],
    trace: [
      {
        label: 'Условная дата последней менструации',
        expression: 'ПДР − 280 дней',
        value: -NAEGELE_DAYS,
        unit: 'дней от ПДР',
      },
      {
        label: 'Срок беременности на дату расчёта',
        value: gaDays,
        expression: 'дата расчёта − условная ЛМП',
        unit: 'дней',
      },
    ],
    warnings: [
      {
        code: 'edd-estimate',
        message:
          'Расчёт основан на среднем сроке 280 дней и не учитывает фактическую дату зачатия.',
      },
    ],
  };
}

export function calculateMaternityLeaveTimeframe(input: {
  readonly eddDate: string;
  readonly pregnancyType: PregnancyType;
  readonly complicatedBirth: boolean;
}): ClinicalCalculationResult {
  const edd = parseIsoDate(input.eddDate, 'Предполагаемая дата родов');
  if (isFailure(edd)) return edd;

  const impliedLmp = addDays(edd, -NAEGELE_DAYS);
  const leaveStartWeeks = input.pregnancyType === 'multiple' ? 28 : 30;
  const leaveStart = addDays(impliedLmp, leaveStartWeeks * DAYS_PER_WEEK);

  const totalDays = input.pregnancyType === 'multiple' ? 194 : input.complicatedBirth ? 156 : 140;
  const leaveEnd = addDays(leaveStart, totalDays - 1);

  return {
    ok: true,
    calculatorId: 'obstetric-maternity-leave',
    formula:
      'Ст. 255 ТК РФ: больничный лист выдаётся с 30 нед (28 нед при многоплодной беременности) на 140 дней (194 — многоплодная, 156 — осложнённые роды)',
    textValues: [
      { label: 'Начало отпуска по беременности и родам', text: formatDateRu(leaveStart) },
      { label: 'Окончание отпуска (при выдаче единым листом)', text: formatDateRu(leaveEnd) },
      { label: 'Продолжительность', text: `${totalDays} календарных дней` },
    ],
    trace: [
      {
        label: 'Условная дата последней менструации',
        expression: 'ПДР − 280 дней',
        value: -NAEGELE_DAYS,
        unit: 'дней от ПДР',
      },
      {
        label: 'Срок начала отпуска',
        expression: `${leaveStartWeeks} нед от ЛМП`,
        value: leaveStartWeeks * DAYS_PER_WEEK,
        unit: 'дней от ЛМП',
      },
    ],
    warnings: [
      {
        code: 'legal-reference',
        message:
          'Продолжительность и правила выдачи листка нетрудоспособности регулируются ст. 255 ТК РФ и Федеральным законом № 255-ФЗ; фактическая дата родов не изменяет длительность выданного листка, кроме случая осложнённых родов (+16 дней) или преждевременных родов.',
      },
      {
        code: 'preterm-not-covered',
        message:
          'Роды на сроке 22–30 недель оформляются отдельным листком нетрудоспособности на 156 дней от даты родов и не рассчитываются этим калькулятором.',
      },
    ],
  };
}

export function calculateGestationalAgeByCrl(input: {
  readonly crlMm: number;
}): ClinicalCalculationResult {
  const crlError = positiveFinite(input.crlMm, 'КТР');
  if (crlError) return crlError;
  if (input.crlMm < 10 || input.crlMm > 95) {
    return failure('Формула Robinson–Fleming применима при КТР от 10 до 95 мм (I триместр).');
  }

  const gaDaysExact = 8.052 * Math.sqrt(input.crlMm) + 23.73;
  const gaDays = Math.round(gaDaysExact);
  const weeks = Math.floor(gaDays / DAYS_PER_WEEK);
  const days = gaDays - weeks * DAYS_PER_WEEK;

  return {
    ok: true,
    calculatorId: 'obstetric-ga-crl',
    formula: 'Robinson–Fleming, 1975: срок (дни) = 8,052 × √(КТР, мм) + 23,73',
    values: [
      { label: 'Недели', value: weeks, unit: 'нед', displayPrecision: 0 },
      { label: 'Дни', value: days, unit: 'дн', displayPrecision: 0 },
    ],
    trace: [
      {
        label: 'Корень из КТР',
        expression: `√${input.crlMm}`,
        value: round(Math.sqrt(input.crlMm), 3),
        unit: 'мм^0.5',
      },
      {
        label: 'Срок беременности',
        expression: `8,052 × ${round(Math.sqrt(input.crlMm), 3)} + 23,73`,
        value: round(gaDaysExact, 1),
        unit: 'дней',
      },
    ],
    warnings: [
      {
        code: 'first-trimester-only',
        message:
          'Формула валидна для КТР 10–95 мм (примерно 6–14 недель). Вне этого диапазона используйте фетометрию II–III триместра.',
      },
    ],
  };
}

interface BiometryParameterEstimate {
  readonly label: string;
  readonly weeks: number;
}

function hadlockBpdWeeks(bpdCm: number): number {
  return 9.54 + 1.482 * bpdCm + 0.1676 * bpdCm ** 2;
}

function hadlockHcWeeks(hcCm: number): number {
  return 8.96 + 0.54 * hcCm + 0.0003 * hcCm ** 3;
}

function hadlockAcWeeks(acCm: number): number {
  return 8.14 + 0.753 * acCm + 0.0036 * acCm ** 2;
}

function hadlockFlWeeks(flCm: number): number {
  return 10.35 + 2.46 * flCm + 0.17 * flCm ** 2;
}

export function calculateGestationalAgeByBiometry(input: {
  readonly bpdCm?: number | undefined;
  readonly hcCm?: number | undefined;
  readonly acCm?: number | undefined;
  readonly flCm?: number | undefined;
}): ClinicalCalculationResult {
  const estimates: BiometryParameterEstimate[] = [];

  if (input.bpdCm !== undefined) {
    const error = positiveFinite(input.bpdCm, 'БПР');
    if (error) return error;
    if (input.bpdCm < 2 || input.bpdCm > 10.5)
      return failure('БПР вне поддерживаемого диапазона 2–10,5 см.');
    estimates.push({ label: 'БПР', weeks: hadlockBpdWeeks(input.bpdCm) });
  }
  if (input.hcCm !== undefined) {
    const error = positiveFinite(input.hcCm, 'ОГ');
    if (error) return error;
    if (input.hcCm < 8 || input.hcCm > 38)
      return failure('ОГ вне поддерживаемого диапазона 8–38 см.');
    estimates.push({ label: 'ОГ', weeks: hadlockHcWeeks(input.hcCm) });
  }
  if (input.acCm !== undefined) {
    const error = positiveFinite(input.acCm, 'ОЖ');
    if (error) return error;
    if (input.acCm < 6 || input.acCm > 40)
      return failure('ОЖ вне поддерживаемого диапазона 6–40 см.');
    estimates.push({ label: 'ОЖ', weeks: hadlockAcWeeks(input.acCm) });
  }
  if (input.flCm !== undefined) {
    const error = positiveFinite(input.flCm, 'ДБ');
    if (error) return error;
    if (input.flCm < 1 || input.flCm > 8.5)
      return failure('ДБ вне поддерживаемого диапазона 1–8,5 см.');
    estimates.push({ label: 'ДБ', weeks: hadlockFlWeeks(input.flCm) });
  }

  if (estimates.length === 0) {
    return failure('Укажите хотя бы один параметр фетометрии (БПР, ОГ, ОЖ или ДБ).');
  }

  const averageWeeks = estimates.reduce((sum, item) => sum + item.weeks, 0) / estimates.length;
  const gaDays = Math.round(averageWeeks * DAYS_PER_WEEK);
  const weeks = Math.floor(gaDays / DAYS_PER_WEEK);
  const days = gaDays - weeks * DAYS_PER_WEEK;

  const trace: CalculationTraceStep[] = estimates.map((estimate) => ({
    label: `Срок по параметру ${estimate.label}`,
    expression: 'формула Hadlock, 1984',
    value: round(estimate.weeks, 2),
    unit: 'нед',
  }));
  trace.push({
    label: 'Средний срок по всем указанным параметрам',
    expression: `среднее из ${estimates.length} оценок`,
    value: round(averageWeeks, 2),
    unit: 'нед',
  });

  return {
    ok: true,
    calculatorId: 'obstetric-ga-biometry',
    formula:
      'Hadlock, 1984: отдельные регрессии по БПР/ОГ/ОЖ/ДБ (см), результат — среднее по указанным параметрам',
    values: [
      { label: 'Недели', value: weeks, unit: 'нед', displayPrecision: 0 },
      { label: 'Дни', value: days, unit: 'дн', displayPrecision: 0 },
    ],
    trace,
    warnings: [
      {
        code: 'single-parameter-average',
        message:
          'Итог — среднее независимых однопараметрических оценок Hadlock 1984, а не совместная многопараметрическая регрессия. При расхождении оценок более чем на 1–2 недели используйте срок по данным I триместра.',
      },
      {
        code: 'second-trimester-preferred',
        message:
          'Формулы наиболее точны во II триместре; в III триместре погрешность оценки возраста плода возрастает.',
      },
    ],
  };
}

const BISHOP_INTERPRETATION_FAVORABLE =
  'Сумма ≥ 8: шейка матки зрелая, вероятность успешного вагинального родоразрешения при индукции высокая.';
const BISHOP_INTERPRETATION_INTERMEDIATE =
  'Сумма 6–7: промежуточная зрелость шейки матки, решение об индукции — по клинической ситуации.';
const BISHOP_INTERPRETATION_UNFAVORABLE =
  'Сумма ≤ 5: шейка матки незрелая, может потребоваться преиндукция (подготовка шейки матки).';

export function calculateBishopScore(input: {
  readonly dilationScore: number;
  readonly effacementScore: number;
  readonly stationScore: number;
  readonly consistencyScore: number;
  readonly positionScore: number;
}): ClinicalCalculationResult {
  const dilationError = integerInRange(input.dilationScore, 'Раскрытие', 0, 3);
  if (dilationError) return dilationError;
  const effacementError = integerInRange(input.effacementScore, 'Сглаживание', 0, 3);
  if (effacementError) return effacementError;
  const stationError = integerInRange(input.stationScore, 'Положение головки', 0, 3);
  if (stationError) return stationError;
  const consistencyError = integerInRange(input.consistencyScore, 'Консистенция шейки', 0, 2);
  if (consistencyError) return consistencyError;
  const positionError = integerInRange(input.positionScore, 'Положение шейки', 0, 2);
  if (positionError) return positionError;

  const total =
    input.dilationScore +
    input.effacementScore +
    input.stationScore +
    input.consistencyScore +
    input.positionScore;

  const interpretation =
    total >= 8
      ? BISHOP_INTERPRETATION_FAVORABLE
      : total >= 6
        ? BISHOP_INTERPRETATION_INTERMEDIATE
        : BISHOP_INTERPRETATION_UNFAVORABLE;

  return {
    ok: true,
    calculatorId: 'obstetric-bishop-score',
    formula:
      'Bishop, 1964: сумма баллов по раскрытию, сглаживанию, положению головки, консистенции и позиции шейки матки',
    value: total,
    unit: 'баллов',
    displayPrecision: 0,
    trace: [
      {
        label: 'Раскрытие шейки матки',
        expression: 'балл',
        value: input.dilationScore,
        unit: 'баллов',
      },
      {
        label: 'Сглаживание шейки матки',
        expression: 'балл',
        value: input.effacementScore,
        unit: 'баллов',
      },
      {
        label: 'Положение головки (станция)',
        expression: 'балл',
        value: input.stationScore,
        unit: 'баллов',
      },
      {
        label: 'Консистенция шейки матки',
        expression: 'балл',
        value: input.consistencyScore,
        unit: 'баллов',
      },
      {
        label: 'Позиция шейки матки',
        expression: 'балл',
        value: input.positionScore,
        unit: 'баллов',
      },
    ],
    warnings: [{ code: 'bishop-interpretation', message: interpretation }],
  };
}
