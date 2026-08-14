import type { CalculatorSchema } from '@localmed/contracts';
import { CalculatorSchemaSchema } from '@localmed/contracts';

/**
 * Obstetric calculators migrated onto the declarative schema — the second batch, after the first proof
 * of concept in `calculator-schema-catalog.ts` showed the format handling pure arithmetic. This batch
 * needed two real DSL extensions to represent the source formulas faithfully:
 *
 * - `kind: 'date'` inputs plus the `today()`/`addDays()`/`daysBetween()` expression functions, so date
 *   arithmetic (Naegele's rule, gestational-age-from-EDD, maternity leave) is expressible at all.
 * - `assertions` (fail the whole calculation on a derived-value guard) and `interpretations` (append a
 *   threshold-based message) on `CalculatorSchema` — see `packages/contracts/src/calculator-schema.ts`.
 *   These close a real gap flagged in the first batch: the original hardcoded eGFR calculator rejects an
 *   implausible derived creatinine value, which the schema had no way to express before `assertions`.
 *
 * `calculateGestationalAgeByBiometry` (Hadlock fetometry) is deliberately NOT migrated here: it averages
 * only whichever 2-4 of its optional inputs (BPD/HC/AC/FL) were actually provided, which needs a
 * variadic "average of present values" primitive the expression language doesn't have yet — a real,
 * narrow gap, not a blanket "dates don't fit" excuse. It stays on the hardcoded path in
 * `obstetric-calculations.ts` for now.
 *
 * All regression-tested against the original hardcoded functions in `obstetric-calculations.test.ts` /
 * `calculator-schema-catalog-obstetrics.test.ts` — same inputs produce numerically identical outputs.
 */

const EDD_ESTIMATE_WARNING = {
  code: 'edd-estimate',
  message:
    'Предполагаемая дата родов — расчётный ориентир на основе среднего срока беременности 280 дней. Роды в срок ±2 недели от ПДР считаются нормой.',
};

export const OBSTETRIC_BISHOP_SCORE_SCHEMA: CalculatorSchema = CalculatorSchemaSchema.parse({
  schemaVersion: 1,
  id: 'obstetric-bishop-score',
  slug: 'obstetric-bishop-score',
  title: 'Шкала Бишопа (готовность шейки матки)',
  shortTitle: 'Шкала Бишопа',
  aliases: ['Bishop score', 'зрелость шейки матки', 'готовность к родам', 'индукция родов'],
  summary:
    'Сумма баллов по раскрытию, сглаживанию, положению головки, консистенции и позиции шейки матки.',
  audience: 'adult',
  category: 'obstetrics',
  clinical: true,
  formulaDisplay:
    'Bishop, 1964: сумма баллов по раскрытию, сглаживанию, положению головки, консистенции и позиции шейки матки',
  population: 'Беременные при оценке готовности шейки матки к индукции родов.',
  limitations: [
    'Оценка проводится врачом при влагалищном исследовании; калькулятор только суммирует уже выставленные баллы.',
    'Не заменяет клиническое решение об индукции — учитываются и другие акушерские факторы.',
  ],
  inputs: [
    {
      id: 'dilationScore',
      label: 'Раскрытие шейки матки',
      kind: 'number',
      integer: true,
      minimum: 0,
      maximum: 3,
      required: true,
      options: [
        { value: 0, label: 'Закрыта (0)' },
        { value: 1, label: '1–2 см (1)' },
        { value: 2, label: '3–4 см (2)' },
        { value: 3, label: '≥5 см (3)' },
      ],
    },
    {
      id: 'effacementScore',
      label: 'Сглаживание шейки матки',
      kind: 'number',
      integer: true,
      minimum: 0,
      maximum: 3,
      required: true,
      options: [
        { value: 0, label: '0–30% (0)' },
        { value: 1, label: '40–50% (1)' },
        { value: 2, label: '60–70% (2)' },
        { value: 3, label: '≥80% (3)' },
      ],
    },
    {
      id: 'stationScore',
      label: 'Положение головки (станция)',
      kind: 'number',
      integer: true,
      minimum: 0,
      maximum: 3,
      required: true,
      options: [
        { value: 0, label: '−3 (0)' },
        { value: 1, label: '−2 (1)' },
        { value: 2, label: '−1 / 0 (2)' },
        { value: 3, label: '+1 / +2 (3)' },
      ],
    },
    {
      id: 'consistencyScore',
      label: 'Консистенция шейки матки',
      kind: 'number',
      integer: true,
      minimum: 0,
      maximum: 2,
      required: true,
      options: [
        { value: 0, label: 'Плотная (0)' },
        { value: 1, label: 'Средняя (1)' },
        { value: 2, label: 'Мягкая (2)' },
      ],
    },
    {
      id: 'positionScore',
      label: 'Позиция шейки матки',
      kind: 'number',
      integer: true,
      minimum: 0,
      maximum: 2,
      required: true,
      options: [
        { value: 0, label: 'Кзади (0)' },
        { value: 1, label: 'Срединное положение (1)' },
        { value: 2, label: 'Кпереди (2)' },
      ],
    },
  ],
  steps: [
    {
      id: 'total',
      label: 'Сумма баллов Bishop',
      unit: 'баллов',
      expression:
        'dilationScore + effacementScore + stationScore + consistencyScore + positionScore',
      displayPrecision: 0,
      isOutput: true,
    },
  ],
  interpretations: [
    {
      when: 'total >= 8',
      message:
        'Сумма ≥ 8: шейка матки зрелая, вероятность успешного вагинального родоразрешения при индукции высокая.',
    },
    {
      when: 'total >= 6',
      message:
        'Сумма 6–7: промежуточная зрелость шейки матки, решение об индукции — по клинической ситуации.',
    },
    {
      when: '1',
      message:
        'Сумма ≤ 5: шейка матки незрелая, может потребоваться преиндукция (подготовка шейки матки).',
    },
  ],
  sources: [
    {
      title: 'Pelvic scoring for elective induction',
      publisher: 'Obstetrics & Gynecology',
      version: 'Bishop, 1964',
      url: 'https://pubmed.ncbi.nlm.nih.gov/14199536/',
      reviewedAt: '2026-08-11',
    },
  ],
});

export const OBSTETRIC_GA_CRL_SCHEMA: CalculatorSchema = CalculatorSchemaSchema.parse({
  schemaVersion: 1,
  id: 'obstetric-ga-crl',
  slug: 'obstetric-ga-crl',
  title: 'Срок беременности по КТР — Robinson–Fleming',
  shortTitle: 'Срок по КТР',
  aliases: [
    'Robinson Fleming',
    'КТР срок беременности',
    'CRL gestational age',
    'копчико-теменной размер',
  ],
  summary: 'Срок беременности по копчико-теменному размеру плода в I триместре.',
  audience: 'adult',
  category: 'obstetrics',
  clinical: true,
  formulaDisplay: 'Robinson–Fleming, 1975: срок (дни) = 8,052 × √(КТР, мм) + 23,73',
  population: 'I триместр беременности, КТР 10–95 мм (примерно 6–14 недель).',
  limitations: [
    'Формула валидна для КТР 10–95 мм. Вне этого диапазона используйте фетометрию II–III триместра.',
  ],
  inputs: [
    {
      id: 'crlMm',
      label: 'КТР',
      unit: 'мм',
      kind: 'number',
      minimum: 10,
      maximum: 95,
      required: true,
    },
  ],
  steps: [
    {
      id: 'sqrtCrl',
      label: 'Корень из КТР',
      unit: 'мм^0.5',
      expression: 'sqrt(crlMm)',
      displayPrecision: 3,
    },
    {
      id: 'gaDaysExact',
      label: 'Срок беременности (точно)',
      unit: 'дней',
      expression: '8.052 * sqrtCrl + 23.73',
      displayPrecision: 1,
    },
    {
      id: 'gaDays',
      label: 'Срок беременности (округлённо)',
      unit: 'дней',
      expression: 'round(gaDaysExact)',
      displayPrecision: 0,
    },
    {
      id: 'weeks',
      label: 'Недели',
      unit: 'нед',
      expression: 'floor(gaDays / 7)',
      displayPrecision: 0,
      isOutput: true,
    },
    {
      id: 'days',
      label: 'Дни',
      unit: 'дн',
      expression: 'gaDays - weeks * 7',
      displayPrecision: 0,
      isOutput: true,
    },
  ],
  warnings: [
    {
      code: 'first-trimester-only',
      message:
        'Формула валидна для КТР 10–95 мм (примерно 6–14 недель). Вне этого диапазона используйте фетометрию II–III триместра.',
    },
  ],
  sources: [
    {
      title: 'Fetal crown-rump length values',
      publisher: 'BMJ / Robinson & Fleming',
      version: '1975',
      reviewedAt: '2026-08-11',
    },
  ],
});

