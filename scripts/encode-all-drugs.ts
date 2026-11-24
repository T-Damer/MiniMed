#!/usr/bin/env bun
/**
 * Resumable local batch encoder for ALL prepared drug documents on disk using Inkling 2 Mini
 * (Atomic Engine, 16 GiB managed RAM budget on Apple Silicon Metal).
 *
 * Reads prepared Markdown instructions (never production SQLite packs), routes high-signal
 * clinical sections into the 4,096-token budget, runs grammar-constrained sparse JSON-schema
 * extraction via direct `<|content_text|>` prefill, and deterministically verifies every
 * extracted number against the source excerpt.
 *
 * Output (gitignored under data/build/drug-properties-inkling/):
 *   - drugs.jsonl    (append-only encoded records with full provenance & verification)
 *   - errors.jsonl   (failed docs for retry/audit)
 *   - progress.json  (live counters, tier progress, throughput, ETA)
 *   - STOP           (touch this file to stop cleanly after the current drug)
 *
 * Usage:
 *   bun scripts/encode-all-drugs.ts [--limit N] [--port 18082] [--out data/build/drug-properties-inkling]
 *                                   [--skip-allmed] [--no-manage-server]
 */
import { type ChildProcess, spawn } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, relative } from 'node:path';

type ServerMode = 'atomic' | 'batched';

interface CliOptions {
  readonly outDir: string;
  readonly port: number;
  readonly mode: ServerMode;
  readonly workers: number;
  readonly slotsPerServer: number;
  readonly budgetGib: number;
  readonly draftMax: number;
  readonly limit: number | null;
  readonly onlyIds: readonly string[] | null;
  readonly maxChars: number;
  readonly maxTokens: number;
  readonly includeAllmed: boolean;
  readonly manageServer: boolean;
}

function parseArgs(argv: readonly string[]): CliOptions {
  let outDir = 'data/build/drug-properties-inkling';
  let port = Number(process.env['INKLING_BATCH_PORT'] ?? '18082');
  let mode: ServerMode = process.env['INKLING_SERVER_MODE'] === 'batched' ? 'batched' : 'atomic';
  let workers = Number(process.env['INKLING_WORKERS'] ?? '1');
  let slotsPerServer = Number(process.env['INKLING_SLOTS'] ?? '1');
  let budgetGib = Number(process.env['INKLING_BUDGET_GIB'] ?? '16');
  let draftMax = Number(process.env['INKLING_DRAFT_MAX'] ?? '6');
  let limit: number | null = null;
  let onlyIds: string[] | null = null;
  let maxChars = Number(process.env['INKLING_MAX_CHARS'] ?? '5200');
  let maxTokens = Number(process.env['INKLING_MAX_TOKENS'] ?? '1400');
  let includeAllmed = true;
  let manageServer = true;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out' && argv[i + 1]) outDir = argv[++i] ?? outDir;
    else if (arg === '--port' && argv[i + 1]) port = Number(argv[++i]);
    else if (arg === '--mode' && argv[i + 1]) {
      const m = argv[++i];
      if (m !== 'atomic' && m !== 'batched') throw new Error(`Invalid --mode "${m}"`);
      mode = m;
    } else if (arg === '--workers' && argv[i + 1]) workers = Math.max(1, Number(argv[++i]));
    else if (arg === '--slots' && argv[i + 1]) slotsPerServer = Math.max(1, Number(argv[++i]));
    else if (arg === '--budget-gib' && argv[i + 1]) budgetGib = Math.max(8, Number(argv[++i]));
    else if (arg === '--draft-max' && argv[i + 1]) draftMax = Math.max(1, Number(argv[++i]));
    else if (arg === '--limit' && argv[i + 1]) limit = Number(argv[++i]);
    else if (arg === '--only' && argv[i + 1]) {
      onlyIds = (argv[++i] ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (arg === '--max-chars' && argv[i + 1]) maxChars = Number(argv[++i]);
    else if (arg === '--max-tokens' && argv[i + 1]) maxTokens = Number(argv[++i]);
    else if (arg === '--skip-allmed') includeAllmed = false;
    else if (arg === '--no-manage-server') manageServer = false;
  }

  return {
    outDir,
    port,
    mode,
    workers,
    slotsPerServer: mode === 'atomic' ? 1 : slotsPerServer,
    budgetGib,
    draftMax,
    limit,
    onlyIds,
    maxChars,
    maxTokens,
    includeAllmed,
    manageServer,
  };
}

interface DrugDocEntry {
  readonly id: string;
  readonly path: string;
  readonly sourceDir: string;
  readonly sourceType: string;
  readonly sourceChecksum: string;
  readonly title: string;
  readonly inn: string;
  readonly tradeName: string;
  readonly dosageForm: string;
  readonly qualityScore: number;
  readonly isOhlp: boolean;
  readonly precedence: number;
  tier: 1 | 2 | 3;
}

const OFFICIAL_SOURCE_DIRS: readonly { readonly dir: string; readonly recursive: boolean }[] = [
  { dir: 'data/intermediate/grls-full-final', recursive: false },
  { dir: 'data/intermediate/grls-ocr-cleaned', recursive: false },
  { dir: 'data/intermediate/grls-garbled-fix', recursive: false },
  { dir: 'data/intermediate/grls-render-repair', recursive: false },
  { dir: 'data/intermediate/grls-g1-additions', recursive: false },
  { dir: 'data/intermediate/grls-g1-additions-2', recursive: false },
  { dir: 'data/intermediate/grls-herbal-additions', recursive: false },
  { dir: 'data/intermediate/vaccine-instructions-2026', recursive: false },
  { dir: 'data/intermediate/eaeu-sister-instructions', recursive: true },
  { dir: 'data/intermediate/manufacturer-instructions-m1', recursive: true },
];

const ALLMED_DIR = 'data/intermediate/allmed-medications';

function walkMarkdownFiles(rootDir: string, recursive: boolean): string[] {
  if (!existsSync(rootDir)) return [];
  const results: string[] = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (recursive) stack.push(full);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        results.push(full);
      }
    }
  }
  results.sort();
  return results;
}

