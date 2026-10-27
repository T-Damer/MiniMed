/**
 * End-to-end encryption of the connected diary (ADR-0026). Web Crypto only, so the same code runs
 * in the browser, in the patient's service worker and in tests.
 *
 * - A doctor's password gives two independent secrets: an auth key the server stores a hash of,
 *   and a wrap key that locks the doctor's private keys. The server never sees the wrap key.
 * - Each doctor and each patient device has an ECDH P-256 pair (to receive data keys) and an
 *   ECDSA P-256 pair (to sign records).
 * - Each patient has an AES-256-GCM data key per epoch, wrapped to every member's public key.
 * - A record is AES-GCM ciphertext bound to its patient, id, revision, epoch and author, signed
 *   by the author.
 */

const subtle = globalThis.crypto.subtle;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const KDF_ITERATIONS = 600_000;
const WRAP_INFO = encoder.encode('minimed-diary-wrap-v1');
const AUTH_INFO = encoder.encode('minimed-diary-auth-v1');
const IDENTITY_INFO = encoder.encode('minimed-diary-identity-v1');
const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export class DiaryCryptoError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DiaryCryptoError';
  }
}

// --- Encoding ---------------------------------------------------------------------------------

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/u.test(text)) throw new DiaryCryptoError('Некорректная кодировка.');
  const padded = text.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return globalThis.crypto.getRandomValues(new Uint8Array(length));
}

/** A random id for patients, devices and records (`[a-z0-9]`, 20 characters). */
export function randomId(length = 20): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return [...randomBytes(length)].map((byte) => alphabet[byte % alphabet.length]).join('');
}

export async function sha256(text: string): Promise<string> {
  return toBase64Url(new Uint8Array(await subtle.digest('SHA-256', encoder.encode(text))));
}

// --- Account secrets --------------------------------------------------------------------------

export interface KdfParams {
  readonly salt: string;
  readonly iterations: number;
}

export interface AccountSecrets {
  /** Sent to the server at login; the server stores only its argon2id hash. */
  readonly authKey: string;
  /** Locks the private keys; never leaves the device. */
  readonly wrapKey: CryptoKey;
}

export function newKdfParams(): KdfParams {
  return { salt: toBase64Url(randomBytes(16)), iterations: KDF_ITERATIONS };
}

async function hkdfBytes(
  master: CryptoKey,
  salt: Uint8Array<ArrayBuffer>,
  info: Uint8Array<ArrayBuffer>,
) {
  return new Uint8Array(
    await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, master, 256),
  );
}

async function secretsFromMaster(master: CryptoKey): Promise<AccountSecrets> {
  const empty = new Uint8Array(32);
  const auth = await hkdfBytes(master, empty, AUTH_INFO);
  const wrap = await hkdfBytes(master, empty, IDENTITY_INFO);
  return {
    authKey: toBase64Url(auth),
    wrapKey: await subtle.importKey('raw', wrap, 'AES-GCM', false, ['encrypt', 'decrypt']),
  };
}

/** The doctor's two secrets from the password (slow on purpose: ~0.5 s on a laptop). */
export async function deriveAccountSecrets(
  password: string,
  kdf: KdfParams,
): Promise<AccountSecrets> {
  if (password.length < 8) throw new DiaryCryptoError('Пароль — не короче 8 символов.');
  const base = await subtle.importKey(
    'raw',
    encoder.encode(password.normalize('NFKC')),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromBase64Url(kdf.salt), iterations: kdf.iterations },
    base,
    256,
  );
  return secretsFromMaster(await subtle.importKey('raw', bits, 'HKDF', false, ['deriveBits']));
}

/** A recovery code shown once at sign-up: 24 characters in groups of four. */
export function newRecoveryCode(): string {
  const characters = [...randomBytes(24)].map(
    (byte) => RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length],
  );
  return characters.join('').replaceAll(/(.{4})(?=.)/gu, '$1-');
}

/** The same two secrets from the recovery code (high entropy: HKDF is enough). */
export async function deriveRecoverySecrets(code: string, email: string): Promise<AccountSecrets> {
  const normalized = code.toUpperCase().replaceAll(/[^A-Z0-9]/gu, '');
  if (normalized.length !== 24) throw new DiaryCryptoError('Код восстановления — 24 символа.');
  const master = await subtle.importKey(
    'raw',
    encoder.encode(`${normalized}|${email.trim().toLowerCase()}`),
    'HKDF',
    false,
    ['deriveBits'],
  );
  return secretsFromMaster(master);
}

// --- Identity key pairs -----------------------------------------------------------------------

export interface IdentityKeys {
  readonly wrap: CryptoKeyPair;
  readonly sign: CryptoKeyPair;
}

/** Public halves as base64url SPKI; what the server and other members know. */
export interface PublicIdentity {
  readonly wrap: string;
  readonly sign: string;
}

const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const;
const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' } as const;

