#!/usr/bin/env bun
/**
 * Local LLM typed clinical schema extraction benchmark (Inkling 2 Mini / any OpenAI-compatible
 * local llama-server): sends a prepared GRLS drug instruction or Russian Clinical Recommendation
 * (КР) section with grammar-constrained `response_format: { type: "json_schema" }` so outputs stay
 * in compact string/number/boolean/enum fields (no prose walls) ready for MiniMed's
 * `study/read -> gather/calculate -> track -> get recommendation` pipeline.
 *
 * Usage:
 *   bun scripts/inkling-drug-extract.ts --mode drug [path]
 *   bun scripts/inkling-drug-extract.ts --mode kr --section "^# 3\\. Лечение" [path]
 */
import { readFileSync } from 'node:fs';

type ExtractMode = 'drug' | 'kr';

interface CliOptions {
  readonly mode: ExtractMode;
  readonly filePath: string;
  readonly sectionPattern: string | null;
  readonly baseUrl: string;
  readonly model: string;
  readonly maxChars: number;
  readonly maxTokens: number;
  readonly thinking: boolean;
}

function parseArgs(argv: readonly string[]): CliOptions {
  let mode: ExtractMode = 'drug';
  let filePath: string | null = null;
  let sectionPattern: string | null = null;
  let baseUrl = process.env['INKLING_URL'] ?? 'http://127.0.0.1:8080';
  let model = process.env['INKLING_MODEL'] ?? 'inkling-2-mini';
  let maxChars = Number(process.env['INKLING_MAX_CHARS'] ?? '6200');
  let maxTokens = Number(process.env['INKLING_MAX_TOKENS'] ?? '1200');
  let thinking = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--mode' && argv[i + 1]) {
      const next = argv[++i];
      if (next !== 'drug' && next !== 'kr') {
        throw new Error(`Unsupported --mode "${next}". Expected "drug" or "kr".`);
      }
      mode = next;
    } else if (arg === '--section' && argv[i + 1]) {
      sectionPattern = argv[++i] ?? null;
    } else if (arg === '--url' && argv[i + 1]) {
      baseUrl = argv[++i] ?? baseUrl;
    } else if (arg === '--model' && argv[i + 1]) {
      model = argv[++i] ?? model;
    } else if (arg === '--max-chars' && argv[i + 1]) {
      maxChars = Number(argv[++i]);
    } else if (arg === '--max-tokens' && argv[i + 1]) {
      maxTokens = Number(argv[++i]);
    } else if (arg === '--think') {
      thinking = true;
    } else if (arg && !arg.startsWith('--')) {
      filePath = arg;
    }
  }

  const defaultPath =
    mode === 'drug'
      ? 'data/intermediate/grls-full-final/drug.rf.23e2738725b043edf46d.instruction.md'
      : 'data/intermediate/private-pilot/kr.rf.full.381_3.bronchitis.md';

  return {
    mode,
    filePath: filePath ?? defaultPath,
    sectionPattern: sectionPattern ?? (mode === 'kr' ? '^# 3\\. Лечение' : null),
    baseUrl,
    model,
    maxChars,
    maxTokens,
    thinking,
  };
}

