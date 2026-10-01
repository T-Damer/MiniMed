/**
 * Incremental SHA-256 (FIPS 180-4). Web Crypto only offers a one-shot digest, which would force a
 * module index of hundreds of megabytes to be held in memory just to verify it; the streaming
 * installer hashes each decoded chunk as it is written instead.
 */

const K = Uint32Array.from([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const BLOCK_BYTES = 64;

export class Sha256Stream {
  private readonly state = Uint32Array.from([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  private readonly pending = new Uint8Array(BLOCK_BYTES);
  private readonly schedule = new Uint32Array(64);
  private pendingBytes = 0;
  private totalBytes = 0;
  private finished = false;

  public update(bytes: Uint8Array): this {
    if (this.finished) throw new Error('SHA-256 stream is already finished.');
    this.totalBytes += bytes.byteLength;
    let offset = 0;
    if (this.pendingBytes > 0) {
      const take = Math.min(BLOCK_BYTES - this.pendingBytes, bytes.byteLength);
      this.pending.set(bytes.subarray(0, take), this.pendingBytes);
      this.pendingBytes += take;
      offset = take;
      if (this.pendingBytes < BLOCK_BYTES) return this;
      this.compress(this.pending, 0);
      this.pendingBytes = 0;
    }
    const wholeBlocksEnd =
      offset + Math.floor((bytes.byteLength - offset) / BLOCK_BYTES) * BLOCK_BYTES;
    for (; offset < wholeBlocksEnd; offset += BLOCK_BYTES) this.compress(bytes, offset);
    if (offset < bytes.byteLength) {
      this.pending.set(bytes.subarray(offset), 0);
      this.pendingBytes = bytes.byteLength - offset;
    }
    return this;
  }

  /** Lowercase hex digest; the stream cannot be updated afterwards. */
  public digestHex(): string {
    if (!this.finished) {
      const bitLength = this.totalBytes * 8;
      const padding = new Uint8Array(
        this.pendingBytes < 56 ? 64 - this.pendingBytes : 128 - this.pendingBytes,
      );
      padding[0] = 0x80;
      const view = new DataView(padding.buffer);
      // Message length in bits as a 64-bit big-endian integer (below 2^53 bits for any real file).
      view.setUint32(padding.byteLength - 8, Math.floor(bitLength / 2 ** 32));
      view.setUint32(padding.byteLength - 4, bitLength >>> 0);
      this.update(padding);
      this.finished = true;
    }
    return Array.from(this.state, (word) => word.toString(16).padStart(8, '0')).join('');
  }

  private compress(source: Uint8Array, offset: number): void {
    // Hot loop: indexed reads are in range by construction, so assert instead of `?? 0` checks.
    const w = this.schedule as unknown as Int32Array;
    const k = K as unknown as Int32Array;
    const state = this.state;
    for (let index = 0, at = offset; index < 16; index += 1, at += 4) {
      w[index] =
        ((source[at] as number) << 24) |
        ((source[at + 1] as number) << 16) |
        ((source[at + 2] as number) << 8) |
        (source[at + 3] as number);
    }
    for (let index = 16; index < 64; index += 1) {
      const x = w[index - 15] as number;
      const y = w[index - 2] as number;
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[index] = ((w[index - 16] as number) + s0 + (w[index - 7] as number) + s1) | 0;
    }
    let a = state[0] as number;
    let b = state[1] as number;
    let c = state[2] as number;
    let d = state[3] as number;
    let e = state[4] as number;
    let f = state[5] as number;
    let g = state[6] as number;
    let h = state[7] as number;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const temp1 =
        (h + sum1 + ((e & f) ^ (~e & g)) + (k[index] as number) + (w[index] as number)) | 0;
      const sum0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const temp2 = (sum0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }
    state[0] = (state[0] as number) + a;
    state[1] = (state[1] as number) + b;
    state[2] = (state[2] as number) + c;
    state[3] = (state[3] as number) + d;
    state[4] = (state[4] as number) + e;
    state[5] = (state[5] as number) + f;
    state[6] = (state[6] as number) + g;
    state[7] = (state[7] as number) + h;
  }
}

export function sha256Hex(bytes: Uint8Array): string {
  return new Sha256Stream().update(bytes).digestHex();
}
