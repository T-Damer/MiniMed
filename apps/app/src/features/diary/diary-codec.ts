import {
  DIARY_FORMAT_VERSION,
  type DiaryEntry,
  DiaryFormatError,
  type DiaryInvitation,
  type DiaryResults,
  GLUCOSE_CONTEXTS,
  isBloodPressureEntry,
  isGlucoseEntry,
  parseDiaryInvitation,
  parseDiaryResults,
} from '@/features/diary/diary-model';

/**
 * Transport for invitations (a URL fragment) and results (one or more QR codes).
 * Payload text: `z` + base64url(deflate-raw(JSON)) or `j` + base64url(JSON) when the runtime
 * has no CompressionStream. The fragment is never sent to a web server.
 */

const RESULT_PREFIX = 'MMD1';
/** Characters of payload per QR code: small enough for a phone camera to read reliably. */
export const DIARY_QR_CHUNK = 700;
const MAX_PARTS = 40;
const MAX_PAYLOAD = DIARY_QR_CHUNK * MAX_PARTS;
/** Enough for 1,500 validated entries while bounding decompression before JSON.parse. */
export const MAX_DIARY_JSON_BYTES = 1024 * 1024;

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/u.test(value)) throw new DiaryFormatError('Повреждённые данные дневника.');
  const padded = value.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function transform(
  bytes: Uint8Array<ArrayBuffer>,
  stream: CompressionStream,
): Promise<Uint8Array<ArrayBuffer>> {
  const output = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(output).arrayBuffer());
}

async function decompressBounded(
  bytes: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      const chunk = Uint8Array.from(next.value);
      total += chunk.byteLength;
      if (total > MAX_DIARY_JSON_BYTES) {
        await reader.cancel();
        throw new DiaryFormatError('Распакованные данные дневника слишком велики.');
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export async function encodePayload(value: unknown): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(value));
  if (json.byteLength > MAX_DIARY_JSON_BYTES) {
    throw new DiaryFormatError('Данные дневника слишком велики.');
  }
  if (typeof CompressionStream === 'undefined') return `j${toBase64Url(json)}`;
  return `z${toBase64Url(await transform(json, new CompressionStream('deflate-raw')))}`;
}

export async function decodePayload(text: string): Promise<unknown> {
  if (text.length > MAX_PAYLOAD) throw new DiaryFormatError('Данные дневника слишком велики.');
  const mode = text[0];
  const bytes = fromBase64Url(text.slice(1));
  let json: Uint8Array<ArrayBuffer>;
  if (mode === 'j') {
    if (bytes.byteLength > MAX_DIARY_JSON_BYTES) {
      throw new DiaryFormatError('Данные дневника слишком велики.');
    }
    json = bytes;
  } else if (mode === 'z') {
    if (typeof DecompressionStream === 'undefined') {
      throw new DiaryFormatError('Браузер не умеет распаковывать сжатые данные дневника.');
    }
    try {
      json = await decompressBounded(bytes);
    } catch (cause) {
      if (cause instanceof DiaryFormatError) throw cause;
      throw new DiaryFormatError('Повреждённые данные дневника.', { cause });
    }
  } else throw new DiaryFormatError('Неизвестный формат данных дневника.');
  try {
    return JSON.parse(new TextDecoder().decode(json)) as unknown;
  } catch (cause) {
    throw new DiaryFormatError('Повреждённые данные дневника.', { cause });
  }
}

// --- Invitation link -------------------------------------------------------------------------

export async function diaryInvitationLink(
  invitation: DiaryInvitation,
  pageUrl: string,
): Promise<string> {
  const url = new URL(pageUrl);
  url.hash = `i=${await encodePayload(invitation)}`;
  return url.toString();
}

/** Reads `#i=...` from a diary page URL fragment; returns null when there is none. */
export async function readInvitationFragment(
  hash: string,
  now = Date.now(),
): Promise<DiaryInvitation | null> {
  const match = /^#?i=([jz][A-Za-z0-9_-]+)$/u.exec(hash);
  if (!match?.[1]) return null;
  return parseDiaryInvitation(await decodePayload(match[1]), now);
}

// --- Results as QR parts ---------------------------------------------------------------------

type WireEntry = readonly (string | number)[];

function minutes(iso: string): number {
  return Math.round(Date.parse(iso) / 60_000);
}

function fromMinutes(value: unknown): string | unknown {
  return typeof value === 'number' && Number.isInteger(value)
    ? new Date(value * 60_000).toISOString()
    : value;
}

function entryToWire(entry: DiaryEntry): WireEntry {
  const note = entry.note ? [entry.note] : [];
  if (isBloodPressureEntry(entry)) {
    return [
      entry.id,
      minutes(entry.at),
      entry.systolic,
      entry.diastolic,
      entry.pulse ?? 0,
      ...note,
    ];
  }
  if (isGlucoseEntry(entry)) {
    return [
      entry.id,
      minutes(entry.at),
      Math.round(entry.mmol * 10),
      GLUCOSE_CONTEXTS.indexOf(entry.context),
      ...note,
    ];
  }
  return [entry.id, minutes(entry.at), entry.medication, entry.taken ? 1 : 0, ...note];
}

