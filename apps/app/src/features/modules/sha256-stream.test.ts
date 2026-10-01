import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Sha256Stream, sha256Hex } from './sha256-stream';

function nodeHex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

describe('Sha256Stream', () => {
  it('matches the published test vectors', () => {
    const encoder = new TextEncoder();
    expect(sha256Hex(new Uint8Array())).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(sha256Hex(encoder.encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(
      sha256Hex(encoder.encode('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')),
    ).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
    expect(sha256Hex(new Uint8Array(1_000_000).fill(0x61))).toBe(
      'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0',
    );
  });

  it('agrees with node:crypto for every padding boundary and any chunking', () => {
    const data = randomBytes(1000);
    for (let length = 0; length <= 200; length += 1) {
      const slice = data.subarray(0, length);
      expect(sha256Hex(slice)).toBe(nodeHex(slice));
    }
    for (const step of [1, 3, 55, 56, 63, 64, 65, 127, 333]) {
      const stream = new Sha256Stream();
      for (let offset = 0; offset < data.length; offset += step) {
        stream.update(data.subarray(offset, offset + step));
      }
      expect(stream.digestHex()).toBe(nodeHex(data));
    }
  });

  it('hashes views that do not start at the beginning of their buffer', () => {
    const backing = randomBytes(300);
    const view = new Uint8Array(backing.buffer, backing.byteOffset + 7, 211);
    expect(sha256Hex(view)).toBe(nodeHex(view));
  });

  it('refuses to be updated after the digest was taken, and repeats the digest', () => {
    const stream = new Sha256Stream().update(new TextEncoder().encode('abc'));
    const digest = stream.digestHex();
    expect(stream.digestHex()).toBe(digest);
    expect(() => stream.update(new Uint8Array(1))).toThrow('already finished');
  });
});
