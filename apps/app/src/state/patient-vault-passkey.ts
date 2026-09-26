/**
 * Browser protection for the patient vault through a passkey and the WebAuthn PRF extension.
 * The authenticator (Face ID, a fingerprint, Windows Hello, a phone or a password manager such
 * as Bitwarden) returns the same 32-byte secret for the same credential and salt; HKDF turns it
 * into the key that wraps the vault's data key. Nothing secret is stored: only the credential id
 * and the salt.
 */

const KEK_INFO = new TextEncoder().encode('minimed-patient-vault-kek-v1');

export interface PasskeyReference {
  readonly credentialId: string;
  readonly salt: string;
}

export interface WrappedDataKey {
  readonly ivBase64: string;
  readonly ciphertextBase64: string;
}

interface PrfOutputs {
  readonly enabled?: boolean;
  readonly results?: { readonly first?: ArrayBuffer | ArrayBufferView };
}

export class PasskeyUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PasskeyUnavailableError';
  }
}

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function fromBase64url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function random(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(length));
}

function toBytes(value: ArrayBuffer | ArrayBufferView): Uint8Array<ArrayBuffer> {
  return value instanceof ArrayBuffer
    ? new Uint8Array(value.slice(0))
    : new Uint8Array(
        value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer,
      );
}

function describeWebAuthnError(error: unknown): Error {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError')
      return new Error('Подтверждение отменено или время ожидания истекло.');
    if (error.name === 'InvalidStateError')
      return new Error('Этот passkey уже создан на устройстве.');
    if (error.name === 'SecurityError')
      return new PasskeyUnavailableError('Passkey недоступен на этом адресе страницы.');
  }
  return error instanceof Error ? error : new Error('Не удалось использовать passkey.');
}

/** `unknown` when the browser cannot say in advance; creation then tells for sure. */
export async function passkeyPrfSupport(): Promise<'supported' | 'unknown' | 'unsupported'> {
  if (typeof window === 'undefined' || !window.PublicKeyCredential || !navigator.credentials) {
    return 'unsupported';
  }
  const withCapabilities = PublicKeyCredential as unknown as {
    getClientCapabilities?: () => Promise<Record<string, boolean | undefined>>;
  };
  if (!withCapabilities.getClientCapabilities) return 'unknown';
  try {
    const capabilities = await withCapabilities.getClientCapabilities();
    const prf = capabilities['extension:prf'];
    return prf === true ? 'supported' : prf === false ? 'unsupported' : 'unknown';
  } catch {
    return 'unknown';
  }
}

async function kekFromSecret(secret: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
  secret.fill(0);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: KEK_INFO },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function evaluatePrf(
  credentialId: Uint8Array<ArrayBuffer>,
  salt: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  let assertion: PublicKeyCredential;
  try {
    assertion = (await navigator.credentials.get({
      publicKey: {
        challenge: random(32),
        allowCredentials: [{ type: 'public-key', id: credentialId }],
        userVerification: 'required',
        timeout: 120_000,
        extensions: { prf: { eval: { first: salt } } } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential;
  } catch (error) {
    throw describeWebAuthnError(error);
  }
  const prf = (assertion.getClientExtensionResults() as { prf?: PrfOutputs }).prf;
  const first = prf?.results?.first;
  if (!first) {
    throw new PasskeyUnavailableError(
      'Этот passkey не умеет выдавать ключ шифрования. Выберите другой способ входа или менеджер паролей.',
    );
  }
  return toBytes(first);
}

/** Creates a passkey for the vault and returns its reference with the derived wrapping key. */
export async function createPasskeyKey(): Promise<PasskeyReference & { readonly kek: CryptoKey }> {
  const salt = random(32);
  let credential: PublicKeyCredential;
  try {
    credential = (await navigator.credentials.create({
      publicKey: {
        challenge: random(32),
        rp: { name: 'MiniMed' },
        user: { id: random(16), name: 'Пациенты MiniMed', displayName: 'Пациенты MiniMed' },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
        timeout: 120_000,
        extensions: { prf: { eval: { first: salt } } } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential;
  } catch (error) {
    throw describeWebAuthnError(error);
  }
  const prf = (credential.getClientExtensionResults() as { prf?: PrfOutputs }).prf;
  if (prf?.enabled === false) {
    throw new PasskeyUnavailableError(
      'Этот passkey не поддерживает шифрование данных. Попробуйте другой способ (телефон, Bitwarden) или продолжите без защиты.',
    );
  }
  const credentialId = new Uint8Array(credential.rawId);
  // Some authenticators return the PRF output only on assertion, not at creation.
  const secret = prf?.results?.first
    ? toBytes(prf.results.first)
    : await evaluatePrf(credentialId, salt);
  return {
    credentialId: base64url(credentialId),
    salt: base64url(salt),
    kek: await kekFromSecret(secret),
  };
}

export async function passkeyKek(reference: PasskeyReference): Promise<CryptoKey> {
  const secret = await evaluatePrf(
    fromBase64url(reference.credentialId),
    fromBase64url(reference.salt),
  );
  return kekFromSecret(secret);
}

export async function wrapDataKey(kek: CryptoKey, rawKey: Uint8Array): Promise<WrappedDataKey> {
  const iv = random(12);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, kek, rawKey.slice());
  return { ivBase64: base64url(iv), ciphertextBase64: base64url(new Uint8Array(ciphertext)) };
}

export async function unwrapDataKey(kek: CryptoKey, wrapped: WrappedDataKey): Promise<Uint8Array> {
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64url(wrapped.ivBase64) },
      kek,
      fromBase64url(wrapped.ciphertextBase64),
    );
    return new Uint8Array(plain);
  } catch {
    throw new Error('Этот passkey не подходит к хранилищу пациентов.');
  }
}
