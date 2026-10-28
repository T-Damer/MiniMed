import { describe, expect, it } from 'bun:test';
import { fromBase64Url, randomBytes, toBase64Url } from '@localmed/diary-sync';

import { encryptPushPayload } from './push';

const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const;
const encoder = new TextEncoder();

async function hmac(key: Uint8Array<ArrayBuffer>, data: Uint8Array<ArrayBuffer>) {
  const imported = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', imported, data));
}

const join = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

/** What the browser does with an `aes128gcm` push (RFC 8291 §3.4, RFC 8188), written apart. */
async function browserDecrypt(
  body: Uint8Array,
  keys: CryptoKeyPair,
  publicRaw: Uint8Array<ArrayBuffer>,
  auth: Uint8Array<ArrayBuffer>,
): Promise<string> {
  const salt = body.slice(0, 16);
  const recordSize = new DataView(body.buffer, body.byteOffset).getUint32(16);
  const idLength = body[20] as number;
  const senderRaw = body.slice(21, 21 + idLength);
  const sealed = body.slice(21 + idLength);
  expect(recordSize).toBe(4096);
  const sender = await crypto.subtle.importKey('raw', senderRaw, ECDH, false, []);
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: sender }, keys.privateKey, 256),
  );
  const info = join(encoder.encode('WebPush: info\0'), publicRaw, senderRaw, Uint8Array.of(1));
  const ikm = await hmac(await hmac(auth, shared), info);
  const prk = await hmac(salt, ikm);
  const cek = (
    await hmac(prk, join(encoder.encode('Content-Encoding: aes128gcm\0'), Uint8Array.of(1)))
  ).slice(0, 16);
  const nonce = (
    await hmac(prk, join(encoder.encode('Content-Encoding: nonce\0'), Uint8Array.of(1)))
  ).slice(0, 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const padded = new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, sealed),
  );
  expect(padded.at(-1)).toBe(2);
  return new TextDecoder().decode(padded.slice(0, -1));
}

describe('web push payload', () => {
  it('encrypts a payload only the subscribed browser can read', async () => {
    const browser = (await crypto.subtle.generateKey(ECDH, true, ['deriveBits'])) as CryptoKeyPair;
    const publicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', browser.publicKey));
    const auth = randomBytes(16);
    const payload = JSON.stringify({ kind: 'reminder', at: '2026-10-28T05:00:00.000Z' });
    const body = await encryptPushPayload(publicRaw, auth, encoder.encode(payload));
    expect(await browserDecrypt(body, browser, publicRaw, auth)).toBe(payload);
    // Another browser's secret does not open it.
    await expect(browserDecrypt(body, browser, publicRaw, randomBytes(16))).rejects.toThrow();
    // A fresh key and salt each time.
    const again = await encryptPushPayload(publicRaw, auth, encoder.encode(payload));
    expect(again.slice(0, 16)).not.toEqual(body.slice(0, 16));
  });

  it('matches the worked example of RFC 8291 (Appendix A)', async () => {
    const asPublic = fromBase64Url(
      'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
    );
    const jwk = {
      kty: 'EC',
      crv: 'P-256',
      x: toBase64Url(asPublic.slice(1, 33)),
      y: toBase64Url(asPublic.slice(33, 65)),
      d: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
    };
    const local = {
      privateKey: await crypto.subtle.importKey('jwk', jwk, ECDH, true, ['deriveBits']),
      publicKey: await crypto.subtle.importKey('raw', asPublic, ECDH, true, []),
    } as CryptoKeyPair;
    const body = await encryptPushPayload(
      fromBase64Url(
        'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
      ),
      fromBase64Url('BTBZMqHH6r4Tts7J_aSIgg'),
      encoder.encode('When I grow up, I want to be a watermelon'),
      { local, salt: fromBase64Url('DGv6ra1nlYgDCS1FRnbzlw') },
    );
    expect(toBase64Url(body)).toBe(
      'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
    );
  });
});
