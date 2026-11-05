import { describe, expect, it } from 'vitest';
import {
  canonicalInviteCode,
  DiaryCryptoError,
  deriveAccountSecrets,
  deriveRecoverySecrets,
  newPairingSecret as freshPairingSecret,
  generateIdentity,
  inviteProof,
  inviteStorageKey,
  newDataKey,
  newPairingSecret,
  newRecoveryCode,
  openIdentity,
  openPairingKeys,
  openRecord,
  openPairingKeys as openSealedPairingKeys,
  pairingProof,
  publicIdentity,
  sealIdentity,
  sealPairingKeys as sealKeysForPairing,
  sealPairingKeys,
  sealRecord,
  unwrapDataKey,
  verifyRecord,
  wrapDataKey,
} from './crypto';

const KDF = { salt: 'c2FsdHNhbHRzYWx0c2FsdA', iterations: 100_000 };

describe('diary end-to-end crypto', () => {
  it('derives a stable auth key and a wrap key that opens the sealed identity', async () => {
    const first = await deriveAccountSecrets('correct horse', KDF);
    const again = await deriveAccountSecrets('correct horse', KDF);
    const other = await deriveAccountSecrets('wrong horse!', KDF);
    expect(first.authKey).toBe(again.authKey);
    expect(first.authKey).not.toBe(other.authKey);

    const identity = await generateIdentity();
    const sealed = await sealIdentity(identity, first.wrapKey);
    const opened = await openIdentity(sealed, again.wrapKey);
    expect(await publicIdentity(opened)).toEqual(await publicIdentity(identity));
    await expect(openIdentity(sealed, other.wrapKey)).rejects.toBeInstanceOf(DiaryCryptoError);
  });

  it('recovers with the code alone', async () => {
    const code = newRecoveryCode();
    expect(code).toMatch(/^([A-Z0-9]{4}-){5}[A-Z0-9]{4}$/u);
    const identity = await generateIdentity();
    const sealed = await sealIdentity(
      identity,
      (await deriveRecoverySecrets(code, 'a@b.ru')).wrapKey,
    );
    const typed = code.toLowerCase().replaceAll('-', ' ');
    const opened = await openIdentity(
      sealed,
      (await deriveRecoverySecrets(typed, 'A@B.ru ')).wrapKey,
    );
    expect(await publicIdentity(opened)).toEqual(await publicIdentity(identity));
  });

  it('wraps a data key for one recipient only', async () => {
    const doctor = await generateIdentity();
    const stranger = await generateIdentity();
    const key = newDataKey();
    const wrapped = await wrapDataKey(key, (await publicIdentity(doctor)).wrap);
    expect(await unwrapDataKey(wrapped, doctor.wrap.privateKey)).toEqual(key);
    await expect(unwrapDataKey(wrapped, stranger.wrap.privateKey)).rejects.toBeInstanceOf(
      DiaryCryptoError,
    );
  });

  it('seals a record bound to its header and signed by its author', async () => {
    const author = await generateIdentity();
    const key = newDataKey();
    const header = {
      patientId: 'patient00001',
      id: 'entry1',
      rev: 1,
      epoch: 1,
      author: 'p:device000001',
    };
    const envelope = await sealRecord(
      header,
      { kind: 'entry', value: 7 },
      key,
      author.sign.privateKey,
    );
    expect(envelope.body).not.toContain('entry');
    expect(await openRecord('patient00001', envelope, key)).toEqual({ kind: 'entry', value: 7 });
    expect(await verifyRecord('patient00001', envelope, (await publicIdentity(author)).sign)).toBe(
      true,
    );
    // Moved to another patient or given another revision: refused.
    await expect(openRecord('patient00002', envelope, key)).rejects.toBeInstanceOf(
      DiaryCryptoError,
    );
    await expect(openRecord('patient00001', { ...envelope, rev: 2 }, key)).rejects.toBeInstanceOf(
      DiaryCryptoError,
    );
    expect(
      await verifyRecord(
        'patient00001',
        { ...envelope, author: 'd:doctor000001' },
        (await publicIdentity(author)).sign,
      ),
    ).toBe(false);
  });

  it('hands epoch keys to a device through the one-time pairing secret', async () => {
    const secret = newPairingSecret();
    const keys = new Map([
      [1, newDataKey()],
      [2, newDataKey()],
    ]);
    const sealed = await sealPairingKeys(keys, secret);
    expect(await openPairingKeys(sealed, secret)).toEqual(keys);
    await expect(openPairingKeys(sealed, newPairingSecret())).rejects.toBeInstanceOf(
      DiaryCryptoError,
    );
  });
});

describe('proofs instead of secrets (SEC-AUDIT1)', () => {
  it('gives the server a pairing proof that cannot open the sealed keys', async () => {
    const secret = freshPairingSecret();
    const key = new Uint8Array(32).fill(7);
    const sealed = await sealKeysForPairing(new Map([[1, key]]), secret);
    const proof = await pairingProof(secret);
    expect(proof).not.toBe(secret);
    expect(await pairingProof(secret)).toBe(proof);
    expect((await openSealedPairingKeys(sealed, secret)).get(1)).toEqual(key);
    await expect(openSealedPairingKeys(sealed, proof)).rejects.toThrow();
  });

  it('gives one invite proof however a code is typed, and never the code itself', async () => {
    expect(canonicalInviteCode(' k7mp 2qxr-9htn ')).toBe('K7MP2QXR9HTN');
    const proof = await inviteProof('K7MP-2QXR-9HTN');
    expect(await inviteProof('k7mp2qxr9htn')).toBe(proof);
    expect(proof).not.toContain('K7MP');
    const key = await inviteStorageKey(proof);
    expect(key.startsWith('h1:')).toBe(true);
    expect(key).not.toContain(proof);
  });
});
