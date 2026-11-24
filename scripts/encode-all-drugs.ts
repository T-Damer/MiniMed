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

const SCHEMA_VERSION = 3;

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
  readonly upgradeV1: boolean;
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
  let maxChars = Number(process.env['INKLING_MAX_CHARS'] ?? '4500');
  let maxTokens = Number(process.env['INKLING_MAX_TOKENS'] ?? '1950');
  let includeAllmed = true;
  let manageServer = true;
  let upgradeV1 = false;

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
    else if (arg === '--upgrade-v1' || arg === '--upgrade-old') upgradeV1 = true;
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
    upgradeV1,
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
 * Schema v3 Two-Pass extraction:
 * - Pass 1 (`PASS1_DOSING_SCHEMA`): identity, strengths, indications, regimens (by clinical
 *   state/severity + adult/child/neonate/elderly + interval_h), IV dilution/infusion tables
 *   (`iv_protocols[]`), stepped therapy ladders (`stages[]`), food/missed_dose/taper/storage/shelf.
 * - Pass 2 (`PASS2_SAFETY_SCHEMA`): special populations (children min_age/max_age/min_kg,
 *   elderly adjustment + age cutoff, pregnancy + exact avoided trimesters, lactation, renal eGFR
 *   cutoffs, hepatic Child-Pugh cutoff), alcohol/driving, contraindications (hard AVOID),
 *   caution_in («С осторожностью» — special conditions), avoid_with, incompat_iv, monitoring,
 *   common_adverse, red_flags (stop immediately), overdose_antidote, PK (t½/Tmax/BBB/CYP), and
 *   PD targets/effects.
 *
 * Splitting into two focused passes prevents section truncation inside the 4,096-token budget,
 * eliminates `finish_reason: "limit"`, and captures the full clinical & patient-handout dataset.
 */
const PASS1_DOSING_SCHEMA = {
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
    'storage_max_c',
    'shelf_open_d',
    'missed_dose',
    'taper',
    'indications',
    'regimens',
    'iv_protocols',
    'stages',
    'doc_flaws',
  ],
  properties: {
    inn: { type: 'string', maxLength: 120 },
    trade_name: { type: 'string', maxLength: 100 },
    atc: { type: ['string', 'null'], maxLength: 16 },
    dosage_form: { type: ['string', 'null'], maxLength: 80 },
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
    storage_max_c: { type: ['number', 'null'] },
    shelf_open_d: { type: ['number', 'null'] },
    missed_dose: {
      type: ['string', 'null'],
      enum: ['skip', 'take_soon', 'ask_doctor', null],
    },
    taper: { type: ['boolean', 'null'] },
    indications: { type: 'array', maxItems: 6, items: { type: 'string', maxLength: 60 } },
    regimens: {
      type: 'array',
      maxItems: 6,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'ind',
          'state',
          'pop',
          'age_min_y',
          'd_min',
          'd_max',
          'u',
          'per_kg',
          'freq_min',
          'freq_max',
          'interval_h',
          'interval_d',
          'max_day',
          'dur_min_d',
          'dur_max_d',
        ],
        properties: {
          ind: { type: 'string', maxLength: 56 },
          state: {
            type: ['string', 'null'],
            enum: [
              'mild',
              'moderate',
              'severe',
              'critical',
              'acute',
              'rehab',
              'maintenance',
              'prophylaxis',
              'perioperative',
              null,
            ],
          },
          pop: {
            type: ['string', 'null'],
            enum: ['adult', 'child', 'neonate', 'elderly', 'all', null],
          },
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
              'amp',
              'vial',
              'supp',
              'sachet',
              null,
            ],
          },
          per_kg: { type: 'boolean' },
          freq_min: { type: ['number', 'null'] },
          freq_max: { type: ['number', 'null'] },
          interval_h: { type: ['number', 'null'] },
          interval_d: { type: ['number', 'null'] },
          max_day: { type: ['number', 'null'] },
          dur_min_d: { type: ['number', 'null'] },
          dur_max_d: { type: ['number', 'null'] },
        },
      },
    },
    iv_protocols: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'for',
          'dil_sol',
          'vol_ml_min',
          'vol_ml_max',
          'rate_min',
          'rate_max',
          'rate_u',
          'dur_min_m',
          'dur_max_m',
          'device',
          'rate_dep',
        ],
        properties: {
          for: { type: 'string', maxLength: 48 },
          dil_sol: {
            type: ['string', 'null'],
            enum: ['nacl_09', 'glucose_5', 'glucose_10', 'ringer', 'wfi', 'other', null],
          },
          vol_ml_min: { type: ['number', 'null'] },
          vol_ml_max: { type: ['number', 'null'] },
          rate_min: { type: ['number', 'null'] },
          rate_max: { type: ['number', 'null'] },
          rate_u: {
            type: ['string', 'null'],
            enum: ['ml_min', 'ml_h', 'gtt_min', 'mg_min', 'mcg_kg_min', null],
          },
          dur_min_m: { type: ['number', 'null'] },
          dur_max_m: { type: ['number', 'null'] },
          device: { type: ['string', 'null'], enum: ['drip', 'pump', 'bolus', null] },
          rate_dep: {
            type: ['string', 'null'],
            enum: ['fixed', 'dose', 'weight', 'volume', 'titrated', null],
          },
        },
      },
    },
    stages: {
      type: 'array',
      maxItems: 4,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['step', 'phase', 'route', 'dose', 'days', 'repeat_d'],
        properties: {
          step: { type: 'integer' },
          phase: { type: 'string', maxLength: 44 },
          route: { type: 'string', enum: ['iv', 'im', 'oral', 'sc', 'other'] },
          dose: { type: 'string', maxLength: 44 },
          days: { type: ['number', 'null'] },
          repeat_d: { type: ['number', 'null'] },
        },
      },
    },
    doc_flaws: {
      type: 'array',
      maxItems: 2,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'where', 'note'],
        properties: {
          kind: {
            type: 'string',
            enum: [
              'ocr_garbled',
              'broken_table',
              'bad_headers',
              'missing_dosing',
              'contradictory',
              'wrong_encoding',
              'other',
            ],
          },
          where: { type: 'string', maxLength: 36 },
          note: { type: 'string', maxLength: 64 },
        },
      },
    },
  },
} as const;

