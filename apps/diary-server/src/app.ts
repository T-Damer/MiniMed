/**
 * HTTP API of the connected diary (ADR-0026). One `fetch` handler, so tests drive it without a
 * socket, over the storage port (`store.ts`) so the same routes run in both modes of ADR-0027:
 * `server` (Bun + SQLite, live stream) and `serverless` (Node + YDB, clients poll). Every body is
 * validated with the shared contract; every patient route checks membership or device ownership;
 * logs carry the route template, status and time only.
 */
import {
  DIARY_ONLINE_WINDOW_MS,
  DIARY_PRESENCE_EVENT_INTERVAL_MS,
  type DiaryAlert,
  type DiaryDeviceKind,
  DiaryEmailSchema,
  DiaryEpochCreateSchema,
  DiaryLoginRequestSchema,
  DiaryMemberInviteSchema,
  DiaryMemberPatchSchema,
  DiaryPairingCreateSchema,
  DiaryPairRequestSchema,
  DiaryPatientCreateSchema,
  type DiaryPatientSummary,
  DiaryPreloginRequestSchema,
  type DiaryPushPayload,
  DiaryPushSubscriptionSchema,
  DiaryRecordsPushSchema,
  DiaryRecoverFetchRequestSchema,
  DiaryRecoverResetRequestSchema,
  DiaryRegisterRequestSchema,
  DiaryRemindersSchema,
  type DiaryRole,
} from '@localmed/contracts';
import {
  accessCodeEmail,
  DEMO_ACCESS_CODE,
  inviteProof,
  inviteStorageKey,
  pairingProof,
  randomBytes,
  randomId,
  sha256,
  toBase64Url,
} from '@localmed/diary-sync';
import type { z } from 'zod';

import type { Passwords } from './passwords';
import { pushToOwners, type Vapid } from './push';
import {
  replaceDoseChecks,
  replaceReminders,
  sendDueReminders,
  sendMissedDoses,
} from './reminders';
import {
  type DiaryStore,
  type DoctorRow,
  InviteSpent,
  now,
  type PatientRow,
  StoreConflict,
} from './store';

/** `server`: one long-running process with a live stream; `serverless`: stateless instances, clients poll. */
export type DiaryMode = 'server' | 'serverless';

export interface AppConfig {
  readonly mode?: DiaryMode;
  readonly passwords: Passwords;
  readonly signup: 'open' | 'invite';
  /** Server secret for the decoy salt of unknown e-mails (no account enumeration). */
  readonly secret: string;
  readonly vapid: Vapid;
  /** Directory of the built web app to serve next to the API; absent in tests. */
  readonly staticDir?: string;
  /** Other origins allowed to call the API (the Android app's WebView); none by default. */
  readonly corsOrigins?: readonly string[];
  readonly log?: (line: string) => void;
  /** Presence window; tests shorten it (default `DIARY_ONLINE_WINDOW_MS`). */
  readonly onlineWindowMs?: number;
  /**
   * Secret of `POST /api/tick` (due reminders and missed-dose notices), for a scheduler outside
   * the process: a Yandex Cloud timer trigger in `serverless` mode. Absent: no such route.
   */
  readonly tickToken?: string;
}

const SESSION_DAYS = 30;
const PAIRING_HOURS = 72;
const PAGE = 500;
const ATTEMPT_WINDOW_MS = 60_000;
const ATTEMPT_LIMIT = 12;
/** Sign-ins a minute to the shared demo account: a lecture hall scanning the QR code at once. */
const DEMO_SIGNIN_LIMIT = 600;
/**
 * Failed sign-ins (or recovery checks) a minute for one account from all addresses together. Every
 * attempt counts per account and address (ATTEMPT_LIMIT), only failures count here: a stranger can
 * no longer lock the owner out from one address, and guessing stays slow from many (SEC-AUDIT1).
 */
const ACCOUNT_FAILURE_LIMIT = 60;
/** Password checks a minute from one address over all accounts: argon2id is 64 MiB each. */
const ADDRESS_CHECK_LIMIT = 60;
/** Push subscriptions per doctor or phone; the oldest-listed one makes room for a new one. */
const MAX_PUSH_SUBSCRIPTIONS = 10;
/** Urgent alerts a minute from one phone. */
const ALERT_LIMIT = 6;
/** Record ids only a doctor writes (the replica refuses them from phones too). */
const DOCTOR_RECORDS = new Set(['plan', 'profile']);

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function body<T extends z.ZodType>(request: Request, schema: T): Promise<z.infer<T>> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new HttpError(400, 'Тело запроса — не JSON.');
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new HttpError(400, 'Некорректный запрос.');
  return parsed.data;
}

/**
 * The caller's address for rate limits: the last `X-Forwarded-For` entry, which the hop in front
 * appends (Yandex API Gateway, Caddy) and a client cannot forge. `-` without a proxy (tests).
 */
function clientAddress(request: Request): string {
  const last = request.headers.get('X-Forwarded-For')?.split(',').at(-1)?.trim();
  return last && last.length <= 64 ? last : '-';
}

function bearer(request: Request, url: URL): string | undefined {
  const header = request.headers.get('Authorization');
  if (header?.startsWith('Bearer ')) return header.slice(7);
  // EventSource cannot send headers: the live stream takes the token from the query.
  return url.pathname === '/api/events' ? (url.searchParams.get('token') ?? undefined) : undefined;
}

type Caller =
  | { readonly kind: 'doctor'; readonly id: string }
  | {
      readonly kind: 'device';
      readonly id: string;
      readonly patientId: string;
      /** The patient's own phone or a carer's (DIARY25). */
      readonly device: DiaryDeviceKind;
    };

/** Live streams of signed-in doctors: doctor id → open SSE controllers. */
class EventHub {
  private readonly streams = new Map<string, Set<ReadableStreamDefaultController<Uint8Array>>>();
  private readonly encoder = new TextEncoder();

