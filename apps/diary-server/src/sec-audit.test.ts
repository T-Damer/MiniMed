/**
 * Fixes from the security audit of 2026-11-05 (SEC-AUDIT1): what the server must refuse, and that
 * neither an access code nor a pairing secret reaches it.
 */
import { describe, expect, it } from 'bun:test';
import {
  accessCodeEmail,
  DEMO_ACCESS_CODE,
  deriveAccountSecrets,
  deriveRecoverySecrets,
  generateIdentity,
  inviteProof,
  inviteStorageKey,
  newDataKey,
  newPairingSecret,
  newRecoveryCode,
  openPairingKeys,
  pairingProof,
  pairingProofHash,
  publicIdentity,
  randomId,
  sealIdentity,
  sealPairingKeys,
  sealRecord,
  sha256,
  wrapDataKey,
} from '@localmed/diary-sync';

import { createApp } from './app';
import { loadVapid } from './push';
import { openDatabase, SqliteStore } from './sqlite-store';
import { now } from './store';

const KDF = { salt: 'c2FsdHNhbHRzYWx0c2FsdA', iterations: 100_000 };

async function setup(signup: 'open' | 'invite' = 'open', hashDelayMs = 0) {
  const db = openDatabase(':memory:');
  const store = new SqliteStore(db);
  const verified: string[] = [];
  const passwords = {
    hash: async (secret: string) => {
      if (hashDelayMs) await new Promise((resolve) => setTimeout(resolve, hashDelayMs));
      return `h:${secret}`;
    },
    verify: async (secret: string, hash: string) => {
      verified.push(secret);
      return hash === `h:${secret}`;
    },
  };
  const app = createApp(store, {
    passwords,
    signup,
    secret: 'test-secret',
    vapid: await loadVapid(store, 'mailto:test@example.org'),
    log: () => {},
  });
  const bodies: string[] = [];
  const call = async (
    method: string,
    path: string,
    body?: unknown,
    token?: string,
    from = '203.0.113.1',
  ) => {
    const text = body === undefined ? undefined : JSON.stringify(body);
    if (text) bodies.push(text);
    const response = await app(
      new Request(`http://diary.test${path}`, {
        method,
        headers: {
          ...(text ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          // A client's own entry first, the address the gateway appends last.
          'X-Forwarded-For': `198.51.100.99, ${from}`,
        },
        ...(text ? { body: text } : {}),
      }),
    );
    // biome-ignore lint/suspicious/noExplicitAny: the test reads answers as loose JSON.
    return { status: response.status, body: (await response.json()) as Record<string, any> };
  };
  return { db, store, call, bodies, verified };
}

type Call = Awaited<ReturnType<typeof setup>>['call'];

async function account(email: string, password = 'password-1') {
  const identity = await generateIdentity();
  const secrets = await deriveAccountSecrets(password, KDF);
  const recovery = await deriveRecoverySecrets(newRecoveryCode(), email);
  return {
    identity,
    secrets,
    request: {
      email,
      name: 'Врач',
      authKey: secrets.authKey,
      kdf: KDF,
      identity: await publicIdentity(identity),
      identityBlob: await sealIdentity(identity, secrets.wrapKey),
      recovery: {
        authKey: recovery.authKey,
        identityBlob: await sealIdentity(identity, recovery.wrapKey),
      },
      privacy: { version: 'policy-test' },
    },
  };
}

async function doctor(call: Call, email: string) {
  const made = await account(email);
  const result = await call('POST', '/api/auth/register', made.request);
  expect(result.status).toBe(201);
  return {
    ...made,
    token: result.body['token'] as string,
    id: result.body['doctor'].id as string,
  };
}

async function patientWith(call: Call, owner: Awaited<ReturnType<typeof doctor>>) {
  const id = randomId();
  const key = newDataKey();
  const created = await call(
    'POST',
    '/api/patients',
    {
      id,
      key: {
        epoch: 1,
        recipient: `d:${owner.id}`,
        wrapped: await wrapDataKey(key, (await publicIdentity(owner.identity)).wrap),
      },
    },
    owner.token,
  );
  expect(created.status).toBe(201);
  return { id, key };
}

async function addEditor(
  call: Call,
  owner: Awaited<ReturnType<typeof doctor>>,
  patient: Awaited<ReturnType<typeof patientWith>>,
  editor: Awaited<ReturnType<typeof doctor>>,
) {
  const invited = await call(
    'POST',
    `/api/patients/${patient.id}/members`,
    {
      doctorId: editor.id,
      role: 'editor',
      keys: [
        {
          epoch: 1,
          recipient: `d:${editor.id}`,
          wrapped: await wrapDataKey(patient.key, (await publicIdentity(editor.identity)).wrap),
        },
      ],
    },
    owner.token,
  );
  expect(invited.status).toBe(201);
  expect((await call('POST', `/api/patients/${patient.id}/accept`, {}, editor.token)).status).toBe(
    200,
  );
}

async function pairing(
  call: Call,
  token: string,
  patient: { id: string; key: Uint8Array<ArrayBuffer> },
  kind?: 'carer',
) {
  const secret = newPairingSecret();
  const made = await call(
    'POST',
    `/api/patients/${patient.id}/pairings`,
    {
      secretHash: await pairingProofHash(secret),
      keys: await sealPairingKeys(new Map([[1, patient.key]]), secret),
      ...(kind ? { kind } : {}),
    },
    token,
  );
  return { secret, status: made.status };
}

async function pairPhone(call: Call, patientId: string, secret: string) {
  const device = await generateIdentity();
  const paired = await call('POST', '/api/pair', {
    patientId,
    proof: await pairingProof(secret),
    identity: await publicIdentity(device),
  });
  return { device, paired };
}

describe('security audit fixes (SEC-AUDIT1)', () => {
  it('pairs a phone without the server ever seeing the pairing secret', async () => {
    const { call, bodies } = await setup();
    const owner = await doctor(call, 'owner@clinic.ru');
    const patient = await patientWith(call, owner);
    const { secret } = await pairing(call, owner.token, patient);
    const { paired } = await pairPhone(call, patient.id, secret);
    expect(paired.status).toBe(201);
    expect(await openPairingKeys(paired.body['keys'], secret)).toEqual(new Map([[1, patient.key]]));
    expect(bodies.some((text) => text.includes(secret))).toBe(false);
    // Proof and secret are unrelated strings: the proof does not open the keys.
    const proof = await pairingProof(secret);
    await expect(openPairingKeys(paired.body['keys'], proof)).rejects.toThrow();
  });

  it('still pairs a phone that sends the secret, against old and new codes', async () => {
    const { call } = await setup();
    const owner = await doctor(call, 'owner@clinic.ru');
    const patient = await patientWith(call, owner);
    const fresh = await pairing(call, owner.token, patient);
    const oldPhone = await call('POST', '/api/pair', {
      patientId: patient.id,
      secret: fresh.secret,
      identity: await publicIdentity(await generateIdentity()),
    });
    expect(oldPhone.status).toBe(201);
    // A code made by a doctor's app before SEC-AUDIT1 (stored under sha256(secret)).
    const legacy = newPairingSecret();
    await call(
      'POST',
      `/api/patients/${patient.id}/pairings`,
      {
        secretHash: await sha256(legacy),
        keys: await sealPairingKeys(new Map([[1, patient.key]]), legacy),
        kind: 'patient',
      },
      owner.token,
    );
    const legacyPhone = await call('POST', '/api/pair', {
      patientId: patient.id,
      secret: legacy,
      identity: await publicIdentity(await generateIdentity()),
    });
    expect(legacyPhone.status).toBe(201);
    // Neither, or both: refused.
    const both = await call('POST', '/api/pair', {
      patientId: patient.id,
      secret: legacy,
      proof: await pairingProof(legacy),
      identity: await publicIdentity(await generateIdentity()),
    });
    expect(both.status).toBe(400);
  });

  it('lets only the owner connect the patient’s own phone; an editor connects carers', async () => {
    const { call } = await setup();
    const owner = await doctor(call, 'owner@clinic.ru');
    const editor = await doctor(call, 'editor@clinic.ru');
    const patient = await patientWith(call, owner);
    await addEditor(call, owner, patient, editor);
    expect((await pairing(call, editor.token, patient)).status).toBe(403);
    expect((await pairing(call, editor.token, patient, 'carer')).status).toBe(201);
    expect((await pairing(call, owner.token, patient)).status).toBe(201);
  });

  it('drops the diary’s unused pairing codes when a curator is removed', async () => {
    const { call } = await setup();
    const owner = await doctor(call, 'owner@clinic.ru');
    const editor = await doctor(call, 'editor@clinic.ru');
    const patient = await patientWith(call, owner);
    await addEditor(call, owner, patient, editor);
    const carerCode = await pairing(call, editor.token, patient, 'carer');
    expect(carerCode.status).toBe(201);
    expect(
      (
        await call(
          'DELETE',
          `/api/patients/${patient.id}/members/${editor.id}`,
          undefined,
          owner.token,
        )
      ).status,
    ).toBe(200);
    const { paired } = await pairPhone(call, patient.id, carerCode.secret);
    expect(paired.status).toBe(404);
  });

  it('keeps only hashes of invite codes and spends one code once', async () => {
    const { store, db, call, bodies } = await setup('invite', 30);
    const code = 'K7MP-2QXR-9HTN';
    await store.createInvite(await inviteStorageKey(await inviteProof(code)), now());
    // Two registrations race for the same code: one account, not two.
    const [a, b] = await Promise.all([account('a@clinic.ru'), account('b@clinic.ru')]);
    const [first, second] = await Promise.all([
      call('POST', '/api/auth/register', { ...a.request, inviteProof: await inviteProof(code) }),
      call('POST', '/api/auth/register', {
        ...b.request,
        inviteProof: await inviteProof(' k7mp 2qxr 9htn '),
      }),
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 403]);
    const doctors = db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM doctors').get();
    expect(doctors?.n).toBe(1);
    expect(bodies.some((text) => text.includes('K7MP'))).toBe(false);
  });

  it('re-keys invites stored as plain codes, used ones included, and still takes old clients', async () => {
    const { store, db, call } = await setup('invite');
    // An access-code account made before SEC-AUDIT1: its code is its password, kept in plain.
    const spent = 'ABCD-2345-WXYZ';
    await store.createInvite(spent, now());
    const coded = await account(await accessCodeEmail(spent), spent);
    expect(
      (
        await call('POST', '/api/auth/register', {
          ...coded.request,
          inviteProof: await inviteProof(spent),
        })
      ).status,
    ).toBe(201);
    // An unused old code, typed by an old client in lower case.
    await store.createInvite('QWER-TYUP-ASDF', now());
    const old = await account('old@clinic.ru');
    expect(
      (await call('POST', '/api/auth/register', { ...old.request, invite: 'qwer-tyup-asdf' }))
        .status,
    ).toBe(201);
    const codes = db.query<{ code: string }, []>('SELECT code FROM invites').all();
    expect(codes).toHaveLength(2);
    for (const row of codes) expect(row.code.startsWith('h1:')).toBe(true);
    expect(await store.plainInvites()).toEqual([]);
  });

  it('refuses records a phone may not write', async () => {
    const { call } = await setup();
    const owner = await doctor(call, 'owner@clinic.ru');
    const patient = await patientWith(call, owner);
    const phoneCode = await pairing(call, owner.token, patient);
    const phone = await pairPhone(call, patient.id, phoneCode.secret);
    const carerCode = await pairing(call, owner.token, patient, 'carer');
    const carer = await pairPhone(call, patient.id, carerCode.secret);
    const write = async (
      who: Awaited<ReturnType<typeof pairPhone>>,
      id: string,
      payload: unknown,
      rev = 1,
    ) => {
      const deviceId = who.paired.body['deviceId'] as string;
      const record = await sealRecord(
        { patientId: patient.id, id, rev, epoch: 1, author: `p:${deviceId}` },
        payload,
        patient.key,
        who.device.sign.privateKey,
      );
      return (
        await call(
          'POST',
          `/api/patients/${patient.id}/records`,
          { records: [record] },
          who.paired.body['token'],
        )
      ).status;
    };
    expect(await write(carer, 'plan', { kind: 'plan' }, 1_000_000)).toBe(403);
    expect(await write(carer, 'profile', { kind: 'profile', label: 'x' }, 1_000_000)).toBe(403);
    expect(await write(carer, 'consent', { kind: 'consent', at: now() })).toBe(403);
    const phoneId = phone.paired.body['deviceId'] as string;
    expect(await write(carer, `member-${phoneId}`, { kind: 'member', name: 'x' })).toBe(403);
    const carerId = carer.paired.body['deviceId'] as string;
    expect(await write(carer, `member-${carerId}`, { kind: 'member', name: 'Мама' })).toBe(201);
    expect(await write(phone, 'consent', { kind: 'consent', at: now() })).toBe(201);
    expect(await write(phone, 'plan', { kind: 'plan' })).toBe(403);
  });

  it('accepts push endpoints of push services only, a few per person', async () => {
    const { call } = await setup();
    const owner = await doctor(call, 'owner@clinic.ru');
    for (const endpoint of [
      'https://127.0.0.1/x',
      'https://10.0.0.5/x',
      'https://169.254.169.254/latest',
      'https://[::1]/x',
      'https://localhost/x',
      'https://push.internal/x',
      'https://fcm.googleapis.com:8443/x',
      'https://user:pass@fcm.googleapis.com/x',
      'https://2130706433/x',
      'http://fcm.googleapis.com/x',
    ]) {
      const saved = await call('POST', '/api/push/subscriptions', { endpoint }, owner.token);
      expect({ endpoint, status: saved.status }).toEqual({ endpoint, status: 400 });
    }
    for (let index = 0; index < 14; index += 1) {
      const saved = await call(
        'POST',
        '/api/push/subscriptions',
        { endpoint: `https://fcm.googleapis.com/fcm/send/${index}` },
        owner.token,
      );
      expect(saved.status).toBe(201);
    }
  });

  it('keeps the owner able to sign in while a stranger fails from another address', async () => {
    const { call } = await setup();
    const owner = await doctor(call, 'owner@clinic.ru');
    const wrong = { email: 'owner@clinic.ru', authKey: 'x'.repeat(43) };
    for (let index = 0; index < 12; index += 1) {
      expect((await call('POST', '/api/auth/login', wrong, undefined, '192.0.2.66')).status).toBe(
        401,
      );
    }
    expect((await call('POST', '/api/auth/login', wrong, undefined, '192.0.2.66')).status).toBe(
      429,
    );
    const right = { email: 'owner@clinic.ru', authKey: owner.secrets.authKey };
    expect((await call('POST', '/api/auth/login', right, undefined, '203.0.113.7')).status).toBe(
      200,
    );
    // Failures over many addresses are capped per account.
    let last = 0;
    for (let index = 0; index < 60; index += 1) {
      last = (await call('POST', '/api/auth/login', wrong, undefined, `192.0.2.${100 + index}`))
        .status;
    }
    expect(last).toBe(429);
  });

  it('checks the public demo password with argon2 once, then by its digest', async () => {
    const { call, verified } = await setup();
    const email = await accessCodeEmail(DEMO_ACCESS_CODE);
    const demo = await account(email, DEMO_ACCESS_CODE);
    expect((await call('POST', '/api/auth/register', demo.request)).status).toBe(201);
    const right = { email, authKey: demo.secrets.authKey };
    for (let index = 0; index < 5; index += 1) {
      expect((await call('POST', '/api/auth/login', right)).status).toBe(200);
    }
    expect((await call('POST', '/api/auth/login', { email, authKey: 'y'.repeat(43) })).status).toBe(
      401,
    );
    expect(verified).toHaveLength(1);
  });
});