const PASS2_SAFETY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'min_age_y',
    'max_age_y',
    'child_min_kg',
    'elderly',
    'elderly_age_y',
    'pregnancy',
    'preg_avoid_tri',
    'lactation',
    'renal_adj',
    'renal_red_egfr',
    'renal_contra_egfr',
    'hepatic_adj',
    'hepatic_cp_contra',
    'alcohol',
    'driving',
    'contraindications',
    'caution_in',
    'avoid_with',
    'incompat_iv',
    'monitoring',
    'common_adverse',
    'red_flags',
    'overdose_antidote',
    'pk',
    'pd_targets',
    'pd_effects',
    'doc_flaws',
  ],
  properties: {
    min_age_y: { type: ['number', 'null'] },
    max_age_y: { type: ['number', 'null'] },
    child_min_kg: { type: ['number', 'null'] },
    elderly: {
      type: ['string', 'null'],
      enum: ['normal', 'reduce', 'caution', 'avoid', null],
    },
    elderly_age_y: { type: ['number', 'null'] },
    pregnancy: {
      type: ['string', 'null'],
      enum: ['allowed', 'caution', 'trimester_restricted', 'contraindicated', null],
    },
    preg_avoid_tri: {
      type: 'array',
      maxItems: 3,
      items: { type: 'integer', enum: [1, 2, 3] },
    },
    lactation: {
      type: ['string', 'null'],
      enum: ['allowed', 'caution', 'contraindicated', null],
    },
    renal_adj: {
      type: ['string', 'null'],
      enum: ['none', 'reduce', 'contraindicated', null],
    },
    renal_red_egfr: { type: ['number', 'null'] },
    renal_contra_egfr: { type: ['number', 'null'] },
    hepatic_adj: {
      type: ['string', 'null'],
      enum: ['none', 'reduce', 'contraindicated', null],
    },
    hepatic_cp_contra: {
      type: ['string', 'null'],
      enum: ['A', 'B', 'C', null],
    },
    alcohol: {
      type: ['string', 'null'],
      enum: ['allowed', 'caution', 'avoid', null],
    },
    driving: {
      type: ['string', 'null'],
      enum: ['none', 'caution', 'avoid', null],
    },
    contraindications: { type: 'array', maxItems: 6, items: { type: 'string', maxLength: 56 } },
    caution_in: { type: 'array', maxItems: 6, items: { type: 'string', maxLength: 56 } },
    avoid_with: { type: 'array', maxItems: 6, items: { type: 'string', maxLength: 56 } },
    incompat_iv: { type: 'array', maxItems: 4, items: { type: 'string', maxLength: 48 } },
    monitoring: { type: 'array', maxItems: 4, items: { type: 'string', maxLength: 52 } },
    common_adverse: { type: 'array', maxItems: 5, items: { type: 'string', maxLength: 44 } },
    red_flags: { type: 'array', maxItems: 4, items: { type: 'string', maxLength: 48 } },
    overdose_antidote: { type: ['string', 'null'], maxLength: 48 },
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
        bbb: { type: 'string', enum: ['high', 'moderate', 'low', 'minimal'] },
        cyp: { type: 'array', maxItems: 5, items: { type: 'string', maxLength: 16 } },
        cyp_inh: { type: 'array', maxItems: 4, items: { type: 'string', maxLength: 16 } },
        cyp_ind: { type: 'array', maxItems: 4, items: { type: 'string', maxLength: 16 } },
        active_metabolite: { type: 'boolean' },
      },
    },
    pd_targets: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['target', 'action', 'zone'],
        properties: {
          target: { type: 'string', maxLength: 36 },
          action: {
            type: 'string',
            enum: [
              'antagonist',
              'agonist',
              'partial_agonist',
              'inhibitor',
              'modulator',
              'blocker',
              'other',
            ],
          },
          zone: { type: ['string', 'null'], maxLength: 44 },
        },
      },
    },
    pd_effects: { type: 'array', maxItems: 4, items: { type: 'string', maxLength: 36 } },
    doc_flaws: {
      type: 'array',
      maxItems: 2,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'where', 'note'],
        properties: {
          kind: {
            type: 'string',
            enum: [
              'ocr_garbled',
              'broken_table',
              'bad_headers',
              'contradictory',
              'wrong_encoding',
              'other',
            ],
          },
          where: { type: 'string', maxLength: 36 },
          note: { type: 'string', maxLength: 64 },
        },
      },
    },
  },
} as const;

