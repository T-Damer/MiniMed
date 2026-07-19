import type { EmbeddingProfile, QuantizedEmbeddingVector } from '@localmed/contracts';

import { PORTABLE_HASH_PROFILE } from './profile';

const WORD_WEIGHT = 4;
const BIGRAM_WEIGHT = 3;
const TRIGRAM_WEIGHT = 1;
const MAX_QUANTIZED_VALUE = 127;
const UTF8_ENCODER = new TextEncoder();

export interface QueryEmbedder {
  readonly profile: EmbeddingProfile;
  embedQuery(text: string): Promise<QuantizedEmbeddingVector>;
}

function normalizeText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('ru-RU')
    .replaceAll('ё', 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function tokens(value: string): readonly string[] {
  const normalized = normalizeText(value);
  return normalized.length === 0 ? [] : normalized.split(' ').filter((token) => token.length >= 2);
}

function fnv1a32(value: string): number {
  let hash = 0x811c9dc5;
  for (const byte of UTF8_ENCODER.encode(value)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function addFeature(accumulator: Int32Array, feature: string, weight: number): void {
  const hash = fnv1a32(feature);
  const index = (hash & 0x7fff_ffff) % accumulator.length;
  const sign = (hash & 0x8000_0000) === 0 ? 1 : -1;
  accumulator[index] = (accumulator[index] ?? 0) + sign * weight;
}

function addTokenFeatures(accumulator: Int32Array, sourceTokens: readonly string[]): void {
  for (const [index, token] of sourceTokens.entries()) {
    addFeature(accumulator, `w:${token}`, WORD_WEIGHT);
    const next = sourceTokens[index + 1];
    if (next) addFeature(accumulator, `b:${token}\u0000${next}`, BIGRAM_WEIGHT);

    const codePoints = [...token];
    if (codePoints.length < 3) {
      addFeature(accumulator, `c:${token}`, TRIGRAM_WEIGHT);
      continue;
    }
    for (let offset = 0; offset <= codePoints.length - 3; offset += 1) {
      addFeature(accumulator, `c:${codePoints.slice(offset, offset + 3).join('')}`, TRIGRAM_WEIGHT);
    }
  }
}

function quantize(accumulator: Int32Array): number[] {
  let squaredNorm = 0;
  for (const value of accumulator) squaredNorm += value * value;
  if (squaredNorm === 0) return Array.from({ length: accumulator.length }, () => 0);

  const norm = Math.sqrt(squaredNorm);
  return Array.from(accumulator, (value) => {
    const scaled = (value / norm) * MAX_QUANTIZED_VALUE;
    const rounded = Math.sign(scaled) * Math.floor(Math.abs(scaled) + 0.5);
    return Math.max(-MAX_QUANTIZED_VALUE, Math.min(MAX_QUANTIZED_VALUE, rounded));
  });
}

export function embedPortableText(
  text: string,
  profile: EmbeddingProfile = PORTABLE_HASH_PROFILE,
): QuantizedEmbeddingVector {
  if (profile.vectorFormat !== 'int8' || profile.normalization !== 'l2') {
    throw new Error(`Unsupported embedding profile: ${profile.id}`);
  }
  const accumulator = new Int32Array(profile.dimensions);
  addTokenFeatures(accumulator, tokens(text));
  const values = quantize(accumulator);
  return {
    profileId: profile.id,
    values,
    norm: vectorNorm(values),
  };
}

export function vectorNorm(values: readonly number[]): number {
  let squaredNorm = 0;
  for (const value of values) squaredNorm += value * value;
  return Math.sqrt(squaredNorm);
}

export function cosineInt8(
  left: readonly number[],
  right: readonly number[],
  leftNorm = vectorNorm(left),
  rightNorm = vectorNorm(right),
): number {
  if (left.length !== right.length) {
    throw new RangeError(`Vector dimension mismatch: ${left.length} !== ${right.length}`);
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  let dot = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += (left[index] ?? 0) * (right[index] ?? 0);
  }
  return Math.max(-1, Math.min(1, dot / (leftNorm * rightNorm)));
}

export class PortableHashEmbedder implements QueryEmbedder {
  public readonly profile: EmbeddingProfile;

  public constructor(profile: EmbeddingProfile = PORTABLE_HASH_PROFILE) {
    this.profile = profile;
  }

  public async embedQuery(text: string): Promise<QuantizedEmbeddingVector> {
    return embedPortableText(text, this.profile);
  }
}