function entryFromWire(kind: DiaryInvitation['kind'], wire: unknown): unknown {
  if (!Array.isArray(wire) || wire.length < 4 || wire.length > 6) {
    throw new DiaryFormatError('Повреждённая запись дневника.');
  }
  const [id, at, first, second, third, fourth] = wire as unknown[];
  switch (kind) {
    case 'blood-pressure':
      return {
        id,
        at: fromMinutes(at),
        systolic: first,
        diastolic: second,
        ...(third === 0 || third === undefined ? {} : { pulse: third }),
        ...(fourth === undefined ? {} : { note: fourth }),
      };
    case 'glucose':
      return {
        id,
        at: fromMinutes(at),
        mmol: typeof first === 'number' ? first / 10 : first,
        context: typeof second === 'number' ? GLUCOSE_CONTEXTS[second] : second,
        ...(third === undefined ? {} : { note: third }),
      };
    case 'medication':
      return {
        id,
        at: fromMinutes(at),
        medication: first,
        taken: second === 1 ? true : second === 0 ? false : second,
        ...(third === undefined ? {} : { note: third }),
      };
  }
}

async function checksum(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return toBase64Url(new Uint8Array(digest).slice(0, 6));
}

/** Splits results into QR texts `MMD1.<sum>.<index>.<count>.<chunk>`, 1-based index. */
export async function encodeDiaryResults(results: DiaryResults): Promise<readonly string[]> {
  const payload = await encodePayload([
    DIARY_FORMAT_VERSION,
    results.invitation,
    results.entries.map(entryToWire),
  ]);
  if (payload.length > MAX_PAYLOAD) {
    throw new DiaryFormatError('В дневнике слишком много записей для передачи кодами.');
  }
  const sum = await checksum(payload);
  const count = Math.max(1, Math.ceil(payload.length / DIARY_QR_CHUNK));
  return Array.from(
    { length: count },
    (_, index) =>
      `${RESULT_PREFIX}.${sum}.${index + 1}.${count}.${payload.slice(index * DIARY_QR_CHUNK, (index + 1) * DIARY_QR_CHUNK)}`,
  );
}

export interface DiaryPart {
  readonly sum: string;
  readonly index: number;
  readonly count: number;
  readonly chunk: string;
}

export function parseDiaryPart(text: string): DiaryPart | null {
  const match = /^MMD1\.([A-Za-z0-9_-]{8})\.(\d{1,2})\.(\d{1,2})\.([A-Za-z0-9_-]+)$/u.exec(
    text.trim(),
  );
  if (!match) return null;
  const index = Number(match[2]);
  const count = Number(match[3]);
  const chunk = match[4] ?? '';
  if (
    count < 1 ||
    count > MAX_PARTS ||
    index < 1 ||
    index > count ||
    chunk.length === 0 ||
    chunk.length > DIARY_QR_CHUNK
  ) {
    return null;
  }
  return { sum: match[1] ?? '', index, count, chunk };
}

/** Collects scanned parts in any order; ignores duplicates and parts of another transfer. */
export class DiaryPartCollector {
  private sum: string | null = null;
  private count = 0;
  private readonly chunks = new Map<number, string>();

  /** Returns false when the text is not a diary code or belongs to another transfer. */
  add(text: string): boolean {
    const part = parseDiaryPart(text);
    if (!part) return false;
    if (this.sum === null) {
      this.sum = part.sum;
      this.count = part.count;
    }
    if (part.sum !== this.sum || part.count !== this.count) return false;
    this.chunks.set(part.index, part.chunk);
    return true;
  }

  get received(): number {
    return this.chunks.size;
  }

  get total(): number {
    return this.count;
  }

  get complete(): boolean {
    return this.count > 0 && this.chunks.size === this.count;
  }

  reset(): void {
    this.sum = null;
    this.count = 0;
    this.chunks.clear();
  }

  async results(now = Date.now()): Promise<DiaryResults> {
    if (!this.complete || this.sum === null) {
      throw new DiaryFormatError('Отсканированы не все коды дневника.');
    }
    const payload = Array.from({ length: this.count }, (_, index) =>
      this.chunks.get(index + 1),
    ).join('');
    if ((await checksum(payload)) !== this.sum) {
      throw new DiaryFormatError('Контрольная сумма не совпала: отсканируйте коды заново.');
    }
    return decodeDiaryResultsPayload(payload, now);
  }
}

export async function decodeDiaryResultsPayload(
  payload: string,
  now = Date.now(),
): Promise<DiaryResults> {
  const value = await decodePayload(payload);
  if (!Array.isArray(value) || value.length !== 3 || !Array.isArray(value[2])) {
    throw new DiaryFormatError('Повреждённые данные дневника.');
  }
  const invitation = parseDiaryInvitation(value[1], now);
  return parseDiaryResults(
    {
      v: value[0],
      invitation,
      entries: (value[2] as unknown[]).map((wire) => entryFromWire(invitation.kind, wire)),
    },
    now,
  );
}
