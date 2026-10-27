/**
 * Web Push without a payload (RFC 8030 + VAPID, RFC 8292). Notifications are content-free by
 * design (ADR-0026): the service worker shows a fixed text, so nothing has to be encrypted for the
 * push service and no library is needed. The VAPID key pair lives in the settings table.
 */
import type { Database } from 'bun:sqlite';
import { fromBase64Url, toBase64Url } from '@localmed/diary-sync';

import { setSetting, setting } from './db';

const encoder = new TextEncoder();
const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' } as const;

export interface Vapid {
  /** Uncompressed public point, base64url: what `pushManager.subscribe` takes. */
  readonly publicKey: string;
  readonly privateKey: CryptoKey;
  readonly subject: string;
}

export async function loadVapid(db: Database, subject: string): Promise<Vapid> {
  const stored = setting(db, 'vapid');
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
  setSetting(db, 'vapid', JSON.stringify({ ...jwk, publicRaw }));
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

/** One empty push. `gone` means the subscription no longer exists and should be dropped. */
export async function sendPush(vapid: Vapid, endpoint: string): Promise<PushOutcome> {
  const url = new URL(endpoint);
  const token = await vapidToken(vapid, url.origin);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `vapid t=${token}, k=${vapid.publicKey}`,
      TTL: '86400',
      Urgency: 'high',
      'Content-Length': '0',
    },
  });
  if (response.status === 404 || response.status === 410) return 'gone';
  return response.ok ? 'sent' : 'failed';
}

/** Checks that a stored public key decodes; used by tests. */
export function vapidPublicBytes(vapid: Vapid): Uint8Array {
  return fromBase64Url(vapid.publicKey);
}