const PASS1_SYSTEM_PROMPT =
  'Ты экстрактор дозировок и схем применения лекарств. Выводи КОМПАКТНЫЙ JSON в одну строку. Извлекай ТОЛЬКО факты из текста; отсутствующие значения -> null или [].\n' +
  'Правила: atc = код АТХ; rx = true/false; strengths = ТОЛЬКО дозировка выпуска; shelf_open_d = срок годности после вскрытия в днях (если указан); missed_dose = что делать при пропуске дозы (skip/take_soon/ask_doctor); taper = true если нужна постепенная отмена.\n' +
  'regimens = до 6 ключевых схем: d_min/d_max = доза в единицах u (напр. 10-20 мл -> d_min:10, d_max:20, u:"ml"); max_day = ТОЛЬКО макс. суточная доза (НЕ дни курса!); dur_min_d/dur_max_d = длительность в днях; interval_h = интервал в часах (НЕ пиши часы в interval_d!); state = тяжесть/период (mild/moderate/severe/critical/acute/rehab/maintenance/prophylaxis/perioperative); pop:"neonate" для новорождённых.\n' +
  'iv_protocols = до 3 схем разведения/инфузии ТОЛЬКО для в/в препаратов (иначе []). stages = ТОЛЬКО при ступенчатой терапии в/в->таблетки или повторном курсе (иначе []). doc_flaws = ТОЛЬКО реальный брак текста (битый OCR, сломанная таблица, противоречивые цифры); иначе [].';

const PASS2_SYSTEM_PROMPT =
  'Ты экстрактор безопасности, особых групп, побочных эффектов и ФК/ФД лекарств. Выводи КОМПАКТНЫЙ JSON в одну строку. Извлекай ТОЛЬКО факты из текста; отсутствующие -> null или [].\n' +
  'Особые группы: min_age_y (0 для новорождённых, 18 если противопоказан детям), child_min_kg (мин. масса ребёнка в кг если указана), elderly (normal/reduce/caution/avoid) + elderly_age_y (60/65/75), pregnancy + preg_avoid_tri (массив запрещённых триместров [1],[2],[3] если ограничено по триместрам, иначе []), lactation.\n' +
  'Почки/печень: renal_adj + renal_red_egfr (порог СКФ/КК снижения дозы) + renal_contra_egfr (порог противопоказания, напр. 30 или 60); hepatic_adj + hepatic_cp_contra ("A"/"B"/"C" по Чайлд-Пью если указано).\n' +
  'Безопасность: contraindications = жёсткие противопоказания; caution_in = «С осторожностью» / особые состояния (подагра, диабет, ХСН, эпилепсия, ЯБЖ и др.); avoid_with = нежелательные комбинации; incompat_iv = несовместимость в растворе; monitoring = что контролировать; common_adverse = частые побочные; red_flags = симптомы немедленной отмены (анафилаксия, отёк Квинке, сыпь/ССД, агранулоцитоз); overdose_antidote = специфический антидот если назван.\n' +
  'ФК/ФД: pk = null если нет Фармакокинетики (bbb только при явном упоминании ГЭБ); pd_targets = конкретные рецепторы/мишени с зоной действия (иначе []); pd_effects = 1–4 коротких эффекта (седативный, гипотензивный и т.п.). doc_flaws = ТОЛЬКО реальный брак OCR/таблиц/заголовков; иначе [].';

interface ExcerptSlot {
  readonly name: string;
  readonly headingPattern: RegExp;
  readonly inlinePattern: RegExp;
  readonly stopPattern?: RegExp;
  readonly cap: number;
  readonly skipIfCaptured?: string;
}

function trimToSentence(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text.trim();
  const cut = text.slice(0, maxLen);
  const lastPeriod = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.\n'), cut.lastIndexOf('; '));
  if (lastPeriod > maxLen * 0.55) {
    return cut.slice(0, lastPeriod + 1).trim();
  }
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > maxLen * 0.7 ? cut.slice(0, lastSpace) : cut).trim();
}

function extractSectionsBySlots(
  raw: string,
  slots: readonly ExcerptSlot[],
  maxChars: number,
  extras: readonly { readonly tag: string; readonly regex: RegExp }[],
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
    return { excerpt: trimToSentence(combined, maxChars), sectionsUsed: ['head'] };
  }

  const sections = headings.map((m, idx) => {
    const start = m.index ?? 0;
    const end = headings[idx + 1]?.index ?? body.length;
    return { heading: m[0], text: body.slice(start, end).trim() };
  });

  const picked: string[] = [];
  const sectionsUsed: string[] = [];
  const capturedSlots = new Set<string>();
  const usedHeadingIdx = new Set<number>();
  let budget = maxChars - fmLines.length - 220;

  for (const slot of slots) {
    if (budget < 80) break;
    if (slot.skipIfCaptured && capturedSlots.has(slot.skipIfCaptured)) continue;
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
        text = trimToSentence(text, Math.min(slot.cap, budget));
        if (text.length > 0) {
          picked.push(text);
          sectionsUsed.push(slot.name);
          capturedSlots.add(slot.name);
          budget -= text.length + 2;
          matched = true;
          break;
        }
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
        slice = trimToSentence(slice, Math.min(slot.cap, budget));
        if (slice.length > 0) {
          picked.push(slice);
          sectionsUsed.push(`inline:${slot.name}`);
          capturedSlots.add(slot.name);
          budget -= slice.length + 2;
        }
      }
    }
  }

  for (const extra of extras) {
    const match = body.match(extra.regex)?.[0]?.trim();
    if (match && !picked.some((p) => p.includes(match.slice(0, 24)))) {
      picked.push(match);
    }
  }

  if (picked.length === 0) {
    picked.push(trimToSentence(body, Math.max(400, budget)));
    sectionsUsed.push('fallback_head');
  }

  const combined = fmLines ? `${fmLines}\n\n${picked.join('\n\n')}` : picked.join('\n\n');
  return {
    excerpt: combined.length > maxChars ? trimToSentence(combined, maxChars) : combined,
    sectionsUsed,
  };
}

