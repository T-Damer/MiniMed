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
];
