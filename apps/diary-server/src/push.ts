/**
 * Web Push (RFC 8030 + VAPID, RFC 8292). Notifications stay content-free by design (ADR-0026): the
 * payload says only what kind of event it is and, for a reminder, its moment; the service worker
 * writes the text. The payload is encrypted for the browser (RFC 8291, `aes128gcm`) with Web
 * Crypto, so no library is needed; subscriptions stored before their keys get an empty push. The
 * VAPID key pair lives in the settings table.
 */
import { type DiaryPushPayload, isPushEndpoint } from '@localmed/contracts';
import { fromBase64Url, randomBytes, toBase64Url } from '@localmed/diary-sync';

import type { DiaryStore, PushTarget } from './store';

const encoder = new TextEncoder();
const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const;
/** One record holds the whole payload; ours are a few dozen bytes. */
const RECORD_SIZE = 4096;

type Bytes = Uint8Array<ArrayBuffer>;

export interface Vapid {
  /** Uncompressed public point, base64url: what `pushManager.subscribe` takes. */
  readonly publicKey: string;
  readonly privateKey: CryptoKey;
  readonly subject: string;
}

export async function loadVapid(store: DiaryStore, subject: string): Promise<Vapid> {
  const stored = await store.setting('vapid');
  if (stored) {
    const jwk = JSON.parse(stored) as JsonWebKey & { publicRaw: string };
    const privateKey = await crypto.subtle.importKey('jwk', jwk, ECDSA, false, ['sign']);
    return { publicKey: jwk.publicRaw, privateKey, subject };
  }
  const pair = (await crypto.subtle.generateKey(ECDSA, true, ['sign', 'verify'])) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const publicRaw = toBase64Url(
    new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)),
  );
  await store.setSetting('vapid', JSON.stringify({ ...jwk, publicRaw }));
  return { publicKey: publicRaw, privateKey: pair.privateKey, subject };
}

async function vapidToken(vapid: Vapid, audience: string): Promise<string> {
  const header = toBase64Url(encoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = toBase64Url(
    encoder.encode(
      JSON.stringify({
        aud: audience,
        exp: Math.floor(Date.now() / 1000) + 12 * 3600,
        sub: vapid.subject,
      }),
    ),
  );
  // Web Crypto returns the IEEE P1363 r||s form JWS expects.
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    vapid.privateKey,
    encoder.encode(`${header}.${claims}`),
  );
  return `${header}.${claims}.${toBase64Url(new Uint8Array(signature))}`;
}

export type PushOutcome = 'sent' | 'gone' | 'failed';

/** A stored subscription; the keys are absent for one saved before payloads existed. */
export type { PushTarget };

/** How long one push service may take to answer before the push counts as failed. */
const PUSH_TIMEOUT_MS = 10_000;
/** Pushes sent at once for one event. */
const PUSH_BATCH = 8;

export interface PushOptions {
  /** Seconds the push service keeps an undelivered push (a late reminder is useless). */
  readonly ttl?: number;
}

async function hmac(key: Bytes, data: Bytes): Promise<Bytes> {
  const imported = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', imported, data));
}

