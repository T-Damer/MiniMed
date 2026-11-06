/**
 * Builds the personality inventories from their transcribed sources (`content/tool-sources/`):
 *
 * - `content/tool-modules/mmpi.json` — СМИЛ (Russian MMPI by Л. Н. Собчик), men's and women's
 *   booklets: a module of its own (`minimed.tools.mmpi.ru`) so it can be withdrawn in one step;
 * - the IPIP 50-item Big-Five markers (public domain), Russian and English, placed into
 *   `content/tool-modules/psychology.json` (replacing earlier copies of the same ids).
 *
 * Every number comes from the source files; this script only turns them into definitions. Run
 * after editing a source file, bump the module versions, then `bun run tools:module:rebuild`:
 *
 *   bun scripts/build-personality-tools.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { AssessmentDefinitionSchema, ToolDefinitionRecordSchema } from '../packages/contracts/src';

const root = resolve(import.meta.dirname, '..');
const read = <T>(path: string): T => JSON.parse(readFileSync(join(root, path), 'utf8')) as T;

const MMPI_MODULE_VERSION = '0.1.0-preview.1';
const PSYCHOLOGY_MODULE_VERSION = '0.1.0-preview.10';
const REVIEWED_AT = '2026-11-06';

interface SmilItems {
  readonly items: Record<string, string>;
  readonly pdfPages: Record<string, [number, number]>;
}
interface SmilKeys {
  readonly scales: Record<string, { readonly true: number[]; readonly false: number[] }>;
}
interface SmilNorms {
  readonly kCorrection: {
    readonly table: Record<string, { '0.5': number; '0.4': number; '0.2': number }>;
  };
  readonly meansAndSds: { readonly values: Record<Sex, Record<string, [number, number]>> };
}
type Sex = 'male' | 'female';

const keys = read<SmilKeys>('content/tool-sources/smil-sobchik-2003/keys.json');
const norms = read<SmilNorms>('content/tool-sources/smil-sobchik-2003/norms.json');

const ANSWER_TRUE = 1;
const ANSWER_FALSE = 0;
const ANSWER_UNKNOWN = 2;

const itemId = (n: number): string => `smil-${String(n).padStart(3, '0')}`;
const answer = (n: number): string => `answer_smil_${String(n).padStart(3, '0')}`;

/** The 13 profile scales in the order of the profile sheet. */
const PROFILE = [
  { key: 'L', id: 'l', label: 'L — ложь', short: 'L', k: undefined },
  { key: 'F', id: 'f', label: 'F — достоверность', short: 'F', k: undefined },
  { key: 'K', id: 'k', label: 'K — коррекция', short: 'K', k: undefined },
  { key: '1', id: '1', label: '1 — невротический сверхконтроль (Hs)', short: '1', k: '0.5' },
  { key: '2', id: '2', label: '2 — пессимистичность (D)', short: '2', k: undefined },
  { key: '3', id: '3', label: '3 — эмоциональная лабильность (Hy)', short: '3', k: undefined },
  { key: '4', id: '4', label: '4 — импульсивность (Pd)', short: '4', k: '0.4' },
  { key: '5', id: '5', label: '5 — мужественность-женственность (Mf)', short: '5', k: undefined },
  { key: '6', id: '6', label: '6 — ригидность (Pa)', short: '6', k: undefined },
  { key: '7', id: '7', label: '7 — тревожность (Pt)', short: '7', k: '1' },
  { key: '8', id: '8', label: '8 — индивидуалистичность (Sc)', short: '8', k: '1' },
  { key: '9', id: '9', label: '9 — оптимистичность (Ma)', short: '9', k: '0.2' },
  { key: '0', id: '0', label: '0 — социальная интроверсия (Si)', short: '0', k: undefined },
] as const;

function keyFor(scale: string, sex: Sex): { readonly true: number[]; readonly false: number[] } {
  const entry = keys.scales[scale === '5' ? `5-${sex}` : scale];
  if (!entry) throw new Error(`No key for scale ${scale}`);
  return entry;
}

/** A raw score: one point for every item answered as the key says. */
function rawFormula(scale: string, sex: Sex): string {
  const key = keyFor(scale, sex);
  return [
    ...key.true.map((n) => `(${answer(n)} == ${ANSWER_TRUE})`),
    ...key.false.map((n) => `(${answer(n)} == ${ANSWER_FALSE})`),
  ].join(' + ');
}