export async function generateIdentity(extractable = true): Promise<IdentityKeys> {
  return {
    wrap: (await subtle.generateKey(ECDH, extractable, ['deriveBits'])) as CryptoKeyPair,
    sign: (await subtle.generateKey(ECDSA, extractable, ['sign', 'verify'])) as CryptoKeyPair,
  };
}

export async function publicIdentity(keys: IdentityKeys): Promise<PublicIdentity> {
  return {
    wrap: toBase64Url(new Uint8Array(await subtle.exportKey('spki', keys.wrap.publicKey))),
    sign: toBase64Url(new Uint8Array(await subtle.exportKey('spki', keys.sign.publicKey))),
  };
}

async function aesSeal(
  key: CryptoKey,
  plain: Uint8Array<ArrayBuffer>,
  data?: Uint8Array<ArrayBuffer>,
) {
  const iv = randomBytes(12);
  const cipher = await subtle.encrypt(
    { name: 'AES-GCM', iv, ...(data ? { additionalData: data } : {}) },
    key,
    plain,
  );
  return `${toBase64Url(iv)}.${toBase64Url(new Uint8Array(cipher))}`;
}

async function aesOpen(key: CryptoKey, sealed: string, data?: Uint8Array<ArrayBuffer>) {
  const [iv, cipher] = sealed.split('.');
  if (!iv || !cipher) throw new DiaryCryptoError('Повреждённые зашифрованные данные.');
  try {
    return new Uint8Array(
      await subtle.decrypt(
        { name: 'AES-GCM', iv: fromBase64Url(iv), ...(data ? { additionalData: data } : {}) },
        key,
        fromBase64Url(cipher),
      ),
    );
  } catch (cause) {
    throw new DiaryCryptoError('Не удалось расшифровать: неверный ключ или данные изменены.', {
      cause,
    });
  }
}

/** The private keys locked with the wrap key (stored on the server). */
export async function sealIdentity(keys: IdentityKeys, wrapKey: CryptoKey): Promise<string> {
  const body = JSON.stringify({
    wrap: toBase64Url(new Uint8Array(await subtle.exportKey('pkcs8', keys.wrap.privateKey))),
    sign: toBase64Url(new Uint8Array(await subtle.exportKey('pkcs8', keys.sign.privateKey))),
    wrapPublic: toBase64Url(new Uint8Array(await subtle.exportKey('spki', keys.wrap.publicKey))),
    signPublic: toBase64Url(new Uint8Array(await subtle.exportKey('spki', keys.sign.publicKey))),
  });
  return aesSeal(wrapKey, encoder.encode(body));
}

export async function openIdentity(sealed: string, wrapKey: CryptoKey): Promise<IdentityKeys> {
  const body = JSON.parse(decoder.decode(await aesOpen(wrapKey, sealed))) as Record<string, string>;
  const read = (name: string): Uint8Array<ArrayBuffer> => {
    const value = body[name];
    if (typeof value !== 'string') throw new DiaryCryptoError('Повреждённые ключи.');
    return fromBase64Url(value);
  };
  return {
    wrap: {
      privateKey: await subtle.importKey('pkcs8', read('wrap'), ECDH, true, ['deriveBits']),
      publicKey: await subtle.importKey('spki', read('wrapPublic'), ECDH, true, []),
    },
    sign: {
      privateKey: await subtle.importKey('pkcs8', read('sign'), ECDSA, true, ['sign']),
      publicKey: await subtle.importKey('spki', read('signPublic'), ECDSA, true, ['verify']),
    },
  };
}

// --- Patient data keys ------------------------------------------------------------------------

export function newDataKey(): Uint8Array<ArrayBuffer> {
  return randomBytes(32);
}