  open(doctorId: string): Response {
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    let ping: ReturnType<typeof setInterval> | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start: (current) => {
        controller = current;
        const set = this.streams.get(doctorId) ?? new Set();
        set.add(current);
        this.streams.set(doctorId, set);
        current.enqueue(this.encoder.encode(': open\n\n'));
        ping = setInterval(() => current.enqueue(this.encoder.encode(': ping\n\n')), 25_000);
      },
      cancel: () => {
        clearInterval(ping);
        if (controller) this.streams.get(doctorId)?.delete(controller);
      },
    });
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
      },
    });
  }

  send(doctorIds: readonly string[], event: string, data: unknown): void {
    const chunk = this.encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    for (const id of doctorIds) {
      for (const controller of this.streams.get(id) ?? []) {
        try {
          controller.enqueue(chunk);
        } catch {
          // A closed stream is removed by its own cancel; a failed enqueue only means it is closing.
          this.streams.get(id)?.delete(controller);
        }
      }
    }
  }
}

export function createApp(
  store: DiaryStore,
  config: AppConfig,
): (request: Request) => Promise<Response> {
  const live = (config.mode ?? 'server') === 'server';
  const hub = new EventHub();
  const log = config.log ?? ((line: string) => console.info(line));
  const onlineWindowMs = config.onlineWindowMs ?? DIARY_ONLINE_WINDOW_MS;
  const passwords = config.passwords;

  /**
   * Live events reach open streams in `server` mode; in `serverless` mode the recipients' change
   * counters are bumped and clients poll `/api/changes` (doctor ids as they are, phones as `p:<id>`).
   */
  const notify = async (ids: readonly string[], event: string, data: unknown): Promise<void> => {
    if (live) hub.send(ids, event, data);
    else await store.bumpChanges(ids);
  };

  const limit = async (key: string, max = ATTEMPT_LIMIT): Promise<void> => {
    if (!(await store.attempt(key, ATTEMPT_WINDOW_MS, max))) {
      throw new HttpError(429, 'Слишком много попыток. Подождите минуту.');
    }
  };

  const demoEmail = accessCodeEmail(DEMO_ACCESS_CODE);
  /** The shared demo account is public: its sign-ins get a hall-sized cap, not a guessing one. */
  const signinLimit = async (email: string): Promise<number> =>
    email === (await demoEmail) ? DEMO_SIGNIN_LIMIT : ATTEMPT_LIMIT;
  /**
   * The demo account's secret is public, so after one argon2id check its digest is enough: a hall
   * of sign-ins (or a flood of wrong ones) costs a hash each, not 64 MiB each. Keyed by the stored
   * hash, so a changed password is checked again.
   */
  const demoChecked = new Map<string, string>();

  /**
   * One sign-in or recovery check (SEC-AUDIT1): limits per account and address, then per address,
   * then failures per account; the row when `secret` matches, otherwise undefined.
   */
  const checkSecret = async (
    scope: 'login' | 'recover',
    request: Request,
    email: string,
    secret: string,
    hashOf: (row: DoctorRow) => string,
  ): Promise<DoctorRow | undefined> => {
    const demo = email === (await demoEmail);
    const address = clientAddress(request);
    await limit(`${scope}:${email}:${address}`, demo ? DEMO_SIGNIN_LIMIT : ATTEMPT_LIMIT);
    const failures = `${scope}-fail:${email}`;
    if (!demo) {
      await limit(`check:${address}`, ADDRESS_CHECK_LIMIT);
      if (!(await store.attempt(failures, ATTEMPT_WINDOW_MS, ACCOUNT_FAILURE_LIMIT, false))) {
        throw new HttpError(429, 'Слишком много попыток. Подождите минуту.');
      }
    }
    const row = await doctorByEmail(email);
    let ok = false;
    if (row) {
      const stored = hashOf(row);
      const digest = demo ? await sha256(secret) : '';
      const known = demo ? demoChecked.get(stored) : undefined;
      if (known !== undefined) ok = known === digest;
      else {
        ok = await passwords.verify(secret, stored);
        if (ok && demo) demoChecked.set(stored, digest);
      }
    }
    if (!ok && !demo) await store.attempt(failures, ATTEMPT_WINDOW_MS, Number.MAX_SAFE_INTEGER);
    return ok ? row : undefined;
  };

  /**
   * Invites made before SEC-AUDIT1 (or put in by hand) are plain codes, and an access code is also
   * its account's password: each registration re-keys them to the hash of their proof first, so
   * the database keeps no code, used ones included. The invites table is small.
   */
  const keyInvites = async (): Promise<void> => {
    for (const code of await store.plainInvites()) {
      await store.rekeyInvite(code, await inviteStorageKey(await inviteProof(code)));
    }
  };

  // --- presence --------------------------------------------------------------------------------
  // A phone is seen on every authenticated request (the diary syncs on open, when visible/online
  // again and every 60 s while visible; see DIARY_ONLINE_WINDOW_MS). Only timestamps and an
  // online flag are kept or sent: no record content.

  /** Patient id → what the doctors were last told, and the timer that flips it to offline. */
  const presence = new Map<
    string,
    { online: boolean; sentAt: number; timer?: ReturnType<typeof setTimeout> }
  >();

  const presenceOf = async (
    patientId: string,
  ): Promise<{ lastSeenAt?: string; online: boolean }> => {
    const lastSeenAt = await store.lastSeen(patientId);
    const online = lastSeenAt !== undefined && Date.now() - Date.parse(lastSeenAt) < onlineWindowMs;
    return lastSeenAt === undefined ? { online } : { lastSeenAt, online };
  };

  const announcePresence = async (patientId: string): Promise<void> => {
    const state = presence.get(patientId);
    if (state) state.sentAt = Date.now();
    await notify(await store.activeDoctors(patientId), 'presence', {
      patientId,
      ...(await presenceOf(patientId)),
    });
  };

  const touchDevice = async (deviceId: string, patientId: string): Promise<void> => {
    await store.touchDevice(deviceId, now());
    // Without a live stream the doctors read presence from the summary; no timers to keep.
    if (!live) return;
    const state = presence.get(patientId) ?? { online: false, sentAt: 0 };
    clearTimeout(state.timer);
    const cameOnline = !state.online;
    state.online = true;
    // Nobody calls once the diary is closed, so the offline flip is timer-driven.
    state.timer = setTimeout(() => {
      state.online = false;
      announcePresence(patientId).catch((cause: unknown) =>
        log(`presence failed: ${cause instanceof Error ? cause.name : 'error'}`),
      );
    }, onlineWindowMs + 100);
    state.timer.unref();
    presence.set(patientId, state);
    if (cameOnline || Date.now() - state.sentAt >= DIARY_PRESENCE_EVENT_INTERVAL_MS) {
      await announcePresence(patientId);
    }
  };

  // --- callers ---------------------------------------------------------------------------------

  const caller = async (request: Request, url: URL): Promise<Caller> => {
    const token = bearer(request, url);
    if (!token) throw new HttpError(401, 'Нужен вход.');
    const hash = await sha256(token);
    const session = await store.session(hash);
    if (session) {
      if (session.expires_at < now()) throw new HttpError(401, 'Сессия истекла.');
      return { kind: 'doctor', id: session.doctor_id };
    }
    const device = await store.deviceByToken(hash);
    if (device) {
      await touchDevice(device.id, device.patient_id);
      return { kind: 'device', id: device.id, patientId: device.patient_id, device: device.kind };
    }
    throw new HttpError(401, 'Нужен вход.');
  };

  const doctorOnly = (who: Caller): string => {
    if (who.kind !== 'doctor') throw new HttpError(403, 'Только для врача.');
    return who.id;
  };

  const patientRow = async (id: string): Promise<PatientRow> => {
    const row = await store.patient(id);
    if (!row) throw new HttpError(404, 'Пациент не найден.');
    return row;
  };

  const membership = (patientId: string, doctorId: string) => store.membership(patientId, doctorId);

  /** Read access: an active member or a device of this patient. Returns the role (devices: none). */
  const canRead = async (who: Caller, patientId: string): Promise<DiaryRole | 'device'> => {
    if (who.kind === 'device') {
      if (who.patientId !== patientId) throw new HttpError(403, 'Нет доступа.');
      return 'device';
    }
    const member = await membership(patientId, who.id);
    if (!member || member.status !== 'active') throw new HttpError(403, 'Нет доступа.');
    return member.role;
  };

  const requireRole = async (
    who: Caller,
    patientId: string,
    roles: readonly DiaryRole[],
  ): Promise<string> => {
    const id = doctorOnly(who);
    const member = await membership(patientId, id);
    if (!member || member.status !== 'active' || !roles.includes(member.role)) {
      throw new HttpError(403, 'Недостаточно прав.');
    }
    return id;
  };

  const activeDoctors = (patientId: string): Promise<string[]> => store.activeDoctors(patientId);

  const pushTo = (owners: readonly string[], payload: DiaryPushPayload): Promise<void> =>
    pushToOwners(store, config.vapid, owners, payload, log);

  const activeDeviceOwners = async (patientId: string): Promise<string[]> =>
    (await store.activeDevices(patientId)).map((row) => `p:${row.id}`);

  const patientDeviceOwners = async (patientId: string): Promise<string[]> =>
    (await store.activeDevices(patientId))
      .filter((row) => row.kind === 'patient')
      .map((row) => `p:${row.id}`);

  /** A phone of the diary: the patient's or a carer's. */
  const deviceOnly = (who: Caller): Extract<Caller, { kind: 'device' }> => {
    if (who.kind !== 'device') throw new HttpError(403, 'Только для устройства пациента.');
    return who;
  };

  /** Who sees the diary changed: its doctors and every phone (patient's and carers'). */
  const announceMembers = async (patientId: string): Promise<void> => {
    await notify(await activeDoctors(patientId), 'members', { patientId });
    await notify(await activeDeviceOwners(patientId), 'members', {});
  };

  const profile = (row: DoctorRow) => ({
    id: row.id,
    email: row.email,
    name: row.name,
    identity: { wrap: row.identity_wrap, sign: row.identity_sign },
  });

  const newSession = async (doctorId: string): Promise<string> => {
    const token = toBase64Url(randomBytes(32));
    const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString();
    await store.createSession(await sha256(token), doctorId, expires);
    return token;
  };

  const doctorByEmail = (email: string) => store.doctorByEmail(email);

  const summary = async (
    row: PatientRow,
    role: DiaryRole,
    status: string,
    doctorId: string,
  ): Promise<DiaryPatientSummary> => {
    const keys = await store.keysFor(row.id, `d:${doctorId}`);
    const counts = await store.counts(row.id);
    return {
      id: row.id,
      role,
      status:
        row.status === 'withdrawn' ? 'withdrawn' : status === 'pending' ? 'pending' : 'active',
      ownerId: row.owner_id,
      keys,
      epoch: row.epoch,
      lastSeq: counts.lastSeq,
      lastRecordAt: counts.lastRecordAt,
      openAlerts: counts.openAlerts,
      devices: counts.devices,
      carers: counts.carers,
      ...(await presenceOf(row.id)),
      createdAt: row.created_at,
    };
  };

  // --- routes ----------------------------------------------------------------------------------

  type Handler = (request: Request, url: URL, params: Record<string, string>) => Promise<Response>;
  const routes: {
    method: string;
    pattern: string;
    regex: RegExp;
    keys: string[];
    handler: Handler;
  }[] = [];
  const route = (method: string, pattern: string, handler: Handler): void => {
    const keys: string[] = [];
    const regex = new RegExp(
      `^${pattern.replaceAll(/:([a-zA-Z]+)/gu, (_, key: string) => {
        keys.push(key);
        return '([a-z0-9]+)';
      })}$`,
      'u',
    );
    routes.push({ method, pattern, regex, keys, handler });
  };

  // `live` tells clients whether to open the stream or to poll (ADR-0027).
  route('GET', '/api/health', async () => json({ ok: true, live: live ? 'sse' : 'poll' }));

  route('GET', '/api/push/key', async () => json({ publicKey: config.vapid.publicKey }));

  route('GET', '/api/info', async () => json({ signup: config.signup }));

  route('POST', '/api/auth/prelogin', async (request) => {
    const { email } = await body(request, DiaryPreloginRequestSchema);
    await limit(`prelogin:${email}:${clientAddress(request)}`, await signinLimit(email));
    const row = await doctorByEmail(email);
    // Unknown e-mail: a stable decoy salt, so the answer does not reveal who has an account.
    const salt = row?.kdf_salt ?? (await sha256(`${config.secret}|${email}`)).slice(0, 22);
    return json({ kdf: { salt, iterations: row?.kdf_iterations ?? 600_000 } });
  });

  route('POST', '/api/auth/register', async (request) => {
    const input = await body(request, DiaryRegisterRequestSchema);
    await limit(`register:${input.email}`);
    await limit(`register-from:${clientAddress(request)}`);
    // Open sign-up: a cap on new accounts for the whole service, not only per address.
    if (config.signup === 'open') await limit('register');
    let inviteCode: string | undefined;
    if (config.signup === 'invite') {
      // New clients send only the proof; older ones the code, which is turned into the same proof.
      const proof =
        input.inviteProof ?? (input.invite ? await inviteProof(input.invite) : undefined);
      let invite: { code: string; used_by: string | null } | undefined;
      if (proof) {
        await keyInvites();
        invite = await store.invite(await inviteStorageKey(proof));
      }
      if (!invite || invite.used_by) {
        throw new HttpError(403, 'Код приглашения не подошёл или уже использован.');
      }
      inviteCode = invite.code;
    }
    if (await doctorByEmail(input.email))
      throw new HttpError(409, 'Этот адрес уже зарегистрирован.');
    const row: DoctorRow = {
      id: randomId(),
      email: input.email,
      name: input.name,
      auth_hash: await passwords.hash(input.authKey),
      kdf_salt: input.kdf.salt,
      kdf_iterations: input.kdf.iterations,
      identity_wrap: input.identity.wrap,
      identity_sign: input.identity.sign,
      identity_blob: input.identityBlob,
      recovery_hash: await passwords.hash(input.recovery.authKey),
      recovery_blob: input.recovery.identityBlob,
      created_at: now(),
    };
    try {
      await store.createDoctor(row, inviteCode);
    } catch (cause) {
      if (cause instanceof InviteSpent)
        throw new HttpError(403, 'Код приглашения не подошёл или уже использован.');
      if (cause instanceof StoreConflict)
        throw new HttpError(409, 'Этот адрес уже зарегистрирован.');
      throw cause;
    }
    const id = row.id;
    return json(
      { token: await newSession(id), doctor: profile(row), identityBlob: row.identity_blob },
      201,
    );
  });

  route('POST', '/api/auth/login', async (request) => {
    const { email, authKey } = await body(request, DiaryLoginRequestSchema);
    const row = await checkSecret('login', request, email, authKey, (found) => found.auth_hash);
    if (!row) throw new HttpError(401, 'Неверный адрес или пароль.');
    return json({
      token: await newSession(row.id),
      doctor: profile(row),
      identityBlob: row.identity_blob,
    });
  });

  route('POST', '/api/auth/logout', async (request, url) => {
    const token = bearer(request, url);
    if (token) await store.deleteSession(await sha256(token));
    return json({ ok: true });
  });

  route('GET', '/api/auth/me', async (request, url) => {
    const id = doctorOnly(await caller(request, url));
    const row = (await store.doctorById(id)) as DoctorRow;
    return json({ doctor: profile(row), identityBlob: row.identity_blob });
  });

  route('POST', '/api/auth/recover/fetch', async (request) => {
    const input = await body(request, DiaryRecoverFetchRequestSchema);
    const row = await checkSecret(
      'recover',
      request,
      input.email,
      input.recoveryAuthKey,
      (found) => found.recovery_hash,
    );
    if (!row) throw new HttpError(401, 'Неверный адрес или код восстановления.');
    return json({ identityBlob: row.recovery_blob });
  });

  route('POST', '/api/auth/recover/reset', async (request) => {
    const input = await body(request, DiaryRecoverResetRequestSchema);
    const row = await checkSecret(
      'recover',
      request,
      input.email,
      input.recoveryAuthKey,
      (found) => found.recovery_hash,
    );
    if (!row) throw new HttpError(401, 'Неверный адрес или код восстановления.');
    await store.resetDoctorAuth(
      row.id,
      await passwords.hash(input.authKey),
      input.kdf.salt,
      input.kdf.iterations,
      input.identityBlob,
    );
    return json({
      token: await newSession(row.id),
      doctor: profile(row),
      identityBlob: input.identityBlob,
    });
  });

  route('GET', '/api/doctors/lookup', async (request, url) => {
    doctorOnly(await caller(request, url));
    const parsed = DiaryEmailSchema.safeParse(url.searchParams.get('email') ?? '');
    if (!parsed.success) throw new HttpError(400, 'Некорректный адрес.');
    const row = await doctorByEmail(parsed.data);
    if (!row) throw new HttpError(404, 'Врач с таким адресом не найден.');
    return json({ doctor: profile(row) });
  });

  // --- patients --------------------------------------------------------------------------------

  route('GET', '/api/patients', async (request, url) => {
    const id = doctorOnly(await caller(request, url));
    const rows = await store.patientsOf(id);
    return json({
      patients: await Promise.all(rows.map((row) => summary(row, row.role, row.member_status, id))),
    });
  });

  route('POST', '/api/patients', async (request, url) => {
    const doctorId = doctorOnly(await caller(request, url));
    const input = await body(request, DiaryPatientCreateSchema);
    if (input.key.epoch !== 1 || input.key.recipient !== `d:${doctorId}`) {
      throw new HttpError(400, 'Ключ пациента должен быть для владельца, эпоха 1.');
    }
    try {
      await store.createPatient(input.id, doctorId, input.key, now());
    } catch (cause) {
      if (cause instanceof StoreConflict) throw new HttpError(409, 'Такой пациент уже есть.');
      throw cause;
    }
    return json(
      { patient: await summary(await patientRow(input.id), 'owner', 'active', doctorId) },
      201,
    );
  });

  route('GET', '/api/patients/:id', async (request, url, params) => {
    const id = params['id'] as string;
    await canRead(await caller(request, url), id);
    await patientRow(id);
    const members = await store.members(id);
    const devices = await store.activeDevices(id);
    return json({
      members: members.map((row) => ({
        doctor: profile(row),
        role: row.role,
        status: row.status,
        addedAt: row.added_at,
      })),
      devices: devices.map((row) => ({
        id: row.id,
        kind: row.kind,
        identity: { wrap: row.identity_wrap, sign: row.identity_sign },
        createdAt: row.created_at,
        lastSeenAt: row.last_seen_at,
      })),
    });
  });

  /** Signing keys of everyone who ever wrote a record here (removed doctors and old devices too). */
  route('GET', '/api/patients/:id/authors', async (request, url, params) => {
    const id = params['id'] as string;
    await canRead(await caller(request, url), id);
    const result: Record<string, string> = {};
    for (const author of await store.authors(id)) {
      const [kind, key] = [author.slice(0, 1), author.slice(2)];
      const sign =
        kind === 'd'
          ? (await store.doctorById(key))?.identity_sign
          : await store.deviceSign(key, id);
      if (sign) result[author] = sign;
    }
    return json({ authors: result });
  });

  route('DELETE', '/api/patients/:id', async (request, url, params) => {
    const id = params['id'] as string;
    await requireRole(await caller(request, url), id, ['owner']);
    await store.deletePatient(id);
    return json({ ok: true });
  });

  route('POST', '/api/patients/:id/pairings', async (request, url, params) => {
    const id = params['id'] as string;
    const who = await caller(request, url);
    await requireRole(who, id, ['owner', 'editor']);
    const input = await body(request, DiaryPairingCreateSchema);
    const expires = new Date(Date.now() + PAIRING_HOURS * 3_600_000).toISOString();
    const kind = input.kind ?? 'patient';
    // The patient's own phone can withdraw consent and wipe the diary: only the owner connects it.
    if (kind === 'patient') await requireRole(who, id, ['owner']);
    await store.createPairing(input.secretHash, id, input.keys, expires, kind);
    // The kind comes back so a client can tell a server that knows carers from an older one.
    return json({ expiresAt: expires, kind }, 201);
  });

  route('POST', '/api/pair', async (request) => {
    const input = await body(request, DiaryPairRequestSchema);
    await limit(`pair:${input.patientId}:${clientAddress(request)}`);
    // The phone proves it holds the secret without sending it (SEC-AUDIT1): the secret also seals
    // the data keys. Phones before that send the secret; its proof is derived here. Codes made by
    // doctors' apps before SEC-AUDIT1 were stored under sha256(secret).
    let hash: string;
    let pairing: Awaited<ReturnType<typeof store.pairing>>;
    if (input.proof) {
      hash = await sha256(input.proof);
      pairing = await store.pairing(hash);
    } else {
      const secret = input.secret as string;
      hash = await sha256(await pairingProof(secret));
      pairing = await store.pairing(hash);
      if (!pairing) {
        hash = await sha256(secret);
        pairing = await store.pairing(hash);
      }
    }
    if (!pairing || pairing.patient_id !== input.patientId || pairing.expires_at < now()) {
      throw new HttpError(404, 'Код недействителен: попросите врача показать новый.');
    }
    const patient = await patientRow(input.patientId);
    if (patient.status === 'withdrawn') throw new HttpError(410, 'Наблюдение завершено.');
    const deviceId = randomId();
    const token = toBase64Url(randomBytes(32));
    // One-time: a photo of the QR code is useless afterwards (the store deletes the pairing).
    await store.pairDevice(
      {
        id: deviceId,
        patient_id: input.patientId,
        token_hash: await sha256(token),
        identity_wrap: input.identity.wrap,
        identity_sign: input.identity.sign,
        created_at: now(),
        kind: pairing.kind,
      },
      hash,
    );
    await notify(await activeDoctors(input.patientId), 'device', {
      patientId: input.patientId,
      deviceId,
    });
    if (pairing.kind === 'carer') {
      // The patient sees who joined: the access list updates and the phone says so.
      const phones = await patientDeviceOwners(input.patientId);
      await notify(phones, 'members', {});
      await pushTo(phones, { kind: 'carer' });
    }
    return json({ deviceId, token, keys: pairing.sealed_keys, kind: pairing.kind }, 201);
  });

  route('DELETE', '/api/patients/:id/devices/:device', async (request, url, params) => {
    const id = params['id'] as string;
    await requireRole(await caller(request, url), id, ['owner', 'editor']);
    await store.revokeDevice(params['device'] as string, id, now());
    await notify(await activeDeviceOwners(id), 'members', {});
    return json({ ok: true });
  });

  // --- records ---------------------------------------------------------------------------------

  route('GET', '/api/patients/:id/records', async (request, url, params) => {
    const id = params['id'] as string;
    await canRead(await caller(request, url), id);
    const after = Math.max(0, Number(url.searchParams.get('after') ?? 0) || 0);
    const rows = await store.records(id, after, PAGE + 1);
    const more = rows.length > PAGE;
    const records = rows.slice(0, PAGE);
    return json({ records, last: records.at(-1)?.seq ?? after, more });
  });

  route('POST', '/api/patients/:id/records', async (request, url, params) => {
    const id = params['id'] as string;
    const who = await caller(request, url);
    const patient = await patientRow(id);
    if (patient.status === 'withdrawn') throw new HttpError(410, 'Наблюдение завершено.');
    let author: string;
    if (who.kind === 'device') {
      await canRead(who, id);
      author = `p:${who.id}`;
    } else {
      author = `d:${await requireRole(who, id, ['owner', 'editor'])}`;
    }
    const input = await body(request, DiaryRecordsPushSchema);
    for (const record of input.records) {
      if (record.author !== author) throw new HttpError(403, 'Автор записи не совпадает.');
      // Who may write which record (SEC-AUDIT1): the plan and profile are doctors', consent is the
      // patient's own phone's, a carer names only itself. A phone that wrote them could block the
      // doctors' edits (a huge revision) or accept the joining documents for the patient.
      if (DOCTOR_RECORDS.has(record.id) && who.kind !== 'doctor')
        throw new HttpError(403, 'Эту запись пишет только врач.');
      if (record.id === 'consent' && (who.kind !== 'device' || who.device !== 'patient'))
        throw new HttpError(403, 'Согласие даёт только телефон пациента.');
      if (record.id.startsWith('member-') && record.id !== `member-${who.id}`)
        throw new HttpError(403, 'Имя пишет только его телефон.');
      if (record.epoch !== patient.epoch)
        throw new HttpError(409, 'Ключ устарел: обновите данные.');
    }
    let seqs: number[];
    try {
      seqs = await store.insertRecords(id, input.records, now());
    } catch (cause) {
      if (cause instanceof StoreConflict) throw new HttpError(409, 'Такая версия записи уже есть.');
      throw cause;
    }
    await notify(await activeDoctors(id), 'records', { patientId: id, seq: seqs.at(-1) });
    // The other phones of the diary sync too: the patient's sees a carer's mark and back (DIARY25).
    const devices = (await activeDeviceOwners(id)).filter((owner) => owner !== author);
    await notify(devices, 'records', { seq: seqs.at(-1) });
    // Only what the patient should look at rings the phone (a profile edit does not).
    if (who.kind === 'doctor' && input.notice) await pushTo(devices, { kind: input.notice });
    return json({ seqs }, 201);
  });

  // --- curators --------------------------------------------------------------------------------

  route('POST', '/api/patients/:id/members', async (request, url, params) => {
    const id = params['id'] as string;
    await requireRole(await caller(request, url), id, ['owner']);
    const input = await body(request, DiaryMemberInviteSchema);
    const patient = await patientRow(id);
    const recipient = `d:${input.doctorId}`;
    if (!(await store.doctorById(input.doctorId))) throw new HttpError(404, 'Врач не найден.');
    if (input.keys.some((key) => key.recipient !== recipient || key.epoch > patient.epoch)) {
      throw new HttpError(400, 'Ключи не для этого врача.');
    }
    await store.inviteMember(id, input.doctorId, input.role, now(), input.keys);
    await notify([input.doctorId], 'invite', { patientId: id });
    await pushTo([`d:${input.doctorId}`], { kind: 'invite' });
    return json({ ok: true }, 201);
  });

  route('POST', '/api/patients/:id/accept', async (request, url, params) => {
    const id = params['id'] as string;
    const doctorId = doctorOnly(await caller(request, url));
    const member = await membership(id, doctorId);
    if (!member) throw new HttpError(404, 'Приглашения нет.');
    await store.acceptMember(id, doctorId);
    await notify(await activeDoctors(id), 'members', { patientId: id });
    return json({ ok: true });
  });

  route('PATCH', '/api/patients/:id/members/:doctor', async (request, url, params) => {
    const id = params['id'] as string;
    await requireRole(await caller(request, url), id, ['owner']);
    const { role } = await body(request, DiaryMemberPatchSchema);
    const target = params['doctor'] as string;
    const member = await membership(id, target);
    if (!member || member.role === 'owner') throw new HttpError(400, 'Нельзя изменить эту роль.');
    await store.setRole(id, target, role);
    await notify(await activeDoctors(id), 'members', { patientId: id });
    return json({ ok: true });
  });

  route('DELETE', '/api/patients/:id/members/:doctor', async (request, url, params) => {
    const id = params['id'] as string;
    const who = await caller(request, url);
    const doctorId = doctorOnly(who);
    const target = params['doctor'] as string;
    // The owner removes anyone else; a curator may leave on their own.
    if (target !== doctorId) await requireRole(who, id, ['owner']);
    const member = await membership(id, target);
    if (!member) throw new HttpError(404, 'Такого куратора нет.');
    if (member.role === 'owner')
      throw new HttpError(400, 'Владельца удалить нельзя: сначала передайте пациента.');
    await store.removeMember(id, target);
    await notify([...(await activeDoctors(id)), target], 'members', { patientId: id });
    return json({ ok: true });
  });

  route('POST', '/api/patients/:id/transfer/:doctor', async (request, url, params) => {
    const id = params['id'] as string;
    const ownerId = await requireRole(await caller(request, url), id, ['owner']);
    const target = params['doctor'] as string;
    const member = await membership(id, target);
    if (!member || member.status !== 'active')
      throw new HttpError(400, 'Передать можно только активному куратору.');
    await store.transferOwner(id, ownerId, target);
    await notify(await activeDoctors(id), 'members', { patientId: id });
    return json({ ok: true });
  });

  /**
   * A new data key after a removal: wrapped for every remaining member and device. The owner
   * rotates after removing a curator or a phone; the patient's own phone after removing a carer.
   */
  route('POST', '/api/patients/:id/epochs', async (request, url, params) => {
    const id = params['id'] as string;
    const who = await caller(request, url);
    if (who.kind === 'device') {
      if (who.patientId !== id || who.device !== 'patient')
        throw new HttpError(403, 'Недостаточно прав.');
    } else {
      await requireRole(who, id, ['owner']);
    }
    const input = await body(request, DiaryEpochCreateSchema);
    const patient = await patientRow(id);
    if (input.epoch !== patient.epoch + 1) throw new HttpError(409, 'Эпоха устарела.');
    const members = new Set((await store.memberDoctors(id)).map((doctor) => `d:${doctor}`));
    const devices = await activeDeviceOwners(id);
    const allowed = new Set([...members, ...devices]);
    const covered = new Set(input.keys.map((key) => key.recipient));
    if (input.keys.some((key) => key.epoch !== input.epoch || !allowed.has(key.recipient))) {
      throw new HttpError(400, 'Ключи не для участников пациента.');
    }
    if ([...allowed].some((recipient) => !covered.has(recipient))) {
      throw new HttpError(400, 'Новый ключ нужен каждому участнику и устройству.');
    }
    await store.addEpoch(id, input.epoch, input.keys);
    await announceMembers(id);
    return json({ ok: true });
  });

  // --- device ----------------------------------------------------------------------------------

  route('GET', '/api/device/keys', async (request, url) => {
    const who = deviceOnly(await caller(request, url));
    const keys = await store.keysFor(who.patientId, `p:${who.id}`);
    const patient = await patientRow(who.patientId);
    return json({ keys, epoch: patient.epoch, patientId: who.patientId, status: patient.status });
  });

  route('POST', '/api/device/alerts', async (request, url) => {
    const who = deviceOnly(await caller(request, url));
    await limit(`alert:${who.id}`, ALERT_LIMIT);
    const alertId = await store.addAlert(who.patientId, 'urgent', now());
    const doctors = await activeDoctors(who.patientId);
    await notify(doctors, 'alert', { id: alertId, patientId: who.patientId });
    await pushTo(
      doctors.map((id) => `d:${id}`),
      { kind: 'alert' },
    );
    return json({ ok: true }, 201);
  });

  /** Consent withdrawn: the patient's records, keys and devices are deleted; doctors are told. */
  route('DELETE', '/api/device', async (request, url) => {
    const who = deviceOnly(await caller(request, url));
    if (who.device !== 'patient') {
      throw new HttpError(403, 'Отозвать согласие может только сам пациент.');
    }
    const doctors = await activeDoctors(who.patientId);
    await store.withdraw(who.patientId, now());
    await notify(doctors, 'alert', { patientId: who.patientId, kind: 'withdrawn' });
    await pushTo(
      doctors.map((id) => `d:${id}`),
      { kind: 'withdrawn' },
    );
    return json({ ok: true });
  });

  /**
   * A carer leaves (their own phone) or the patient's phone removes a carer (DIARY25). The patient's
   * phone then rotates the key (`POST /api/patients/:id/epochs`), as the owner does for a curator.
   */
  route('DELETE', '/api/device/carers/:device', async (request, url, params) => {
    const who = deviceOnly(await caller(request, url));
    const target = params['device'] as string;
    if (who.device !== 'patient' && target !== who.id) {
      throw new HttpError(403, 'Опекун может отключить только себя.');
    }
    const carer = (await store.activeDevices(who.patientId)).find((row) => row.id === target);
    if (carer?.kind !== 'carer') throw new HttpError(404, 'Такого опекуна нет.');
    await store.revokeDevice(target, who.patientId, now());
    await notify(await activeDoctors(who.patientId), 'device', {
      patientId: who.patientId,
      deviceId: target,
    });
    await notify(await activeDeviceOwners(who.patientId), 'members', {});
    return json({ ok: true });
  });

  // --- alerts, push, live ----------------------------------------------------------------------

  route('GET', '/api/alerts', async (request, url) => {
    const id = doctorOnly(await caller(request, url));
    const alerts = await store.openAlertsFor(id, 200);
    return json({
      alerts: alerts.map((row) => ({
        id: row.id,
        patientId: row.patient_id,
        kind: row.kind as DiaryAlert['kind'],
        at: row.at,
      })),
    });
  });

  route('POST', '/api/alerts/:alert/ack', async (request, url, params) => {
    const id = doctorOnly(await caller(request, url));
    const alertId = Number(params['alert']);
    const patientId = await store.alertPatient(alertId);
    if (!patientId) throw new HttpError(404, 'Отметка не найдена.');
    await canRead({ kind: 'doctor', id }, patientId);
    await store.ackAlert(alertId, now());
    await notify(await activeDoctors(patientId), 'alert', { patientId });
    return json({ ok: true });
  });

  route('POST', '/api/push/subscriptions', async (request, url) => {
    const who = await caller(request, url);
    const { endpoint, keys } = await body(request, DiaryPushSubscriptionSchema);
    const owner = who.kind === 'doctor' ? `d:${who.id}` : `p:${who.id}`;
    // A few browsers per person; each event pushes to all of them (SEC-AUDIT1).
    const mine = await store.pushTargets([owner]);
    if (mine.length >= MAX_PUSH_SUBSCRIPTIONS && !mine.some((t) => t.endpoint === endpoint)) {
      for (const extra of mine.slice(0, mine.length - MAX_PUSH_SUBSCRIPTIONS + 1)) {
        await store.deletePushSubscription(extra.endpoint);
      }
    }
    await store.savePushSubscription(
      endpoint,
      owner,
      now(),
      keys?.p256dh ?? null,
      keys?.auth ?? null,
    );
    return json({ ok: true }, 201);
  });

  /**
   * The phone's next reminder moments (times only); replaces its earlier list. While the diary has
   * a carer, also the dose moments for the missed-dose notice (DIARY25): the patient's phone says
   * which are open, any phone which are taken. Moments are computed in the patient's time zone on
   * the patient's phone, so a carer's phone elsewhere only ever reports taken ones.
   */
  route('PUT', '/api/device/reminders', async (request, url) => {
    const who = deviceOnly(await caller(request, url));
    const input = await body(request, DiaryRemindersSchema);
    const count = await replaceReminders(store, who.id, input.at);
    if (input.checks || input.taken) {
      const carers = (await store.activeDevices(who.patientId)).some((row) => row.kind === 'carer');
      await replaceDoseChecks(store, who.patientId, {
        open: who.device === 'patient' && input.checks && carers ? input.checks : undefined,
        taken: input.taken ?? [],
        clear: !carers,
      });
    }
    return json({ count });
  });

  /** Due reminders and missed-dose notices, for a scheduler outside the process (see `tickToken`). */
  if (config.tickToken) {
    const tickHash = sha256(config.tickToken);
    route('POST', '/api/tick', async (request, url) => {
      const token = bearer(request, url) ?? url.searchParams.get('key') ?? '';
      if ((await sha256(token)) !== (await tickHash)) throw new HttpError(401, 'Нужен ключ.');
      await limit('tick', 10);
      const reminders = await sendDueReminders(store, config.vapid, log);
      const missed = await sendMissedDoses(store, config.vapid, log);
      return json({ reminders, missed });
    });
  }

  /** Polling in `serverless` mode: the caller's change counter; re-read the data when it moves. */
  route('GET', '/api/changes', async (request, url) => {
    const who = await caller(request, url);
    return json({ n: await store.changes(who.kind === 'doctor' ? who.id : `p:${who.id}`) });
  });

  // Live stream: a doctor by id, a patient's phone as `p:<device id>` (no colon in doctor ids).
  route('GET', '/api/events', async (request, url) => {
    const who = await caller(request, url);
    if (!live) throw new HttpError(404, 'Живого потока нет: данные обновляются опросом.');
    return hub.open(who.kind === 'doctor' ? who.id : `p:${who.id}`);
  });

  // --- static app ------------------------------------------------------------------------------

  const serveStatic = async (url: URL): Promise<Response> => {
    if (!config.staticDir) return json({ error: 'Не найдено.' }, 404);
    const path = decodeURIComponent(url.pathname);
    if (path.includes('..')) return json({ error: 'Не найдено.' }, 404);
    const candidates = path.endsWith('/') ? [`${path}index.html`] : [path, `${path}/index.html`];
    for (const candidate of candidates) {
      // Only the `server` mode (Bun) serves files; the serverless entry sets no staticDir.
      const file = Bun.file(`${config.staticDir}${candidate}`);
      if (await file.exists()) {
        const immutable = candidate.startsWith('/assets/');
        return new Response(file, {
          headers: {
            'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
            'X-Content-Type-Options': 'nosniff',
            'Referrer-Policy': 'no-referrer',
            // The app's SQLite worker needs a cross-origin-isolated page, as on the dev server.
            'Cross-Origin-Embedder-Policy': 'require-corp',
            'Cross-Origin-Opener-Policy': 'same-origin',
          },
        });
      }
    }
    return json({ error: 'Не найдено.' }, 404);
  };

  const corsHeaders = (request: Request): Record<string, string> => {
    const origin = request.headers.get('Origin');
    const allowed = config.corsOrigins ?? [];
    if (!origin) return {};
    if (!allowed.includes(origin)) {
      // Name an allowed origin instead of staying silent: a gateway in front (ADR-0027) would
      // otherwise answer «*», and the browser now refuses the foreign page either way.
      return allowed[0] ? { 'Access-Control-Allow-Origin': allowed[0], Vary: 'Origin' } : {};
    }
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE',
      'Access-Control-Max-Age': '600',
      Vary: 'Origin',
    };
  };

  const handle = async (request: Request): Promise<Response> => {
    const started = performance.now();
    const url = new URL(request.url);
    if (request.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }
    let template = url.pathname.startsWith('/api/') ? 'unknown' : 'static';
    let response: Response;
    try {
      if (!url.pathname.startsWith('/api/')) {
        response =
          request.method === 'GET' || request.method === 'HEAD'
            ? await serveStatic(url)
            : json({ error: 'Метод не поддерживается.' }, 405);
      } else {
        const match = routes.find(
          (candidate) => candidate.method === request.method && candidate.regex.test(url.pathname),
        );
        if (!match) throw new HttpError(404, 'Не найдено.');
        template = `${match.method} ${match.pattern}`;
        const values = match.regex.exec(url.pathname)?.slice(1) ?? [];
        const params = Object.fromEntries(
          match.keys.map((key, index) => [key, values[index] ?? '']),
        );
        response = await match.handler(request, url, params);
      }
    } catch (cause) {
      if (cause instanceof HttpError) {
        response = json({ error: cause.message }, cause.status);
      } else {
        log(
          `error in ${template}: ${cause instanceof Error ? `${cause.name}: ${cause.message}` : 'unknown'}`,
        );
        response = json({ error: 'Ошибка сервера.' }, 500);
      }
    }
    if (template !== 'static') {
      log(`${template} ${response.status} ${Math.round(performance.now() - started)}ms`);
    }
    return response;
  };

  return async (request: Request): Promise<Response> => {
    const response = await handle(request);
    const cors = corsHeaders(request);
    for (const [name, value] of Object.entries(cors)) response.headers.set(name, value);
    return response;
  };
}
