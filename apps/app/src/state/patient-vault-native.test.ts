import { describe, expect, it } from 'vitest';
import { nativeVaultErrorCode } from '@/state/patient-vault-native';

describe('nativeVaultErrorCode', () => {
  it('recognises only the codes the Android plugin rejects with', () => {
    for (const code of ['AUTH_CANCELLED', 'AUTH_UNAVAILABLE', 'AUTH_FAILED', 'KEY_INVALIDATED']) {
      expect(nativeVaultErrorCode(Object.assign(new Error('x'), { code }))).toBe(code);
    }
    expect(nativeVaultErrorCode(Object.assign(new Error('x'), { code: 'UNIMPLEMENTED' }))).toBe(
      undefined,
    );
    expect(nativeVaultErrorCode(new Error('plain'))).toBe(undefined);
    expect(nativeVaultErrorCode(undefined)).toBe(undefined);
    expect(nativeVaultErrorCode(null)).toBe(undefined);
  });
});
