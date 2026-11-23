/**
 * WebAssembly runtime bridge for `@localmed/search-lexical`'s RapidFuzz OSA / Levenshtein kernels.
 *
 * Uses native 64-bit WASM `i64` bit-parallel arithmetic (zero per-character JS `BigInt` allocations)
 * and packs choice vocabularies once into linear memory (`WeakMap` + `FinalizationRegistry`) so
 * `extractTop` scans tens of thousands of drug names in a single JS→WASM call on Web, iPhone
 * Safari, iOS, and Android. Falls back cleanly to the pure TypeScript implementation if
 * WebAssembly instantiation is unavailable.
 */

import { RAPIDFUZZ_WASM_BASE64 } from './rapidfuzz-wasm-bytes';

interface LexicalWasmExports {
  readonly memory: WebAssembly.Memory;
  readonly _initialize?: () => void;
  readonly malloc: (bytes: number) => number;
  readonly free: (ptr: number) => void;
  readonly osa_distance_u16: (aPtr: number, aLen: number, bPtr: number, bLen: number) => number;
  readonly levenshtein_distance_u16: (
    aPtr: number,
    aLen: number,
    bPtr: number,
    bLen: number,
  ) => number;
  readonly extract_top_u16: (
    queryPtr: number,
    queryLen: number,
    choicesBufPtr: number,
    offsetsPtr: number,
    lengthsPtr: number,
    numChoices: number,
    scoreCutoff: number,
    limit: number,
    metric: number,
    outIndicesPtr: number,
    outScoresPtr: number,
  ) => number;
}

interface PackedChoices {
  readonly count: number;
  readonly bufPtr: number;
  readonly offsetsPtr: number;
  readonly lengthsPtr: number;
}

interface WasmState {
  readonly exports: LexicalWasmExports;
  u16: Uint16Array;
  u32: Uint32Array;
  f64: Float64Array;
  scratchPtr: number;
  scratchCapU16: number;
}

let wasmState: WasmState | null | undefined;

const packedChoicesCache = new WeakMap<readonly string[], PackedChoices>();
const packedFinalizer =
  typeof FinalizationRegistry === 'function'
    ? new FinalizationRegistry<PackedChoices>((entry) => {
        if (!wasmState) return;
        wasmState.exports.free(entry.bufPtr);
        wasmState.exports.free(entry.offsetsPtr);
        wasmState.exports.free(entry.lengthsPtr);
      })
    : undefined;