function unquoteYaml(raw: string | undefined): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  if (trimmed === '~' || trimmed === 'null') return '';
  return trimmed.replace(/^['"]|['"]$/gu, '').trim();
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replaceAll(/\s+/gu, ' ').trim();
}

function dosageFormBucket(form: string): string {
  const f = normalizeKey(form);
  if (!f) return 'unknown';
  if (/таблет|капсул|драже|пастил|гранул/u.test(f)) return 'oral_solid';
  if (/сироп|суспенз|капли для приема|раствор для приема/u.test(f)) return 'oral_liquid';
  if (/инъекц|инфуз|лиофилизат|концентрат для приготовления раствора/u.test(f)) return 'parenteral';
  if (/ингаляц|аэрозоль/u.test(f)) return 'inhaled';
  if (/спрей|назальн|глазн|ушн/u.test(f)) return 'ent_eye';
  if (/мазь|крем|гель|наружн|пластыр|лосьон/u.test(f)) return 'topical';
  if (/суппозитор|ректальн|вагинальн/u.test(f)) return 'suppository';
  return f.slice(0, 24);
}

function discoverDrugCorpus(includeAllmed: boolean): DrugDocEntry[] {
  const byId = new Map<string, DrugDocEntry>();

  const ingestFile = (filePath: string, sourceDir: string, precedence: number): void => {
    const head = readFileSync(filePath, 'utf8').slice(0, 2200);
    const id = unquoteYaml(head.match(/^id:\s*(.+)$/mu)?.[1]) || basename(filePath, '.md');
    const title = unquoteYaml(head.match(/^title:\s*(.+)$/mu)?.[1]) || id;
    const sourceType = unquoteYaml(head.match(/^source_type:\s*(.+)$/mu)?.[1]) || 'unknown';
    const sourceChecksum = unquoteYaml(head.match(/^source_checksum:\s*(.+)$/mu)?.[1]) || '';
    const inn = unquoteYaml(head.match(/^\s+inn:\s*(.+)$/mu)?.[1]);
    const tradeName = unquoteYaml(head.match(/^\s+tradeName:\s*(.+)$/mu)?.[1]) || title;
    const dosageForm = unquoteYaml(head.match(/^\s+dosageForm:\s*(.+)$/mu)?.[1]);
    const qualityRaw = Number(head.match(/^\s+qualityScore:\s*([0-9.]+)/mu)?.[1] ?? '0.8');
    const qualityScore = Number.isFinite(qualityRaw) ? qualityRaw : 0.8;
    const isOhlp =
      /documentKind:\s*ohlp/iu.test(head) ||
      /общая характеристика лекарственного препарата/iu.test(title);

    byId.set(id, {
      id,
      path: filePath,
      sourceDir,
      sourceType,
      sourceChecksum,
      title,
      inn,
      tradeName,
      dosageForm,
      qualityScore,
      isOhlp,
      precedence,
      tier: 3,
    });
  };

  OFFICIAL_SOURCE_DIRS.forEach(({ dir, recursive }, index) => {
    for (const filePath of walkMarkdownFiles(dir, recursive)) {
      ingestFile(filePath, dir, index + 1);
    }
  });

  if (includeAllmed) {
    for (const filePath of walkMarkdownFiles(ALLMED_DIR, false)) {
      ingestFile(filePath, ALLMED_DIR, 0);
    }
  }

  const all = [...byId.values()];
  const official = all.filter((doc) => doc.sourceDir !== ALLMED_DIR);
  const allmed = all.filter((doc) => doc.sourceDir === ALLMED_DIR);

  // Pick one highest-quality representative per (INN, dosageFormBucket) for Tier 1 so all ~2,100+
  // active substances and dosage forms are covered first before manufacturer variants.
  const bestByGroup = new Map<string, DrugDocEntry>();
  const rankDoc = (doc: DrugDocEntry): number =>
    (doc.isOhlp ? 100 : 0) + doc.precedence * 5 + doc.qualityScore * 10;

  for (const doc of official) {
    const key = doc.inn
      ? `${normalizeKey(doc.inn)}::${dosageFormBucket(doc.dosageForm)}`
      : `noinn::${doc.id}`;
    const existing = bestByGroup.get(key);
    if (!existing || rankDoc(doc) > rankDoc(existing)) {
      bestByGroup.set(key, doc);
    }
  }

  const tier1Ids = new Set([...bestByGroup.values()].map((d) => d.id));
  const tier1: DrugDocEntry[] = [];
  const tier2: DrugDocEntry[] = [];
  for (const doc of official) {
    if (tier1Ids.has(doc.id)) {
      doc.tier = 1;
      tier1.push(doc);
    } else {
      doc.tier = 2;
      tier2.push(doc);
    }
  }
  const tier3: DrugDocEntry[] = allmed.map((doc) => {
    doc.tier = 3;
    return doc;
  });

  // Sort deterministically within each tier: single-ingredient Cyrillic INNs first (most clinically
  // useful core formulary), then combinations/bracketed herbal extracts, then INN-less tail.
  const innRank = (inn: string): number => {
    if (!inn) return 3;
    if (/^[А-ЯЁA-Z]/iu.test(inn) && !inn.includes('+')) return 0;
    if (/^[А-ЯЁA-Z]/iu.test(inn)) return 1;
    return 2;
  };
  const sortDocs = (list: DrugDocEntry[]): DrugDocEntry[] =>
    list.sort((a, b) => {
      const ra = innRank(a.inn);
      const rb = innRank(b.inn);
      if (ra !== rb) return ra - rb;
      return a.inn.localeCompare(b.inn, 'ru') || a.id.localeCompare(b.id);
    });

  return [...sortDocs(tier1), ...sortDocs(tier2), ...sortDocs(tier3)];
}

/**
/**
 * Hybrid typed drug properties schema:
 * - Top-level clinical properties are REQUIRED (nullable when absent) so GBNF grammar forces the
 *   model to check every key (ATC, Rx, strengths, age, pregnancy, lactation, organs, driving,
 *   storage, PK, regimens) instead of skipping optional keys under greedy decoding.
 * - Inner `regimens[]` and `pk` fields remain SPARSE (optional) so per-regimen output stays tiny.
 * - Text lists carry `maxItems` caps so multi-indication drugs never hit the token ceiling.
 */
const DRUG_SPARSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'inn',
    'trade_name',
    'atc',
    'dosage_form',
    'route',
    'food',
    'rx',
    'strengths',
    'min_age_y',
    'max_age_y',
    'pregnancy',
    'lactation',
    'driving',
    'renal_adj',
    'hepatic_adj',
    'storage_max_c',
    'pk',
    'regimens',
    'indications',
    'contraindications',
    'avoid_with',
    'monitoring',
  ],
  properties: {
    inn: { type: 'string' },
    trade_name: { type: 'string' },
    atc: { type: ['string', 'null'] },
    dosage_form: { type: ['string', 'null'] },
    route: {
      type: 'string',
      enum: [
        'oral',
        'iv',
        'im',
        'sc',
        'inhaled',
        'topical',
        'rectal',
        'vaginal',
        'eye_ear_nose',
        'sublingual',
        'other',
      ],
    },
    food: {
      type: ['string', 'null'],
      enum: ['independent', 'with_food', 'before_food', 'after_food', null],
    },
    rx: { type: ['boolean', 'null'] },
    strengths: {
      type: 'array',
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['v', 'u'],
        properties: {
          v: { type: 'number' },
          u: {
            type: 'string',
            enum: [
              'mg',
              'mcg',
              'g',
              'ml',
              'iu',
              'u',
              'pct',
              'mmol',
              'mg_ml',
              'mcg_dose',
              'drops',
              'other',
            ],
          },
        },
      },
    },
    min_age_y: { type: ['number', 'null'] },
    max_age_y: { type: ['number', 'null'] },
    pregnancy: {
      type: ['string', 'null'],
      enum: ['allowed', 'caution', 'trimester_restricted', 'contraindicated', null],
    },
    lactation: {
      type: ['string', 'null'],
      enum: ['allowed', 'caution', 'contraindicated', null],
    },
    driving: {
      type: ['string', 'null'],
      enum: ['none', 'caution', 'avoid', null],
    },
    renal_adj: {
      type: ['string', 'null'],
      enum: ['none', 'reduce', 'contraindicated', null],
    },
    hepatic_adj: {
      type: ['string', 'null'],
      enum: ['none', 'reduce', 'contraindicated', null],
    },
    storage_max_c: { type: ['number', 'null'] },
    pk: {
      type: ['object', 'null'],
      additionalProperties: false,
      properties: {
        t_half_min_h: { type: 'number' },
        t_half_max_h: { type: 'number' },
        tmax_min_h: { type: 'number' },
        tmax_max_h: { type: 'number' },
        bioavail_pct: { type: 'number' },
        protein_bind_pct: { type: 'number' },
        renal_excr_pct: { type: 'number' },
        cyp: { type: 'array', maxItems: 6, items: { type: 'string' } },
        active_metabolite: { type: 'boolean' },
      },
    },
    regimens: {
      type: 'array',
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'ind',
          'pop',
          'age_min_y',
          'd_min',
          'd_max',
          'u',
          'per_kg',
          'freq_min',
          'freq_max',
          'interval_d',
          'max_day',
          'dur_min_d',
          'dur_max_d',
        ],
        properties: {
          ind: { type: 'string' },
          pop: { type: ['string', 'null'], enum: ['adult', 'child', 'elderly', 'all', null] },
          age_min_y: { type: ['number', 'null'] },
          d_min: { type: ['number', 'null'] },
          d_max: { type: ['number', 'null'] },
          u: {
            type: ['string', 'null'],
            enum: [
              'mg',
              'mcg',
              'g',
              'ml',
              'iu',
              'u',
              'drops',
              'puffs',
              'tab',
              'caps',
              'supp',
              'sachet',
              null,
            ],
          },
          per_kg: { type: 'boolean' },
          freq_min: { type: ['number', 'null'] },
          freq_max: { type: ['number', 'null'] },
          interval_d: { type: ['number', 'null'] },
          max_day: { type: ['number', 'null'] },
          dur_min_d: { type: ['number', 'null'] },
          dur_max_d: { type: ['number', 'null'] },
        },
      },
    },
    indications: { type: 'array', maxItems: 6, items: { type: 'string' } },
    contraindications: { type: 'array', maxItems: 8, items: { type: 'string' } },
    avoid_with: { type: 'array', maxItems: 8, items: { type: 'string' } },
    monitoring: { type: 'array', maxItems: 4, items: { type: 'string' } },
  },
} as const;

