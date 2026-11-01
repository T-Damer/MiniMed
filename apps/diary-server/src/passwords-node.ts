/** Node's `crypto.argon2` (Node ≥ 24.7) writing and reading the same PHC strings as Bun (passwords.ts). */
import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';

import type { Passwords } from './passwords';

// Bun's defaults: 64 MiB, 2 passes, 1 lane, 32-byte salt and tag.
const MEMORY_KIB = 65_536;
const PASSES = 2;
const LANES = 1;
const BYTES = 32;

function derive(
  secret: string,
  salt: Buffer,
  memory: number,
  passes: number,
  lanes: number,
  length: number,
) {
  return new Promise<Buffer>((resolve, reject) =>
    argon2(
      'argon2id',
      {
        message: Buffer.from(secret),
        nonce: salt,
        memory,
        passes,
        parallelism: lanes,
        tagLength: length,
      },
      (error, key) => (error ? reject(error) : resolve(key)),
    ),
  );
}

const b64 = (bytes: Buffer) => bytes.toString('base64').replace(/=+$/u, '');

export const nodePasswords: Passwords = {
  async hash(secret) {
    const salt = randomBytes(BYTES);
    const key = await derive(secret, salt, MEMORY_KIB, PASSES, LANES, BYTES);
    return `$argon2id$v=19$m=${MEMORY_KIB},t=${PASSES},p=${LANES}$${b64(salt)}$${b64(key)}`;
  },
  async verify(secret, hash) {
    const match =
      /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/u.exec(hash);
    if (!match) return false;
    const [, memory, passes, lanes, salt, tag] = match as unknown as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    const expected = Buffer.from(tag, 'base64');
    const key = await derive(
      secret,
      Buffer.from(salt, 'base64'),
      Number(memory),
      Number(passes),
      Number(lanes),
      expected.length,
    );
    return timingSafeEqual(key, expected);
  },
};
