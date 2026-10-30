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

import {
  createDiaryApi,
  type DiaryApi,
  DiaryApiError,
  diaryAuth,
  diaryInfo,
} from '@/features/diary/connected/diary-api';
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

/** Whether the service lets any doctor register or needs an invite code. */
export async function signUpMode(): Promise<'open' | 'invite'> {
  return (await diaryInfo(doctorApi(undefined))).signup;
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

/**
 * An access code: the service's sign-up code (`K7MP-2QXR-9HTN`, apps/diary-server/src/invites.ts)
 * typed in any case, with any separators. Returns the grouped capitals, or nothing when the text
 * is not one (an e-mail, a half-typed code).
 */
export function readAccessCode(typed: string): string | undefined {
  if (typed.includes('@')) return undefined;
  const letters = typed.toUpperCase().replaceAll(/[\s-]/gu, '');
  if (!/^[A-Z0-9]{12}$/u.test(letters)) return undefined;
  return letters.replaceAll(/(.{4})(?=.)/gu, '$1-');
}

/**
 * The account an access code stands for: a doctor without e-mail or name, whose code is the
 * password. The address is a digest, so colleagues who see it in a patient's access list do not
 * see the code.
 */
async function accessCodeAccount(code: string): Promise<{ email: string; password: string }> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`minimed-access-code:${code}`)),
  );
  const hex = [...digest.slice(0, 10)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return { email: `${hex}@code.invalid`, password: code };
}

/** The name patients see for a doctor who signed in by code alone. */
export const ACCESS_CODE_DOCTOR_NAME = 'Врач';

/**
 * Sign-in by an access code alone. The first use spends the code as the sign-up invite and creates
 * the account; every later use signs in to it. No recovery code: the access code is the way back.
 */
export async function signInWithCode(input: {
  readonly code: string;
  readonly rememberDevice: boolean;
}): Promise<DoctorSession> {
  const code = readAccessCode(input.code);
  if (!code) throw new Error('Код выглядит как XXXX-XXXX-XXXX.');
  const account = await accessCodeAccount(code);
  try {
    return await signIn({ ...account, rememberDevice: input.rememberDevice });
  } catch (cause) {
    if (!(cause instanceof DiaryApiError && cause.status === 401)) throw cause;
  }
  try {
    const { session } = await signUp({
      ...account,
      name: ACCESS_CODE_DOCTOR_NAME,
      invite: input.code.trim(),
      rememberDevice: input.rememberDevice,
    });
    return session;
  } catch (cause) {
    if (cause instanceof DiaryApiError && cause.status === 403) {
      throw new DiaryApiError(403, 'Код не подошёл.');
    }
    throw cause;
  }
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