const DRUG_JSON_SCHEMA = {
  name: 'drug_typed_properties',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: [
      'inn',
      'trade_name',
      'dosage_form',
      'route',
      'food_relation',
      'rx_required',
      'strengths_mg',
      'min_age_years',
      'pregnancy_allowed',
      'lactation_allowed',
      'renal_adjustment',
      'hepatic_start_mg_day',
      'elderly_start_mg_day',
      'taper_min_days',
      'storage_max_c',
      'regimens',
      'contraindicated_agents',
      'avoid_substances',
      'monitoring_metrics',
    ],
    properties: {
      inn: { type: 'string' },
      trade_name: { type: 'string' },
      dosage_form: { type: 'string' },
      route: {
        type: 'string',
        enum: ['oral', 'iv', 'im', 'sc', 'inhaled', 'topical', 'rectal', 'other'],
      },
      food_relation: {
        type: 'string',
        enum: ['independent', 'with_food', 'before_food', 'after_food', 'unspecified'],
      },
      rx_required: { type: ['boolean', 'null'] },
      strengths_mg: { type: 'array', items: { type: 'number' } },
      min_age_years: { type: ['number', 'null'] },
      pregnancy_allowed: { type: ['boolean', 'null'] },
      lactation_allowed: { type: ['boolean', 'null'] },
      renal_adjustment: {
        type: 'string',
        enum: ['none', 'reduce', 'contraindicated', 'unspecified'],
      },
      hepatic_start_mg_day: { type: ['number', 'null'] },
      elderly_start_mg_day: { type: ['number', 'null'] },
      taper_min_days: { type: ['number', 'null'] },
      storage_max_c: { type: ['number', 'null'] },
      regimens: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'indication',
            'doses_per_day',
            'day1_mg',
            'day2_mg',
            'day3_mg',
            'day4_mg',
            'target_min_mg_day',
            'target_max_mg_day',
            'max_mg_day',
            'min_mg_day',
          ],
          properties: {
            indication: { type: 'string' },
            doses_per_day: { type: ['number', 'null'] },
            day1_mg: { type: ['number', 'null'] },
            day2_mg: { type: ['number', 'null'] },
            day3_mg: { type: ['number', 'null'] },
            day4_mg: { type: ['number', 'null'] },
            target_min_mg_day: { type: ['number', 'null'] },
            target_max_mg_day: { type: ['number', 'null'] },
            max_mg_day: { type: ['number', 'null'] },
            min_mg_day: { type: ['number', 'null'] },
          },
        },
      },
      contraindicated_agents: { type: 'array', items: { type: 'string' } },
      avoid_substances: { type: 'array', items: { type: 'string' } },
      monitoring_metrics: { type: 'array', items: { type: 'string' } },
    },
  },
} as const;

const KR_JSON_SCHEMA = {
  name: 'kr_clinical_decision_schema',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['kr_id', 'condition', 'age_group', 'gather_inputs', 'rules', 'track_metrics'],
    properties: {
      kr_id: { type: 'string' },
      condition: { type: 'string' },
      age_group: { type: 'string', enum: ['children', 'adults', 'all'] },
      gather_inputs: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'kind', 'unit'],
          properties: {
            id: { type: 'string' },
            kind: { type: 'string', enum: ['number', 'boolean', 'select'] },
            unit: { type: ['string', 'null'] },
          },
        },
      },
      rules: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'when_expr', 'action', 'agent', 'route'],
          properties: {
            id: { type: 'string' },
            when_expr: { type: 'string' },
            action: { type: 'string', enum: ['recommend', 'consider', 'avoid'] },
            agent: { type: 'string' },
            route: {
              type: 'string',
              enum: ['oral', 'inhaled', 'nebulized', 'topical', 'supportive', 'other'],
            },
            dose_min: { type: ['number', 'null'] },
            dose_max: { type: ['number', 'null'] },
            dose_unit: {
              type: ['string', 'null'],
              enum: ['mg', 'mcg', 'ml', 'drops', 'puffs', null],
            },
            per_kg: { type: 'boolean' },
            max_daily: { type: ['number', 'null'] },
            max_daily_unit: {
              type: ['string', 'null'],
              enum: ['mg', 'mg_kg', 'ml', 'ml_kg', 'mcg', null],
            },
            freq_per_day_max: { type: ['number', 'null'] },
            duration_days_min: { type: ['number', 'null'] },
            duration_days_max: { type: ['number', 'null'] },
            age_min_y: { type: ['number', 'null'] },
            age_max_y: { type: ['number', 'null'] },
            uur: { type: ['string', 'null'], enum: ['A', 'B', 'C', null] },
            udd: { type: ['integer', 'null'], enum: [1, 2, 3, 4, 5, null] },
          },
        },
      },
      track_metrics: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['metric_id', 'check_after_hours', 'goal'],
          properties: {
            metric_id: { type: 'string' },
            check_after_hours: { type: ['number', 'null'] },
            goal: { type: 'string' },
          },
        },
      },
    },
  },
} as const;