export const OBSTETRIC_EDD_LMP_SCHEMA: CalculatorSchema = CalculatorSchemaSchema.parse({
  schemaVersion: 1,
  id: 'obstetric-edd-lmp',
  slug: 'obstetric-edd-lmp',
  title: 'ПДР по дате последней менструации — правило Негеле',
  shortTitle: 'ПДР по ЛМП',
  aliases: ['Naegele', 'правило Негеле', 'ПДР по менструации'],
  summary: 'Предполагаемая дата родов и текущий срок беременности по дате последней менструации.',
  audience: 'adult',
  category: 'obstetrics',
  clinical: true,
  formulaDisplay: 'Правило Негеле: ПДР = дата последней менструации + 280 дней (40 нед)',
  population: 'Беременные с известной и достоверной датой последней менструации.',
  limitations: ['Формула предполагает регулярный менструальный цикл длиной 28 дней.'],
  inputs: [{ id: 'lmpDate', label: 'Дата последней менструации', kind: 'date', required: true }],
  steps: [
    {
      id: 'naegeleDays',
      label: 'Добавление 280 дней к дате последней менструации',
      unit: 'дней',
      expression: '280',
      displayPrecision: 0,
    },
    {
      id: 'edd',
      label: 'Предполагаемая дата родов',
      unit: 'дата',
      expression: 'addDays(lmpDate, 280)',
      valueKind: 'date',
      isOutput: true,
    },
    {
      id: 'gaToDateRaw',
      label: 'Срок беременности на сегодня',
      unit: 'дней',
      expression: 'max(daysBetween(lmpDate, today()), 0)',
      displayPrecision: 0,
    },
    {
      id: 'gaWeeks',
      label: 'Срок беременности на сегодня, недель',
      unit: 'нед',
      expression: 'floor(gaToDateRaw / 7)',
      displayPrecision: 0,
      isOutput: true,
    },
    {
      id: 'gaDaysRemainder',
      label: 'Срок беременности на сегодня, дней',
      unit: 'дн',
      expression: 'gaToDateRaw - gaWeeks * 7',
      displayPrecision: 0,
      isOutput: true,
    },
  ],
  warnings: [
    EDD_ESTIMATE_WARNING,
    {
      code: 'regular-cycle-assumption',
      message: 'Формула предполагает регулярный менструальный цикл длиной 28 дней.',
    },
  ],
  sources: [
    {
      title: 'Naegele rule for estimated date of delivery',
      publisher: 'ACOG',
      version: 'Committee Opinion',
      reviewedAt: '2026-08-11',
    },
  ],
});

export const OBSTETRIC_EDD_ULTRASOUND_SCHEMA: CalculatorSchema = CalculatorSchemaSchema.parse({
  schemaVersion: 1,
  id: 'obstetric-edd-ultrasound',
  slug: 'obstetric-edd-ultrasound',
  title: 'ПДР по УЗИ',
  shortTitle: 'ПДР по УЗИ',
  aliases: ['ПДР по сроку УЗИ', 'дата родов по УЗИ'],
  summary: 'Предполагаемая дата родов по известному сроку беременности на дату УЗИ.',
  audience: 'adult',
  category: 'obstetrics',
  clinical: true,
  formulaDisplay: 'ПДР = дата УЗИ + (280 − срок на дату УЗИ, дней)',
  population: 'Беременные с известным сроком по данным УЗИ.',
  limitations: [
    'По принятой практике ПДР фиксируется по первому надёжному УЗИ и обычно не пересчитывается по более поздним сканированиям.',
  ],
  inputs: [
    { id: 'examDate', label: 'Дата УЗИ', kind: 'date', required: true },
    {
      id: 'gaWeeksAtExam',
      label: 'Срок на дату УЗИ',
      unit: 'нед',
      kind: 'number',
      integer: true,
      minimum: 0,
      maximum: 42,
      required: true,
    },
    {
      id: 'gaDaysAtExam',
      label: 'Срок на дату УЗИ',
      unit: 'дн',
      kind: 'number',
      integer: true,
      minimum: 0,
      maximum: 6,
      required: true,
    },
  ],
  steps: [
    {
      id: 'gaAtExam',
      label: 'Срок на дату УЗИ',
      unit: 'дней',
      expression: 'gaWeeksAtExam * 7 + gaDaysAtExam',
      displayPrecision: 0,
    },
    {
      id: 'remainder',
      label: 'Остаток до 280 дней',
      unit: 'дней',
      expression: '280 - gaAtExam',
      displayPrecision: 0,
    },
    {
      id: 'edd',
      label: 'Предполагаемая дата родов',
      unit: 'дата',
      expression: 'addDays(examDate, remainder)',
      valueKind: 'date',
      isOutput: true,
    },
  ],
  assertions: [
    { when: 'gaAtExam > 280', error: 'Срок беременности на дату УЗИ превышает 40 недель.' },
  ],
  warnings: [
    EDD_ESTIMATE_WARNING,
    {
      code: 'first-accurate-scan',
      message:
        'По принятой практике ПДР фиксируется по первому надёжному УЗИ и обычно не пересчитывается по более поздним сканированиям.',
    },
  ],
  sources: [
    {
      title: 'Methods for estimating the due date',
      publisher: 'ACOG',
      version: 'Committee Opinion No. 700',
      reviewedAt: '2026-08-11',
    },
  ],
});

export const OBSTETRIC_EDD_CONCEPTION_SCHEMA: CalculatorSchema = CalculatorSchemaSchema.parse({
  schemaVersion: 1,
  id: 'obstetric-edd-conception',
  slug: 'obstetric-edd-conception',
  title: 'ПДР по дате зачатия',
  shortTitle: 'ПДР по зачатию',
  aliases: ['дата зачатия ПДР'],
  summary: 'Предполагаемая дата родов по известной дате зачатия.',
  audience: 'adult',
  category: 'obstetrics',
  clinical: true,
  formulaDisplay: 'ПДР = дата зачатия + 266 дней (38 нед от зачатия)',
  population: 'Беременные с точно известной датой зачатия (например, ЭКО).',
  limitations: ['Применимо только при точно известной дате зачатия.'],
  inputs: [{ id: 'conceptionDate', label: 'Дата зачатия', kind: 'date', required: true }],
  steps: [
    {
      id: 'postConceptionDays',
      label: 'Добавление 266 дней к дате зачатия',
      unit: 'дней',
      expression: '266',
      displayPrecision: 0,
    },
    {
      id: 'edd',
      label: 'Предполагаемая дата родов',
      unit: 'дата',
      expression: 'addDays(conceptionDate, 266)',
      valueKind: 'date',
      isOutput: true,
    },
  ],
  warnings: [EDD_ESTIMATE_WARNING],
  sources: [
    {
      title: 'Methods for estimating the due date',
      publisher: 'ACOG',
      version: 'Committee Opinion No. 700',
      reviewedAt: '2026-08-11',
    },
  ],
});