const PASS1_SLOTS: readonly ExcerptSlot[] = [
  {
    name: 'composition',
    headingPattern:
      /общая информация|карточка препарата|состав|лекарственная форма|инструкция|торговое наименование/iu,
    inlinePattern: /(?:Торговое наименование|Состав|Лекарственная форма)/iu,
    stopPattern: /Фармакодинамика|Показания к применению|Перед приемом препарата/iu,
    cap: 520,
  },
  {
    name: 'dosing',
    headingPattern: /режим дозирования|способ применения и дозы/iu,
    inlinePattern: /(?:Режим дозирования|Способ применения и дозы)/iu,
    stopPattern: /Побочное действие|Нежелательные реакции|Передозировка/iu,
    cap: 2500,
  },
  {
    name: 'dosing_leaflet',
    headingPattern: /при[её]м препарата|применение препарата/iu,
    inlinePattern: /(?:3\.\s*При[её]м препарата|3\.\s*Применение препарата|Рекомендуемая доза)/iu,
    stopPattern: /Побочное действие|Возможные нежелательные реакции|Передозировка/iu,
    cap: 1800,
    skipIfCaptured: 'dosing',
  },
  {
    name: 'indications',
    headingPattern: /показания|что из себя представляет/iu,
    inlinePattern: /Показания к применению/iu,
    stopPattern: /Противопоказания/iu,
    cap: 550,
  },
  {
    name: 'storage',
    headingPattern: /хранение|условия хранения|срок годности/iu,
    inlinePattern: /(?:Условия хранения|5\.?\s*Хранение|Срок годности)/iu,
    stopPattern: /Условия отпуска|Производитель|Владелец/iu,
    cap: 320,
  },
];

const PASS2_SLOTS: readonly ExcerptSlot[] = [
  {
    name: 'contraindications',
    headingPattern: /противопоказания/iu,
    inlinePattern: /Противопоказания/iu,
    stopPattern: /С осторожностью|Применение при беременности|Особые указания|Способ применения/iu,
    cap: 580,
  },
  {
    name: 'caution',
    headingPattern: /с осторожностью|особые указания|меры предосторожности/iu,
    inlinePattern: /(?:С осторожностью|Особые указания и меры предосторожности|Особые указания)/iu,
    stopPattern: /Применение при беременности|Способ применения|Побочное действие|Взаимодействие/iu,
    cap: 650,
  },
  {
    name: 'special_pops',
    headingPattern:
      /особые группы пациентов|дети и подростки|применение у детей|пожилого возраста|почечной недостаточностью/iu,
    inlinePattern: /(?:Особые группы пациентов|Дети и подростки|Лица пожилого возраста)/iu,
    stopPattern: /Нежелательные реакции|Побочное действие|Передозировка/iu,
    cap: 550,
  },
  {
    name: 'pregnancy',
    headingPattern: /беременность|грудное вскармливание|фертильность|применение при беременности/iu,
    inlinePattern:
      /(?:Применение при беременности|Беременность и грудное вскармливание|Беременность,\s*грудное)/iu,
    stopPattern: /Способ применения|Управление транспорт|Влияние на способность/iu,
    cap: 420,
  },
  {
    name: 'interactions',
    headingPattern: /взаимодействие|другие препараты/iu,
    inlinePattern: /(?:Взаимодействие с другими лекарственными|Другие препараты и препарат)/iu,
    stopPattern: /Особые указания|Влияние на способность|Форма выпуска|Несовместимость/iu,
    cap: 420,
  },
  {
    name: 'adverse',
    headingPattern: /побочное действие|нежелательные реакции/iu,
    inlinePattern: /(?:Побочное действие|Возможные нежелательные реакции|Нежелательные реакции)/iu,
    stopPattern: /Передозировка|Сообщение о нежелательных|5\.?\s*Хранение/iu,
    cap: 520,
  },
  {
    name: 'overdose',
    headingPattern: /передозировка/iu,
    inlinePattern: /Передозировка/iu,
    stopPattern: /Взаимодействие|Особые указания|Форма выпуска/iu,
    cap: 260,
  },
  {
    name: 'pd',
    headingPattern: /фармакодинамик|механизм действия/iu,
    inlinePattern: /(?:Фармакодинамика|Механизм действия)/iu,
    stopPattern: /Фармакокинетика|Показания к применению/iu,
    cap: 420,
  },
  {
    name: 'pk',
    headingPattern: /фармакокинет/iu,
    inlinePattern: /Фармакокинетика/iu,
    stopPattern: /Показания к применению|Противопоказания/iu,
    cap: 460,
  },
  {
    name: 'driving',
    headingPattern: /управление транспорт|влияние на способность/iu,
    inlinePattern: /(?:Влияние на способность управлять|Управление транспортными средствами)/iu,
    stopPattern: /Форма выпуска|Условия хранения|Срок годности/iu,
    cap: 200,
  },
];

