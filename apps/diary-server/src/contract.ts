/**
 * One diary life through the HTTP app that touches every method of the storage port (ADR-0027).
 * Runtime-neutral (no bun:test): `contract.test.ts` runs it over SQLite under Bun, and
 * `scripts/diary-ydb-contract.sh` bundles it for Node and runs it over a real YDB database.
 */
import {
  deriveAccountSecrets,
  deriveRecoverySecrets,
  generateIdentity,
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
  wrapDataKey,
} from '@localmed/diary-sync';

import { buildServiceStats, statsWindows } from './stats';
import { type DiaryStore, InviteSpent } from './store';

type App = (request: Request) => Promise<Response>;
// biome-ignore lint/suspicious/noExplicitAny: the scenario reads answers as loose JSON.
type Body = Record<string, any>;

const KDF = { salt: 'c2FsdHNhbHRzYWx0c2FsdA', iterations: 100_000 };

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`contract: ${message}`);
}

/**
 * `store` is the one behind `app` (the missed-dose checks need moments in the past, which no route
 * accepts); the app is made with `tickToken: CONTRACT_TICK_TOKEN`.
 */
export const CONTRACT_TICK_TOKEN = 'tick-test';

export async function runStoreContract(
  app: App,
  mode: 'server' | 'serverless',
  store: DiaryStore,
): Promise<string[]> {
  const steps: string[] = [];
  const step = (name: string) => steps.push(name);
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
    return { status: response.status, body: (await response.json()) as Body };
  };
  const expectStatus = async (
    status: number,
    pending: Promise<{ status: number; body: Body }>,
    what: string,
  ) => {
    const result = await pending;
    check(
      result.status === status,
      `${what}: ${result.status} ≠ ${status} (${JSON.stringify(result.body)})`,
    );
    return result.body;
  };
  // Unique per run: a shared test database may already hold earlier runs.
  const run = randomId(8).toLowerCase();

  const health = await expectStatus(200, call('GET', '/api/health'), 'health');
  check(health['live'] === (mode === 'server' ? 'sse' : 'poll'), 'health tells the live mode');
  step('health');

  const registration = async (email: string, name: string) => {
    const identity = await generateIdentity();
    const secrets = await deriveAccountSecrets('password-1', KDF);
    const code = newRecoveryCode();
    const recovery = await deriveRecoverySecrets(code, email);
    const body = {
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
    };
    return { identity, code, recovery, body };
  };
  const register = async (email: string, name: string) => {
    const made = await registration(email, name);
    const body = await expectStatus(
      201,
      call('POST', '/api/auth/register', made.body),
      `register ${email}`,
    );
    return { ...made, token: body['token'] as string, id: body['doctor'].id as string };
  };
  const ownerEmail = `owner-${run}@clinic.test`;
  const curatorEmail = `curator-${run}@clinic.test`;
  const owner = await register(ownerEmail, 'Д-р Иванова');
  const curator = await register(curatorEmail, 'Д-р Петров');
  await expectStatus(
    409,
    call('POST', '/api/auth/register', (await registration(ownerEmail, 'Двойник')).body),
    'e-mail taken',
  );
  step('register');

  // Invites (SEC-AUDIT1): plain codes are re-keyed, a code is spent once even by a race.
  const plainCode = `PLAIN-${run}`;
  await store.createInvite(plainCode, new Date().toISOString());
  check((await store.plainInvites()).includes(plainCode), 'plain invites are listed');
  const inviteKey = `h1:contract-${run}`;
  await store.rekeyInvite(plainCode, inviteKey);
  check(!(await store.plainInvites()).includes(plainCode), 'a re-keyed invite is no longer plain');
  check((await store.invite(plainCode)) === undefined, 'the plain code is gone');
  check((await store.invite(inviteKey))?.used_by === null, 'the re-keyed invite is unused');
  const inviteDoctor = (email: string) => ({
    id: randomId(),
    email,
    name: 'Приглашённый',
    auth_hash: 'h',
    kdf_salt: KDF.salt,
    kdf_iterations: KDF.iterations,
    identity_wrap: 'w',
    identity_sign: 's',
    identity_blob: 'b',
    recovery_hash: 'h',
    recovery_blob: 'b',
    created_at: new Date().toISOString(),
  });
  await store.createDoctor(inviteDoctor(`invited-${run}@clinic.test`), inviteKey);
  let spent = false;
  try {
    await store.createDoctor(inviteDoctor(`invited2-${run}@clinic.test`), inviteKey);
  } catch (cause) {
    spent = cause instanceof InviteSpent;
  }
  check(spent, 'a spent invite creates no second account');
  check(
    (await store.doctorByEmail(`invited2-${run}@clinic.test`)) === undefined,
    'nothing is left of the refused account',
  );
  step('invites');

  const secrets = await deriveAccountSecrets('password-1', KDF);
  const login = await expectStatus(
    200,
    call('POST', '/api/auth/login', { email: ownerEmail, authKey: secrets.authKey }),
    'login',
  );
  const me = await expectStatus(200, call('GET', '/api/auth/me', undefined, login['token']), 'me');
  check(me['doctor'].id === owner.id, 'me is the owner');
  await expectStatus(200, call('POST', '/api/auth/logout', undefined, login['token']), 'logout');
  await expectStatus(401, call('GET', '/api/auth/me', undefined, login['token']), 'logged out');
  step('sessions');

  // A patient with the owner's key; then a plan record from the doctor.
  const patientId = randomId();
  const key1 = newDataKey();
  const ownerPublic = await publicIdentity(owner.identity);
  const patientBody = {
    id: patientId,
    key: {
      epoch: 1,
      recipient: `d:${owner.id}`,
      wrapped: await wrapDataKey(key1, ownerPublic.wrap),
    },
  };
  await expectStatus(
    201,
    call('POST', '/api/patients', patientBody, owner.token),
    'create patient',
  );
  await expectStatus(
    409,
    call('POST', '/api/patients', patientBody, owner.token),
    'duplicate patient',
  );
  const listed = await expectStatus(
    200,
    call('GET', '/api/patients', undefined, owner.token),
    'list',
  );
  check(
    listed['patients'].length === 1 && listed['patients'][0].keys.length === 1,
    'owner sees the patient and key',
  );
  const plan = await sealRecord(
    { patientId, id: 'plan', rev: 1, epoch: 1, author: `d:${owner.id}` },
    { kind: 'plan' },
    key1,
    owner.identity.sign.privateKey,
  );
  const planSeq = await expectStatus(
    201,
    call('POST', `/api/patients/${patientId}/records`, { records: [plan] }, owner.token),
    'plan',
  );
  await expectStatus(
    409,
    call('POST', `/api/patients/${patientId}/records`, { records: [plan] }, owner.token),
    'duplicate revision',
  );
  step('patients and records');

  // Pairing is one-time.
  const pair = async () => {
    const secret = newPairingSecret();
    await expectStatus(
      201,
      call(
        'POST',
        `/api/patients/${patientId}/pairings`,
        {
          secretHash: await pairingProofHash(secret),
          keys: await sealPairingKeys(new Map([[1, key1]]), secret),
        },
        owner.token,
      ),
      'pairing',
    );
    const device = await generateIdentity();
    // The phone proves it holds the secret without sending it (SEC-AUDIT1).
    const body = {
      patientId,
      proof: await pairingProof(secret),
      identity: await publicIdentity(device),
    };
    const paired = await expectStatus(201, call('POST', '/api/pair', body), 'pair');
    check(
      (await openPairingKeys(paired['keys'], secret)).get(1) !== undefined,
      'phone opens the keys',
    );
    await expectStatus(404, call('POST', '/api/pair', body), 'pairing reused');
    return { device, token: paired['token'] as string, id: paired['deviceId'] as string };
  };
  const phone = await pair();
  const changesBefore = (
    await expectStatus(200, call('GET', '/api/changes', undefined, owner.token), 'changes')
  )['n'];
  const entry = await sealRecord(
    { patientId, id: 'entry1', rev: 1, epoch: 1, author: `p:${phone.id}` },
    { kind: 'entry' },
    key1,
    phone.device.sign.privateKey,
  );
  await expectStatus(
    201,
    call('POST', `/api/patients/${patientId}/records`, { records: [entry] }, phone.token),
    'phone record',
  );
  const pulled = await expectStatus(
    200,
    call(
      'GET',
      `/api/patients/${patientId}/records?after=${planSeq['seqs'][0]}`,
      undefined,
      owner.token,
    ),
    'pull',
  );
  check(
    pulled['records'].length === 1 && pulled['records'][0].id === 'entry1',
    'pull after the cursor',
  );
  const authors = await expectStatus(
    200,
    call('GET', `/api/patients/${patientId}/authors`, undefined, owner.token),
    'authors',
  );
  check(Object.keys(authors['authors']).length === 2, 'both authors have signing keys');
  if (mode === 'serverless') {
    const changesAfter = (
      await expectStatus(200, call('GET', '/api/changes', undefined, owner.token), 'changes')
    )['n'];
    check(changesAfter > changesBefore, 'a phone record bumps the doctor’s counter');
  }
  const summary = (
    await expectStatus(200, call('GET', '/api/patients', undefined, owner.token), 'summary')
  )['patients'][0];
  check(
    summary.lastSeq >= 2 && summary.devices === 1 && summary.online === true,
    'summary counts and presence',
  );
  step('pairing, phone records, changes');

  // Alerts and push subscriptions (the endpoint does not resolve: the push fails quietly).
  await expectStatus(
    201,
    call(
      'POST',
      '/api/push/subscriptions',
      { endpoint: `https://push.invalid/${run}` },
      owner.token,
    ),
    'subscribe',
  );
  await expectStatus(201, call('POST', '/api/device/alerts', {}, phone.token), 'alert');
  const alerts = await expectStatus(
    200,
    call('GET', '/api/alerts', undefined, owner.token),
    'alerts',
  );
  check(alerts['alerts'].length === 1, 'the owner sees the alert');
  await expectStatus(
    200,
    call('POST', `/api/alerts/${alerts['alerts'][0].id}/ack`, undefined, owner.token),
    'ack',
  );
  check(
    (await expectStatus(200, call('GET', '/api/alerts', undefined, owner.token), 'alerts'))[
      'alerts'
    ].length === 0,
    'acked alerts leave the list',
  );
  await expectStatus(
    200,
    call(
      'PUT',
      '/api/device/reminders',
      { at: [new Date(Date.now() + 3_600_000).toISOString()] },
      phone.token,
    ),
    'reminders',
  );
  step('alerts, push, reminders');

  // Curators: invite, accept, role, details, transfer and back, removal; then a new epoch.
  const curatorPublic = await publicIdentity(curator.identity);
  await expectStatus(
    200,
    call(
      'GET',
      `/api/doctors/lookup?email=${encodeURIComponent(curatorEmail)}`,
      undefined,
      owner.token,
    ),
    'lookup',
  );
  await expectStatus(
    201,
    call(
      'POST',
      `/api/patients/${patientId}/members`,
      {
        doctorId: curator.id,
        role: 'reader',
        keys: [
          {
            epoch: 1,
            recipient: `d:${curator.id}`,
            wrapped: await wrapDataKey(key1, curatorPublic.wrap),
          },
        ],
      },
      owner.token,
    ),
    'invite curator',
  );
  await expectStatus(
    200,
    call('POST', `/api/patients/${patientId}/accept`, undefined, curator.token),
    'accept',
  );
  await expectStatus(
    200,
    call(
      'PATCH',
      `/api/patients/${patientId}/members/${curator.id}`,
      { role: 'editor' },
      owner.token,
    ),
    'role',
  );
  const details = await expectStatus(
    200,
    call('GET', `/api/patients/${patientId}`, undefined, curator.token),
    'details',
  );
  check(
    details['members'].length === 2 && details['devices'].length === 1,
    'details list members and the phone',
  );
  await expectStatus(
    200,
    call('POST', `/api/patients/${patientId}/transfer/${curator.id}`, undefined, owner.token),
    'transfer',
  );
  await expectStatus(
    200,
    call('POST', `/api/patients/${patientId}/transfer/${owner.id}`, undefined, curator.token),
    'transfer back',
  );
  await expectStatus(
    200,
    call('DELETE', `/api/patients/${patientId}/members/${curator.id}`, undefined, owner.token),
    'remove curator',
  );
  const key2 = newDataKey();
  const phonePublic = await publicIdentity(phone.device);
  await expectStatus(
    200,
    call(
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
            recipient: `p:${phone.id}`,
            wrapped: await wrapDataKey(key2, phonePublic.wrap),
          },
        ],
      },
      owner.token,
    ),
    'new epoch',
  );
  const deviceKeys = await expectStatus(
    200,
    call('GET', '/api/device/keys', undefined, phone.token),
    'device keys',
  );
  check(
    deviceKeys['epoch'] === 2 && deviceKeys['keys'].length === 1,
    'the phone gets the epoch 2 key',
  );
  step('curators and epochs');

  // A carer (DIARY25): pairs like a phone, writes, cannot withdraw consent or remove the patient's
  // phone; dose checks; the patient's phone removes the carer and rotates the key itself.
  const carerSecret = newPairingSecret();
  await expectStatus(
    201,
    call(
      'POST',
      `/api/patients/${patientId}/pairings`,
      {
        secretHash: await pairingProofHash(carerSecret),
        keys: await sealPairingKeys(new Map([[2, key2]]), carerSecret),
        kind: 'carer',
      },
      owner.token,
    ),
    'carer pairing',
  );
  const carerDevice = await generateIdentity();
  const carerPaired = await expectStatus(
    201,
    call('POST', '/api/pair', {
      patientId,
      proof: await pairingProof(carerSecret),
      identity: await publicIdentity(carerDevice),
    }),
    'carer pair',
  );
  check(carerPaired['kind'] === 'carer', 'the pairing says it is a carer');
  const carer = { token: carerPaired['token'] as string, id: carerPaired['deviceId'] as string };
  const withCarer = await expectStatus(
    200,
    call('GET', `/api/patients/${patientId}`, undefined, phone.token),
    'details with a carer',
  );
  check(
    withCarer['devices']
      .map((device: Body) => device['kind'])
      .toSorted()
      .join() === 'carer,patient',
    'details tell the carer from the patient',
  );
  const carerSummary = (
    await expectStatus(200, call('GET', '/api/patients', undefined, owner.token), 'summary')
  )['patients'][0];
  check(carerSummary.devices === 1 && carerSummary.carers === 1, 'summary counts the carer apart');
  const carerEntry = await sealRecord(
    { patientId, id: 'e-carer1', rev: 1, epoch: 2, author: `p:${carer.id}` },
    { kind: 'entry' },
    key2,
    carerDevice.sign.privateKey,
  );
  await expectStatus(
    201,
    call('POST', `/api/patients/${patientId}/records`, { records: [carerEntry] }, carer.token),
    'carer record',
  );
  await expectStatus(403, call('DELETE', '/api/device', undefined, carer.token), 'carer withdraws');
  await expectStatus(
    403,
    call('DELETE', `/api/device/carers/${phone.id}`, undefined, carer.token),
    'carer removes the phone',
  );
  const soon = new Date(Date.now() + 3_600_000).toISOString();
  await expectStatus(
    200,
    call('PUT', '/api/device/reminders', { at: [], checks: [soon] }, phone.token),
    'dose checks',
  );
  await expectStatus(
    200,
    call('PUT', '/api/device/reminders', { at: [], taken: [soon] }, carer.token),
    'taken by the carer',
  );
  const hour = 3_600_000;
  const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
  const [stale, taken, open] = [ago(2 * hour), ago(1.5 * hour), ago(hour)];
  await store.replaceDoseChecks(patientId, [stale, taken, open], ago(3 * hour));
  await store.markDosesTaken(patientId, [taken]);
  const missed = await store.takeMissedDoses(ago(0.5 * hour), ago(1.8 * hour));
  check(
    missed.length === 1 && missed[0]?.at === open && missed[0]?.patient_id === patientId,
    'one open dose is due (the older is stale, the other taken)',
  );
  check(
    (await store.takeMissedDoses(ago(0.5 * hour), ago(1.8 * hour))).length === 0,
    'a missed dose is told once',
  );
  const tick = await expectStatus(
    200,
    call('POST', '/api/tick', undefined, CONTRACT_TICK_TOKEN),
    'tick',
  );
  check(typeof tick['missed'] === 'number', 'the tick reports what it sent');
  await expectStatus(401, call('POST', '/api/tick', undefined, 'wrong'), 'tick without the key');
  await expectStatus(
    200,
    call('DELETE', `/api/device/carers/${carer.id}`, undefined, phone.token),
    'the patient removes the carer',
  );
  await expectStatus(401, call('GET', '/api/device/keys', undefined, carer.token), 'removed carer');
  const key3 = newDataKey();
  await expectStatus(
    200,
    call(
      'POST',
      `/api/patients/${patientId}/epochs`,
      {
        epoch: 3,
        keys: [
          {
            epoch: 3,
            recipient: `d:${owner.id}`,
            wrapped: await wrapDataKey(key3, ownerPublic.wrap),
          },
          {
            epoch: 3,
            recipient: `p:${phone.id}`,
            wrapped: await wrapDataKey(key3, phonePublic.wrap),
          },
        ],
      },
      phone.token,
    ),
    'the patient’s phone rotates the key',
  );
  step('carer');

  // The service owner's aggregates (the YDB database is shared between runs, so only lower bounds).
  const at = new Date();
  const windows = statsWindows(at);
  const raw = await store.serviceStats(windows.since7, windows.since30);
  const overview = buildServiceStats(raw, at);
  check(overview.doctors.total >= 2, 'overview counts the doctors');
  check(overview.patients.total >= 1, 'overview counts the diaries');
  check(overview.records.total >= 1 && overview.records.last7 >= 1, 'overview counts records');
  check(overview.records.last30 >= overview.records.last7, 'overview windows nest');
  check(overview.phones.patient >= 1, 'overview counts phones');
  check(overview.alerts.total >= 1, 'overview counts alerts');
  check(overview.weeks.at(-1)?.newDoctors !== undefined, 'overview has a weekly series');
  check(
    overview.doctorRows.some((row) => row.email === ownerEmail && row.patients >= 1),
    'overview lists the doctor with a diary',
  );
  step('service overview aggregates');

  // Revoke the phone; a second phone withdraws consent; another patient is deleted.
  await expectStatus(
    200,
    call('DELETE', `/api/patients/${patientId}/devices/${phone.id}`, undefined, owner.token),
    'revoke',
  );
  await expectStatus(401, call('GET', '/api/device/keys', undefined, phone.token), 'revoked phone');
  const second = await (async () => {
    const secret = newPairingSecret();
    await expectStatus(
      201,
      call(
        'POST',
        `/api/patients/${patientId}/pairings`,
        {
          secretHash: await pairingProofHash(secret),
          keys: await sealPairingKeys(new Map([[2, key2]]), secret),
        },
        owner.token,
      ),
      'pairing 2',
    );
    const device = await generateIdentity();
    // A phone from before SEC-AUDIT1 still sends the secret; the server derives the proof.
    return expectStatus(
      201,
      call('POST', '/api/pair', { patientId, secret, identity: await publicIdentity(device) }),
      'pair 2',
    );
  })();
  await expectStatus(200, call('DELETE', '/api/device', undefined, second['token']), 'withdraw');
  check(
    (
      await expectStatus(
        200,
        call('GET', `/api/patients/${patientId}/records`, undefined, owner.token),
        'after withdrawal',
      )
    )['records'].length === 0,
    'withdrawal deletes the records',
  );
  const other = randomId();
  await expectStatus(
    201,
    call(
      'POST',
      '/api/patients',
      {
        id: other,
        key: {
          epoch: 1,
          recipient: `d:${owner.id}`,
          wrapped: await wrapDataKey(newDataKey(), ownerPublic.wrap),
        },
      },
      owner.token,
    ),
    'second patient',
  );
  await expectStatus(
    200,
    call('DELETE', `/api/patients/${other}`, undefined, owner.token),
    'delete patient',
  );
  await expectStatus(
    403,
    call('GET', `/api/patients/${other}`, undefined, owner.token),
    'deleted patient',
  );
  step('revoke, withdraw, delete');

  // Recovery code resets the password and ends the sessions; wrong passwords hit the limit.
  const fresh = await deriveAccountSecrets('password-2', KDF);
  await expectStatus(
    200,
    call('POST', '/api/auth/recover/reset', {
      email: ownerEmail,
      recoveryAuthKey: owner.recovery.authKey,
      authKey: fresh.authKey,
      kdf: KDF,
      identityBlob: await sealIdentity(owner.identity, fresh.wrapKey),
    }),
    'recover',
  );
  await expectStatus(401, call('GET', '/api/auth/me', undefined, owner.token), 'old session ended');
  let limited = false;
  for (let i = 0; i < 14 && !limited; i += 1) {
    limited =
      (await call('POST', '/api/auth/login', { email: curatorEmail, authKey: 'x'.repeat(43) }))
        .status === 429;
  }
  check(limited, 'repeated wrong logins are limited');
  step('recovery and rate limit');
  return steps;
}
