import type { VisitNoteDraft, VisitNoteQuoteSource } from '@localmed/contracts';

import { buildVisitNoteDraft, type VisitNoteSources } from './visit-note-draft';
import { visitNoteLineNumber } from './visit-note-lines';

/**
 * Local-model pass of the visit-note draft (SCRIBE1). The sources go to the model window by window,
 * because the bundled models read about 2 000 tokens at a time; every window asks for statements
 * with their own verbatim quote, the answers are merged per field, and `buildVisitNoteDraft` then
 * keeps only what it can locate. The model never sees its earlier answers, so a window it misreads
 * costs that window only. With `citation: 'line'` the source lines go numbered and every statement
 * cites its line numbers instead of quoting (`locateLines`), for models that paraphrase quotes.
 */

/** One completion; resolves with the parsed JSON of the answer, or null when it had none. */
export interface VisitNoteModelRequest {
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly maxTokens: number;
}

/** Port to whichever local model runs on the device. */
export interface VisitNoteModel {
  complete(request: VisitNoteModelRequest): Promise<unknown>;
}

export interface VisitNoteModelOptions {
  readonly signal?: AbortSignal;
  /** Called after every window with how many are done out of all. */
  readonly onProgress?: (done: number, total: number) => void;
  /** Source characters per window; the default fits a 2 048-token context with the answer. */
  readonly windowChars?: number;
  /** How a statement points into the source: a verbatim quote (default) or line numbers. */
  readonly citation?: VisitNoteCitation;
}

export type VisitNoteCitation = 'quote' | 'line';

export interface VisitNoteModelResult {
  readonly draft: VisitNoteDraft;
  readonly windows: number;
  /** Windows whose answer held no JSON object; they add nothing to the draft. */
  readonly unreadableWindows: number;
}

export const VISIT_NOTE_WINDOW_CHARS = 1_600;
export const VISIT_NOTE_ANSWER_TOKENS = 512;

const FIELD_GUIDE = [
  'complaints — жалобы',
  'anamnesisMorbi — анамнез заболевания: начало, течение, лечение до приёма',
  'anamnesisVitae — анамнез жизни, хронические болезни, операции',
  'allergies — аллергии и непереносимость',
  'examination — объективный осмотр',
  'diagnoses — диагнозы',
  'medications — принимаемые и назначенные лекарства с дозами',
  'plan — обследования, рекомендации, повторный приём',
].join('\n');

const CITATION_RULES: Readonly<Record<VisitNoteCitation, readonly string[]>> = {
  quote: [
    'Значение — массив пунктов {"text": "кратко, медицинским языком", "quote": "точные слова из текста, 3–12 слов подряд"}.',
    'Пиши только то, что есть в тексте. У каждого пункта своя цитата, слово в слово. Если сказано с отрицанием, цитата начинается с отрицания.',
    'Пример: {"complaints": [{"text": "Давящая боль в груди при ходьбе", "quote": "давит в груди при ходьбе"}]}',
  ],
  line: [
    'Строки текста пронумерованы: «номер| строка». Значение — массив пунктов {"text": "кратко, медицинским языком", "line": номер строки}. Если ответ пациента понятен только с вопросом врача, укажи обе строки: "line": [7, 8].',
    'Пиши только то, что есть в тексте, по одному факту в пункте. Отрицание пиши явно: «Аллергии нет».',
    'Пример: {"complaints": [{"text": "Давящая боль в груди при ходьбе", "line": 2}], "allergies": [{"text": "Аллергии нет", "line": [7, 8]}]}',
  ],
};

export function visitNoteSystemPrompt(
  remote: boolean,
  citation: VisitNoteCitation = 'quote',
): string {
  const lines = [
    'Ты составляешь черновик протокола приёма. Не рассуждай. Верни только один JSON-объект.',
    `Ключи, пустые пропускай:\n${FIELD_GUIDE}`,
    ...CITATION_RULES[citation],
  ];
  if (remote) {
    lines.push(
      'Приём дистанционный: в осмотр — только то, что видно на камере или известно со слов пациента; пальпации, перкуссии и аускультации не было.',
    );
  }
  return lines.join('\n\n');
}