function prepareDosingExcerpt(
  raw: string,
  maxChars: number,
): { excerpt: string; sectionsUsed: string[] } {
  return extractSectionsBySlots(raw, PASS1_SLOTS, maxChars, [
    { tag: 'atc', regex: /Код АТХ[:\s]+([A-Z]\d{2}[A-Z]{0,2}\d{0,2})/iu },
    { tag: 'rx', regex: /(?:Категория отпуска|Условия отпуска)[\s\S]{0,100}/iu },
    { tag: 'missed', regex: /Если Вы забыли[\s\S]{0,180}/iu },
  ]);
}

function prepareSafetyExcerpt(
  raw: string,
  maxChars: number,
): { excerpt: string; sectionsUsed: string[] } {
  return extractSectionsBySlots(raw, PASS2_SLOTS, maxChars, [
    { tag: 'incompat', regex: /Несовместимость[\s\S]{0,200}/iu },
    { tag: 'alcohol', regex: /(?:алкогол|этанол|спиртн)[\s\S]{0,140}/iu },
  ]);
}

interface DetectedDocFlaw {
  readonly source: 'deterministic' | 'llm';
  readonly kind: string;
  readonly where: string;
  readonly note: string;
}

/**
 * Deterministic pre-scan for structural/OCR/table/header defects in prepared Markdown instructions.
 * Paired with the LLM's own `doc_flaws` report so broken source files are logged cleanly without
 * silently repairing them (AGENTS.md Data-agent rules).
 */