/** The rounded fraction of K from the profile sheet's table, as a chain of conditions. */
function kFractionFormula(fraction: '0.5' | '0.4' | '0.2'): string {
  const rows = Object.entries(norms.kCorrection.table)
    .map(([k, values]) => [Number(k), values[fraction]] as const)
    .sort((left, right) => left[0] - right[0]);
  const highest = rows.at(-1);
  if (!highest) throw new Error('Empty K table');
  return rows
    .slice(0, -1)
    .reduceRight(
      (otherwise, [k, value]) => `cond(score_raw_k == ${k}, ${value}, ${otherwise})`,
      String(highest[1]),
    );
}

function tFormula(scale: string, sex: Sex, corrected: string): string {
  const pair = norms.meansAndSds.values[sex][scale];
  if (!pair) throw new Error(`No norm for ${sex} ${scale}`);
  const [mean, sd] = pair;
  // On the women's sheet scale 5 runs the other way: more points, lower T.
  const sign = scale === '5' && sex === 'female' ? '-' : '+';
  return `round(50 ${sign} 10 * (${corrected} - ${mean}) / ${sd})`;
}

const BOOK_URL = 'https://archive.org/details/2003-2025377-60613';
const PSYLAB_URL =
  'https://psylab.info/Стандартизированный_многофакторный_метод_исследования_личности/Ключи_к_тесту_СМИЛ';

const SMIL_INTRO =
  'Вам будет предъявлена целая серия разных утверждений. Оценивая каждое из них, не тратьте много времени на раздумья. Наиболее естественна — первая непосредственная реакция. Внимательно вчитывайтесь в текст, дочитывая до конца каждое утверждение и оценивая его все целиком как верное или неверное по отношению к Вам.\n\n' +
  'Обращайте внимание на утверждения с двойными отрицаниями: например, «У меня никогда не было припадков с судорогами». Если не было, то Ваш ответ — «Верно», и наоборот, если это с Вами было, то Ваш ответ — «Неверно».\n\n' +
  'Некоторые утверждения звучат так: «Номер данного пункта следует обвести кружочком». На них отвечайте «Не знаю» (это — для проверки Вашей внимательности).\n\n' +
  'Если некоторые утверждения вызывают большие сомнения, ориентируйтесь в Вашем ответе на то, что предположительно больше свойственно Вам. Если утверждение верно по отношению к Вам в одних ситуациях и неверно в других, остановитесь на том ответе, который больше подходит в настоящий момент. Лишь в крайнем случае, если утверждение к Вам вообще не подходит, отвечайте «Не знаю». Однако избыток таких ответов приведёт к недостоверности результатов.\n\n' +
  'Старайтесь отвечать искренно, иначе Ваши ответы будут распознаны как недостоверные и опрос придется повторить. Отвечая на разные пункты опросника, попытайтесь понять — «Какой (какая) я на самом деле?».';

const SMIL_LICENSE =
  'MMPI — S. R. Hathaway, J. C. McKinley (University of Minnesota, 1943); права на MMPI принадлежат Regents of the University of Minnesota (University of Minnesota Press; MMPI-2 и MMPI-3 распространяет Pearson). ' +
  'СМИЛ — русская адаптация и рестандартизация MMPI, автор Л. Н. Собчик (1968–1984). Утверждения мужского и женского вариантов, ключи, доли K и профильные листы — по изданию: Собчик Л. Н. Стандартизированный многофакторный метод исследования личности СМИЛ (MMPI): практическое руководство. СПб.: Речь, 2003, с. 142–216. ' +
  'Права на адаптацию принадлежат автору и издателю. MiniMed не автор методики: опросник включён по решению владельца приложения (2026-11-06) без отдельного разрешения правообладателей и будет удалён по их требованию.';

