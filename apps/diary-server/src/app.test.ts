import { describe, expect, it } from 'bun:test';
import { DiaryAdminStatsSchema } from '@localmed/contracts';
import {
  accessCodeEmail,
  DEMO_ACCESS_CODE,
  deriveAccountSecrets,
  deriveRecoverySecrets,
  generateIdentity,
  newDataKey,
  newPairingSecret,
  newRecoveryCode,
  openIdentity,
  openPairingKeys,
  openRecord,
  publicIdentity,
  randomBytes,
  randomId,
  sealIdentity,
  sealPairingKeys,
  sealRecord,
  sha256,
  toBase64Url,
  unwrapDataKey,
  verifyRecord,
  wrapDataKey,
} from '@localmed/diary-sync';

import { createApp } from './app';
import { bunPasswords } from './passwords';
import { loadVapid } from './push';
import { sendDueReminders, sendMissedDoses } from './reminders';
import { openDatabase, SqliteStore } from './sqlite-store';

async function setup(
  signup: 'open' | 'invite' = 'open',
  onlineWindowMs?: number,
  adminEmails: readonly string[] = [],
) {
  const db = openDatabase(':memory:');
  const store = new SqliteStore(db);
  const logs: string[] = [];
  const app = createApp(store, {
    passwords: bunPasswords,
    signup,
    secret: 'test-secret',
    vapid: await loadVapid(store, 'mailto:test@example.org'),
    log: (line) => logs.push(line),
    adminEmails,
    ...(onlineWindowMs === undefined ? {} : { onlineWindowMs }),
  });
  const call = async (method: string, path: string, body?: unknown, token?: string) => {
    const response = await app(
      new Request(`http://diary.test${path}`, {
        method,
        headers: {
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
    // biome-ignore lint/suspicious/noExplicitAny: the test reads answers as loose JSON.
    return { status: response.status, body: (await response.json()) as Record<string, any> };
  };
  return { db, store, call, logs, app };
}

const KDF = { salt: 'c2FsdHNhbHRzYWx0c2FsdA', iterations: 100_000 };

async function register(
  call: Awaited<ReturnType<typeof setup>>['call'],
  email: string,
  name: string,
) {
  const identity = await generateIdentity();
  const secrets = await deriveAccountSecrets('password-1', KDF);
  const code = newRecoveryCode();
  const recovery = await deriveRecoverySecrets(code, email);
  const result = await call('POST', '/api/auth/register', {
    email,
    name,
    authKey: secrets.authKey,
    kdf: KDF,
    identity: await publicIdentity(identity),
    identityBlob: await sealIdentity(identity, secrets.wrapKey),
    recovery: {
      authKey: recovery.authKey,
      identityBlob: await sealIdentity(identity, recovery.wrapKey),
    },
  });
  expect(result.status).toBe(201);
  return {
    identity,
    token: result.body['token'] as string,
    id: result.body['doctor'].id as string,
    code,
  };
}

describe('diary server', () => {
  it('runs the whole life of a connected diary without seeing plaintext', async () => {
    const { db, call, logs } = await setup();
    const owner = await register(call, 'owner@clinic.ru', 'Д-р Иванова');
    const curator = await register(call, 'curator@clinic.ru', 'Д-р Петров');

    // Login derives the same auth key from the password and gets the sealed identity back.
    const pre = await call('POST', '/api/auth/prelogin', { email: 'OWNER@clinic.ru' });
    const secrets = await deriveAccountSecrets('password-1', pre.body['kdf']);
    const login = await call('POST', '/api/auth/login', {
      email: 'owner@clinic.ru',
      authKey: secrets.authKey,
    });
    expect(login.status).toBe(200);
    const opened = await openIdentity(login.body['identityBlob'], secrets.wrapKey);
    expect(await publicIdentity(opened)).toEqual(await publicIdentity(owner.identity));
    const wrong = await call('POST', '/api/auth/login', {
      email: 'owner@clinic.ru',
      authKey: 'x'.repeat(43),
    });
    expect(wrong.status).toBe(401);
    // An unknown e-mail gets a stable decoy salt.
    const decoy = await call('POST', '/api/auth/prelogin', { email: 'nobody@clinic.ru' });
    expect((await call('POST', '/api/auth/prelogin', { email: 'nobody@clinic.ru' })).body).toEqual(
      decoy.body,
    );

    // The owner creates a patient with epoch 1.
    const patientId = randomId();
    const key1 = newDataKey();
    const ownerPublic = await publicIdentity(owner.identity);
    const created = await call(
      'POST',
      '/api/patients',
      {
        id: patientId,
        key: {
          epoch: 1,
          recipient: `d:${owner.id}`,
          wrapped: await wrapDataKey(key1, ownerPublic.wrap),
        },
      },
      owner.token,
    );
    expect(created.status).toBe(201);
    const listed = await call('GET', '/api/patients', undefined, owner.token);
    expect(
      await unwrapDataKey(
        listed.body['patients'][0].keys[0].wrapped,
        owner.identity.wrap.privateKey,
      ),
    ).toEqual(key1);

    // The doctor writes the plan; the patient's phone pairs once with the QR secret.
    const plan = await sealRecord(
      { patientId, id: 'plan', rev: 1, epoch: 1, author: `d:${owner.id}` },
      { kind: 'plan', invitation: { title: 'Дневник лечения' } },
      key1,
      owner.identity.sign.privateKey,
    );
    expect(
      (await call('POST', `/api/patients/${patientId}/records`, { records: [plan] }, owner.token))
        .status,
    ).toBe(201);
    const secret = newPairingSecret();
    await call(
      'POST',
      `/api/patients/${patientId}/pairings`,
      {
        secretHash: await sha256(secret),
        keys: await sealPairingKeys(new Map([[1, key1]]), secret),
      },
      owner.token,
    );
    const device = await generateIdentity();
    const paired = await call('POST', '/api/pair', {
      patientId,
      secret,
      identity: await publicIdentity(device),
    });
    expect(paired.status).toBe(201);
    const deviceKeys = await openPairingKeys(paired.body['keys'], secret);
    expect(deviceKeys.get(1)).toEqual(key1);
    const again = await call('POST', '/api/pair', {
      patientId,
      secret,
      identity: await publicIdentity(device),
    });
    expect(again.status).toBe(404);
    const deviceToken = paired.body['token'] as string;
    const deviceAuthor = `p:${paired.body['deviceId']}`;

    // The patient marks a dose; the doctor reads and verifies it.
    const mark = await sealRecord(
      { patientId, id: 'entry1', rev: 1, epoch: 1, author: deviceAuthor },
      { kind: 'entry', entry: { wellbeing: 6 } },
      key1,
      device.sign.privateKey,
    );
    expect(
      (await call('POST', `/api/patients/${patientId}/records`, { records: [mark] }, deviceToken))
        .status,
    ).toBe(201);
    // A device cannot write as a doctor, and a reader cannot write at all.
    const forged = { ...mark, id: 'entry2', author: `d:${owner.id}` };
    expect(
      (await call('POST', `/api/patients/${patientId}/records`, { records: [forged] }, deviceToken))
        .status,
    ).toBe(403);
    const page = await call(
      'GET',
      `/api/patients/${patientId}/records?after=0`,
      undefined,
      owner.token,
    );
    expect(page.body['records'].map((record: { id: string }) => record.id)).toEqual([
      'plan',
      'entry1',
    ]);
    const authors = (
      await call('GET', `/api/patients/${patientId}/authors`, undefined, owner.token)
    ).body['authors'];
    const stored = page.body['records'][1];
    expect(await verifyRecord(patientId, stored, authors[deviceAuthor])).toBe(true);
    expect(await openRecord(patientId, stored, key1)).toEqual({
      kind: 'entry',
      entry: { wellbeing: 6 },
    });

    // A curator is invited as a reader, accepts, reads, and cannot write.
    const curatorPublic = (
      await call('GET', '/api/doctors/lookup?email=curator@clinic.ru', undefined, owner.token)
    ).body['doctor'];
    await call(
      'POST',
      `/api/patients/${patientId}/members`,
      {
        doctorId: curator.id,
        role: 'reader',
        keys: [
          {
            epoch: 1,
            recipient: `d:${curator.id}`,
            wrapped: await wrapDataKey(key1, curatorPublic.identity.wrap),
          },
        ],
      },
      owner.token,
    );
    expect(
      (await call('GET', `/api/patients/${patientId}/records`, undefined, curator.token)).status,
    ).toBe(403);
    await call('POST', `/api/patients/${patientId}/accept`, {}, curator.token);
    expect(
      (await call('GET', `/api/patients/${patientId}/records`, undefined, curator.token)).body[
        'records'
      ],
    ).toHaveLength(2);
    const curatorWrite = await sealRecord(
      { patientId, id: 'tip', rev: 1, epoch: 1, author: `d:${curator.id}` },
      { kind: 'tip' },
      key1,
      curator.identity.sign.privateKey,
    );
    expect(
      (
        await call(
          'POST',
          `/api/patients/${patientId}/records`,
          { records: [curatorWrite] },
          curator.token,
        )
      ).status,
    ).toBe(403);
    await call(
      'PATCH',
      `/api/patients/${patientId}/members/${curator.id}`,
      { role: 'editor' },
      owner.token,
    );
    expect(
      (
        await call(
          'POST',
          `/api/patients/${patientId}/records`,
          { records: [curatorWrite] },
          curator.token,
        )
      ).status,
    ).toBe(201);

    // Removed: no access, and the owner rotates to epoch 2 for those left (owner + device).
    await call(
      'DELETE',
      `/api/patients/${patientId}/members/${curator.id}`,
      undefined,
      owner.token,
    );
    expect(
      (await call('GET', `/api/patients/${patientId}/records`, undefined, curator.token)).status,
    ).toBe(403);
    const key2 = newDataKey();
    const partial = await call(
      'POST',
      `/api/patients/${patientId}/epochs`,
      {
        epoch: 2,
        keys: [
          {
            epoch: 2,
            recipient: `d:${owner.id}`,
            wrapped: await wrapDataKey(key2, ownerPublic.wrap),
          },
        ],
      },
      owner.token,
    );
    expect(partial.status).toBe(400);
    const rotated = await call(
      'POST',
      `/api/patients/${patientId}/epochs`,
      {
        epoch: 2,
        keys: [
          {
            epoch: 2,
            recipient: `d:${owner.id}`,
            wrapped: await wrapDataKey(key2, ownerPublic.wrap),
          },
          {
            epoch: 2,
            recipient: deviceAuthor,
            wrapped: await wrapDataKey(key2, (await publicIdentity(device)).wrap),
          },
        ],
      },
      owner.token,
    );
    expect(rotated.status).toBe(200);
    const deviceKeyList = (await call('GET', '/api/device/keys', undefined, deviceToken)).body;
    expect(deviceKeyList['epoch']).toBe(2);
    expect(await unwrapDataKey(deviceKeyList['keys'][0].wrapped, device.wrap.privateKey)).toEqual(
      key2,
    );
    // Records in the old epoch are refused now.
    const stale = await sealRecord(
      { patientId, id: 'entry3', rev: 1, epoch: 1, author: deviceAuthor },
      {},
      key1,
      device.sign.privateKey,
    );
    expect(
      (await call('POST', `/api/patients/${patientId}/records`, { records: [stale] }, deviceToken))
        .status,
    ).toBe(409);

    // An urgent mark reaches the doctor's alerts; withdrawal deletes the records.
    await call('POST', '/api/device/alerts', {}, deviceToken);
    const alerts = await call('GET', '/api/alerts', undefined, owner.token);
    expect(alerts.body['alerts']).toEqual([expect.objectContaining({ patientId, kind: 'urgent' })]);
    await call('POST', `/api/alerts/${alerts.body['alerts'][0].id}/ack`, {}, owner.token);
    expect((await call('GET', '/api/alerts', undefined, owner.token)).body['alerts']).toHaveLength(
      0,
    );
    expect((await call('DELETE', '/api/device', undefined, deviceToken)).status).toBe(200);
    expect(db.query('SELECT COUNT(*) AS count FROM records').get()).toEqual({ count: 0 });
    expect(
      (await call('GET', '/api/patients', undefined, owner.token)).body['patients'][0].status,
    ).toBe('withdrawn');
    expect((await call('GET', '/api/device/keys', undefined, deviceToken)).status).toBe(401);

    // The database holds no plaintext of the plan or the marks; logs hold no bodies.
    const dump =
      JSON.stringify(db.query('SELECT * FROM records').all()) +
      JSON.stringify(db.query('SELECT * FROM doctors').all());
    expect(dump).not.toContain('Дневник лечения');
    expect(dump).not.toContain('wellbeing');
    expect(logs.join('\n')).not.toContain(patientId);
  });

  it('tracks when a patient was last seen and tells the doctors without content', async () => {
    const { db, call, app } = await setup('open', 60);
    const owner = await register(call, 'owner@clinic.ru', 'Д-р Иванова');
    const patientId = randomId();
    const key = newDataKey();
    const ownerPublic = await publicIdentity(owner.identity);
    await call(
      'POST',
      '/api/patients',
      {
        id: patientId,
        key: {
          epoch: 1,
          recipient: `d:${owner.id}`,
          wrapped: await wrapDataKey(key, ownerPublic.wrap),
        },
      },
      owner.token,
    );
    const secret = newPairingSecret();
    await call(
      'POST',
      `/api/patients/${patientId}/pairings`,
      {
        secretHash: await sha256(secret),
        keys: await sealPairingKeys(new Map([[1, key]]), secret),
      },
      owner.token,
    );
    const device = await generateIdentity();
    const paired = await call('POST', '/api/pair', {
      patientId,
      secret,
      identity: await publicIdentity(device),
    });
    const deviceToken = paired.body['token'] as string;
    const summaryOf = async () =>
      (await call('GET', '/api/patients', undefined, owner.token)).body['patients'][0];

    // Never seen: no timestamp, offline.
    const before = await summaryOf();
    expect(before.online).toBe(false);
    expect(before).not.toHaveProperty('lastSeenAt');

    // The doctor's live stream.
    const stream = await app(
      new Request('http://diary.test/api/events', {
        headers: { Authorization: `Bearer ${owner.token}` },
      }),
    );
    const reader = (stream.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    const next = async (): Promise<string> =>
      decoder.decode((await reader.read()).value as Uint8Array);
    expect(await next()).toContain(': open');

    // Any authenticated request of the phone stamps it and announces «online» at once.
    expect((await call('GET', '/api/device/keys', undefined, deviceToken)).status).toBe(200);
    const online = await next();
    expect(online).toContain('event: presence');
    const data = JSON.parse(online.split('data: ')[1] as string);
    expect(data).toEqual({ patientId, online: true, lastSeenAt: expect.any(String) });
    const seen = await summaryOf();
    expect(seen.online).toBe(true);
    expect(seen.lastSeenAt).toBe(data.lastSeenAt);

    // Further requests inside the throttle interval stay silent: the next event is the alert.
    await call('GET', '/api/device/keys', undefined, deviceToken);
    await call('POST', '/api/device/alerts', {}, deviceToken);
    expect(await next()).toContain('event: alert');

    // The phone goes quiet: the window passes, the doctors hear «offline» and the summary agrees.
    const offline = await next();
    expect(offline).toContain('event: presence');
    expect(JSON.parse(offline.split('data: ')[1] as string)).toEqual({
      patientId,
      online: false,
      lastSeenAt: expect.any(String),
    });
    const after = await summaryOf();
    expect(after.online).toBe(false);
    expect(after.lastSeenAt).toBe(
      db.query<{ at: string }, []>('SELECT MAX(last_seen_at) AS at FROM devices').get()?.at,
    );
    await reader.cancel();
  });

  it('stores only reminder moments and pushes each once, with kinds and no content', async () => {
    const { db, store, call } = await setup('open');
    const owner = await register(call, 'remind@clinic.ru', 'Д-р Петрова');
    expect((await call('GET', '/api/info')).body).toEqual({ signup: 'open' });
    const patientId = randomId();
    const key = newDataKey();
    const ownerPublic = await publicIdentity(owner.identity);
    await call(
      'POST',
      '/api/patients',
      {
        id: patientId,
        key: {
          epoch: 1,
          recipient: `d:${owner.id}`,
          wrapped: await wrapDataKey(key, ownerPublic.wrap),
        },
      },
      owner.token,
    );
    const secret = newPairingSecret();
    await call(
      'POST',
      `/api/patients/${patientId}/pairings`,
      {
        secretHash: await sha256(secret),
        keys: await sealPairingKeys(new Map([[1, key]]), secret),
      },
      owner.token,
    );
    const paired = await call('POST', '/api/pair', {
      patientId,
      secret,
      identity: await publicIdentity(await generateIdentity()),
    });
    const deviceToken = paired.body['token'] as string;
    const deviceId = paired.body['deviceId'] as string;

    // Only a doctor's own phone may set reminders; the list replaces the earlier one.
    const soon = new Date(Date.now() + 60_000).toISOString();
    const later = new Date(Date.now() + 3_600_000).toISOString();
    const past = new Date(Date.now() - 60_000).toISOString();
    expect((await call('PUT', '/api/device/reminders', { at: [soon] }, owner.token)).status).toBe(
      403,
    );
    const stored = await call(
      'PUT',
      '/api/device/reminders',
      { at: [soon, later, later, past] },
      deviceToken,
    );
    expect(stored.body).toEqual({ count: 2 });
    expect(
      (await call('PUT', '/api/device/reminders', { at: ['08:00'] }, deviceToken)).status,
    ).toBe(400);

    // The phone's browser subscribes with its payload keys.
    const browser = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
      'deriveBits',
    ])) as CryptoKeyPair;
    const p256dh = toBase64Url(
      new Uint8Array(await crypto.subtle.exportKey('raw', browser.publicKey)),
    );
    await call(
      'POST',
      '/api/push/subscriptions',
      {
        endpoint: 'https://push.example/phone',
        keys: { p256dh, auth: toBase64Url(randomBytes(16)) },
      },
      deviceToken,
    );
    await call(
      'POST',
      '/api/push/subscriptions',
      { endpoint: 'https://push.example/doctor' },
      owner.token,
    );

    const sent: { url: string; headers: Headers; size: number }[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      sent.push({
        url: String(input),
        headers: new Headers(init?.headers),
        size: init?.body ? (init.body as Uint8Array).length : 0,
      });
      return new Response(null, { status: 201 });
    }) as typeof fetch;
    try {
      const vapid = await loadVapid(store, 'mailto:test@example.org');
      // Not due yet; then due; then gone (sent once).
      expect(await sendDueReminders(store, vapid, () => undefined)).toBe(0);
      expect(await sendDueReminders(store, vapid, () => undefined, Date.parse(soon) + 1000)).toBe(
        1,
      );
      expect(await sendDueReminders(store, vapid, () => undefined, Date.parse(soon) + 2000)).toBe(
        0,
      );
      // A reminder missed by more than the grace period is dropped, not sent late.
      expect(
        await sendDueReminders(store, vapid, () => undefined, Date.parse(later) + 3_600_000),
      ).toBe(0);
      expect(db.query('SELECT COUNT(*) AS n FROM reminders').get()).toEqual({ n: 0 });
      await Bun.sleep(20);
      expect(sent).toHaveLength(1);
      expect(sent[0]?.url).toBe('https://push.example/phone');
      expect(sent[0]?.headers.get('Content-Encoding')).toBe('aes128gcm');
      expect(sent[0]?.headers.get('TTL')).toBe('1200');
      expect(sent[0]?.size).toBeGreaterThan(86);

      // A doctor's tip: the phone hears «tip»; the doctor's own old subscription gets nothing.
      const tip = await sealRecord(
        { patientId, id: 'tip-1', rev: 1, epoch: 1, author: `d:${owner.id}` },
        { kind: 'tip' },
        key,
        owner.identity.sign.privateKey,
      );
      expect(
        (
          await call(
            'POST',
            `/api/patients/${patientId}/records`,
            { records: [tip], notice: 'tip' },
            owner.token,
          )
        ).status,
      ).toBe(201);
      // The doctor's subscription has no keys: an urgent mark reaches it as an empty push.
      await call('POST', '/api/device/alerts', {}, deviceToken);
      await Bun.sleep(20);
      // Encrypting takes longer than an empty push, so the order is not fixed.
      expect(sent.map((one) => one.url).sort()).toEqual([
        'https://push.example/doctor',
        'https://push.example/phone',
        'https://push.example/phone',
      ]);
      expect(sent.find((one) => one.url.endsWith('/doctor'))?.size).toBe(0);
    } finally {
      globalThis.fetch = realFetch;
    }
    // A phone whose patient withdrew keeps no reminders.
    await call('PUT', '/api/device/reminders', { at: [later] }, deviceToken);
    await call('DELETE', '/api/device', undefined, deviceToken);
    const vapid = await loadVapid(store, 'mailto:test@example.org');
    expect(await sendDueReminders(store, vapid, () => undefined, Date.parse(later) + 1000)).toBe(0);
    expect(deviceId).toBeTruthy();
  });

  it('tells a carer once about a dose not marked taken 30 minutes after its moment', async () => {
    const { db, store, call } = await setup('open');
    const owner = await register(call, 'carer@clinic.ru', 'Д-р Смирнова');
    const patientId = randomId();
    const key = newDataKey();
    const ownerPublic = await publicIdentity(owner.identity);
    await call(
      'POST',
      '/api/patients',
      {
        id: patientId,
        key: {
          epoch: 1,
          recipient: `d:${owner.id}`,
          wrapped: await wrapDataKey(key, ownerPublic.wrap),
        },
      },
      owner.token,
    );
    const pair = async (kind?: 'carer') => {
      const secret = newPairingSecret();
      await call(
        'POST',
        `/api/patients/${patientId}/pairings`,
        {
          secretHash: await sha256(secret),
          keys: await sealPairingKeys(new Map([[1, key]]), secret),
          ...(kind ? { kind } : {}),
        },
        owner.token,
      );
      const paired = await call('POST', '/api/pair', {
        patientId,
        secret,
        identity: await publicIdentity(await generateIdentity()),
      });
      return { token: paired.body['token'] as string, id: paired.body['deviceId'] as string };
    };
    const minutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();
    const phone = await pair();
    // No carer yet: the phone's dose moments are not kept.
    await call('PUT', '/api/device/reminders', { at: [], checks: [minutes(10)] }, phone.token);
    expect(db.query('SELECT COUNT(*) AS n FROM dose_checks').get()).toEqual({ n: 0 });
    await call(
      'POST',
      '/api/push/subscriptions',
      { endpoint: 'https://push.example/phone' },
      phone.token,
    );

    const sent: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request) => {
      sent.push(String(input));
      return new Response(null, { status: 201 });
    }) as typeof fetch;
    try {
      const carer = await pair('carer');
      await call(
        'POST',
        '/api/push/subscriptions',
        { endpoint: 'https://push.example/carer' },
        carer.token,
      );
      // The patient's phone hears that a carer joined.
      await Bun.sleep(20);
      expect(sent).toEqual(['https://push.example/phone']);
      sent.length = 0;

      const [first, second] = [minutes(10), minutes(20)];
      await call('PUT', '/api/device/reminders', { at: [], checks: [first, second] }, phone.token);
      // A carer's phone only closes moments: its own times (another time zone) are not kept.
      await call(
        'PUT',
        '/api/device/reminders',
        { at: [], checks: [minutes(40)], taken: [second] },
        carer.token,
      );
      expect(db.query('SELECT at, state FROM dose_checks ORDER BY at').all()).toEqual([
        { at: first, state: 'open' },
        { at: second, state: 'taken' },
      ]);
      const vapid = await loadVapid(store, 'mailto:test@example.org');
      expect(await sendMissedDoses(store, vapid, () => undefined)).toBe(0);
      const late = Date.parse(second) + 31 * 60_000;
      expect(await sendMissedDoses(store, vapid, () => undefined, late)).toBe(1);
      expect(await sendMissedDoses(store, vapid, () => undefined, late + 1000)).toBe(0);
      await Bun.sleep(20);
      expect(sent).toEqual(['https://push.example/carer']);

      // The patient removes the carer: the open moments go, and no notice is sent any more.
      const third = minutes(30);
      await call('PUT', '/api/device/reminders', { at: [], checks: [third] }, phone.token);
      expect(
        (await call('DELETE', `/api/device/carers/${carer.id}`, undefined, phone.token)).status,
      ).toBe(200);
      expect(
        await sendMissedDoses(store, vapid, () => undefined, Date.parse(third) + 31 * 60_000),
      ).toBe(0);
      await call('PUT', '/api/device/reminders', { at: [], checks: [minutes(50)] }, phone.token);
      expect(db.query("SELECT COUNT(*) AS n FROM dose_checks WHERE state = 'open'").get()).toEqual({
        n: 0,
      });
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('asks for an invite when sign-up is closed and resets a password with the recovery code', async () => {
    const { db, call } = await setup('invite');
    const identity = await generateIdentity();
    const secrets = await deriveAccountSecrets('password-1', KDF);
    const recovery = await deriveRecoverySecrets(newRecoveryCode(), 'a@b.ru');
    const request = {
      email: 'a@b.ru',
      name: 'Врач',
      authKey: secrets.authKey,
      kdf: KDF,
      identity: await publicIdentity(identity),
      identityBlob: await sealIdentity(identity, secrets.wrapKey),
      recovery: {
        authKey: recovery.authKey,
        identityBlob: await sealIdentity(identity, recovery.wrapKey),
      },
    };
    expect((await call('POST', '/api/auth/register', request)).status).toBe(403);
    db.query("INSERT INTO invites (code, created_at) VALUES ('K7MP-2QXR-9HTN', 'now')").run();
    // Typed in lower case, with spaces and without dashes: still the same code.
    expect(
      (await call('POST', '/api/auth/register', { ...request, invite: ' k7mp 2qxr9htn ' })).status,
    ).toBe(201);
    expect(
      (
        await call('POST', '/api/auth/register', {
          ...request,
          email: 'c@d.ru',
          invite: 'K7MP-2QXR-9HTN',
        })
      ).status,
    ).toBe(403);

    const fetched = await call('POST', '/api/auth/recover/fetch', {
      email: 'a@b.ru',
      recoveryAuthKey: recovery.authKey,
    });
    const keys = await openIdentity(fetched.body['identityBlob'], recovery.wrapKey);
    const next = await deriveAccountSecrets('new-password', KDF);
    const reset = await call('POST', '/api/auth/recover/reset', {
      email: 'a@b.ru',
      recoveryAuthKey: recovery.authKey,
      authKey: next.authKey,
      kdf: KDF,
      identityBlob: await sealIdentity(keys, next.wrapKey),
    });
    expect(reset.status).toBe(200);
    expect(
      (await call('POST', '/api/auth/login', { email: 'a@b.ru', authKey: secrets.authKey })).status,
    ).toBe(401);
    expect(
      (await call('POST', '/api/auth/login', { email: 'a@b.ru', authKey: next.authKey })).status,
    ).toBe(200);
  });

  it('lets a hall sign in to the shared demo account but keeps the guessing cap elsewhere', async () => {
    const { call } = await setup();
    const login = (email: string) =>
      call('POST', '/api/auth/login', { email, authKey: 'a'.repeat(43) });
    const demo = await accessCodeEmail(DEMO_ACCESS_CODE);
    for (let index = 0; index < 40; index += 1) expect((await login(demo)).status).toBe(401);
    for (let index = 0; index < 12; index += 1) {
      expect((await login('doctor@clinic.ru')).status).toBe(401);
    }
    expect((await login('doctor@clinic.ru')).status).toBe(429);
  });

  it('shows the service owner aggregates only to an admin and never a patient or a record', async () => {
    const { call, logs } = await setup('open', undefined, ['boss@clinic.ru']);
    const boss = await register(call, 'Boss@Clinic.ru', 'Д-р Хозяин');
    const other = await register(call, 'other@clinic.ru', 'Д-р Другой');

    expect((await call('GET', '/api/admin/stats')).status).toBe(401);
    expect((await call('GET', '/api/admin/stats', undefined, other.token)).status).toBe(403);

    // The client learns of the entry from /api/auth/me; other doctors get no flag at all.
    expect((await call('GET', '/api/auth/me', undefined, boss.token)).body['admin']).toBe(true);
    expect('admin' in (await call('GET', '/api/auth/me', undefined, other.token)).body).toBe(false);
    expect(
      'admin' in (await call('GET', '/api/auth/me', undefined, other.token)).body['doctor'],
    ).toBe(false);

    const patient = randomId();
    const key = newDataKey();
    const created = await call(
      'POST',
      '/api/patients',
      {
        id: patient,
        key: {
          epoch: 1,
          recipient: `d:${boss.id}`,
          wrapped: await wrapDataKey(key, (await publicIdentity(boss.identity)).wrap),
        },
      },
      boss.token,
    );
    expect(created.status).toBe(201);

    const stats = await call('GET', '/api/admin/stats', undefined, boss.token);
    expect(stats.status).toBe(200);
    expect(DiaryAdminStatsSchema.parse(stats.body)).toBeTruthy();
    expect(stats.body['doctors'].total).toBe(2);
    expect(stats.body['patients'].total).toBe(1);
    expect(stats.body['patients'].withPhone).toBe(0);
    expect(stats.body['doctorRows']).toHaveLength(2);
    // Aggregates only: the patient's id appears nowhere.
    expect(JSON.stringify(stats.body)).not.toContain(patient);
    expect(logs.join('\n')).not.toContain(patient);
  });

  it('keeps the reported totals, only for a signed-in doctor, and shows them to the owner', async () => {
    const { call, logs } = await setup('open', undefined, ['boss@clinic.ru']);
    const boss = await register(call, 'boss@clinic.ru', 'Д-р Хозяин');
    const other = await register(call, 'other@clinic.ru', 'Д-р Другой');
    const totals = {
      diaries: 3,
      prescriptions: 8,
      adherence7: { done: 20, total: 30 },
      adherence30: { done: 70, total: 100 },
    };

    expect((await call('PUT', '/api/doctor/totals', totals)).status).toBe(401);
    for (const bad of [
      { ...totals, prescriptions: -1 },
      { ...totals, diaries: 1.5 },
      { ...totals, prescriptions: 10_000_001 },
      { ...totals, adherence7: { done: 31, total: 30 } },
      { ...totals, adherence30: { done: 1 } },
      { diaries: 1 },
      { ...totals, patientId: 'abc' },
    ]) {
      const answer = await call('PUT', '/api/doctor/totals', bad, other.token);
      expect(answer.status, JSON.stringify(bad)).toBe(400);
    }

    expect((await call('PUT', '/api/doctor/totals', totals, other.token)).status).toBe(200);
    // A second report replaces the first: one row per doctor.
    const newer = { ...totals, prescriptions: 9, adherence30: { done: 80, total: 100 } };
    expect((await call('PUT', '/api/doctor/totals', newer, other.token)).status).toBe(200);

    const stats = await call('GET', '/api/admin/stats', undefined, boss.token);
    expect(DiaryAdminStatsSchema.parse(stats.body)).toBeTruthy();
    expect(stats.body['prescriptions']).toBe(9);
    expect(stats.body['diariesWithPlan']).toBe(3);
    expect(stats.body['adherence7']).toEqual({ done: 20, total: 30 });
    expect(stats.body['adherence30']).toEqual({ done: 80, total: 100 });
    const rows = stats.body['doctorRows'] as { email: string; totalsAt: string | null }[];
    const row = rows.find((entry) => entry.email === 'other@clinic.ru');
    expect(row).toMatchObject({ prescriptions: 9, adherence30: 0.8 });
    expect(typeof row?.totalsAt).toBe('string');
    expect(rows.find((entry) => entry.email === 'boss@clinic.ru')?.totalsAt).toBeNull();
    expect(logs.join('\n')).not.toContain('prescriptions');
  });

  it('has no admin when none is configured', async () => {
    const { call } = await setup();
    const doctor = await register(call, 'boss@clinic.ru', 'Д-р Хозяин');
    expect((await call('GET', '/api/admin/stats', undefined, doctor.token)).status).toBe(403);
    expect('admin' in (await call('GET', '/api/auth/me', undefined, doctor.token)).body).toBe(
      false,
    );
  });
});