function selectDrugClinicalSections(body: string, maxChars: number): string {
  // Deterministic section router: keep high-signal clinical sections (strengths, indications,
  // contraindications, pregnancy/interactions, dosing/titration, storage) and drop verbose
  // boilerplate (patient warnings wall, adverse-event catalog, manufacturer addresses) so the
  // entire dosing + safety surface fits inside a 4K-context local model.
  const headings = [...body.matchAll(/^#{1,3} .+$/gmu)];
  if (headings.length === 0) return body.slice(0, maxChars);

  const sections = headings.map((match, idx) => {
    const start = match.index ?? 0;
    const end = headings[idx + 1]?.index ?? body.length;
    return { heading: match[0], text: body.slice(start, end).trim() };
  });

  // Order clinical sections by signal priority so dosing/titration, indications, contraindications
  // and organ limits never get truncated out by verbose excipient paragraphs.
  const priorityRules: readonly { readonly pattern: RegExp; readonly maxLen?: number }[] = [
    { pattern: /общая информация/iu, maxLen: 400 },
    { pattern: /что из себя представляет|показания/iu, maxLen: 900 },
    { pattern: /противопоказания/iu, maxLen: 900 },
    { pattern: /прием препарата|способ применения и дозы/iu, maxLen: 2600 },
    { pattern: /фармакокинет/iu, maxLen: 800 },
    { pattern: /дети/iu, maxLen: 1200 },
    { pattern: /хранение/iu, maxLen: 400 },
  ];

  const picked: string[] = [];
  const used = new Set<number>();
  for (const rule of priorityRules) {
    for (let idx = 0; idx < sections.length; idx += 1) {
      if (used.has(idx)) continue;
      const sec = sections[idx];
      if (!sec || !rule.pattern.test(sec.heading)) continue;
      used.add(idx);
      let text = sec.text;
      if (/общая информация/iu.test(sec.heading)) {
        const cutIdx = text.indexOf('Перед приемом препарата полностью прочитайте');
        if (cutIdx > 0) text = text.slice(0, cutIdx).trim();
      }
      if (/дети/iu.test(sec.heading)) {
        const excIdx = text.indexOf('содержит лактозу');
        if (excIdx > 0) text = text.slice(0, excIdx).trim();
      }
      if (rule.maxLen && text.length > rule.maxLen) {
        text = `${text.slice(0, rule.maxLen)}…`;
      }
      picked.push(text);
    }
  }
  const rxLine = body.match(/Категория отпуска[\s\S]{0,180}/u)?.[0]?.trim();
  if (rxLine) picked.push(rxLine);

  const joined = picked.length > 0 ? picked.join('\n\n') : body;
  return joined.length > maxChars
    ? `${joined.slice(0, maxChars)}\n\n[...обрезано до ${maxChars} символов...]`
    : joined;
}

function prepareExcerpt(
  raw: string,
  mode: ExtractMode,
  sectionPattern: string | null,
  maxChars: number,
): string {
  const frontmatterMatch = /^---\n([\s\S]*?)\n---\s*/u.exec(raw);
  const frontmatterHeader = frontmatterMatch
    ? frontmatterMatch[1]
        ?.split('\n')
        .filter((line) => /^(id|title|version_label|age_groups):/u.test(line))
        .join('\n')
    : '';
  let body = raw.replace(/^---[\s\S]*?---\s*/u, '');
  body = body
    .replace(/<!--[\s\S]*?-->\s*/gu, '')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();

  if (sectionPattern) {
    const abbrMatch =
      mode === 'kr'
        ? /Список сокращений[\s\S]{0,1200}?(?=\nТермины и определения|\n1\. )/u.exec(body)
        : null;
    const regex = new RegExp(sectionPattern, 'mu');
    const match = regex.exec(body);
    if (match && match.index >= 0) {
      const sliced = body.slice(match.index);
      body = abbrMatch ? `${abbrMatch[0].trim()}\n\n${sliced}` : sliced;
    }
  } else if (mode === 'drug' && body.length > maxChars) {
    body = selectDrugClinicalSections(body, maxChars);
  }

  const combined = frontmatterHeader ? `${frontmatterHeader}\n\n${body}` : body;
  return combined.length > maxChars
    ? `${combined.slice(0, maxChars)}\n\n[...обрезано до ${maxChars} символов...]`
    : combined;
}

const options = parseArgs(process.argv.slice(2));
const raw = readFileSync(options.filePath, 'utf8');
const excerpt = prepareExcerpt(raw, options.mode, options.sectionPattern, options.maxChars);

const jsonSchema = options.mode === 'drug' ? DRUG_JSON_SCHEMA : KR_JSON_SCHEMA;

const compactFieldHint =
  options.mode === 'drug'
    ? 'Поля JSON: inn, trade_name, dosage_form, route(oral|iv|im|sc|inhaled|topical|rectal|other), food_relation(independent|with_food|before_food|after_food|unspecified), rx_required(bool|null), strengths_mg(number[]), min_age_years(number|null), pregnancy_allowed(bool|null), lactation_allowed(bool|null), renal_adjustment(none|reduce|contraindicated|unspecified), hepatic_start_mg_day(number|null), elderly_start_mg_day(number|null), taper_min_days(number|null), storage_max_c(number|null), regimens([{indication,doses_per_day,day1_mg,day2_mg,day3_mg,day4_mg,target_min_mg_day,target_max_mg_day,max_mg_day,min_mg_day}]), contraindicated_agents(string[]), avoid_substances(string[]), monitoring_metrics(string[]).'
    : 'Поля JSON: kr_id, condition, age_group(children|adults|all), gather_inputs([{id,kind(number|boolean|select),unit}]), rules([{id,when_expr,action(recommend|consider|avoid),agent,route(oral|inhaled|nebulized|topical|supportive|other), и только заданные в тексте опциональные поля: dose_min,dose_max,dose_unit(mg|mcg|ml|drops|puffs),per_kg(bool),max_daily,max_daily_unit(mg|mg_kg|ml|ml_kg|mcg),freq_per_day_max,duration_days_min,duration_days_max,age_min_y,age_max_y,uur(A|B|C),udd(1..5)}]), track_metrics([{metric_id,check_after_hours,goal}]). Не пиши null-поля в rules — опускай отсутствующие ключи.';

const systemPrompt =
  options.mode === 'drug'
    ? `Ты экстрактор структурированных клинических данных. Извлекай ТОЛЬКО факты, явно присутствующие в тексте инструкции. Используй числа, булевы флаги, enum и короткие коды без длинной прозы. Если факта нет в тексте — ставь null или []. Верни ТОЛЬКО компактный валидный JSON.\n${compactFieldHint}`
    : `Ты компилятор клинических рекомендаций (КР) в исполняемую схему правил (gather -> calculate -> track -> recommend). Извлекай ТОЛЬКО правила, дозы, пороги, УУР и УДД, явно указанные в тексте КР. В when_expr пиши короткие выражения (например "temp_c > 39.0", "bronchoobstruction == true", "suspected_mycoplasma == true && age_y >= 8"). Если поля нет — ставь null. Верни ТОЛЬКО компактный валидный JSON.\n${compactFieldHint}`;

const userPrompt =
  options.mode === 'drug'
    ? `Извлеки строго типизированную карточку препарата (числа, флаги, все схемы титрации и ограничения) из текста инструкции:\n\n${excerpt}`
    : `Закодируй фрагмент клинических рекомендаций в компактную схему правил принятия решений (входные параметры, правила назначений/запретов с дозами и УУР/УДД, метрики контроля):\n\n${excerpt}`;

const useInklingDirectCompletion =
  !options.thinking && options.model.toLowerCase().includes('inkling');

const startedAt = performance.now();
let content = '';
let reasoning = '';
let finishReason = 'unknown';
let usage: { readonly prompt_tokens?: number; readonly completion_tokens?: number } | undefined;
let timings:
  | {
      readonly prompt_per_second?: number;
      readonly predicted_per_second?: number;
      readonly draft_n?: number;
      readonly draft_n_accepted?: number;
    }
  | undefined;

if (useInklingDirectCompletion) {
  // Prefill directly into Inkling's <|content_text|> block with GBNF json_schema so structured
  // extraction skips verbose reasoning and emits schema-valid JSON immediately inside the 4K window.
  const prompt =
    `<|message_system|><|content_text|>${systemPrompt}<|end_message|>` +
    `<|message_user|><|content_text|>${userPrompt}<|end_message|>` +
    `<|message_model|><|content_thinking|><|end_message|>` +
    `<|message_model|><|content_text|>`;

  const response = await fetch(`${options.baseUrl}/completion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      temperature: 0,
      n_predict: options.maxTokens,
      json_schema: jsonSchema.schema,
      stop: ['<|end_message|>'],
    }),
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errText}`);
  }
  const payload = (await response.json()) as {
    readonly content?: string;
    readonly stop_type?: string;
    readonly tokens_evaluated?: number;
    readonly tokens_predicted?: number;
    readonly timings?: typeof timings;
  };
  content = (payload.content ?? '').trim();
  finishReason = payload.stop_type ?? 'stop';
  usage = {
    prompt_tokens: payload.tokens_evaluated,
    completion_tokens: payload.tokens_predicted,
  };
  timings = payload.timings;
} else {
  const response = await fetch(`${options.baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: options.model,
      temperature: 0,
      max_tokens: options.maxTokens,
      response_format: {
        type: 'json_schema',
        json_schema: jsonSchema,
      },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errText}`);
  }

  const payload = (await response.json()) as {
    readonly choices?: readonly {
      readonly finish_reason?: string;
      readonly message?: { readonly content?: string; readonly reasoning_content?: string };
    }[];
    readonly usage?: typeof usage;
    readonly timings?: typeof timings;
  };
  content = payload.choices?.[0]?.message?.content ?? '';
  reasoning = payload.choices?.[0]?.message?.reasoning_content ?? '';
  finishReason = payload.choices?.[0]?.finish_reason ?? 'unknown';
  usage = payload.usage;
  timings = payload.timings;
}