function detectDeterministicDocFlaws(
  raw: string,
  dosingExcerpt: string,
  sectionsUsed: readonly string[],
): DetectedDocFlaw[] {
  const flaws: DetectedDocFlaw[] = [];
  const body = raw
    .replace(/^---[\s\S]*?---\s*/u, '')
    .replace(/<!--[\s\S]*?-->\s*/gu, '')
    .trim();

  if (body.length < 400) {
    flaws.push({
      source: 'deterministic',
      kind: 'truncated',
      where: 'body',
      note: `Very short document body (${body.length} chars)`,
    });
  }

  const qualityRaw = Number(raw.match(/^\s+qualityScore:\s*([0-9.]+)/mu)?.[1] ?? '1');
  const ocrLowRatio = Number(raw.match(/^\s+ocrLowConfidenceRatio:\s*([0-9.]+)/mu)?.[1] ?? '0');
  if ((Number.isFinite(qualityRaw) && qualityRaw < 0.7) || ocrLowRatio > 0.15) {
    flaws.push({
      source: 'deterministic',
      kind: 'ocr_garbled',
      where: 'frontmatter.extraction',
      note: `Low extraction quality (qualityScore=${qualityRaw}, ocrLowConf=${ocrLowRatio})`,
    });
  }

  const replacementCount = (body.match(/\uFFFD/gu) ?? []).length;
  if (replacementCount > 0) {
    flaws.push({
      source: 'deterministic',
      kind: 'wrong_encoding',
      where: 'body',
      note: `${replacementCount} Unicode replacement char(s) (U+FFFD)`,
    });
  }

  // Classic OCR Latin/Cyrillic homoglyph mixing inside a single Russian word (e.g., `тaблeтки`)
  const mixedScriptWords =
    body.match(/\b(?:[А-Яа-яЁё]+[A-Za-z][А-Яа-яЁё]+|[A-Za-z]+[А-Яа-яЁё][A-Za-z]+)\b/gu) ?? [];
  if (mixedScriptWords.length >= 4) {
    flaws.push({
      source: 'deterministic',
      kind: 'ocr_garbled',
      where: 'body',
      note: `${mixedScriptWords.length} mixed Latin/Cyrillic OCR words (e.g. ${mixedScriptWords.slice(0, 3).join(', ')})`,
    });
  }

  const tableReviewCount = (raw.match(/<!--\s*localmed:review\s+table-candidate\s*-->/gu) ?? [])
    .length;
  const pipeLines = body.split('\n').filter((line) => /^\s*\|.*\|\s*$/u.test(line));
  let jaggedTables = 0;
  let prevCols = -1;
  for (const line of pipeLines) {
    const cols = line.split('|').length - 2;
    if (prevCols > 0 && cols !== prevCols) jaggedTables += 1;
    prevCols = cols;
  }
  if (jaggedTables > 0) {
    flaws.push({
      source: 'deterministic',
      kind: 'broken_table',
      where: 'markdown_table',
      note: `${jaggedTables} jagged table row(s) with mismatched pipe columns`,
    });
  } else if (tableReviewCount >= 3) {
    flaws.push({
      source: 'deterministic',
      kind: 'broken_table',
      where: 'table_candidate',
      note: `${tableReviewCount} unparsed table-candidate blocks`,
    });
  }

  const headings = [...body.matchAll(/^(#{1,4})\s+(.+)$/gmu)];
  if (body.length > 4000 && headings.length <= 1) {
    flaws.push({
      source: 'deterministic',
      kind: 'bad_headers',
      where: 'headings',
      note: `Flat document (${body.length} chars, only ${headings.length} markdown heading)`,
    });
  }
  const giantHeadings = headings.filter((m) => (m[2]?.length ?? 0) > 180);
  if (giantHeadings.length > 0) {
    flaws.push({
      source: 'deterministic',
      kind: 'bad_headers',
      where: 'headings',
      note: `${giantHeadings.length} oversized heading (>180 chars, likely body paragraph)`,
    });
  }

  const hasDosingSlot = sectionsUsed.some(
    (s) => s === 'dosing' || s === 'inline:dosing' || s === 'full',
  );
  const hasAnyNumericDose =
    /\d+(?:[.,]\d+)?\s*(?:мг|мкг|мл|г\b|ед|ме\b|таб|капс|кап|амп|фл|супп|доз)/iu.test(
      dosingExcerpt,
    );
  if (!hasDosingSlot && !hasAnyNumericDose) {
    flaws.push({
      source: 'deterministic',
      kind: 'missing_dosing',
      where: 'dosing',
      note: sectionsUsed.includes('dosing_leaflet')
        ? 'Patient leaflet has no numeric doses (boilerplate-only)'
        : 'No dosing section with numeric doses detected',
    });
  }

  return flaws;
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
    // Logical stage order (1, 2, 3) and pregnancy trimesters (often written as Roman I/II/III or
    // Russian words «первый/третий триместр») are structural enums, not literal prose numbers.
    if (!pathPrefix.endsWith('.step') && !pathPrefix.startsWith('preg_avoid_tri[')) {
      out.push({ path: pathPrefix, num: value });
    }
  } else if (Array.isArray(value)) {
    for (let idx = 0; idx < value.length; idx += 1) {
      collectNumbers(value[idx], `${pathPrefix}[${idx}]`, out);
    }
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (k === 'doc_flaws') continue;
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
  const ivProtocols = Array.isArray(parsed['iv_protocols']) ? parsed['iv_protocols'] : [];
  for (let i = 0; i < ivProtocols.length; i += 1) {
    const iv = ivProtocols[i] as Record<string, unknown>;
    if (!iv || typeof iv !== 'object') continue;
    const ivPairs: readonly [string, string][] = [
      ['vol_ml_min', 'vol_ml_max'],
      ['rate_min', 'rate_max'],
      ['dur_min_m', 'dur_max_m'],
    ];
    for (const [lo, hi] of ivPairs) {
      if (typeof iv[lo] === 'number' && typeof iv[hi] === 'number' && iv[lo] > iv[hi]) {
        warnings.push(`iv_protocols[${i}].${lo}(${iv[lo]})>${hi}(${iv[hi]})`);
      }
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

interface CompletionCallResult {
  readonly parsed: Record<string, unknown> | null;
  readonly parseError: string | null;
  readonly rawContent: string;
  readonly finishReason: string;
  readonly elapsedSec: number;
  readonly promptTokens: number | null;
  readonly completionTokens: number | null;
  readonly decodeTokS: number | null;
  readonly draftAcceptPct: number | null;
}

async function runSchemaPass(
  baseUrl: string,
  systemPrompt: string,
  userPrompt: string,
  jsonSchema: unknown,
  maxTokens: number,
  cachePrompt: boolean,
): Promise<CompletionCallResult> {
  const prompt =
    `<|message_system|><|content_text|>${systemPrompt}<|end_message|>` +
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
      json_schema: jsonSchema,
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

  let parsed: Record<string, unknown> | null = null;
  let parseError: string | null = null;
  try {
    const obj = JSON.parse(rawContent);
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      parsed = obj as Record<string, unknown>;
    } else {
      parseError = 'Expected JSON object';
    }
  } catch (err) {
    parseError = err instanceof Error ? err.message : String(err);
  }

  const draftAcceptPct =
    payload.timings?.draft_n && payload.timings.draft_n > 0
      ? Number(
          (((payload.timings.draft_n_accepted ?? 0) / payload.timings.draft_n) * 100).toFixed(1),
        )
      : null;

  return {
    parsed,
    parseError,
    rawContent,
    finishReason: payload.stop_type ?? 'stop',
    elapsedSec,
    promptTokens: payload.tokens_evaluated ?? null,
    completionTokens: payload.tokens_predicted ?? null,
    decodeTokS: payload.timings?.predicted_per_second
      ? Number(payload.timings.predicted_per_second.toFixed(1))
      : null,
    draftAcceptPct,
  };
}

function extractLlmFlaws(parsed: Record<string, unknown> | null): DetectedDocFlaw[] {
  if (!parsed || !Array.isArray(parsed['doc_flaws'])) return [];
  return (parsed['doc_flaws'] as { kind?: string; where?: string; note?: string }[])
    .filter(
      (f) =>
        f &&
        typeof f.kind === 'string' &&
        typeof f.note === 'string' &&
        !/обрез|обрыв|выборк|truncat|cut\s+off|mid-sentence|неполн\S*\s+фрагмент/iu.test(f.note),
    )
    .map((f) => ({
      source: 'llm' as const,
      kind: f.kind ?? 'other',
      where: f.where ?? 'body',
      note: f.note ?? '',
    }));
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
  readonly flaws: readonly DetectedDocFlaw[];
  readonly elapsedSec: number;
}> {
  const raw = readFileSync(doc.path, 'utf8');
  const pass1Excerpt = prepareDosingExcerpt(raw, maxChars);
  const pass2Excerpt = prepareSafetyExcerpt(raw, maxChars);

  const pass1 = await runSchemaPass(
    baseUrl,
    PASS1_SYSTEM_PROMPT,
    `Извлеки дозировки, показания, в/в протоколы и ступенчатые схемы из текста:\n\n${pass1Excerpt.excerpt}`,
    PASS1_DOSING_SCHEMA,
    maxTokens,
    cachePrompt,
  );
  const pass2 = await runSchemaPass(
    baseUrl,
    PASS2_SYSTEM_PROMPT,
    `Извлеки особые группы (дети, беременность/триместры, лактация, пожилые, почки/СКФ, печень/Чайлд-Пью), «С осторожностью», противопоказания, побочные/красные флаги, антидот и ФК/ФД из текста:\n\n${pass2Excerpt.excerpt}`,
    PASS2_SAFETY_SCHEMA,
    maxTokens,
    cachePrompt,
  );

  const combinedSections = [
    ...new Set([...pass1Excerpt.sectionsUsed, ...pass2Excerpt.sectionsUsed]),
  ];
  const detFlaws = detectDeterministicDocFlaws(raw, pass1Excerpt.excerpt, combinedSections);
  const rawLlmFlaws = [...extractLlmFlaws(pass1.parsed), ...extractLlmFlaws(pass2.parsed)];
  const seenFlawKey = new Set<string>();
  const allFlaws: DetectedDocFlaw[] = [];
  for (const flaw of [...detFlaws, ...rawLlmFlaws]) {
    const key = `${flaw.kind}::${flaw.where.toLowerCase()}::${flaw.note.toLowerCase()}`;
    if (seenFlawKey.has(key)) continue;
    seenFlawKey.add(key);
    allFlaws.push(flaw);
  }

  let merged: Record<string, unknown> | null = null;
  if (pass1.parsed && pass2.parsed) {
    const { doc_flaws: _f1, ...dosingData } = pass1.parsed;
    const { doc_flaws: _f2, ...safetyData } = pass2.parsed;
    merged = { ...dosingData, ...safetyData };
  }

  const parseError =
    [
      pass1.parseError ? `p1:${pass1.parseError}` : null,
      pass2.parseError ? `p2:${pass2.parseError}` : null,
    ]
      .filter(Boolean)
      .join('; ') || null;

  const verification = verifyExtractedRecord(merged, raw);
  const elapsedSec = Number((pass1.elapsedSec + pass2.elapsedSec).toFixed(2));

  const record: Record<string, unknown> = {
    schema_version: SCHEMA_VERSION,
    doc_id: doc.id,
    tier: doc.tier,
    source_dir: doc.sourceDir,
    source_path: relative(process.cwd(), doc.path),
    source_type: doc.sourceType,
    source_checksum: doc.sourceChecksum,
    meta_inn: doc.inn || null,
    meta_trade_name: doc.tradeName || null,
    meta_dosage_form: doc.dosageForm || null,
    sections_used: combinedSections,
    excerpt_chars: pass1Excerpt.excerpt.length + pass2Excerpt.excerpt.length,
    encoded_at: new Date().toISOString(),
    model: 'Inkling-2-Mini-AD-IQ2_M',
    finish_reason:
      pass1.finishReason === 'limit' || pass2.finishReason === 'limit'
        ? `p1:${pass1.finishReason},p2:${pass2.finishReason}`
        : 'eos',
    parse_error: parseError,
    ...(parseError
      ? {
          raw_preview: {
            p1: pass1.parseError ? pass1.rawContent.slice(-300) : null,
            p2: pass2.parseError ? pass2.rawContent.slice(-300) : null,
          },
        }
      : {}),
    data: merged,
    doc_flaws: allFlaws,
    verification,
    stats: {
      elapsed_sec: elapsedSec,
      p1_sec: pass1.elapsedSec,
      p2_sec: pass2.elapsedSec,
      prompt_tokens: (pass1.promptTokens ?? 0) + (pass2.promptTokens ?? 0),
      completion_tokens: (pass1.completionTokens ?? 0) + (pass2.completionTokens ?? 0),
      decode_tok_s: pass1.decodeTokS ?? pass2.decodeTokS,
      draft_accept_pct: pass1.draftAcceptPct ?? pass2.draftAcceptPct,
    },
  };

  return { record, verification, flaws: allFlaws, elapsedSec };
}

function loadCompletedKeys(jsonlPath: string): {
  keys: Set<string>;
  v2Keys: Set<string>;
  v1Count: number;
  v2Count: number;
  verified: number;
  needsReview: number;
  jsonErrors: number;
  docsWithFlaws: number;
} {
  const latestByKey = new Map<
    string,
    { schemaVersion: number; status: string; hasFlaws: boolean }
  >();
  if (existsSync(jsonlPath)) {
    const text = readFileSync(jsonlPath, 'utf8');
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line) as {
          schema_version?: number;
          doc_id?: string;
          source_checksum?: string;
          doc_flaws?: unknown[];
          verification?: { status?: string };
        };
        if (obj.doc_id) {
          const key = `${obj.doc_id}::${obj.source_checksum ?? ''}`;
          latestByKey.set(key, {
            schemaVersion: obj.schema_version ?? 1,
            status: obj.verification?.status ?? 'error',
            hasFlaws: Array.isArray(obj.doc_flaws) && obj.doc_flaws.length > 0,
          });
        }
      } catch {
        // ignore partial trailing line if ever interrupted
      }
    }
  }
  const keys = new Set<string>();
  const v2Keys = new Set<string>();
  let v1Count = 0;
  let v2Count = 0;
  let verified = 0;
  let needsReview = 0;
  let jsonErrors = 0;
  let docsWithFlaws = 0;
  for (const [key, entry] of latestByKey) {
    keys.add(key);
    if (entry.schemaVersion >= SCHEMA_VERSION) {
      v2Keys.add(key);
      v2Count += 1;
    } else {
      v1Count += 1;
    }
    if (entry.status === 'verified') verified += 1;
    else if (entry.status === 'needs_review') needsReview += 1;
    else jsonErrors += 1;
    if (entry.hasFlaws) docsWithFlaws += 1;
  }
  return { keys, v2Keys, v1Count, v2Count, verified, needsReview, jsonErrors, docsWithFlaws };
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
  const flawsJsonl = join(options.outDir, 'flaws.jsonl');
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
  const skipSet = options.upgradeV1 ? resumed.v2Keys : resumed.keys;
  const filtered = options.onlyIds
    ? corpus.filter((d) => options.onlyIds?.includes(d.id))
    : corpus.filter((d) => !skipSet.has(`${d.id}::${d.sourceChecksum}`));
  const queue = options.limit !== null ? filtered.slice(0, options.limit) : filtered;
  const totalConcurrency = options.workers * options.slotsPerServer;

  console.log(
    `[encode-all-drugs] Schema v${SCHEMA_VERSION} | Corpus: ${corpus.length} unique docs ` +
      `(T1 canonical=${tierCounts.tier1}, T2 variants=${tierCounts.tier2}, T3 allmed=${tierCounts.tier3}) | ` +
      `done=${resumed.keys.size} (v1=${resumed.v1Count}, v2=${resumed.v2Count}) | queued=${queue.length}${options.upgradeV1 ? ' [upgrade-v1]' : ''} | ` +
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
  let v1Count = resumed.v1Count;
  let v2Count = resumed.v2Count;
  let verifiedCount = resumed.verified;
  let needsReviewCount = resumed.needsReview;
  let errorCount = resumed.jsonErrors;
  let docsWithFlawsCount = resumed.docsWithFlaws;
  const startedAt = new Date().toISOString();
  let sessionStartMs = performance.now();
  const activeDocs = new Map<number, DrugDocEntry>();

  const saveProgress = (state: string): void => {
    const totalDone = options.upgradeV1 ? v2Count : resumed.keys.size + sessionDone;
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
      schema_version: SCHEMA_VERSION,
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
      v1_records: v1Count,
      v2_records: v2Count,
      remaining,
      pct: Number(((totalDone / Math.max(1, corpus.length)) * 100).toFixed(2)),
      verified: verifiedCount,
      needs_review: needsReviewCount,
      errors: errorCount,
      docs_with_flaws: docsWithFlawsCount,
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
            const { record, verification, flaws, elapsedSec } = await encodeSingleDrug(
              baseUrl,
              doc,
              options.maxChars,
              options.maxTokens,
              options.mode === 'batched',
            );
            appendFileSync(drugsJsonl, `${JSON.stringify(record)}\n`, 'utf8');
            if (flaws.length > 0) {
              docsWithFlawsCount += 1;
              appendFileSync(
                flawsJsonl,
                `${JSON.stringify({
                  doc_id: doc.id,
                  tier: doc.tier,
                  source_path: relative(process.cwd(), doc.path),
                  inn: doc.inn || null,
                  trade_name: doc.tradeName || null,
                  flaws,
                  at: new Date().toISOString(),
                })}\n`,
                'utf8',
              );
            }
            const docKey = `${doc.id}::${doc.sourceChecksum}`;
            if (resumed.keys.has(docKey) && !resumed.v2Keys.has(docKey)) {
              v1Count = Math.max(0, v1Count - 1);
            }
            v2Count += 1;
            sessionDone += 1;
            if (verification.status === 'verified') verifiedCount += 1;
            else if (verification.status === 'needs_review') needsReviewCount += 1;
            else errorCount += 1;

            const totalDone = options.upgradeV1 ? v2Count : resumed.keys.size + sessionDone;
            const wallPerDoc = ((performance.now() - sessionStartMs) / 1000 / sessionDone).toFixed(
              1,
            );
            const unv = verification.unverified_numbers.length;
            const flawTag = flaws.length > 0 ? `, ${flaws.length} flaw(s)` : '';
            console.log(
              `[${totalDone}/${corpus.length}] [S${serverIdx}] T${doc.tier} v${SCHEMA_VERSION} ${doc.id} (${doc.inn || doc.tradeName}) ` +
                `-> ${verification.status} (${verification.verified_numbers}/${verification.total_numbers} nums${unv ? `, ${unv} unv` : ''}${flawTag}) ` +
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
