import { Capacitor, registerPlugin } from '@capacitor/core';

interface LocalMedPatientVaultPlugin {
  isAvailable(): Promise<{ readonly available: boolean }>;
  wrapKey(options: { readonly keyBase64: string }): Promise<{
    readonly ivBase64: string;
    readonly ciphertextBase64: string;
  }>;
  unwrapKey(options: {
    readonly ivBase64: string;
    readonly ciphertextBase64: string;
  }): Promise<{ readonly keyBase64: string }>;
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

export async function isNativePatientVaultKeychainAvailable(): Promise<boolean> {
  if (!isPatientVaultNativePlatform()) return false;
  try {
    return (await nativePatientVault.isAvailable()).available === true;
  } catch {
    return false;
  }
}

export async function wrapPatientVaultKey(rawKey: Uint8Array): Promise<{
  readonly ivBase64: string;
  readonly ciphertextBase64: string;
}> {
  if (rawKey.byteLength !== 32) throw new Error('Некорректная длина ключа хранилища.');
  return nativePatientVault.wrapKey({ keyBase64: bytesToBase64(rawKey) });
}

export async function unwrapPatientVaultKey(input: {
  readonly ivBase64: string;
  readonly ciphertextBase64: string;
}): Promise<Uint8Array> {
  const result = await nativePatientVault.unwrapKey(input);
  const rawKey = base64ToBytes(result.keyBase64);
  if (rawKey.byteLength !== 32) throw new Error('Keychain вернул ключ неверной длины.');
  return rawKey;
}

export async function deletePatientVaultNativeKey(): Promise<void> {
  if (isPatientVaultNativePlatform()) await nativePatientVault.deleteKey();
}