const elapsedSec = (performance.now() - startedAt) / 1000;

let parsed: unknown = null;
let parseError: string | null = null;
try {
  parsed = JSON.parse(content);
} catch (err) {
  parseError = err instanceof Error ? err.message : String(err);
}

const compactJsonBytes = parsed !== null ? Buffer.byteLength(JSON.stringify(parsed), 'utf8') : 0;
const sourceBytes = Buffer.byteLength(excerpt, 'utf8');

console.log('=== RUN ===');
console.log(
  JSON.stringify(
    {
      mode: options.mode,
      model: options.model,
      thinking: options.thinking,
      filePath: options.filePath,
      excerptChars: excerpt.length,
      sourceBytes,
      compactJsonBytes,
      compressionRatio:
        compactJsonBytes > 0 ? Number((sourceBytes / compactJsonBytes).toFixed(1)) : null,
      reasoningChars: reasoning.length,
      finishReason,
      jsonValid: parseError === null,
      parseError,
    },
    null,
    2,
  ),
);

console.log('\n=== EXTRACTED JSON ===');
console.log(parsed !== null ? JSON.stringify(parsed, null, 2) : content);

console.log('\n=== TIMINGS ===');
const draftAcceptance =
  timings?.draft_n && timings.draft_n > 0
    ? Number((((timings.draft_n_accepted ?? 0) / timings.draft_n) * 100).toFixed(1))
    : null;
console.log(
  JSON.stringify(
    {
      elapsedSec: Number(elapsedSec.toFixed(2)),
      usage,
      promptTokPerSec: timings?.prompt_per_second
        ? Number(timings.prompt_per_second.toFixed(1))
        : null,
      decodeTokPerSec: timings?.predicted_per_second
        ? Number(timings.predicted_per_second.toFixed(1))
        : null,
      draftAcceptancePct: draftAcceptance,
    },
    null,
    2,
  ),
);

const metricsRes = await fetch(`${options.baseUrl}/metrics`).catch(() => null);
if (metricsRes?.ok) {
  const metrics = await metricsRes.text();
  const budgetLines = metrics
    .split('\n')
    .filter((line) => !line.startsWith('#') && /engine_memory_budget|memory/i.test(line));
  console.log('\n=== ATOMIC ENGINE MEMORY METRICS ===');
  for (const line of budgetLines) console.log(line);
}
