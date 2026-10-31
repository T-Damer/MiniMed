import { Capacitor, registerPlugin } from '@capacitor/core';

/**
 * How the Android Keystore protects the key that wraps the vault data key:
 * - `device`: usable whenever the phone is unlocked (every vault made before the fingerprint
 *   unlock, and phones without a secure lock screen);
 * - `auth`: usable only after a fingerprint / face / device-PIN check, valid for a few minutes.
 */
export type NativeKeyProtection = 'device' | 'auth';

export interface NativeVaultStatus {
  readonly available: boolean;
  /** The phone has a secure lock screen and an Android that can ask for it (API 29+). */
  readonly authAvailable: boolean;
}

export interface NativeWrappedKeyParts {
  readonly ivBase64: string;
  readonly ciphertextBase64: string;
}

/** Error codes the plugin rejects with when the system prompt does not unlock the key. */
export type NativeVaultErrorCode =
  | 'AUTH_CANCELLED'
  | 'AUTH_UNAVAILABLE'
  | 'AUTH_FAILED'
  | 'KEY_INVALIDATED';

interface LocalMedPatientVaultPlugin {
  isAvailable(): Promise<{ readonly available: boolean; readonly authAvailable?: boolean }>;
  wrapKey(options: {
    readonly keyBase64: string;
    readonly protection: NativeKeyProtection;
  }): Promise<NativeWrappedKeyParts>;
  unwrapKey(options: {
    readonly ivBase64: string;
    readonly ciphertextBase64: string;
    readonly protection: NativeKeyProtection;
  }): Promise<{ readonly keyBase64: string }>;
  retireLegacyKey(): Promise<{ readonly retired: boolean }>;
  deleteKey(): Promise<void>;
}

const nativePatientVault = registerPlugin<LocalMedPatientVaultPlugin>('LocalMedPatientVault');

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function isPatientVaultNativePlatform(): boolean {
  return Capacitor.isNativePlatform();
}

export async function nativePatientVaultStatus(): Promise<NativeVaultStatus> {
  if (!isPatientVaultNativePlatform()) return { available: false, authAvailable: false };
  try {
    const status = await nativePatientVault.isAvailable();
    return {
      available: status.available === true,
      authAvailable: status.available === true && status.authAvailable === true,
    };
  } catch {
    return { available: false, authAvailable: false };
  }
}

export async function isNativePatientVaultKeychainAvailable(): Promise<boolean> {
  return (await nativePatientVaultStatus()).available;
}

/** True when the phone can ask for a fingerprint / face / PIN before the vault key is used. */
export async function isNativePatientVaultAuthAvailable(): Promise<boolean> {
  return (await nativePatientVaultStatus()).authAvailable;
}

/** The plugin's rejection code, when the rejection carries one of ours. */
export function nativeVaultErrorCode(error: unknown): NativeVaultErrorCode | undefined {
  const code = (error as { readonly code?: unknown } | null | undefined)?.code;
  return code === 'AUTH_CANCELLED' ||
    code === 'AUTH_UNAVAILABLE' ||
    code === 'AUTH_FAILED' ||
    code === 'KEY_INVALIDATED'
    ? code
    : undefined;
}

export async function wrapPatientVaultKey(
  rawKey: Uint8Array,
  protection: NativeKeyProtection = 'device',
): Promise<NativeWrappedKeyParts> {
  if (rawKey.byteLength !== 32) throw new Error('Некорректная длина ключа хранилища.');
  return nativePatientVault.wrapKey({ keyBase64: bytesToBase64(rawKey), protection });
}

export async function unwrapPatientVaultKey(
  input: NativeWrappedKeyParts,
  protection: NativeKeyProtection = 'device',
): Promise<Uint8Array> {
  const result = await nativePatientVault.unwrapKey({ ...input, protection });
  const rawKey = base64ToBytes(result.keyBase64);
  if (rawKey.byteLength !== 32) throw new Error('Keychain вернул ключ неверной длины.');
  return rawKey;
}

/**
 * Removes the device-bound key that wrapped the vault before the fingerprint unlock. Call it only
 * after the auth-wrapped key is stored and read back; the plugin also refuses without an auth key.
 */
export async function retireLegacyPatientVaultKey(): Promise<boolean> {
  return (await nativePatientVault.retireLegacyKey()).retired === true;
}

export async function deletePatientVaultNativeKey(): Promise<void> {
  if (isPatientVaultNativePlatform()) await nativePatientVault.deleteKey();
}