function smilDefinition(sex: Sex) {
  const items = read<SmilItems>(`content/tool-sources/smil-sobchik-2003/items.${sex}.json`);
  const numbers = Object.keys(items.items)
    .map(Number)
    .sort((left, right) => left - right);
  if (numbers.length !== 566 || numbers.some((n, index) => n !== index + 1)) {
    throw new Error(`${sex}: items must be 1–566`);
  }
  const circleItems = numbers.filter((n) =>
    /обвести кружочком/u.test(items.items[String(n)] ?? ''),
  );
  const men = sex === 'male';
  const id = men ? 'minimed.assessment.smil-men' : 'minimed.assessment.smil-women';
  const slug = men ? 'smil-men' : 'smil-women';
  const title = men ? 'СМИЛ (MMPI) — мужской вариант' : 'СМИЛ (MMPI) — женский вариант';
  const pages = Object.keys(items.pdfPages).map(Number);
  const pageNote = `PDF с. ${Math.min(...pages)}–${Math.max(...pages)}`;

  const scales: Record<string, unknown>[] = [
    {
      id: 'items',
      label: 'Ответы',
      shortLabel: 'Ответы',
      description: 'Все 566 утверждений; баллы считают шкалы ниже.',
      context: true,
    },
    {
      id: 'raw-q',
      label: '«?» — ответы «Не знаю»',
      shortLabel: '?',
      description:
        'Число ответов «Не знаю» (в бланке — обведённые номера), включая 27 контрольных пунктов.',
      formula: numbers.map((n) => `(${answer(n)} == ${ANSWER_UNKNOWN})`).join(' + '),
      hidden: true,
    },
    {
      id: 'missed-checks',
      label: 'Контрольные пункты не отмечены «Не знаю»',
      shortLabel: 'Контроль',
      description:
        'Пункты «Номер данного пункта следует обвести кружочком», на которые дан ответ «Верно» или «Неверно».',
      formula: circleItems.map((n) => `(${answer(n)} != ${ANSWER_UNKNOWN})`).join(' + '),
      hidden: true,
    },
  ];
  for (const scale of PROFILE) {
    scales.push({
      id: `raw-${scale.id}`,
      label: `${scale.label}: сырой балл`,
      shortLabel: scale.short,
      description: `Сумма совпадений с ключом шкалы ${scale.key} (Собчик, 2003, с. 142–144).`,
      formula: rawFormula(scale.key, sex),
      hidden: true,
    });
  }
  for (const fraction of ['0.5', '0.4', '0.2'] as const) {
    scales.push({
      id: `k-${fraction.replace('.', '')}`,
      label: `${fraction.replace('.', ',')}K`,
      shortLabel: `${fraction.replace('.', ',')}K`,
      description: 'Доля K по таблице профильного листа (с. 215–216).',
      formula: kFractionFormula(fraction),
      hidden: true,
    });
  }
  for (const scale of PROFILE) {
    const raw = `score_raw_${scale.id}`;
    const correction =
      scale.k === undefined
        ? undefined
        : scale.k === '1'
          ? 'score_raw_k'
          : `score_k_${scale.k.replace('.', '')}`;
    scales.push({
      id: `corr-${scale.id}`,
      label: `${scale.label}: с коррекцией K`,
      shortLabel: scale.short,
      description: correction
        ? `Сырой балл плюс ${scale.k === '1' ? '1,0' : scale.k?.replace('.', ',')}K.`
        : 'Без коррекции.',
      formula: correction ? `${raw} + ${correction}` : raw,
      hidden: true,
    });
  }
  for (const scale of PROFILE) {
    scales.push({
      id: `t-${scale.id}`,
      label: `${scale.label}: T-балл`,
      shortLabel: scale.short,
      description: 'T = 50 + 10·(X − M)/σ (Собчик, 2003, с. 20).',
      formula: tFormula(scale.key, sex, `score_corr_${scale.id}`),
      hidden: true,
    });
  }

  const definition = {
    schemaVersion: 2,
    id,
    slug,
    title,
    shortTitle: men ? 'СМИЛ, мужской' : 'СМИЛ, женский',
    aliases: [
      'СМИЛ',
      'MMPI',
      'ММPI',
      'Миннесотский многоаспектный личностный опросник',
      'стандартизированный многофакторный метод исследования личности',
      'Собчик',
      men ? 'СМИЛ мужской' : 'СМИЛ женский',
    ],
    bankId: 'psychology',
    bankLabel: 'Психология и психодиагностика',
    category: 'personality-inventory',
    description: `566 утверждений с ответами «Верно», «Неверно» и «Не знаю». Профиль по трём шкалам достоверности (L, F, K) и десяти базисным шкалам в T-баллах с коррекцией по K — по руководству Л. Н. Собчик (${men ? 'нормы мужчин' : 'нормы женщин'}).`,
    intro: SMIL_INTRO,
    estimatedMinutes: 90,
    audience: men
      ? 'Взрослые мужчины; заполняет сам обследуемый, профиль толкует психолог или психиатр'
      : 'Взрослые женщины; заполняет сама обследуемая, профиль толкует психолог или психиатр',
    ageScope: {
      groups: ['adults'],
      basis: `«Вариант ${men ? 'мужской' : 'женский'} взрослый» (Собчик, 2003); для подростков 13–15 лет в руководстве отдельный вариант.`,
    },
    responseOptions: [
      { value: ANSWER_TRUE, label: 'Верно', shortLabel: 'В' },
      { value: ANSWER_FALSE, label: 'Неверно', shortLabel: 'Н' },
      { value: ANSWER_UNKNOWN, label: 'Не знаю', shortLabel: '?' },
    ],
    pageSize: 20,
    answerSheet: true,
    variants: [
      { label: 'Мужской', assessmentId: 'minimed.assessment.smil-men', language: 'ru' },
      { label: 'Женский', assessmentId: 'minimed.assessment.smil-women', language: 'ru' },
    ],
    variantLabel: 'Вариант бланка',
    language: 'ru',
    scales,
    questions: numbers.map((n) => ({
      id: itemId(n),
      prompt: items.items[String(n)],
      scaleId: 'items',
    })),
    tallies: [
      {
        id: 'unknown',
        value: ANSWER_UNKNOWN,
        label: 'Не знаю',
        warnAt: 41,
        warning:
          'Больше 40 ответов «Не знаю»: по руководству 41–60 говорят о выраженной настороженности, больше 70 — результаты недостоверны. На 27 контрольных пунктов ответ «Не знаю» нужен; на остальные отвечайте «Верно» или «Неверно», когда это возможно.',
      },
    ],
    alerts: [
      {
        id: 'cannot-say-invalid',
        when: 'score_raw_q > 70',
        title: 'Больше 70 ответов «Не знаю»',
        message:
          'По руководству (с. 26) данные теста недостоверны; нужна беседа и повторное тестирование.',
      },
      {
        id: 'cannot-say-guarded',
        when: 'score_raw_q > 40',
        title: 'Много ответов «Не знаю»',
        message:
          'По руководству (с. 26) 41–60 «Не знаю» говорят о выраженной настороженности обследуемого.',
      },
      {
        id: 'lie-invalid',
        when: 'score_t_l >= 70',
        title: 'L 70T и выше: профиль недостоверен',
        message:
          'Стремление приукрасить себя, отрицая слабости, присущие любому человеку; по руководству (с. 27) нужно повторное тестирование после дополнительной беседы.',
      },
      {
        id: 'f-high',
        when: 'score_t_f > 70',
        title: 'F выше 70T',
        message:
          'По руководству (с. 27–28) достоверность под сомнением: возможны взволнованность, небрежность, тенденция к драматизации или выраженное напряжение. Нормативный разброс F достигает 80T; профили выше 80T не учитывают при обработке данных группы.',
      },
      {
        id: 'k-high',
        when: 'score_t_k >= 66',
        title: 'K 66T и выше',
        message:
          'По руководству (с. 28) — защитная установка: обследуемый не захотел откровенно рассказать о себе и демонстрирует социабельность.',
      },
      {
        id: 'missed-checks',
        when: 'score_missed_checks > 0',
        title: 'Не все контрольные пункты отмечены «Не знаю»',
        message:
          'На пункты «Номер данного пункта следует обвести кружочком» нужен ответ «Не знаю» (проверка внимательности, с. 19). Ответ «Верно» на многие из них засчитывается в шкалу F.',
      },
    ],
    interpretations: [
      {
        when: 'score_raw_q > 70',
        headline: 'Профиль недостоверен: слишком много ответов «Не знаю»',
        message: 'Т-баллы показаны для справки; по руководству такой профиль не толкуют.',
      },
      {
        when: 'score_t_l >= 70',
        headline: 'Профиль недостоверен по шкале L',
        message: 'Т-баллы показаны для справки; по руководству нужно повторное тестирование.',
      },
      {
        when: 'score_raw_q >= 0',
        headline: 'Профиль СМИЛ',
        message:
          'Т-баллы — в таблице и на графике. 50T — средненормативный уровень; от 30T до 70T — коридор нормы, выше 70T и ниже 30T — отклонение от нормы (с. 19–20). Профиль толкует специалист по руководству: в целом, по сочетанию шкал, а не по одной шкале.',
      },
    ],
    tables: [
      {
        id: 'profile',
        title: 'Шкалы профиля',
        columns: ['Сырой', '+K', 'T'],
        rows: PROFILE.map((scale) => ({
          label: scale.label,
          cells: [`score_raw_${scale.id}`, `score_corr_${scale.id}`, `score_t_${scale.id}`],
        })),
        caption:
          'Коррекция: +0,5K к 1-й, +0,4K к 4-й, +1K к 7-й и 8-й, +0,2K к 9-й шкале (с. 19). T = 50 + 10·(X − M)/σ; M и σ — в «Информации».',
      },
    ],
    visuals: [
      {
        id: 'smil_profile',
        title: 'Профиль СМИЛ',
        kind: 'line',
        labels: PROFILE.map((scale) => scale.short),
        datasets: [
          { label: 'T-баллы', data: PROFILE.map((scale) => `score_t_${scale.id}`), tone: 'accent' },
          { label: 'Граница нормы 70T', data: PROFILE.map(() => 70), tone: 'danger' },
          { label: 'Норма 50T', data: PROFILE.map(() => 50), tone: 'neutral' },
          { label: 'Граница нормы 30T', data: PROFILE.map(() => 30), tone: 'danger' },
        ],
        yAxis: { label: 'T', minimum: 20, maximum: 120 },
        caption: 'Пунктир: 50T — норма, 30T и 70T — границы нормативного коридора.',
        heightPx: 320,
      },
    ],
    disclaimer:
      'Профиль толкуют по руководству в целом, по сочетанию шкал. T-баллы посчитаны по формуле руководства и расходятся с бумажным профильным листом не больше чем на 1–2 балла.',
    evidenceNote:
      `Утверждения — «Вариант ${men ? 'мужской' : 'женский'} взрослый» (${pageNote} издания 2003 г.), переписаны со скана и сверены со вторым вариантом и копией psylab.info. Ключи L, F, K и шкал 1–0 (раздельные для 5-й шкалы у мужчин и женщин) — с. 142–144; число пунктов каждого ключа совпадает с напечатанным. ` +
      'Коррекция: доли K из таблицы профильного листа (с. 215–216); мужской лист даёт 0,2K = 5 при K = 29, женский — 6, взято 6. ' +
      'T = 50 + 10·(X − M)/σ (с. 20); числа M и σ базисных шкал книга не печатает (они заложены в профильные листы) — они получены прямой по отметкам сырых баллов обоих профильных листов (расхождение с любой отметкой ≤ 1,3T); таблица psylab.info расходится с листами до 3,8T и не используется. ' +
      `M и σ (${men ? 'мужчины' : 'женщины'}, по профильному листу): ${PROFILE.map((scale) => {
        const [mean, sd] = norms.meansAndSds.values[sex][scale.key] ?? [0, 0];
        return `${scale.short} ${String(mean).replace('.', ',')} / ${String(sd).replace('.', ',')}`;
      }).join('; ')}. ` +
      'Изменено для экрана: ответы кнопками вместо регистрационного листа; «обвести кружочком» = «Не знаю». В книге сказано о 26 контрольных пунктах, в бланке их 27.',
    evaluation: {
      status: 'not-applicable',
      rules: [],
      missingContext: [],
      reason:
        'Профиль СМИЛ толкует специалист по руководству; приложение считает баллы и не выносит заключения.',
      sourceIds: [`${slug}-sobchik-2003`],
    },
    license: { kind: 'third-party-attributed', notice: SMIL_LICENSE, sourceUrl: BOOK_URL },
  };
  const parsed = AssessmentDefinitionSchema.parse(definition);
  return ToolDefinitionRecordSchema.parse({
    id,
    kind: 'assessment',
    version: '1.0.0',
    slug,
    title,
    shortTitle: parsed.shortTitle,
    aliases: parsed.aliases,
    bankId: parsed.bankId,
    bankLabel: parsed.bankLabel,
    category: parsed.category,
    description: parsed.description,
    estimatedMinutes: parsed.estimatedMinutes,
    audience: parsed.audience,
    definition,
    sources: [
      {
        id: `${slug}-sobchik-2003`,
        kind: 'literature',
        relation: 'methodology',
        title:
          'Собчик Л. Н. Стандартизированный многофакторный метод исследования личности СМИЛ (MMPI). СПб.: Речь, 2003 (archive.org, SHA-256 6910f6df…3abe2)',
        url: BOOK_URL,
        reviewedAt: REVIEWED_AT,
      },
      {
        id: `${slug}-psylab-smil-keys`,
        kind: 'literature',
        relation: 'methodology',
        title: 'Psylab.info: Ключи к тесту СМИЛ (oldid 9619) — сверка ключей и таблицы M и σ',
        url: PSYLAB_URL,
        reviewedAt: REVIEWED_AT,
      },
    ],
  });
}

