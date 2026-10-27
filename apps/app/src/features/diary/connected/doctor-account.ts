/**
 * The doctor's account on the diary service: sign-up with a recovery code, sign-in from any
 * device, and keeping the unlocked keys on a trusted device. The password never leaves the
 * device; the server gets only the derived auth key (ADR-0026 §3).
 */
import type { DiaryDoctorProfile } from '@localmed/contracts';
import {
  deriveAccountSecrets,
  deriveRecoverySecrets,
  generateIdentity,
  type IdentityKeys,
  newKdfParams,
  newRecoveryCode,
  openIdentity,
  publicIdentity,
  sealIdentity,
} from '@localmed/diary-sync';

import { createDiaryApi, type DiaryApi, diaryAuth } from '@/features/diary/connected/diary-api';
import { diaryServiceBase } from '@/features/diary/diary-links';

const SESSION_KEY = 'minimed.diary.doctor.v1';
const DB_NAME = 'minimed-diary-doctor';
const DB_STORE = 'keys';

export interface DoctorSession {
  readonly token: string;
  readonly doctor: DiaryDoctorProfile;
  readonly identity: IdentityKeys;
}

interface StoredSession {
  readonly token: string;
  readonly doctor: DiaryDoctorProfile;
  /** The identity sealed with a non-extractable device key kept in IndexedDB. */
  readonly sealed: string;
}

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(DB_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB недоступна.'));
  });
}

async function deviceKey(create: boolean): Promise<CryptoKey | undefined> {
  const db = await idb();
  const existing = await new Promise<CryptoKey | undefined>((resolve, reject) => {
    const request = db.transaction(DB_STORE).objectStore(DB_STORE).get('device');
    request.onsuccess = () => resolve(request.result as CryptoKey | undefined);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB недоступна.'));
  });
  if (existing || !create) return existing;
  // Non-extractable: script on the page can use it but cannot copy it out.
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction(DB_STORE, 'readwrite').objectStore(DB_STORE).put(key, 'device');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('IndexedDB недоступна.'));
  });
  return key;
}

async function remember(session: DoctorSession): Promise<void> {
  const key = await deviceKey(true);
  if (!key) return;
  const stored: StoredSession = {
    token: session.token,
    doctor: session.doctor,
    sealed: await sealIdentity(session.identity, key),
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(stored));
}

/** The session kept on this device, if the doctor chose to stay signed in. */
export async function restoreDoctorSession(): Promise<DoctorSession | undefined> {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return undefined;
  const stored = JSON.parse(raw) as StoredSession;
  const key = await deviceKey(false);
  if (!key) return undefined;
  return {
    token: stored.token,
    doctor: stored.doctor,
    identity: await openIdentity(stored.sealed, key),
  };
}

export function forgetDoctorSession(): void {
  localStorage.removeItem(SESSION_KEY);
}

export function doctorApi(session: Pick<DoctorSession, 'token'> | undefined): DiaryApi {
  return createDiaryApi(() => session?.token, diaryServiceBase());
}

export interface SignUpResult {
  readonly session: DoctorSession;
  /** Shown once: the only way back in without the password. */
  readonly recoveryCode: string;
}

export async function signUp(input: {
  readonly email: string;
  readonly name: string;
  readonly password: string;
  readonly invite?: string;
  readonly rememberDevice: boolean;
}): Promise<SignUpResult> {
  const email = input.email.trim().toLowerCase();
  const kdf = newKdfParams();
  const [secrets, identity] = await Promise.all([
    deriveAccountSecrets(input.password, kdf),
    generateIdentity(true),
  ]);
  const recoveryCode = newRecoveryCode();
  const recovery = await deriveRecoverySecrets(recoveryCode, email);
  const answer = await diaryAuth.register(doctorApi(undefined), {
    email,
    name: input.name.trim(),
    authKey: secrets.authKey,
    kdf,
    identity: await publicIdentity(identity),
    identityBlob: await sealIdentity(identity, secrets.wrapKey),
    recovery: {
      authKey: recovery.authKey,
      identityBlob: await sealIdentity(identity, recovery.wrapKey),
    },
    ...(input.invite?.trim() ? { invite: input.invite.trim() } : {}),
  });
  const session = { token: answer.token, doctor: answer.doctor, identity };
  if (input.rememberDevice) await remember(session);
  return { session, recoveryCode };
}

export async function signIn(input: {
  readonly email: string;
  readonly password: string;
  readonly rememberDevice: boolean;
}): Promise<DoctorSession> {
  const email = input.email.trim().toLowerCase();
  const api = doctorApi(undefined);
  const { kdf } = await diaryAuth.prelogin(api, email);
  const secrets = await deriveAccountSecrets(input.password, kdf);
  const answer = await diaryAuth.login(api, email, secrets.authKey);
  const session = {
    token: answer.token,
    doctor: answer.doctor,
    identity: await openIdentity(answer.identityBlob, secrets.wrapKey),
  };
  if (input.rememberDevice) await remember(session);
  return session;
}

/** A new password from the recovery code; the keys (and so every patient) are kept. */
export async function recoverAccount(input: {
  readonly email: string;
  readonly code: string;
  readonly password: string;
  readonly rememberDevice: boolean;
}): Promise<DoctorSession> {
  const email = input.email.trim().toLowerCase();
  const api = doctorApi(undefined);
  const recovery = await deriveRecoverySecrets(input.code, email);
  const fetched = await diaryAuth.recoverFetch(api, email, recovery.authKey);
  const identity = await openIdentity(fetched.identityBlob, recovery.wrapKey);
  const kdf = newKdfParams();
  const secrets = await deriveAccountSecrets(input.password, kdf);
  const answer = await diaryAuth.recoverReset(api, {
    email,
    recoveryAuthKey: recovery.authKey,
    authKey: secrets.authKey,
    kdf,
    identityBlob: await sealIdentity(identity, secrets.wrapKey),
  });
  const session = { token: answer.token, doctor: answer.doctor, identity };
  if (input.rememberDevice) await remember(session);
  return session;
}

export async function signOut(session: DoctorSession): Promise<void> {
  forgetDoctorSession();
  await diaryAuth.logout(doctorApi(session));
}