const SYSTEM_PROMPT =
  'Ты экстрактор строго типизированных свойств лекарств. Извлекай ТОЛЬКО факты, явно указанные в тексте; ничего не выдумывай. Для отсутствующих верхнеуровневых полей ставь null (или [] для массивов); внутри regimens и pk опускай отсутствующие поля (НЕ пиши 1 или drops по умолчанию). В indications/contraindications/avoid_with/monitoring пиши КОРОТКИЕ термины (2–6 слов, без предложений).\n' +
  'Правила: atc = код АТХ (напр. N05BX); rx = true (по рецепту) / false (без рецепта); strengths = ТОЛЬКО дозировка/концентрация выпуска (напр. 5 мг/мл -> {v:5,u:"mg_ml"}, 25 мг -> {v:25,u:"mg"}), НЕ дозы приёма; min_age_y = мин. разрешённый возраст в годах (до 18 лет противопоказан -> 18, до 3 мес -> 0.25); max_age_y = только если запрещён старше возраста (обычно null); pregnancy/lactation/driving/renal_adj/hepatic_adj/storage_max_c/pk заполняй всегда, если есть в тексте; regimens = схемы дозирования (freq_min/freq_max = раз В СУТКИ, freq_min<=freq_max; при введении раз в N дней/недель используй interval_d).';