interface IpipSource {
  readonly anchors: { readonly en: string[]; readonly ru: string[] };
  readonly instruction: { readonly en: string; readonly ru: string };
  readonly factors: Record<string, [string, string]>;
  readonly items: readonly {
    readonly n: number;
    readonly factor: number;
    readonly keyed: '+' | '-';
    readonly en: string;
    readonly ru: string;
  }[];
}

function ipipDefinition(language: 'ru' | 'en') {
  const source = read<IpipSource>('content/tool-sources/ipip-bfm-50/items.json');
  const russian = language === 'ru';
  const id = russian ? 'minimed.assessment.ipip-bfm-50' : 'minimed.assessment.ipip-bfm-50-en';
  const slug = russian ? 'ipip-big-five-50' : 'ipip-big-five-50-en';
  const title = russian
    ? 'IPIP-50: «Большая пятёрка» (Big-Five Factor Markers)'
    : 'IPIP-50: Big-Five Factor Markers (English)';
  const factorIds = [
    'extraversion',
    'agreeableness',
    'conscientiousness',
    'emotional-stability',
    'intellect',
  ];
  const descriptions = [
    'Общительность, активность в компании, готовность быть в центре внимания.',
    'Интерес к людям, сочувствие, забота о других.',
    'Порядок, внимание к деталям, исполнение обязанностей.',
    'Спокойствие и устойчивость настроения (обратный полюс — нейротизм).',
    'Богатое воображение, интерес к идеям, быстрое понимание.',
  ];
  const definition = {
    schemaVersion: 2,
    id,
    slug,
    title,
    shortTitle: russian ? 'IPIP-50' : 'IPIP-50 (English)',
    aliases: [
      'IPIP',
      'Big Five',
      'Большая пятёрка',
      'пятифакторный опросник',
      'Goldberg',
      'Голдберг',
    ],
    bankId: 'psychology',
    bankLabel: 'Психология и психодиагностика',
    category: 'self-reflection',
    description: russian
      ? '50 утверждений International Personality Item Pool (общественное достояние): пять факторов личности — экстраверсия, доброжелательность, добросовестность, эмоциональная стабильность, интеллект. Открытая альтернатива большим коммерческим опросникам.'
      : 'Оригинальные английские утверждения International Personality Item Pool (общественное достояние): пять факторов личности, тот же подсчёт, что в русском варианте.',
    intro: russian ? source.instruction.ru : source.instruction.en,
    estimatedMinutes: 10,
    audience: 'Взрослые; самоотчёт, сравнение с самим собой и для беседы',
    ageScope: {
      groups: ['adults'],
      basis:
        'IPIP: «in relation to other people you know of the same sex as you are, and roughly your same age» — опросник для взрослых.',
    },
    responseOptions: (russian ? source.anchors.ru : source.anchors.en).map((label, index) => ({
      value: index + 1,
      label,
    })),
    variants: [
      { label: 'Русский', assessmentId: 'minimed.assessment.ipip-bfm-50', language: 'ru' },
      { label: 'English', assessmentId: 'minimed.assessment.ipip-bfm-50-en', language: 'en' },
    ],
    variantLabel: 'Язык',
    language,
    scales: factorIds.map((factorId, index) => {
      const names = source.factors[String(index + 1)] ?? ['', ''];
      return {
        id: factorId,
        label: names[0],
        shortLabel: names[0],
        description: `${names[1]}. ${descriptions[index]}`,
      };
    }),
    questions: source.items.map((item) => ({
      id: `ipip50-${String(item.n).padStart(2, '0')}`,
      prompt: russian ? item.ru : item.en,
      scaleId: factorIds[item.factor - 1],
      ...(item.keyed === '-' ? { reverse: true } : {}),
    })),
    disclaimer:
      'Сумма по каждому фактору (10–50) показывает выраженность черты в ответах этого человека; русский перевод не стандартизирован, популяционных норм нет.',
    evidenceNote:
      'Утверждения, их порядок, принадлежность к факторам и ключи (+/−) — IPIP «50-item sample questionnaire» (Goldberg, 1992; ipip.ori.org, проверено 06.11.2026). Русский перевод — O. Hypponen (страница переводов IPIP); IPIP не ручается за точность переводов. Изменено MiniMed: исправлены опечатки перевода (5 пунктов, перечислены в источниках модуля), запятые в вариантах ответа. Подсчёт: «+» пункты 1–5, «−» пункты 5–1.',
    evaluation: {
      status: 'not-applicable',
      rules: [],
      missingContext: [],
      reason:
        'У русского перевода IPIP-50 нет норм: баллы сравнивают с прошлыми заполнениями того же человека.',
      sourceIds: [`${slug}-ipip-50`],
    },
    license: {
      kind: 'public-domain-derived',
      notice:
        'International Personality Item Pool (L. R. Goldberg и соавт.): утверждения IPIP переданы в общественное достояние — использование для любых целей, коммерческих и некоммерческих, разрешено без запроса. Русский перевод — O. Hypponen, опубликован на сайте IPIP.',
      sourceUrl: 'https://ipip.ori.org/newPermission.htm',
    },
  };
  const parsed = AssessmentDefinitionSchema.parse(definition);
  return ToolDefinitionRecordSchema.parse({
    id,
    kind: 'assessment',
    version: '1.0.0',
    slug,
    title,
    shortTitle: parsed.shortTitle,
    aliases: parsed.aliases,
    bankId: parsed.bankId,
    bankLabel: parsed.bankLabel,
    category: parsed.category,
    description: parsed.description,
    estimatedMinutes: parsed.estimatedMinutes,
    audience: parsed.audience,
    definition,
    sources: [
      {
        id: `${slug}-ipip-50`,
        kind: 'literature',
        relation: 'methodology',
        title: 'IPIP: Administering IPIP Measures, with a 50-item Sample Questionnaire',
        url: 'https://ipip.ori.org/new_ipip-50-item-scale.htm',
        reviewedAt: REVIEWED_AT,
      },
      {
        id: `${slug}-ipip-50-ru`,
        kind: 'literature',
        relation: 'methodology',
        title:
          'IPIP: Russian Translation of the 50-Item Lexical Big-Five Factor Markers (O. Hypponen)',
        url: 'https://ipip.ori.org/Russian50-itemBigFiveFactorMarkers.htm',
        reviewedAt: REVIEWED_AT,
      },
    ],
  });
}

const mmpiModule = {
  id: 'minimed.tools.mmpi.ru',
  version: MMPI_MODULE_VERSION,
  title: 'СМИЛ (MMPI) — многофакторное исследование личности',
  schemaVersion: 2,
  builtAt: `${REVIEWED_AT}T00:00:00Z`,
  tools: [smilDefinition('male'), smilDefinition('female')],
};
writeFileSync(
  join(root, 'content/tool-modules/mmpi.json'),
  `${JSON.stringify(mmpiModule, null, 2)}\n`,
);

const psychologyPath = join(root, 'content/tool-modules/psychology.json');
const psychology = JSON.parse(readFileSync(psychologyPath, 'utf8')) as {
  version: string;
  tools: { id: string }[];
};
const ipip = [ipipDefinition('ru'), ipipDefinition('en')];
psychology.tools = [
  ...psychology.tools.filter((tool) => !ipip.some((record) => record.id === tool.id)),
  ...ipip,
];
psychology.version = PSYCHOLOGY_MODULE_VERSION;
writeFileSync(psychologyPath, `${JSON.stringify(psychology, null, 2)}\n`);
console.log(
  `mmpi.json: ${mmpiModule.tools.length} tools; psychology.json: ${psychology.tools.length} tools.`,
);