function concat(...parts: readonly Bytes[]): Bytes {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** HKDF-Expand for one block (every length here is at most 32 bytes). */
async function expand(prk: Bytes, info: Bytes, length: number): Promise<Bytes> {
  return (await hmac(prk, concat(info, Uint8Array.of(1)))).slice(0, length);
}

/**
 * RFC 8291 message encryption: an ephemeral ECDH key against the browser's `p256dh`, mixed with
 * its `auth` secret, AES-128-GCM over the payload, in the one-record `aes128gcm` coding (RFC 8188).
 */
export async function encryptPushPayload(
  p256dh: Bytes,
  auth: Bytes,
  plaintext: Bytes,
  /** Tests only (RFC 8291 Appendix A): a fixed sender key and salt instead of fresh ones. */
  fixed?: { readonly local: CryptoKeyPair; readonly salt: Bytes },
): Promise<Bytes> {
  const browserKey = await crypto.subtle.importKey('raw', p256dh, ECDH, false, []);
  const local =
    fixed?.local ??
    ((await crypto.subtle.generateKey(ECDH, true, ['deriveBits'])) as CryptoKeyPair);
  const localPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: browserKey }, local.privateKey, 256),
  );
  const keyInfo = concat(encoder.encode('WebPush: info\0'), p256dh, localPublic);
  const ikm = await expand(await hmac(auth, shared), keyInfo, 32);
  const salt = fixed?.salt ?? randomBytes(16);
  const prk = await hmac(salt, ikm);
  const cek = await expand(prk, encoder.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await expand(prk, encoder.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // The last (and only) record ends with the 0x02 delimiter.
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce },
      key,
      concat(plaintext, Uint8Array.of(2)),
    ),
  );
  const header = new Uint8Array(16 + 4 + 1);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = localPublic.length;
  return concat(header, localPublic, sealed);
}

/**
 * One push. With the subscription's keys and a payload it is encrypted for the browser; otherwise
 * it is empty and the worker shows its generic text. `gone`: the subscription no longer exists.
 */
export async function sendPush(
  vapid: Vapid,
  target: PushTarget,
  payload?: DiaryPushPayload,
  options: PushOptions = {},
): Promise<PushOutcome> {
  const url = new URL(target.endpoint);
  const token = await vapidToken(vapid, url.origin);
  const headers: Record<string, string> = {
    Authorization: `vapid t=${token}, k=${vapid.publicKey}`,
    TTL: String(options.ttl ?? 86400),
    Urgency: 'high',
  };
  let content: Bytes | undefined;
  if (payload && target.p256dh && target.auth) {
    content = await encryptPushPayload(
      fromBase64Url(target.p256dh),
      fromBase64Url(target.auth),
      encoder.encode(JSON.stringify(payload)),
    );
    headers['Content-Encoding'] = 'aes128gcm';
    headers['Content-Type'] = 'application/octet-stream';
  }
  headers['Content-Length'] = String(content?.length ?? 0);
  // A push service answers at once; it is never followed elsewhere (SEC-AUDIT1).
  const response = await fetch(url, {
    method: 'POST',
    headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
    ...(content ? { body: content } : {}),
  });
  if (response.status === 404 || response.status === 410) return 'gone';
  return response.ok ? 'sent' : 'failed';
}

/**
 * Pushes to every subscription of these owners (`d:<doctor>`, `p:<device>`) and resolves when all
 * have answered (a serverless instance may be frozen right after its response, ADR-0027); a failed
 * push is logged, never thrown. Subscriptions the push service no longer knows are deleted.
 */
export async function pushToOwners(
  store: DiaryStore,
  vapid: Vapid,
  owners: readonly string[],
  payload: DiaryPushPayload,
  log: (line: string) => void,
  options: PushOptions = {},
): Promise<void> {
  if (!owners.length) return;
  const targets: PushTarget[] = [];
  for (const target of await store.pushTargets(owners)) {
    // Subscriptions saved before SEC-AUDIT1 may name any https address: those are dropped.
    if (isPushEndpoint(target.endpoint)) targets.push(target);
    else await store.deletePushSubscription(target.endpoint);
  }
  for (let start = 0; start < targets.length; start += PUSH_BATCH) {
    await Promise.all(
      targets.slice(start, start + PUSH_BATCH).map(async (target) => {
        try {
          if ((await sendPush(vapid, target, payload, options)) === 'gone') {
            await store.deletePushSubscription(target.endpoint);
          }
        } catch (cause) {
          log(`push failed: ${cause instanceof Error ? cause.name : 'error'}`);
        }
      }),
    );
  }
}

/** Checks that a stored public key decodes; used by tests. */
export function vapidPublicBytes(vapid: Vapid): Uint8Array {
  return fromBase64Url(vapid.publicKey);
}