function prepareDrugExcerpt(
  raw: string,
  maxChars: number,
): { excerpt: string; sectionsUsed: string[] } {
  const fmMatch = /^---\n([\s\S]*?)\n---\s*/u.exec(raw);
  const fmLines = fmMatch?.[1]
    ? fmMatch[1]
        .split('\n')
        .filter((l) => /^(id|title):|\s+(tradeName|inn|dosageForm|nameLat):/u.test(l))
        .join('\n')
    : '';

  const body = raw
    .replace(/^---[\s\S]*?---\s*/u, '')
    .replace(/<!--[\s\S]*?-->\s*/gu, '')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();

  if (fmLines.length + body.length + 2 <= maxChars) {
    return {
      excerpt: fmLines ? `${fmLines}\n\n${body}` : body,
      sectionsUsed: ['full'],
    };
  }

  const headings = [...body.matchAll(/^#{1,3} .+$/gmu)];
  if (headings.length === 0) {
    const combined = fmLines ? `${fmLines}\n\n${body}` : body;
    return { excerpt: combined.slice(0, maxChars), sectionsUsed: ['head'] };
  }

  const sections = headings.map((m, idx) => {
    const start = m.index ?? 0;
    const end = headings[idx + 1]?.index ?? body.length;
    return { heading: m[0], text: body.slice(start, end).trim() };
  });

  // High-signal clinical section slots: matches structured headings when the PDF has >2 headings,
  // and always falls back to inline regex extraction for flat-heading GRLS PDFs (e.g. 1 heading).
  const slots: readonly {
    readonly name: string;
    readonly headingPattern: RegExp;
    readonly inlinePattern: RegExp;
    readonly stopPattern?: RegExp;
    readonly cap: number;
  }[] = [
    {
      name: 'composition',
      headingPattern:
        /общая информация|карточка препарата|состав|лекарственная форма|инструкция|торговое наименование/iu,
      inlinePattern: /(?:Торговое наименование|Состав|Лекарственная форма)/iu,
      stopPattern: /Фармакодинамика|Показания к применению|Перед приемом препарата/iu,
      cap: 550,
    },
    {
      name: 'dosing',
      headingPattern:
        /способ применения и дозы|прием препарата|применение препарата|режим дозирования/iu,
      inlinePattern:
        /(?:Способ применения и дозы|Режим дозирования|Рекомендуемая доза|3\.\s*При[её]м препарата|3\.\s*Применение препарата)/iu,
      stopPattern: /Побочное действие|Возможные нежелательные реакции|Передозировка/iu,
      cap: 1600,
    },
    {
      name: 'indications',
      headingPattern: /показания|что из себя представляет/iu,
      inlinePattern: /Показания к применению/iu,
      stopPattern: /Противопоказания/iu,
      cap: 500,
    },
    {
      name: 'contraindications',
      headingPattern: /противопоказания/iu,
      inlinePattern: /Противопоказания/iu,
      stopPattern:
        /С осторожностью|Применение при беременности|Особые указания|Способ применения/iu,
      cap: 650,
    },
    {
      name: 'pregnancy',
      headingPattern:
        /беременность|грудное вскармливание|фертильность|применение при беременности/iu,
      inlinePattern:
        /(?:Применение при беременности|Беременность и грудное вскармливание|Беременность,\s*грудное)/iu,
      stopPattern: /Способ применения|Управление транспорт|Влияние на способность/iu,
      cap: 380,
    },
    {
      name: 'pk',
      headingPattern: /фармакокинет/iu,
      inlinePattern: /Фармакокинетика/iu,
      stopPattern: /Показания к применению|Противопоказания/iu,
      cap: 480,
    },
    {
      name: 'interactions',
      headingPattern: /взаимодействие|другие препараты/iu,
      inlinePattern: /(?:Взаимодействие с другими лекарственными|Другие препараты и препарат)/iu,
      stopPattern: /Особые указания|Влияние на способность|Форма выпуска/iu,
      cap: 420,
    },
    {
      name: 'driving',
      headingPattern: /управление транспорт|влияние на способность/iu,
      inlinePattern: /(?:Влияние на способность управлять|Управление транспортными средствами)/iu,
      stopPattern: /Форма выпуска|Условия хранения|Срок годности/iu,
      cap: 220,
    },
    {
      name: 'storage',
      headingPattern: /хранение|условия хранения/iu,
      inlinePattern: /(?:Условия хранения|5\.\s*Хранение)/iu,
      stopPattern: /Срок годности|Условия отпуска|Производитель|Владелец/iu,
      cap: 180,
    },
  ];

  const picked: string[] = [];
  const sectionsUsed: string[] = [];
  const usedHeadingIdx = new Set<number>();
  let budget = maxChars - fmLines.length - 160;

  for (const slot of slots) {
    if (budget < 80) break;
    let matched = false;
    if (sections.length > 2) {
      for (let i = 0; i < sections.length; i += 1) {
        if (usedHeadingIdx.has(i)) continue;
        const sec = sections[i];
        if (!sec || !slot.headingPattern.test(sec.heading)) continue;
        usedHeadingIdx.add(i);
        let text = sec.text;
        const boilerIdx = text.indexOf('Перед приемом препарата полностью прочитайте');
        if (boilerIdx > 0) text = text.slice(0, boilerIdx).trim();
        const sliceCap = Math.min(slot.cap, budget);
        if (text.length > sliceCap) text = `${text.slice(0, sliceCap)}…`;
        picked.push(text);
        sectionsUsed.push(slot.name);
        budget -= text.length + 2;
        matched = true;
        break;
      }
    }
    if (!matched) {
      const m = slot.inlinePattern.exec(body);
      if (m && m.index >= 0) {
        let slice = body.slice(m.index, m.index + Math.min(slot.cap, budget));
        if (slot.stopPattern) {
          const stopMatch = slot.stopPattern.exec(slice.slice(m[0].length));
          if (stopMatch && stopMatch.index > 20) {
            slice = slice.slice(0, m[0].length + stopMatch.index);
          }
        }
        slice = slice.trim();
        if (slice.length > 0) {
          picked.push(slice);
          sectionsUsed.push(`inline:${slot.name}`);
          budget -= slice.length + 2;
        }
      }
    }
  }

  // Always check for ATC code & Rx/OTC dispensing status anywhere in body.
  const atcMatch = body.match(/Код АТХ[:\s]+([A-Z]\d{2}[A-Z]{0,2}\d{0,2})/iu)?.[0];
  if (atcMatch && !picked.some((p) => p.includes(atcMatch))) {
    picked.push(atcMatch);
  }
  const rxMatch = body.match(/(?:Категория отпуска|Условия отпуска)[\s\S]{0,100}/iu)?.[0]?.trim();
  if (rxMatch && !picked.some((p) => p.includes(rxMatch.slice(0, 25)))) {
    picked.push(rxMatch);
  }

  if (picked.length === 0) {
    picked.push(body.slice(0, Math.max(400, budget)));
    sectionsUsed.push('fallback_head');
  }

  const combined = fmLines ? `${fmLines}\n\n${picked.join('\n\n')}` : picked.join('\n\n');
  return {
    excerpt: combined.length > maxChars ? combined.slice(0, maxChars) : combined,
    sectionsUsed,
  };
}

/**
 * Deterministic source-number verifier: extracts every numeric value from the LLM JSON output
 * and checks whether it (or a trivial unit equivalent like 1000 mg <-> 1 g or 1-2 weeks <-> 7 days)
 * actually occurs in the source text. Any unmatched number is explicitly flagged for review.
 */
function collectNumbers(
  value: unknown,
  pathPrefix = '',
  out: { path: string; num: number }[] = [],
): { path: string; num: number }[] {
  if (typeof value === 'number' && Number.isFinite(value)) {
    out.push({ path: pathPrefix, num: value });
  } else if (Array.isArray(value)) {
    for (let idx = 0; idx < value.length; idx += 1) {
      collectNumbers(value[idx], `${pathPrefix}[${idx}]`, out);
    }
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      collectNumbers(v, pathPrefix ? `${pathPrefix}.${k}` : k, out);
    }
  }
  return out;
}

function buildSourceNumberSet(sourceText: string): Set<number> {
  const nums = new Set<number>();
  // Match integers and decimals (with dot or Russian comma), including thousands separated by space.
  const matches = sourceText.matchAll(
    /(?<![A-Za-zА-Яа-я0-9])(\d{1,3}(?:[\s\u00a0]\d{3})+|\d+(?:[.,]\d+)?)(?![A-Za-zА-Яа-я0-9])/gu,
  );
  for (const m of matches) {
    const raw = m[1];
    if (!raw) continue;
    const normalized = raw.replaceAll(/[\s\u00a0]/gu, '').replace(',', '.');
    const n = Number(normalized);
    if (!Number.isFinite(n)) continue;
    nums.add(n);
    // Unit conversions (g <-> mg, mg <-> mcg, weeks <-> days, hours <-> freq/day)
    if (n > 0 && n <= 10) nums.add(Number((n * 1000).toFixed(4)));
    if (n >= 100 && n % 10 === 0) nums.add(Number((n / 1000).toFixed(4)));
    if (n >= 1 && n <= 12) nums.add(n * 7);
    if (n === 4 || n === 6 || n === 8 || n === 12 || n === 24) nums.add(24 / n);
  }
  // Russian word numerals common in dosing ("один раз", "два раза", "три раза", "четыре раза")
  if (/\bодин\s+раз|\bоднократно|\b1\s*раз/iu.test(sourceText)) nums.add(1);
  if (/\bдва\s+раза|\bдвукратно|\bдважды/iu.test(sourceText)) nums.add(2);
  if (/\bтри\s+раза|\bтрехкратно|\bтрижды/iu.test(sourceText)) nums.add(3);
  if (/\bчетыре\s+раза|\bчетырехкратно/iu.test(sourceText)) nums.add(4);
  if (/\bнедел/iu.test(sourceText)) {
    nums.add(7);
    nums.add(14);
  }
  return nums;
}

interface VerificationResult {
  readonly json_valid: boolean;
  readonly total_numbers: number;
  readonly verified_numbers: number;
  readonly unverified_numbers: readonly { readonly path: string; readonly value: number }[];
  readonly sanity_warnings: readonly string[];
  readonly number_match_pct: number;
  readonly status: 'verified' | 'needs_review' | 'error';
}

function checkClinicalSanity(parsed: Record<string, unknown>): string[] {
  const warnings: string[] = [];
  const route = parsed['route'];
  const regimens = Array.isArray(parsed['regimens']) ? parsed['regimens'] : [];
  for (let i = 0; i < regimens.length; i += 1) {
    const r = regimens[i] as Record<string, unknown>;
    if (!r || typeof r !== 'object') continue;
    const pairs: readonly [string, string][] = [
      ['d_min', 'd_max'],
      ['freq_min', 'freq_max'],
      ['age_min_y', 'age_max_y'],
      ['wt_min_kg', 'wt_max_kg'],
      ['dur_min_d', 'dur_max_d'],
    ];
    for (const [lo, hi] of pairs) {
      if (typeof r[lo] === 'number' && typeof r[hi] === 'number' && r[lo] > r[hi]) {
        warnings.push(`regimens[${i}].${lo}(${r[lo]})>${hi}(${r[hi]})`);
      }
    }
    if (
      (route === 'iv' || route === 'im' || route === 'sc') &&
      (r['u'] === 'drops' || r['max_day_u'] === 'drops')
    ) {
      warnings.push(`regimens[${i}]:drops_on_${String(route)}`);
    }
  }
  return warnings;
}

function verifyExtractedRecord(parsed: unknown, sourceText: string): VerificationResult {
  if (!parsed || typeof parsed !== 'object') {
    return {
      json_valid: false,
      total_numbers: 0,
      verified_numbers: 0,
      unverified_numbers: [],
      sanity_warnings: [],
      number_match_pct: 0,
      status: 'error',
    };
  }
  const sourceNums = buildSourceNumberSet(sourceText);
  const extracted = collectNumbers(parsed);
  const unverified: { path: string; value: number }[] = [];
  for (const item of extracted) {
    if (!sourceNums.has(item.num)) {
      unverified.push({ path: item.path, value: item.num });
    }
  }
  const sanityWarnings = checkClinicalSanity(parsed as Record<string, unknown>);
  const total = extracted.length;
  const verified = total - unverified.length;
  const pct = total === 0 ? 100 : Number(((verified / total) * 100).toFixed(1));
  return {
    json_valid: true,
    total_numbers: total,
    verified_numbers: verified,
    unverified_numbers: unverified,
    sanity_warnings: sanityWarnings,
    number_match_pct: pct,
    status: unverified.length === 0 && sanityWarnings.length === 0 ? 'verified' : 'needs_review',
  };
}

class ManagedInklingServer {
  private child: ChildProcess | null = null;
  constructor(
    readonly port: number,
    private readonly logPath: string,
    private readonly mode: ServerMode,
    private readonly slots: number,
    private readonly budgetGib: number,
    private readonly draftMax: number,
    private readonly threads: number,
  ) {}

  async isHealthy(): Promise<boolean> {
    try {
      const res = await fetch(`http://127.0.0.1:${this.port}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async ensureRunning(): Promise<void> {
    if (await this.isHealthy()) return;
    await this.stop();
    const bin = 'data/tools/atomic-engine/build-metal-release/bin/llama-server';
    const model = 'data/models/inkling-2-mini/Inkling-2-Mini-AD-IQ2_M.gguf';
    const draft = 'data/models/inkling-2-mini/dspark-Inkling-2-Mini-Q8_0.gguf';

    const args =
      this.mode === 'batched'
        ? [
            '-m',
            model,
            '-c',
            String(this.slots * 4096),
            '-np',
            String(this.slots),
            '-b',
            '4096',
            '-ub',
            '1024',
            '-fa',
            'on',
            '-ctk',
            'q4_0',
            '-ctv',
            'q4_0',
            '-ngl',
            'all',
            '-t',
            String(this.threads),
            '-tb',
            String(this.threads),
            '--temp',
            '0',
            '--cache-ram',
            '4096',
            '--no-warmup',
            '--metrics',
            '--host',
            '127.0.0.1',
            '--port',
            String(this.port),
          ]
        : [
            '-m',
            model,
            '-md',
            draft,
            '--spec-type',
            'draft-dspark',
            '--spec-draft-n-max',
            String(this.draftMax),
            '--spec-draft-n-ubatch',
            '32',
            '--engine-budget-mib',
            String(this.budgetGib * 1024 + 100),
            '-fit',
            'off',
            '-c',
            '4096',
            '-b',
            '1024',
            '-ub',
            '1024',
            '-np',
            '1',
            '-fa',
            'on',
            '-ctk',
            'q4_0',
            '-ctv',
            'q4_0',
            '-ctkd',
            'q4_0',
            '-ctvd',
            'q4_0',
            '-ngl',
            'all',
            '-ngld',
            '99',
            '-t',
            String(this.threads),
            '-tb',
            String(this.threads),
            '--temp',
            '0',
            '--cache-ram',
            '0',
            '--ctx-checkpoints',
            '0',
            '--no-warmup',
            '--metrics',
            '--host',
            '127.0.0.1',
            '--port',
            String(this.port),
          ];

    const child = spawn(bin, args, {
      env: {
        PATH: process.env['PATH'] ?? '/usr/bin:/bin:/opt/homebrew/bin',
        HOME: process.env['HOME'] ?? '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.child = child;
    child.stdout?.on('data', (chunk: Buffer) => appendFileSync(this.logPath, chunk));
    child.stderr?.on('data', (chunk: Buffer) => appendFileSync(this.logPath, chunk));

    for (let i = 0; i < 90; i += 1) {
      if (child.exitCode !== null) {
        throw new Error(
          `llama-server exited early with code ${child.exitCode}; see ${this.logPath}`,
        );
      }
      if (await this.isHealthy()) return;
      await Bun.sleep(1000);
    }
    throw new Error(`llama-server failed healthcheck on port ${this.port} after 90s`);
  }

  async stop(): Promise<void> {
    if (!this.child) return;
    const child = this.child;
    this.child = null;
    try {
      child.kill('SIGTERM');
    } catch {
      return;
    }
    for (let i = 0; i < 20; i += 1) {
      if (child.exitCode !== null) return;
      await Bun.sleep(250);
    }
    try {
      child.kill('SIGKILL');
    } catch {
      // already gone
    }
  }
}

async function encodeSingleDrug(
  baseUrl: string,
  doc: DrugDocEntry,
  maxChars: number,
  maxTokens: number,
  cachePrompt: boolean,
): Promise<{
  readonly record: Record<string, unknown>;
  readonly verification: VerificationResult;
  readonly elapsedSec: number;
}> {
  const raw = readFileSync(doc.path, 'utf8');
  const { excerpt, sectionsUsed } = prepareDrugExcerpt(raw, maxChars);

  const userPrompt = `Извлеки строго типизированные свойства препарата (числа, флаги, дозировки, титрацию, ограничения, ФК) из текста:\n\n${excerpt}`;
  const prompt =
    `<|message_system|><|content_text|>${SYSTEM_PROMPT}<|end_message|>` +
    `<|message_user|><|content_text|>${userPrompt}<|end_message|>` +
    `<|message_model|><|content_thinking|><|end_message|>` +
    `<|message_model|><|content_text|>`;

  const startedAt = performance.now();
  const res = await fetch(`${baseUrl}/completion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(240_000),
    body: JSON.stringify({
      prompt,
      temperature: 0,
      n_predict: maxTokens,
      cache_prompt: cachePrompt,
      json_schema: DRUG_SPARSE_SCHEMA,
      stop: ['<|end_message|>'],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 300)}`);
  }

  const payload = (await res.json()) as {
    readonly content?: string;
    readonly stop_type?: string;
    readonly tokens_evaluated?: number;
    readonly tokens_predicted?: number;
    readonly timings?: {
      readonly prompt_per_second?: number;
      readonly predicted_per_second?: number;
      readonly draft_n?: number;
      readonly draft_n_accepted?: number;
    };
  };

  const elapsedSec = Number(((performance.now() - startedAt) / 1000).toFixed(2));
  const rawContent = (payload.content ?? '').trim();

  let parsed: unknown = null;
  let parseError: string | null = null;
  try {
    parsed = JSON.parse(rawContent);
  } catch (err) {
    parseError = err instanceof Error ? err.message : String(err);
  }

  // Verify against the full document text (not just excerpt) so numbers from frontmatter/metadata
  // or unit equivalents are checked fairly, while still catching hallucinated numbers.
  const verification = verifyExtractedRecord(parsed, raw);
  const draftAcceptPct =
    payload.timings?.draft_n && payload.timings.draft_n > 0
      ? Number(
          (((payload.timings.draft_n_accepted ?? 0) / payload.timings.draft_n) * 100).toFixed(1),
        )
      : null;

  const record: Record<string, unknown> = {
    schema_version: 1,
    doc_id: doc.id,
    tier: doc.tier,
    source_dir: doc.sourceDir,
    source_path: relative(process.cwd(), doc.path),
    source_type: doc.sourceType,
    source_checksum: doc.sourceChecksum,
    meta_inn: doc.inn || null,
    meta_trade_name: doc.tradeName || null,
    meta_dosage_form: doc.dosageForm || null,
    sections_used: sectionsUsed,
    excerpt_chars: excerpt.length,
    encoded_at: new Date().toISOString(),
    model: 'Inkling-2-Mini-AD-IQ2_M',
    finish_reason: payload.stop_type ?? 'stop',
    parse_error: parseError,
    data: parsed,
    verification,
    stats: {
      elapsed_sec: elapsedSec,
      prompt_tokens: payload.tokens_evaluated ?? null,
      completion_tokens: payload.tokens_predicted ?? null,
      decode_tok_s: payload.timings?.predicted_per_second
        ? Number(payload.timings.predicted_per_second.toFixed(1))
        : null,
      draft_accept_pct: draftAcceptPct,
    },
  };

  return { record, verification, elapsedSec };
}

function loadCompletedKeys(jsonlPath: string): {
  keys: Set<string>;
  verified: number;
  needsReview: number;
  jsonErrors: number;
} {
  const keys = new Set<string>();
  let verified = 0;
  let needsReview = 0;
  let jsonErrors = 0;
  if (!existsSync(jsonlPath)) return { keys, verified, needsReview, jsonErrors };

  const text = readFileSync(jsonlPath, 'utf8');
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line) as {
        doc_id?: string;
        source_checksum?: string;
        verification?: { status?: string };
      };
      if (obj.doc_id) {
        keys.add(`${obj.doc_id}::${obj.source_checksum ?? ''}`);
        const st = obj.verification?.status;
        if (st === 'verified') verified += 1;
        else if (st === 'needs_review') needsReview += 1;
        else jsonErrors += 1;
      }
    } catch {
      // ignore partial trailing line if ever interrupted
    }
  }
  return { keys, verified, needsReview, jsonErrors };
}

function writeAtomicJson(path: string, data: unknown): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  renameSync(tmp, path);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  mkdirSync(options.outDir, { recursive: true });

  const drugsJsonl = join(options.outDir, 'drugs.jsonl');
  const errorsJsonl = join(options.outDir, 'errors.jsonl');
  const progressPath = join(options.outDir, 'progress.json');
  const stopFile = join(options.outDir, 'STOP');

  const corpus = discoverDrugCorpus(options.includeAllmed);
  const tierCounts = {
    tier1: corpus.filter((d) => d.tier === 1).length,
    tier2: corpus.filter((d) => d.tier === 2).length,
    tier3: corpus.filter((d) => d.tier === 3).length,
  };

  const resumed = loadCompletedKeys(drugsJsonl);
  const filtered = options.onlyIds
    ? corpus.filter((d) => options.onlyIds?.includes(d.id))
    : corpus.filter((d) => !resumed.keys.has(`${d.id}::${d.sourceChecksum}`));
  const queue = options.limit !== null ? filtered.slice(0, options.limit) : filtered;
  const totalConcurrency = options.workers * options.slotsPerServer;

  console.log(
    `[encode-all-drugs] Corpus: ${corpus.length} unique docs ` +
      `(T1 canonical=${tierCounts.tier1}, T2 variants=${tierCounts.tier2}, T3 allmed=${tierCounts.tier3}) | ` +
      `already done=${resumed.keys.size} | queued=${queue.length} | ` +
      `mode=${options.mode} workers=${options.workers} slots=${options.slotsPerServer} (conc=${totalConcurrency})`,
  );

  if (queue.length === 0) {
    console.log('[encode-all-drugs] Nothing pending — all drugs encoded!');
    return;
  }

  let stopRequested = false;
  const onSignal = (): void => {
    console.log('[encode-all-drugs] Signal received; finishing active drugs and shutting down...');
    stopRequested = true;
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  const threadsPerServer = Math.max(2, Math.floor(8 / options.workers));
  const servers: ManagedInklingServer[] = options.manageServer
    ? Array.from(
        { length: options.workers },
        (_, idx) =>
          new ManagedInklingServer(
            options.port + idx,
            join(options.outDir, `server-${idx}.log`),
            options.mode,
            options.slotsPerServer,
            options.budgetGib,
            options.draftMax,
            threadsPerServer,
          ),
      )
    : [];

  let sessionDone = 0;
  let verifiedCount = resumed.verified;
  let needsReviewCount = resumed.needsReview;
  let errorCount = resumed.jsonErrors;
  const startedAt = new Date().toISOString();
  let sessionStartMs = performance.now();
  const activeDocs = new Map<number, DrugDocEntry>();

  const saveProgress = (state: string): void => {
    const totalDone = resumed.keys.size + sessionDone;
    const remaining = Math.max(0, corpus.length - totalDone);
    const wallSec = (performance.now() - sessionStartMs) / 1000;
    const wallPerDoc = sessionDone > 0 ? wallSec / sessionDone : null;
    const etaHours =
      wallPerDoc !== null ? Number(((remaining * wallPerDoc) / 3600).toFixed(2)) : null;
    const currentList = [...activeDocs.values()].map((d) => ({
      id: d.id,
      tier: d.tier,
      inn: d.inn,
      trade: d.tradeName,
    }));
    writeAtomicJson(progressPath, {
      state,
      pid: process.pid,
      mode: options.mode,
      workers: options.workers,
      slots_per_server: options.slotsPerServer,
      concurrency: totalConcurrency,
      ports: Array.from({ length: options.workers }, (_, i) => options.port + i),
      started_at: startedAt,
      updated_at: new Date().toISOString(),
      corpus_total: corpus.length,
      tier_totals: tierCounts,
      completed: totalDone,
      remaining,
      pct: Number(((totalDone / Math.max(1, corpus.length)) * 100).toFixed(2)),
      verified: verifiedCount,
      needs_review: needsReviewCount,
      errors: errorCount,
      session_done: sessionDone,
      wall_sec_per_doc: wallPerDoc !== null ? Number(wallPerDoc.toFixed(2)) : null,
      eta_hours: etaHours,
      active: currentList,
    });
  };

  try {
    if (servers.length > 0) {
      console.log(
        `[encode-all-drugs] Starting ${servers.length}x Inkling 2 Mini (${options.mode}, ` +
          `slots=${options.slotsPerServer}, budget=${options.budgetGib} GiB/srv, draft_max=${options.draftMax})...`,
      );
      await Promise.all(servers.map((srv) => srv.ensureRunning()));
      console.log(`[encode-all-drugs] All ${servers.length} server(s) ready.`);
    }

    sessionStartMs = performance.now();
    let nextIdx = 0;

    const runSlotWorker = async (serverIdx: number, slotId: number): Promise<void> => {
      const server = servers[serverIdx] ?? null;
      const baseUrl = `http://127.0.0.1:${options.port + serverIdx}`;
      while (true) {
        if (stopRequested || existsSync(stopFile)) return;
        const idx = nextIdx;
        nextIdx += 1;
        if (idx >= queue.length) return;
        const doc = queue[idx];
        if (!doc) return;

        activeDocs.set(slotId, doc);
        saveProgress('running');

        let lastErr: unknown = null;
        let succeeded = false;
        for (let attempt = 1; attempt <= 2; attempt += 1) {
          try {
            if (server && attempt > 1) {
              console.log(
                `[encode-all-drugs] [S${serverIdx}] Retrying ${doc.id} (attempt ${attempt})...`,
              );
              await server.ensureRunning();
            }
            const { record, verification, elapsedSec } = await encodeSingleDrug(
              baseUrl,
              doc,
              options.maxChars,
              options.maxTokens,
              options.mode === 'batched',
            );
            appendFileSync(drugsJsonl, `${JSON.stringify(record)}\n`, 'utf8');
            sessionDone += 1;
            if (verification.status === 'verified') verifiedCount += 1;
            else if (verification.status === 'needs_review') needsReviewCount += 1;
            else errorCount += 1;

            const totalDone = resumed.keys.size + sessionDone;
            const wallPerDoc = ((performance.now() - sessionStartMs) / 1000 / sessionDone).toFixed(
              1,
            );
            const unv = verification.unverified_numbers.length;
            console.log(
              `[${totalDone}/${corpus.length}] [S${serverIdx}] T${doc.tier} ${doc.id} (${doc.inn || doc.tradeName}) ` +
                `-> ${verification.status} (${verification.verified_numbers}/${verification.total_numbers} nums${unv ? `, ${unv} unv` : ''}) ` +
                `in ${elapsedSec}s (wall ${wallPerDoc}s/doc)`,
            );
            succeeded = true;
            break;
          } catch (err) {
            lastErr = err;
            if (server && options.slotsPerServer === 1) await server.stop();
          }
        }

        activeDocs.delete(slotId);
        if (!succeeded) {
          errorCount += 1;
          const message = lastErr instanceof Error ? lastErr.message : String(lastErr);
          appendFileSync(
            errorsJsonl,
            `${JSON.stringify({ doc_id: doc.id, path: doc.path, source_checksum: doc.sourceChecksum, error: message, at: new Date().toISOString() })}\n`,
            'utf8',
          );
          console.error(`[encode-all-drugs] [S${serverIdx}] ERROR ${doc.id}: ${message}`);
        }
      }
    };

    const workerPromises: Promise<void>[] = [];
    let slotId = 0;
    for (let s = 0; s < options.workers; s += 1) {
      for (let k = 0; k < options.slotsPerServer; k += 1) {
        workerPromises.push(runSlotWorker(s, slotId));
        slotId += 1;
      }
    }
    await Promise.all(workerPromises);

    const totalWall = ((performance.now() - sessionStartMs) / 1000).toFixed(1);
    const wallAvg = sessionDone > 0 ? (Number(totalWall) / sessionDone).toFixed(2) : 'n/a';
    console.log(
      `[encode-all-drugs] Session finished: ${sessionDone} docs in ${totalWall}s (${wallAvg}s/doc wall).`,
    );
    saveProgress(stopRequested || existsSync(stopFile) ? 'stopped' : 'completed');
  } finally {
    await Promise.all(servers.map((srv) => srv.stop()));
  }
}

await main();