async function sharedWrapKey(
  privateKey: CryptoKey,
  publicKey: CryptoKey,
  salt: Uint8Array<ArrayBuffer>,
): Promise<CryptoKey> {
  const shared = await subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256);
  const master = await subtle.importKey('raw', shared, 'HKDF', false, ['deriveBits']);
  const bits = await hkdfBytes(master, salt, WRAP_INFO);
  return subtle.importKey('raw', bits, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/**
 * The data key locked for one recipient (ECIES): an ephemeral ECDH key, HKDF, AES-GCM.
 * Format `epk.iv.ct`.
 */
export async function wrapDataKey(
  dataKey: Uint8Array<ArrayBuffer>,
  recipientWrap: string,
): Promise<string> {
  const recipient = await subtle.importKey('spki', fromBase64Url(recipientWrap), ECDH, false, []);
  const ephemeral = (await subtle.generateKey(ECDH, true, ['deriveBits'])) as CryptoKeyPair;
  const epk = new Uint8Array(await subtle.exportKey('raw', ephemeral.publicKey));
  const key = await sharedWrapKey(ephemeral.privateKey, recipient, epk);
  return `${toBase64Url(epk)}.${await aesSeal(key, dataKey)}`;
}

export async function unwrapDataKey(
  wrapped: string,
  privateWrap: CryptoKey,
): Promise<Uint8Array<ArrayBuffer>> {
  const dot = wrapped.indexOf('.');
  if (dot < 1) throw new DiaryCryptoError('Повреждённый ключ пациента.');
  const epk = fromBase64Url(wrapped.slice(0, dot));
  const ephemeral = await subtle.importKey('raw', epk, ECDH, false, []);
  const key = await sharedWrapKey(privateWrap, ephemeral, epk);
  return aesOpen(key, wrapped.slice(dot + 1));
}

// --- Records ----------------------------------------------------------------------------------

/** What the server stores per record revision: everything but `seq` comes from the author. */
export interface RecordEnvelope {
  readonly id: string;
  readonly rev: number;
  readonly epoch: number;
  /** `d:<doctorId>` or `p:<deviceId>`. */
  readonly author: string;
  /** `iv.ciphertext`, base64url. */
  readonly body: string;
  /** ECDSA P-256 signature over the binding and the body. */
  readonly sig: string;
}

export interface RecordHeader {
  readonly patientId: string;
  readonly id: string;
  readonly rev: number;
  readonly epoch: number;
  readonly author: string;
}

function binding(header: RecordHeader): Uint8Array<ArrayBuffer> {
  return encoder.encode(
    `${header.patientId}|${header.id}|${header.rev}|${header.epoch}|${header.author}`,
  );
}

async function dataCryptoKey(dataKey: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return subtle.importKey('raw', dataKey, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function sealRecord(
  header: RecordHeader,
  payload: unknown,
  dataKey: Uint8Array<ArrayBuffer>,
  signKey: CryptoKey,
): Promise<RecordEnvelope> {
  const body = await aesSeal(
    await dataCryptoKey(dataKey),
    encoder.encode(JSON.stringify(payload)),
    binding(header),
  );
  const signature = await subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    signKey,
    encoder.encode(`${decoder.decode(binding(header))}|${body}`),
  );
  return {
    id: header.id,
    rev: header.rev,
    epoch: header.epoch,
    author: header.author,
    body,
    sig: toBase64Url(new Uint8Array(signature)),
  };
}

export async function verifyRecord(
  patientId: string,
  envelope: RecordEnvelope,
  authorSign: string,
): Promise<boolean> {
  const key = await subtle.importKey('spki', fromBase64Url(authorSign), ECDSA, false, ['verify']);
  const header = { patientId, ...envelope };
  return subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    fromBase64Url(envelope.sig),
    encoder.encode(`${decoder.decode(binding(header))}|${envelope.body}`),
  );
}

export async function openRecord(
  patientId: string,
  envelope: RecordEnvelope,
  dataKey: Uint8Array<ArrayBuffer>,
): Promise<unknown> {
  const plain = await aesOpen(
    await dataCryptoKey(dataKey),
    envelope.body,
    binding({ patientId, ...envelope }),
  );
  return JSON.parse(decoder.decode(plain)) as unknown;
}

/** Signs a short statement (a membership change) with an identity key. */
export async function signText(text: string, signKey: CryptoKey): Promise<string> {
  const signature = await subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    signKey,
    encoder.encode(text),
  );
  return toBase64Url(new Uint8Array(signature));
}

export async function verifyText(text: string, sig: string, publicSign: string): Promise<boolean> {
  const key = await subtle.importKey('spki', fromBase64Url(publicSign), ECDSA, false, ['verify']);
  return subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    fromBase64Url(sig),
    encoder.encode(text),
  );
}

// --- Pairing a patient device -----------------------------------------------------------------

const PAIRING_INFO = encoder.encode('minimed-diary-pairing-v1');

async function pairingKey(secret: string): Promise<CryptoKey> {
  const master = await subtle.importKey('raw', fromBase64Url(secret), 'HKDF', false, [
    'deriveBits',
  ]);
  const bits = await hkdfBytes(master, new Uint8Array(32), PAIRING_INFO);
  return subtle.importKey('raw', bits, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** A one-time pairing secret for the QR code (the server keeps only its hash). */
export function newPairingSecret(): string {
  return toBase64Url(randomBytes(24));
}

/** Epoch → raw data key, sealed with the pairing secret; handed to the device once. */
export async function sealPairingKeys(
  keys: ReadonlyMap<number, Uint8Array<ArrayBuffer>>,
  secret: string,
): Promise<string> {
  const body = JSON.stringify(
    Object.fromEntries([...keys].map(([epoch, key]) => [epoch, toBase64Url(key)])),
  );
  return aesSeal(await pairingKey(secret), encoder.encode(body));
}

export async function openPairingKeys(
  sealed: string,
  secret: string,
): Promise<Map<number, Uint8Array<ArrayBuffer>>> {
  const body = JSON.parse(
    decoder.decode(await aesOpen(await pairingKey(secret), sealed)),
  ) as Record<string, unknown>;
  const keys = new Map<number, Uint8Array<ArrayBuffer>>();
  for (const [epoch, key] of Object.entries(body)) {
    if (typeof key !== 'string' || !/^\d+$/u.test(epoch))
      throw new DiaryCryptoError('Повреждённые ключи.');
    keys.set(Number(epoch), fromBase64Url(key));
  }
  return keys;
}