export const OBSTETRIC_EDD_QUICKENING_SCHEMA: CalculatorSchema = CalculatorSchemaSchema.parse({
  schemaVersion: 1,
  id: 'obstetric-edd-quickening',
  slug: 'obstetric-edd-quickening',
  title: 'ПДР по первому шевелению',
  shortTitle: 'ПДР по шевелению',
  aliases: ['первое шевеление плода', 'quickening'],
  summary: 'Предполагаемая дата родов по дате первого ощущаемого шевеления плода.',
  audience: 'adult',
  category: 'obstetrics',
  clinical: true,
  formulaDisplay:
    'ПДР = дата первого шевеления + 22 нед (первобеременные) или + 24 нед (повторнобеременные)',
  population: 'Беременные без более точных данных о сроке (УЗИ I триместра недоступно).',
  limitations: [
    'Дата первого шевеления — субъективный и ненадёжный ориентир. ACOG рекомендует УЗИ первого триместра как основной метод датирования беременности; используйте этот метод только при отсутствии более точных данных.',
  ],
  inputs: [
    { id: 'quickeningDate', label: 'Дата первого шевеления', kind: 'date', required: true },
    {
      id: 'parity',
      label: 'Паритет',
      kind: 'select',
      required: true,
      options: [
        { value: 'primigravida', label: 'Первобеременная' },
        { value: 'multigravida', label: 'Повторнобеременная' },
      ],
    },
  ],
  steps: [
    {
      id: 'weeksToAdd',
      label: 'Недель до срока по паритету',
      unit: 'нед',
      expression: 'cond(parity == "primigravida", 22, 24)',
      displayPrecision: 0,
    },
    {
      id: 'daysToAdd',
      label: 'Дней до срока',
      unit: 'дней',
      expression: 'weeksToAdd * 7',
      displayPrecision: 0,
    },
    {
      id: 'edd',
      label: 'Предполагаемая дата родов',
      unit: 'дата',
      expression: 'addDays(quickeningDate, daysToAdd)',
      valueKind: 'date',
      isOutput: true,
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
  sources: [
    {
      title: 'Methods for estimating the due date',
      publisher: 'ACOG',
      version: 'Committee Opinion No. 700',
      reviewedAt: '2026-08-11',
    },
  ],
});

export const OBSTETRIC_EDD_GIVEN_DATE_SCHEMA: CalculatorSchema = CalculatorSchemaSchema.parse({
  schemaVersion: 1,
  id: 'obstetric-edd-given-date',
  slug: 'obstetric-edd-given-date',
  title: 'ПДР по известному сроку на заданную дату',
  shortTitle: 'ПДР по известному сроку',
  aliases: ['срок на дату ПДР'],
  summary: 'Предполагаемая дата родов, если срок беременности известен на произвольную дату.',
  audience: 'adult',
  category: 'obstetrics',
  clinical: true,
  formulaDisplay: 'ПДР = заданная дата + (280 − известный срок на эту дату, дней)',
  population: 'Случаи, когда срок беременности задокументирован на дату, отличную от УЗИ/ЛМП.',
  limitations: ['Достоверность результата зависит от точности исходного известного срока.'],
  inputs: [
    { id: 'referenceDate', label: 'Дата отсчёта', kind: 'date', required: true },
    {
      id: 'gaWeeksGiven',
      label: 'Срок на заданную дату',
      unit: 'нед',
      kind: 'number',
      integer: true,
      minimum: 0,
      maximum: 42,
      required: true,
    },
    {
      id: 'gaDaysGiven',
      label: 'Срок на заданную дату',
      unit: 'дн',
      kind: 'number',
      integer: true,
      minimum: 0,
      maximum: 6,
      required: true,
    },
  ],
  steps: [
    {
      id: 'gaAtDate',
      label: 'Срок на заданную дату',
      unit: 'дней',
      expression: 'gaWeeksGiven * 7 + gaDaysGiven',
      displayPrecision: 0,
    },
    {
      id: 'remainder',
      label: 'Остаток до 280 дней',
      unit: 'дней',
      expression: '280 - gaAtDate',
      displayPrecision: 0,
    },
    {
      id: 'edd',
      label: 'Предполагаемая дата родов',
      unit: 'дата',
      expression: 'addDays(referenceDate, remainder)',
      valueKind: 'date',
      isOutput: true,
    },
  ],
  assertions: [
    { when: 'gaAtDate > 280', error: 'Указанный срок беременности превышает 40 недель.' },
  ],
  warnings: [EDD_ESTIMATE_WARNING],
  sources: [
    {
      title: 'Methods for estimating the due date',
      publisher: 'ACOG',
      version: 'Committee Opinion No. 700',
      reviewedAt: '2026-08-11',
    },
  ],
});

export const OBSTETRIC_GA_FROM_EDD_SCHEMA: CalculatorSchema = CalculatorSchemaSchema.parse({
  schemaVersion: 1,
  id: 'obstetric-ga-from-edd',
  slug: 'obstetric-ga-from-edd',
  title: 'Срок беременности по известной ПДР',
  shortTitle: 'Срок по ПДР',
  aliases: ['срок беременности сегодня', 'текущий срок по ПДР'],
  summary: 'Текущий срок беременности на заданную дату (или сегодня) по известной ПДР.',
  audience: 'adult',
  category: 'obstetrics',
  clinical: true,
  formulaDisplay: 'Срок беременности = (дата расчёта) − (ПДР − 280 дней)',
  population: 'Беременные с уже установленной ПДР.',
  limitations: [
    'Расчёт основан на среднем сроке 280 дней и не учитывает фактическую дату зачатия.',
  ],
  inputs: [
    { id: 'eddDate', label: 'Предполагаемая дата родов', kind: 'date', required: true },
    {
      id: 'asOfDate',
      label: 'Дата расчёта',
      kind: 'date',
      required: false,
      defaultExpression: 'today()',
      note: 'По умолчанию — сегодня.',
    },
  ],
  steps: [
    {
      id: 'impliedLmp',
      label: 'Условная дата последней менструации',
      unit: 'дата',
      expression: 'addDays(eddDate, -280)',
      valueKind: 'date',
    },
    {
      id: 'gaDays',
      label: 'Срок беременности на дату расчёта',
      unit: 'дней',
      expression: 'daysBetween(impliedLmp, asOfDate)',
      displayPrecision: 0,
    },
    {
      id: 'weeks',
      label: 'Недели',
      unit: 'нед',
      expression: 'floor(gaDays / 7)',
      displayPrecision: 0,
      isOutput: true,
    },
    {
      id: 'days',
      label: 'Дни',
      unit: 'дн',
      expression: 'gaDays - weeks * 7',
      displayPrecision: 0,
      isOutput: true,
    },
  ],
  assertions: [
    {
      when: 'gaDays < 0',
      error: 'Указанная дата расчёта раньше начала беременности по этому ПДР.',
    },
    {
      when: 'gaDays > 301',
      error: 'Указанная дата расчёта более чем на 3 недели позже ПДР.',
    },
  ],
  warnings: [
    {
      code: 'edd-estimate',
      message: 'Расчёт основан на среднем сроке 280 дней и не учитывает фактическую дату зачатия.',
    },
  ],
  sources: [
    {
      title: 'Methods for estimating the due date',
      publisher: 'ACOG',
      version: 'Committee Opinion No. 700',
      reviewedAt: '2026-08-11',
    },
  ],
});

export const OBSTETRIC_MATERNITY_LEAVE_SCHEMA: CalculatorSchema = CalculatorSchemaSchema.parse({
  schemaVersion: 1,
  id: 'obstetric-maternity-leave',
  slug: 'obstetric-maternity-leave',
  title: 'Сроки отпуска по беременности и родам',
  shortTitle: 'Декретный отпуск',
  aliases: ['декретный отпуск', 'больничный лист по беременности', 'ст 255 ТК РФ'],
  summary:
    'Начало, окончание и продолжительность отпуска по беременности и родам по известной ПДР.',
  audience: 'adult',
  category: 'obstetrics',
  clinical: true,
  formulaDisplay:
    'Ст. 255 ТК РФ: больничный лист выдаётся с 30 нед (28 нед при многоплодной беременности) на 140 дней (194 — многоплодная, 156 — осложнённые роды)',
  population: 'Беременные, оформляющие отпуск по беременности и родам в РФ.',
  limitations: [
    'Продолжительность и правила выдачи листка нетрудоспособности регулируются ст. 255 ТК РФ и Федеральным законом № 255-ФЗ; фактическая дата родов не изменяет длительность выданного листка, кроме случая осложнённых родов (+16 дней) или преждевременных родов.',
    'Роды на сроке 22–30 недель оформляются отдельным листком нетрудоспособности на 156 дней от даты родов и не рассчитываются этим калькулятором.',
  ],
  inputs: [
    { id: 'eddDate', label: 'Предполагаемая дата родов', kind: 'date', required: true },
    {
      id: 'pregnancyType',
      label: 'Тип беременности',
      kind: 'select',
      required: true,
      options: [
        { value: 'single', label: 'Одноплодная' },
        { value: 'multiple', label: 'Многоплодная' },
      ],
    },
    {
      id: 'complicatedBirth',
      label: 'Осложнённые роды',
      kind: 'select',
      required: true,
      options: [
        { value: 'no', label: 'Нет' },
        { value: 'yes', label: 'Да' },
      ],
    },
  ],
  steps: [
    {
      id: 'impliedLmp',
      label: 'Условная дата последней менструации',
      unit: 'дата',
      expression: 'addDays(eddDate, -280)',
      valueKind: 'date',
    },
    {
      id: 'leaveStartWeeks',
      label: 'Срок начала отпуска',
      unit: 'нед от ЛМП',
      expression: 'cond(pregnancyType == "multiple", 28, 30)',
      displayPrecision: 0,
    },
    {
      id: 'leaveStartDays',
      label: 'Срок начала отпуска, дней от ЛМП',
      unit: 'дней от ЛМП',
      expression: 'leaveStartWeeks * 7',
      displayPrecision: 0,
    },
    {
      id: 'leaveStart',
      label: 'Начало отпуска по беременности и родам',
      unit: 'дата',
      expression: 'addDays(impliedLmp, leaveStartDays)',
      valueKind: 'date',
      isOutput: true,
    },
    {
      id: 'totalDays',
      label: 'Продолжительность',
      unit: 'календарных дней',
      expression:
        'cond(pregnancyType == "multiple", 194, cond(complicatedBirth == "yes", 156, 140))',
      displayPrecision: 0,
      isOutput: true,
    },
    {
      id: 'leaveEnd',
      label: 'Окончание отпуска (при выдаче единым листом)',
      unit: 'дата',
      expression: 'addDays(leaveStart, totalDays - 1)',
      valueKind: 'date',
      isOutput: true,
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
  sources: [
    {
      title: 'Трудовой кодекс РФ, ст. 255',
      publisher: 'Официальный интернет-портал правовой информации',
      version: 'действующая редакция',
      reviewedAt: '2026-08-11',
    },
  ],
});

export const OBSTETRIC_FETAL_GROWTH_DOPPLER_SCHEMA: CalculatorSchema = CalculatorSchemaSchema.parse(
  {
    schemaVersion: 1,
    id: 'obstetric-fetal-growth-doppler',
    slug: 'obstetric-fetal-growth-doppler',
    title: 'Рост плода и допплерометрия',
    shortTitle: 'Рост и допплер',
    aliases: ['fetal growth', 'Doppler', 'ЦПС', 'церебро-плацентарное отношение', 'ПИ артерий'],
    summary: 'Расчёт ЦПС и среднего ПИ маточных артерий по данным протокола УЗИ.',
    audience: 'adult',
    category: 'obstetrics',
    clinical: true,
    formulaDisplay:
      'ЦПС = ПИ средней мозговой артерии / ПИ пуповинной артерии; средний ПИ маточных артерий = (правый + левый) / 2',
    population: 'Беременность 20–42 недели при наличии показателей допплерометрии в протоколе УЗИ.',
    limitations: [
      'Калькулятор считает индексы, но не определяет норму: пороги зависят от срока, методики и референсных таблиц учреждения.',
      'Процентиль массы вводится из протокола УЗИ и не рассчитывается без полного набора биометрии и выбранного стандарта.',
    ],
    inputs: [
      {
        id: 'gaWeeks',
        label: 'Срок беременности',
        unit: 'нед',
        kind: 'number',
        integer: true,
        minimum: 20,
        maximum: 42,
        required: true,
      },
      {
        id: 'gaDays',
        label: 'Дополнительные дни',
        unit: 'дн',
        kind: 'number',
        integer: true,
        minimum: 0,
        maximum: 6,
        required: true,
      },
      {
        id: 'efwG',
        label: 'Расчётная масса плода из протокола',
        unit: 'г',
        kind: 'number',
        minimum: 100,
        maximum: 6000,
        required: true,
      },
      {
        id: 'efwPercentile',
        label: 'Процентиль массы из протокола',
        unit: '%',
        kind: 'number',
        minimum: 0.1,
        maximum: 99.9,
        required: true,
      },
      {
        id: 'umbilicalArteryPi',
        label: 'ПИ пуповинной артерии',
        kind: 'number',
        minimum: 0.01,
        maximum: 10,
        required: true,
      },
      {
        id: 'middleCerebralArteryPi',
        label: 'ПИ средней мозговой артерии',
        kind: 'number',
        minimum: 0.01,
        maximum: 10,
        required: true,
      },
      {
        id: 'uterineArteryPiRight',
        label: 'ПИ правой маточной артерии',
        kind: 'number',
        minimum: 0,
        maximum: 10,
        required: true,
      },
      {
        id: 'uterineArteryPiLeft',
        label: 'ПИ левой маточной артерии',
        kind: 'number',
        minimum: 0,
        maximum: 10,
        required: true,
      },
    ],
    steps: [
      {
        id: 'gaExact',
        label: 'Срок беременности',
        unit: 'нед',
        expression: 'gaWeeks + gaDays / 7',
        displayPrecision: 2,
      },
      {
        id: 'cerebroPlacentalRatio',
        label: 'Церебро-плацентарное отношение (ЦПС)',
        unit: 'отношение',
        expression: 'middleCerebralArteryPi / umbilicalArteryPi',
        displayPrecision: 2,
        isOutput: true,
      },
      {
        id: 'meanUterinePi',
        label: 'Средний ПИ маточных артерий',
        unit: 'индекс',
        expression: '(uterineArteryPiRight + uterineArteryPiLeft) / 2',
        displayPrecision: 2,
        isOutput: true,
      },
      {
        id: 'reportedEfw',
        label: 'Масса плода из протокола',
        unit: 'г',
        expression: 'efwG',
        displayPrecision: 0,
        isOutput: true,
      },
      {
        id: 'reportedEfwPercentile',
        label: 'Процентиль массы из протокола',
        unit: '%',
        expression: 'efwPercentile',
        displayPrecision: 1,
        isOutput: true,
      },
    ],
    warnings: [
      {
        code: 'reference-charts-required',
        message:
          'Индексы нельзя интерпретировать без срока беременности и референсных таблиц, принятых в конкретном учреждении.',
      },
    ],
    sources: [
      {
        title: 'ISUOG Practice Guidelines: use of Doppler velocimetry in obstetrics',
        publisher: 'International Society of Ultrasound in Obstetrics and Gynecology',
        version: '2020',
        url: 'https://www.isuog.org/clinical-resources/isuog-guidelines.html',
        reviewedAt: '2026-08-14',
      },
    ],
  },
);

export const OBSTETRIC_EFW_MATERNAL_ANTHROPOMETRY_SCHEMA: CalculatorSchema =
  CalculatorSchemaSchema.parse({
    schemaVersion: 1,
    id: 'obstetric-efw-maternal-anthropometry',
    slug: 'obstetric-efw-maternal-anthropometry',
    title: 'Предполагаемая масса плода по антропометрии матери',
    shortTitle: 'Масса по антропометрии',
    aliases: ['EFW maternal anthropometry', 'масса плода по матери', 'масса при рождении'],
    summary:
      'Антропометрическая оценка ожидаемой массы при рождении по сроку и прибавке массы матери.',
    audience: 'adult',
    category: 'obstetrics',
    clinical: true,
    formulaDisplay:
      'Масса (г) = срок (дни) × [9,36 + 0,262 × пол + 0,000237 × рост × масса на 26-й неделе + 4,81 × скорость прибавки × (паритет + 1)]',
    population:
      'Одноплодная беременность III триместра; антропометрическая оценка ожидаемой массы при рождении.',
    limitations: [
      'Это модель массы при рождении, а не сонографическая оценка текущей массы плода; она не заменяет УЗИ.',
      'Точность зависит от популяции, качества данных о массе на 26-й неделе и скорости прибавки.',
    ],
    inputs: [
      {
        id: 'gaWeeks',
        label: 'Срок беременности',
        unit: 'нед',
        kind: 'number',
        integer: true,
        minimum: 28,
        maximum: 42,
        required: true,
      },
      {
        id: 'gaDays',
        label: 'Дополнительные дни',
        unit: 'дн',
        kind: 'number',
        integer: true,
        minimum: 0,
        maximum: 6,
        required: true,
      },
      {
        id: 'fetalSex',
        label: 'Пол плода',
        kind: 'select',
        required: true,
        options: [
          { value: -1, label: 'Женский' },
          { value: 0, label: 'Неизвестен' },
          { value: 1, label: 'Мужской' },
        ],
      },
      {
        id: 'maternalHeightCm',
        label: 'Рост матери',
        unit: 'см',
        kind: 'number',
        minimum: 100,
        maximum: 220,
        required: true,
      },
      {
        id: 'maternalWeightAt26Kg',
        label: 'Масса матери на 26-й неделе',
        unit: 'кг',
        kind: 'number',
        minimum: 35,
        maximum: 180,
        required: true,
      },
      {
        id: 'thirdTrimesterWeightGainKg',
        label: 'Прибавка массы в III триместре',
        unit: 'кг',
        kind: 'number',
        minimum: 0,
        maximum: 30,
        required: true,
      },
      {
        id: 'parity',
        label: 'Предыдущие роды после 20 недель',
        unit: 'раз',
        kind: 'number',
        integer: true,
        minimum: 0,
        maximum: 10,
        required: true,
      },
    ],
    steps: [
      {
        id: 'gaDaysTotal',
        label: 'Срок беременности',
        unit: 'дней',
        expression: 'gaWeeks * 7 + gaDays',
        displayPrecision: 0,
      },
      {
        id: 'thirdTrimesterDays',
        label: 'Дни наблюдаемого III триместра',
        unit: 'дней',
        expression: 'gaDaysTotal - 196',
        displayPrecision: 0,
      },
      {
        id: 'weightGainRate',
        label: 'Скорость прибавки массы',
        unit: 'кг/день',
        expression: 'thirdTrimesterWeightGainKg / thirdTrimesterDays',
        displayPrecision: 3,
      },
      {
        id: 'estimatedBirthWeight',
        label: 'Ожидаемая масса при рождении',
        unit: 'г',
        expression:
          'gaDaysTotal * (9.36 + 0.262 * fetalSex + 0.000237 * maternalHeightCm * maternalWeightAt26Kg + 4.81 * weightGainRate * (parity + 1))',
        displayPrecision: 0,
        isOutput: true,
      },
    ],
    warnings: [
      {
        code: 'birthweight-model',
        message:
          'Результат относится к ожидаемой массе при рождении по антропометрической модели и не является текущей массой плода.',
      },
    ],
    sources: [
      {
        title: 'Reliability of a clinical method in estimating foetal weight',
        publisher: 'PMC',
        version: '2021',
        url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC8517749/',
        reviewedAt: '2026-08-14',
      },
    ],
  });

export const OBSTETRIC_EFW_RUDAKOV_SCHEMA: CalculatorSchema = CalculatorSchemaSchema.parse({
  schemaVersion: 1,
  id: 'obstetric-efw-rudakov',
  slug: 'obstetric-efw-rudakov',
  title: 'Предполагаемая масса плода по Рудакову',
  shortTitle: 'Масса по Рудакову',
  aliases: ['Rudakov', 'Рудаков масса плода', 'OJ VDM'],
  summary: 'Упрощённая bedside-оценка массы по окружности живота и высоте дна матки.',
  audience: 'adult',
  category: 'obstetrics',
  clinical: true,
  formulaDisplay: 'Упрощённая оценка: масса (г) ≈ окружность живота (см) × высота дна матки (см)',
  population: 'Беременность III триместра при измерении окружности живота и высоты дна матки.',
  limitations: [
    'Полная методика Рудакова использует пальпаторные полуокружности и таблицу; здесь реализована распространённая упрощённая оценка без таблицы.',
    'Результат чувствителен к положению плода, ожирению, многоводию, многоплодию и ошибке измерения.',
  ],
  inputs: [
    {
      id: 'gaWeeks',
      label: 'Срок беременности',
      unit: 'нед',
      kind: 'number',
      integer: true,
      minimum: 28,
      maximum: 42,
      required: true,
    },
    {
      id: 'abdominalCircumferenceCm',
      label: 'Окружность живота',
      unit: 'см',
      kind: 'number',
      minimum: 50,
      maximum: 160,
      required: true,
    },
    {
      id: 'fundalHeightCm',
      label: 'Высота дна матки',
      unit: 'см',
      kind: 'number',
      minimum: 20,
      maximum: 45,
      required: true,
    },
  ],
  steps: [
    {
      id: 'rudakovIndex',
      label: 'Индекс ОЖ × ВДМ',
      unit: 'см²',
      expression: 'abdominalCircumferenceCm * fundalHeightCm',
      displayPrecision: 0,
    },
    {
      id: 'estimatedFetalWeight',
      label: 'Предполагаемая масса плода',
      unit: 'г',
      expression: 'rudakovIndex',
      displayPrecision: 0,
      isOutput: true,
    },
  ],
  warnings: [
    {
      code: 'simplified-rudakov',
      message:
        'Использована упрощённая формула ОЖ × ВДМ; для клинического решения нужна полная методика и сопоставление с УЗИ.',
    },
  ],
  sources: [
    {
      title: 'Сравнение методов оценки массы плода',
      publisher: 'Arutunyan Doctor',
      version: 'онлайн-методика',
      url: 'https://arutunyan.doctor/tools/fetal-weight-comparison',
      reviewedAt: '2026-08-14',
    },
    {
      title: 'Reliability of a clinical method in estimating foetal weight',
      publisher: 'PMC',
      version: '2021',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC8517749/',
      reviewedAt: '2026-08-14',
    },
  ],
});

export const OBSTETRIC_VBAC_ANTEPARTUM_SCHEMA: CalculatorSchema = CalculatorSchemaSchema.parse({
  schemaVersion: 1,
  id: 'obstetric-vbac-antepartum',
  slug: 'obstetric-vbac-antepartum',
  title: 'Вероятность успешных родов после кесарева — при постановке на учёт',
  shortTitle: 'VBAC при постановке на учёт',
  aliases: ['VBAC antepartum', 'TOLAC Grobman 2007', 'родоразрешение после кесарева'],
  summary:
    'Прогностическая модель MFMU для оценки вероятности VBAC по данным первого дородового визита.',
  audience: 'adult',
  category: 'obstetrics',
  clinical: true,
  formulaDisplay:
    'Grobman 2007: p = exp(w) / (1 + exp(w)), логит w включает возраст, ИМТ, анамнез вагинальных родов и показание к кесареву',
  population:
    'Кандидаты на TOLAC с одним предшествующим кесаревым сечением при отсутствии противопоказаний к вагинальным родам.',
  limitations: [
    'Это прогностическая модель, а не решение о допустимости TOLAC и не гарантия исхода.',
    'Коэффициенты расы исторические и не должны использоваться как самостоятельный клинический признак; результат требует очной оценки акушером.',
  ],
  inputs: [
    {
      id: 'ageYears',
      label: 'Возраст',
      unit: 'лет',
      kind: 'number',
      minimum: 18,
      maximum: 50,
      required: true,
    },
    {
      id: 'bmi',
      label: 'ИМТ до беременности',
      unit: 'кг/м²',
      kind: 'number',
      minimum: 15,
      maximum: 60,
      required: true,
    },
    {
      id: 'race',
      label: 'Группа модели',
      kind: 'select',
      required: true,
      options: [
        { value: 'other', label: 'Другая / не указана' },
        { value: 'african-american', label: 'African-American' },
        { value: 'hispanic', label: 'Hispanic' },
      ],
    },
    {
      id: 'anyPriorVaginal',
      label: 'Были вагинальные роды',
      kind: 'select',
      required: true,
      options: [
        { value: 'no', label: 'Нет' },
        { value: 'yes', label: 'Да' },
      ],
    },
    {
      id: 'priorVbac',
      label: 'Был VBAC после кесарева',
      kind: 'select',
      required: true,
      options: [
        { value: 'no', label: 'Нет' },
        { value: 'yes', label: 'Да' },
      ],
    },
    {
      id: 'indication',
      label: 'Показание к предыдущему кесареву',
      kind: 'select',
      required: true,
      options: [
        { value: 'nonrecurring', label: 'Неповторяющееся' },
        { value: 'recurring', label: 'Повторяющееся' },
      ],
    },
  ],
  steps: [
    {
      id: 'africanAmerican',
      label: 'Коэффициент African-American',
      unit: 'коэфф.',
      expression: 'cond(race == "african-american", 1, 0)',
      displayPrecision: 0,
    },
    {
      id: 'hispanic',
      label: 'Коэффициент Hispanic',
      unit: 'коэфф.',
      expression: 'cond(race == "hispanic", 1, 0)',
      displayPrecision: 0,
    },
    {
      id: 'priorVaginal',
      label: 'Коэффициент предыдущих вагинальных родов',
      unit: 'коэфф.',
      expression: 'cond(anyPriorVaginal == "yes", 1, 0)',
      displayPrecision: 0,
    },
    {
      id: 'priorVbacValue',
      label: 'Коэффициент предыдущего VBAC',
      unit: 'коэфф.',
      expression: 'cond(priorVbac == "yes", 1, 0)',
      displayPrecision: 0,
    },
    {
      id: 'recurringIndication',
      label: 'Коэффициент повторяющегося показания',
      unit: 'коэфф.',
      expression: 'cond(indication == "recurring", 1, 0)',
      displayPrecision: 0,
    },
    {
      id: 'logit',
      label: 'Логит модели',
      unit: 'логит',
      expression:
        '3.766 - 0.039 * ageYears - 0.060 * bmi - 0.671 * africanAmerican - 0.680 * hispanic + 0.888 * priorVaginal + 1.003 * priorVbacValue - 0.632 * recurringIndication',
      displayPrecision: 3,
    },
    {
      id: 'successProbability',
      label: 'Расчётная вероятность успешного VBAC',
      unit: '%',
      expression: '100 * exp(logit) / (1 + exp(logit))',
      displayPrecision: 1,
      isOutput: true,
    },
  ],
  warnings: [
    {
      code: 'vbac-model',
      message:
        'Модель оценивает вероятность успеха только у уже отобранных кандидатов на TOLAC и не заменяет клиническую оценку.',
    },
  ],
  sources: [
    {
      title: 'Prediction of vaginal birth after cesarean delivery',
      publisher: 'PMC / MFMU Network',
      version: 'Grobman 2007',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC4372471/',
      reviewedAt: '2026-08-14',
    },
  ],
});

export const OBSTETRIC_VBAC_ADMISSION_SCHEMA: CalculatorSchema = CalculatorSchemaSchema.parse({
  schemaVersion: 1,
  id: 'obstetric-vbac-admission',
  slug: 'obstetric-vbac-admission',
  title: 'Вероятность успешных родов после кесарева — при поступлении',
  shortTitle: 'VBAC при поступлении',
  aliases: ['VBAC admission', 'TOLAC Grobman 2009', 'VBAC calculator admission'],
  summary: 'Модель MFMU с данными, доступными при поступлении в родильный стационар.',
  audience: 'adult',
  category: 'obstetrics',
  clinical: true,
  formulaDisplay:
    'Grobman 2009: логистическая модель с возрастом, ИМТ, анамнезом, сроком, состоянием шейки и индукцией',
  population: 'Кандидаты на TOLAC при поступлении для родоразрешения.',
  limitations: [
    'Модель не определяет показания или противопоказания к TOLAC и не учитывает все клинические обстоятельства.',
    'Коэффициенты расы исторические; результат нельзя использовать как единственное основание для выбора способа родоразрешения.',
  ],
  inputs: [
    {
      id: 'ageYears',
      label: 'Возраст',
      unit: 'лет',
      kind: 'number',
      minimum: 18,
      maximum: 50,
      required: true,
    },
    {
      id: 'bmi',
      label: 'ИМТ до беременности',
      unit: 'кг/м²',
      kind: 'number',
      minimum: 15,
      maximum: 60,
      required: true,
    },
    {
      id: 'race',
      label: 'Группа модели',
      kind: 'select',
      required: true,
      options: [
        { value: 'other', label: 'Другая / не указана' },
        { value: 'african-american', label: 'African-American' },
        { value: 'hispanic', label: 'Hispanic' },
      ],
    },
    {
      id: 'anyPriorVaginal',
      label: 'Были вагинальные роды',
      kind: 'select',
      required: true,
      options: [
        { value: 'no', label: 'Нет' },
        { value: 'yes', label: 'Да' },
      ],
    },
    {
      id: 'priorVbac',
      label: 'Был VBAC после кесарева',
      kind: 'select',
      required: true,
      options: [
        { value: 'no', label: 'Нет' },
        { value: 'yes', label: 'Да' },
      ],
    },
    {
      id: 'indication',
      label: 'Показание к предыдущему кесареву',
      kind: 'select',
      required: true,
      options: [
        { value: 'nonrecurring', label: 'Неповторяющееся' },
        { value: 'recurring', label: 'Повторяющееся' },
      ],
    },
    {
      id: 'gaWeeks',
      label: 'Срок при поступлении',
      unit: 'нед',
      kind: 'number',
      minimum: 34,
      maximum: 42,
      required: true,
    },
    {
      id: 'hypertensiveDisease',
      label: 'Гипертензивное заболевание беременности',
      kind: 'select',
      required: true,
      options: [
        { value: 'no', label: 'Нет' },
        { value: 'yes', label: 'Да' },
      ],
    },
    {
      id: 'effacement',
      label: 'Сглаживание шейки',
      unit: '%',
      kind: 'number',
      minimum: 0,
      maximum: 100,
      required: true,
    },
    {
      id: 'dilation',
      label: 'Раскрытие шейки',
      unit: 'см',
      kind: 'number',
      minimum: 0,
      maximum: 10,
      required: true,
    },
    {
      id: 'station',
      label: 'Станция головки',
      unit: 'станция',
      kind: 'number',
      minimum: -3,
      maximum: 3,
      required: true,
    },
    {
      id: 'laborInduction',
      label: 'Индукция родов',
      kind: 'select',
      required: true,
      options: [
        { value: 'no', label: 'Нет' },
        { value: 'yes', label: 'Да' },
      ],
    },
  ],
  steps: [
    {
      id: 'africanAmerican',
      label: 'Коэффициент African-American',
      unit: 'коэфф.',
      expression: 'cond(race == "african-american", 1, 0)',
      displayPrecision: 0,
    },
    {
      id: 'hispanic',
      label: 'Коэффициент Hispanic',
      unit: 'коэфф.',
      expression: 'cond(race == "hispanic", 1, 0)',
      displayPrecision: 0,
    },
    {
      id: 'priorVaginal',
      label: 'Коэффициент предыдущих вагинальных родов',
      unit: 'коэфф.',
      expression: 'cond(anyPriorVaginal == "yes", 1, 0)',
      displayPrecision: 0,
    },
    {
      id: 'priorVbacValue',
      label: 'Коэффициент предыдущего VBAC',
      unit: 'коэфф.',
      expression: 'cond(priorVbac == "yes", 1, 0)',
      displayPrecision: 0,
    },
    {
      id: 'recurringIndication',
      label: 'Коэффициент повторяющегося показания',
      unit: 'коэфф.',
      expression: 'cond(indication == "recurring", 1, 0)',
      displayPrecision: 0,
    },
    {
      id: 'hypertensiveValue',
      label: 'Коэффициент гипертензивного заболевания',
      unit: 'коэфф.',
      expression: 'cond(hypertensiveDisease == "yes", 1, 0)',
      displayPrecision: 0,
    },
    {
      id: 'inductionValue',
      label: 'Коэффициент индукции',
      unit: 'коэфф.',
      expression: 'cond(laborInduction == "yes", 1, 0)',
      displayPrecision: 0,
    },
    {
      id: 'logit',
      label: 'Логит модели',
      unit: 'логит',
      expression:
        '7.059 - 0.037 * ageYears - 0.044 * bmi - 0.460 * africanAmerican - 0.761 * hispanic + 0.955 * priorVaginal + 0.851 * priorVbacValue - 0.655 * recurringIndication - 0.109 * gaWeeks - 0.499 * hypertensiveValue + 0.044 * effacement + 0.109 * dilation + 0.082 * station - 0.452 * inductionValue',
      displayPrecision: 3,
    },
    {
      id: 'successProbability',
      label: 'Расчётная вероятность успешного VBAC',
      unit: '%',
      expression: '100 * exp(logit) / (1 + exp(logit))',
      displayPrecision: 1,
      isOutput: true,
    },
  ],
  warnings: [
    {
      code: 'vbac-model',
      message:
        'Модель оценивает вероятность успеха только у уже отобранных кандидатов на TOLAC и не заменяет клиническую оценку.',
    },
  ],
  sources: [
    {
      title: 'Development of a nomogram for prediction of vaginal birth after cesarean delivery',
      publisher: 'Thieme / MFMU Network',
      version: 'Grobman 2009',
      url: 'https://www.thieme-connect.com/products/ejournals/html/10.1055/s-0029-1239494',
      reviewedAt: '2026-08-14',
    },
  ],
});

export const GYNECOLOGY_BREAST_CANCER_RISK_SCHEMA: CalculatorSchema = CalculatorSchemaSchema.parse({
  schemaVersion: 1,
  id: 'gynecology-breast-cancer-risk',
  slug: 'gynecology-breast-cancer-risk',
  title: 'Риск рака молочной железы — модель Gail/BCRAT',
  shortTitle: 'Риск молочной железы',
  aliases: ['Gail model', 'BCRAT', 'breast cancer risk', 'модель Гейла'],
  summary: 'Пятилетний и оставшийся до 90 лет риск инвазивного рака по модели NCI BCRAT.',
  audience: 'adult',
  category: 'gynecology',
  clinical: true,
  formulaDisplay:
    'NCI Breast Cancer Risk Assessment Tool: относительный риск × возрастные базовые частоты SEER/NCHS с конкурирующей смертностью',
  population: 'Женщины 20–89 лет без ранее диагностированного инвазивного рака или DCIS.',
  limitations: [
    'Модель разработана на американских популяционных данных и не заменяет оценку наследственных синдромов (BRCA, BRCAPRO, Tyrer–Cuzick).',
    'Результат нельзя сравнивать напрямую с популяциями, для которых базовые частоты и валидность модели отличаются.',
  ],
  inputs: [
    {
      id: 'ageYears',
      label: 'Возраст',
      unit: 'лет',
      kind: 'number',
      integer: true,
      minimum: 20,
      maximum: 89,
      required: true,
    },
    {
      id: 'race',
      label: 'Группа модели',
      kind: 'select',
      required: true,
      options: [
        { value: 'white', label: 'White' },
        { value: 'black', label: 'Black' },
        { value: 'hispanic', label: 'Hispanic' },
        { value: 'asian', label: 'Asian' },
        { value: 'other', label: 'Другая / не указана' },
      ],
    },
    {
      id: 'biopsiesCategory',
      label: 'Количество биопсий молочной железы',
      kind: 'select',
      required: true,
      options: [
        { value: 0, label: '0' },
        { value: 1, label: '1' },
        { value: 2, label: '2 и более' },
      ],
    },
    {
      id: 'menarcheCategory',
      label: 'Возраст менархе',
      kind: 'select',
      required: true,
      options: [
        { value: 0, label: '14 лет и старше' },
        { value: 1, label: '12–13 лет' },
        { value: 2, label: 'Младше 12 лет' },
      ],
    },
    {
      id: 'firstBirthCategory',
      label: 'Возраст при первых родах',
      kind: 'select',
      required: true,
      options: [
        { value: 0, label: 'До 20 лет или не было родов' },
        { value: 1, label: '20–24 года' },
        { value: 2, label: '25–29 лет' },
        { value: 3, label: '30 лет и старше' },
      ],
    },
    {
      id: 'relativesCategory',
      label: 'Родственницы первой линии с раком молочной железы',
      kind: 'select',
      required: true,
      options: [
        { value: 0, label: '0' },
        { value: 1, label: '1' },
        { value: 2, label: '2 и более' },
      ],
    },
    {
      id: 'atypicalHyperplasia',
      label: 'Атипическая гиперплазия в биопсии',
      kind: 'select',
      required: true,
      options: [
        { value: 0, label: 'Нет' },
        { value: 1, label: 'Да' },
      ],
    },
  ],
  steps: [
    {
      id: 'fiveYearRisk',
      label: 'Риск инвазивного рака за 5 лет',
      unit: '%',
      expression:
        'gailRisk(ageYears, 5, race, biopsiesCategory, menarcheCategory, firstBirthCategory, relativesCategory, atypicalHyperplasia)',
      displayPrecision: 2,
      isOutput: true,
    },
    {
      id: 'lifetimeRisk',
      label: 'Риск до 90 лет',
      unit: '%',
      expression:
        'gailRisk(ageYears, 90, race, biopsiesCategory, menarcheCategory, firstBirthCategory, relativesCategory, atypicalHyperplasia)',
      displayPrecision: 2,
      isOutput: true,
    },
  ],
  warnings: [
    {
      code: 'bcrat-population',
      message:
        'Это справочная оценка по NCI BCRAT/Gail; она не заменяет онкогенетическую консультацию и индивидуальный план скрининга.',
    },
  ],
  sources: [
    {
      title: 'About the Breast Cancer Risk Assessment Tool',
      publisher: 'National Cancer Institute',
      version: 'BCRAT',
      url: 'https://bcrisktool.cancer.gov/about.html',
      reviewedAt: '2026-08-14',
    },
    {
      title: 'Breast Cancer Risk Assessment (BCRA)',
      publisher: 'National Cancer Institute',
      version: 'R package 2.0',
      url: 'https://dceg.cancer.gov/tools/risk-assessment/bcra',
      reviewedAt: '2026-08-14',
    },
  ],
});

export const GYNECOLOGY_CERVICAL_CANCER_RISK_SCHEMA: CalculatorSchema =
  CalculatorSchemaSchema.parse({
    schemaVersion: 1,
    id: 'gynecology-cervical-cancer-risk',
    slug: 'gynecology-cervical-cancer-risk',
    title: 'Скрининг шейки матки — ASCCP',
    shortTitle: 'Риск шейки матки',
    aliases: ['cervical cancer risk', 'ASCCP', 'ВПЧ и цитология', 'скрининг шейки матки'],
    summary: 'Справочная стратификация маршрута по общим сочетаниям ВПЧ, цитологии и анамнеза.',
    audience: 'adult',
    category: 'gynecology',
    clinical: true,
    formulaDisplay:
      'ASCCP risk-based management: уровень 1–3 для навигации по общему маршруту, не абсолютный риск рака',
    population: 'Пациентки скринингового возраста с результатами ВПЧ-теста и цитологии.',
    limitations: [
      'Это не числовой калькулятор риска рака: точные риски CIN3+ требуют полной таблицы ASCCP, предыдущих результатов и дат.',
      'Иммунодефицит, беременность, возраст до 25 лет и лечение CIN2+ меняют маршрут; окончательное решение принимает врач.',
    ],
    inputs: [
      {
        id: 'ageYears',
        label: 'Возраст',
        unit: 'лет',
        kind: 'number',
        integer: true,
        minimum: 21,
        maximum: 100,
        required: true,
      },
      {
        id: 'cytology',
        label: 'Цитология',
        kind: 'select',
        required: true,
        options: [
          { value: 'negative', label: 'NILM / без интраэпителиального поражения' },
          { value: 'ascus', label: 'ASC-US' },
          { value: 'lsil', label: 'LSIL' },
          { value: 'hsil', label: 'HSIL' },
          { value: 'agc', label: 'AGC' },
        ],
      },
      {
        id: 'hpvStatus',
        label: 'Высокоонкогенный ВПЧ',
        kind: 'select',
        required: true,
        options: [
          { value: 'negative', label: 'Отрицательный' },
          { value: 'positive', label: 'Положительный' },
        ],
      },
      {
        id: 'hpv16Or18',
        label: 'ВПЧ 16/18',
        kind: 'select',
        required: true,
        options: [
          { value: 'no', label: 'Нет / не выявлен' },
          { value: 'yes', label: 'Да' },
        ],
      },
      {
        id: 'priorCin2Plus',
        label: 'Анамнез CIN2+ или неизвестен',
        kind: 'select',
        required: true,
        options: [
          { value: 'negative', label: 'Нет' },
          { value: 'unknown', label: 'Неизвестен' },
          { value: 'yes', label: 'Да' },
        ],
      },
      {
        id: 'immunosuppressed',
        label: 'Иммуносупрессия',
        kind: 'select',
        required: true,
        options: [
          { value: 'no', label: 'Нет' },
          { value: 'yes', label: 'Да' },
        ],
      },
    ],
    steps: [
      {
        id: 'asccpBand',
        label: 'Справочный уровень маршрута ASCCP',
        unit: 'уровень 1–3',
        expression:
          'asccpRiskBand(ageYears, cytology, hpvStatus, hpv16Or18, priorCin2Plus, immunosuppressed)',
        displayPrecision: 0,
        isOutput: true,
      },
    ],
    interpretations: [
      {
        when: 'asccpBand >= 3',
        message:
          'Высокий уровень: нужна очная оценка и проверка актуального маршрута ASCCP; при некоторых сочетаниях показана кольпоскопия или ускоренная диагностика.',
      },
      {
        when: 'asccpBand >= 2',
        message:
          'Промежуточный уровень: маршрут зависит от предыдущих результатов и сроков; сверяйте полную таблицу ASCCP.',
      },
      {
        when: 'asccpBand == 1',
        message:
          'Низкий уровень в этой упрощённой навигации; соблюдайте возрастной скрининг и локальный протокол.',
      },
    ],
    warnings: [
      {
        code: 'asccp-not-absolute-risk',
        message:
          'Уровень не является процентом риска и не заменяет официальный ASCCP risk-based calculator.',
      },
    ],
    sources: [
      {
        title: 'Management Guidelines',
        publisher: 'ASCCP',
        version: 'Risk-based management',
        url: 'https://www.asccp.org/management-guidelines',
        reviewedAt: '2026-08-14',
      },
      {
        title: 'Updated Guidelines for Management of Cervical Cancer Screening Abnormalities',
        publisher: 'ACOG',
        version: '2020',
        url: 'https://www.acog.org/clinical/clinical-guidance/practice-advisory/articles/2020/10/updated-guidelines-for-management-of-cervical-cancer-screening-abnormalities',
        reviewedAt: '2026-08-14',
      },
    ],
  });

export const OBSTETRIC_SCHEMA_CATALOG: readonly CalculatorSchema[] = [
  OBSTETRIC_BISHOP_SCORE_SCHEMA,
  OBSTETRIC_GA_CRL_SCHEMA,
  OBSTETRIC_EDD_LMP_SCHEMA,
  OBSTETRIC_EDD_ULTRASOUND_SCHEMA,
  OBSTETRIC_EDD_CONCEPTION_SCHEMA,
  OBSTETRIC_EDD_QUICKENING_SCHEMA,
  OBSTETRIC_EDD_GIVEN_DATE_SCHEMA,
  OBSTETRIC_GA_FROM_EDD_SCHEMA,
  OBSTETRIC_MATERNITY_LEAVE_SCHEMA,
  OBSTETRIC_FETAL_GROWTH_DOPPLER_SCHEMA,
  OBSTETRIC_EFW_MATERNAL_ANTHROPOMETRY_SCHEMA,
  OBSTETRIC_EFW_RUDAKOV_SCHEMA,
  OBSTETRIC_VBAC_ANTEPARTUM_SCHEMA,
  OBSTETRIC_VBAC_ADMISSION_SCHEMA,
  GYNECOLOGY_BREAST_CANCER_RISK_SCHEMA,
  GYNECOLOGY_CERVICAL_CANCER_RISK_SCHEMA,
];