const SOURCE_TITLE: Readonly<Record<VisitNoteQuoteSource, string>> = {
  transcript: 'Запись приёма, реплики врача и пациента',
  'prior-record': 'Прежняя медицинская запись пациента',
};

export function visitNoteUserPrompt(
  source: VisitNoteQuoteSource,
  window: string,
  position: number,
  total: number,
): string {
  return `${SOURCE_TITLE[source]}, фрагмент ${position} из ${total}:\n\n${window}`;
}

/**
 * Packs whole lines into windows of at most `maxChars`; a longer line is cut at the last space
 * before the limit. The last line of a window opens the next one when it is short, so a statement
 * split across speech segments is read with its neighbour; duplicates are removed by the builder.
 */
export function splitVisitNoteWindows(lines: readonly string[], maxChars: number): string[] {
  const pieces = lines
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => cutLine(line, maxChars));
  const windows: string[] = [];
  let current: string[] = [];
  let size = 0;
  for (const piece of pieces) {
    if (current.length > 0 && size + 1 + piece.length > maxChars) {
      windows.push(current.join('\n'));
      const carried = current.at(-1) as string;
      const carry = carried.length <= maxChars / 4 && carried.length + 1 + piece.length <= maxChars;
      current = carry ? [carried] : [];
      size = carry ? carried.length : 0;
    }
    size += (current.length > 0 ? 1 : 0) + piece.length;
    current.push(piece);
  }
  if (current.length > 0) windows.push(current.join('\n'));
  return windows;
}

function cutLine(line: string, maxChars: number): string[] {
  const pieces: string[] = [];
  let rest = line;
  while (rest.length > maxChars) {
    const space = rest.lastIndexOf(' ', maxChars);
    const cut = space > maxChars / 2 ? space : maxChars;
    pieces.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) pieces.push(rest);
  return pieces;
}

export async function draftVisitNoteWithModel(
  model: VisitNoteModel,
  sources: VisitNoteSources,
  options: VisitNoteModelOptions = {},
): Promise<VisitNoteModelResult> {
  const windowChars = options.windowChars ?? VISIT_NOTE_WINDOW_CHARS;
  const citation = options.citation ?? 'quote';
  const promptLines = (source: VisitNoteQuoteSource, lines: readonly string[]) =>
    citation === 'quote'
      ? lines
      : lines.map((line, index) =>
          line.trim() ? `${visitNoteLineNumber(sources, source, index)}| ${line.trim()}` : '',
        );
  const jobs = (['transcript', 'prior-record'] as const).flatMap((source) =>
    splitVisitNoteWindows(
      promptLines(
        source,
        (source === 'transcript' ? sources.transcript : sources.priorRecord) ?? [],
      ),
      windowChars,
    ).map((text) => ({ source, text })),
  );
  const systemPrompt = visitNoteSystemPrompt(sources.remote, citation);
  // A Map, not an object: the keys come from the model, and «__proto__» must stay a plain key.
  const fields = new Map<string, unknown[]>();
  let unreadableWindows = 0;
  for (const [index, job] of jobs.entries()) {
    options.signal?.throwIfAborted();
    const answer = await model.complete({
      systemPrompt,
      userPrompt: visitNoteUserPrompt(job.source, job.text, index + 1, jobs.length),
      maxTokens: VISIT_NOTE_ANSWER_TOKENS,
    });
    options.signal?.throwIfAborted();
    if (answer !== null && typeof answer === 'object' && !Array.isArray(answer)) {
      for (const [key, value] of Object.entries(answer)) {
        const items = fields.get(key) ?? [];
        if (Array.isArray(value)) items.push(...value);
        else items.push(value);
        fields.set(key, items);
      }
    } else {
      unreadableWindows += 1;
    }
    options.onProgress?.(index + 1, jobs.length);
  }
  return {
    draft: buildVisitNoteDraft({ fields: Object.fromEntries(fields) }, sources),
    windows: jobs.length,
    unreadableWindows,
  };
}