function decodeBase64(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function refreshViews(state: WasmState): void {
  const buffer = state.exports.memory.buffer;
  if (state.u16.buffer !== buffer) {
    state.u16 = new Uint16Array(buffer);
    state.u32 = new Uint32Array(buffer);
    state.f64 = new Float64Array(buffer);
  }
}

function getWasmState(): WasmState | null {
  if (wasmState !== undefined) return wasmState;
  if (typeof WebAssembly === 'undefined') {
    wasmState = null;
    return null;
  }
  try {
    const bytes = decodeBase64(RAPIDFUZZ_WASM_BASE64);
    const mod = new WebAssembly.Module(bytes);
    let stateRef: WasmState | undefined;
    const instance = new WebAssembly.Instance(mod, {
      env: {
        emscripten_notify_memory_growth: () => {
          if (stateRef) refreshViews(stateRef);
        },
      },
    });
    const exports = instance.exports as unknown as LexicalWasmExports;
    exports._initialize?.();
    const initialCap = 1024;
    const scratchPtr = exports.malloc(initialCap * 2);
    if (!scratchPtr) {
      wasmState = null;
      return null;
    }
    const buf = exports.memory.buffer;
    stateRef = {
      exports,
      u16: new Uint16Array(buf),
      u32: new Uint32Array(buf),
      f64: new Float64Array(buf),
      scratchPtr,
      scratchCapU16: initialCap,
    };
    wasmState = stateRef;
    return stateRef;
  } catch {
    wasmState = null;
    return null;
  }
}

function ensureScratch(state: WasmState, neededU16: number): number {
  if (neededU16 <= state.scratchCapU16) return state.scratchPtr;
  const nextCap = Math.max(neededU16, state.scratchCapU16 * 2);
  const nextPtr = state.exports.malloc(nextCap * 2);
  if (!nextPtr) return 0;
  state.exports.free(state.scratchPtr);
  state.scratchPtr = nextPtr;
  state.scratchCapU16 = nextCap;
  refreshViews(state);
  return nextPtr;
}

function writeStringU16(state: WasmState, bytePtr: number, text: string): void {
  refreshViews(state);
  const offset = bytePtr >>> 1;
  const view = state.u16;
  for (let i = 0; i < text.length; i += 1) {
    view[offset + i] = text.charCodeAt(i);
  }
}

function getOrPackChoices(state: WasmState, choices: readonly string[]): PackedChoices | null {
  const existing = packedChoicesCache.get(choices);
  if (existing && existing.count === choices.length) return existing;

  let totalU16 = 0;
  for (let i = 0; i < choices.length; i += 1) {
    totalU16 += (choices[i] as string).length;
  }
  const bufPtr = state.exports.malloc(Math.max(2, totalU16 * 2));
  const offsetsPtr = state.exports.malloc(Math.max(4, choices.length * 4));
  const lengthsPtr = state.exports.malloc(Math.max(4, choices.length * 4));
  if (!bufPtr || !offsetsPtr || !lengthsPtr) {
    if (bufPtr) state.exports.free(bufPtr);
    if (offsetsPtr) state.exports.free(offsetsPtr);
    if (lengthsPtr) state.exports.free(lengthsPtr);
    return null;
  }
  refreshViews(state);
  const u16 = state.u16;
  const u32 = state.u32;
  const bufBase = bufPtr >>> 1;
  const offBase = offsetsPtr >>> 2;
  const lenBase = lengthsPtr >>> 2;
  let cursor = 0;
  for (let i = 0; i < choices.length; i += 1) {
    const s = choices[i] as string;
    u32[offBase + i] = cursor;
    u32[lenBase + i] = s.length;
    for (let j = 0; j < s.length; j += 1) {
      u16[bufBase + cursor + j] = s.charCodeAt(j);
    }
    cursor += s.length;
  }
  const entry: PackedChoices = {
    count: choices.length,
    bufPtr,
    offsetsPtr,
    lengthsPtr,
  };
  packedChoicesCache.set(choices, entry);
  packedFinalizer?.register(choices, entry);
  return entry;
}

export function isRapidfuzzWasmReady(): boolean {
  return getWasmState() !== null;
}

export function wasmPairDistance(
  left: string,
  right: string,
  metric: 'osa' | 'levenshtein',
): number | undefined {
  const state = getWasmState();
  if (!state) return undefined;
  const needed = left.length + right.length;
  const basePtr = ensureScratch(state, Math.max(1, needed));
  if (!basePtr) return undefined;
  const leftPtr = basePtr;
  const rightPtr = basePtr + left.length * 2;
  writeStringU16(state, leftPtr, left);
  writeStringU16(state, rightPtr, right);
  return metric === 'osa'
    ? state.exports.osa_distance_u16(leftPtr, left.length, rightPtr, right.length)
    : state.exports.levenshtein_distance_u16(leftPtr, left.length, rightPtr, right.length);
}

export interface WasmExtractMatch {
  readonly choice: string;
  readonly score: number;
  readonly index: number;
}

export function wasmExtractTopStrings(
  query: string,
  choices: readonly string[],
  limit: number,
  scoreCutoff: number,
  metric: 'osa' | 'levenshtein',
): WasmExtractMatch[] | undefined {
  const state = getWasmState();
  if (!state) return undefined;
  if (limit <= 0 || choices.length === 0) return [];
  const packed = getOrPackChoices(state, choices);
  if (!packed) return undefined;

  const cap = Math.min(limit, choices.length);
  const queryPtr = ensureScratch(state, Math.max(1, query.length));
  if (!queryPtr) return undefined;
  writeStringU16(state, queryPtr, query);

  const outIndicesPtr = state.exports.malloc(cap * 4);
  const outScoresPtr = state.exports.malloc(cap * 8);
  if (!outIndicesPtr || !outScoresPtr) {
    if (outIndicesPtr) state.exports.free(outIndicesPtr);
    if (outScoresPtr) state.exports.free(outScoresPtr);
    return undefined;
  }

  try {
    const count = state.exports.extract_top_u16(
      queryPtr,
      query.length,
      packed.bufPtr,
      packed.offsetsPtr,
      packed.lengthsPtr,
      packed.count,
      scoreCutoff,
      cap,
      metric === 'osa' ? 0 : 1,
      outIndicesPtr,
      outScoresPtr,
    );
    refreshViews(state);
    const results: WasmExtractMatch[] = new Array(count);
    const idxBase = outIndicesPtr >>> 2;
    const scoreBase = outScoresPtr >>> 3;
    for (let i = 0; i < count; i += 1) {
      const index = state.u32[idxBase + i] as number;
      const score = state.f64[scoreBase + i] as number;
      results[i] = { choice: choices[index] as string, score, index };
    }
    return results;
  } finally {
    state.exports.free(outIndicesPtr);
    state.exports.free(outScoresPtr);
  }
}
