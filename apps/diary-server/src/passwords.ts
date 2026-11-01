/**
 * Password hashing of doctors' login and recovery keys (argon2id, PHC strings), behind one small
 * port so the app runs on Bun (`server` mode) and on Node (`serverless` mode, ADR-0027). Both write
 * the same `$argon2id$v=19$m=65536,t=2,p=1$…` strings, so accounts survive a change of mode. The
 * Node one lives in `passwords-node.ts`: Bun 1.2 has no `crypto.argon2`.
 */
export interface Passwords {
  hash(secret: string): Promise<string>;
  verify(secret: string, hash: string): Promise<boolean>;
}

/** Bun's built-in argon2id. */
export const bunPasswords: Passwords = {
  hash: (secret) => Bun.password.hash(secret, { algorithm: 'argon2id' }),
  verify: (secret, hash) => Bun.password.verify(secret, hash),
};
