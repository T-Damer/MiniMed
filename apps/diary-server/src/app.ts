/**
 * HTTP API of the connected diary (ADR-0026). One `fetch` handler, so tests drive it without a
 * socket. Every body is validated with the shared contract; every patient route checks membership
 * or device ownership; logs carry the route template, status and time only.
 */
import type { Database } from 'bun:sqlite';
import {
  DIARY_ONLINE_WINDOW_MS,
  DIARY_PRESENCE_EVENT_INTERVAL_MS,
  type DiaryAlert,
  DiaryEmailSchema,
  DiaryEnvelopeSchema,
  DiaryEpochCreateSchema,
  DiaryLoginRequestSchema,
  DiaryMemberInviteSchema,
  DiaryMemberPatchSchema,
  DiaryPairingCreateSchema,
  DiaryPairRequestSchema,
  DiaryPatientCreateSchema,
  type DiaryPatientSummary,
  DiaryPreloginRequestSchema,
  DiaryPushSubscriptionSchema,
  DiaryRecordsPushSchema,
  DiaryRecoverFetchRequestSchema,
  DiaryRecoverResetRequestSchema,
  DiaryRegisterRequestSchema,
  type DiaryRole,
} from '@localmed/contracts';
import { randomBytes, randomId, sha256, toBase64Url } from '@localmed/diary-sync';
import type { z } from 'zod';

import { now } from './db';
import { inviteCandidates } from './invites';
import { sendPush, type Vapid } from './push';

export interface AppConfig {
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
}

const SESSION_DAYS = 30;
const PAIRING_HOURS = 72;
const PAGE = 500;
const ATTEMPT_WINDOW_MS = 60_000;
const ATTEMPT_LIMIT = 12;

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

function bearer(request: Request, url: URL): string | undefined {
  const header = request.headers.get('Authorization');
  if (header?.startsWith('Bearer ')) return header.slice(7);
  // EventSource cannot send headers: the live stream takes the token from the query.
  return url.pathname === '/api/events' ? (url.searchParams.get('token') ?? undefined) : undefined;
}

type Caller =
  | { readonly kind: 'doctor'; readonly id: string }
  | { readonly kind: 'device'; readonly id: string; readonly patientId: string };

interface DoctorRow {
  id: string;
  email: string;
  name: string;
  auth_hash: string;
  kdf_salt: string;
  kdf_iterations: number;
  identity_wrap: string;
  identity_sign: string;
  identity_blob: string;
  recovery_hash: string;
  recovery_blob: string;
}

interface PatientRow {
  id: string;
  owner_id: string;
  epoch: number;
  status: string;
  created_at: string;
}

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
  db: Database,
  config: AppConfig,
): (request: Request) => Promise<Response> {
  const hub = new EventHub();
  const attempts = new Map<string, number[]>();
  const log = config.log ?? ((line: string) => console.info(line));
  const onlineWindowMs = config.onlineWindowMs ?? DIARY_ONLINE_WINDOW_MS;

  const limit = (key: string): void => {
    const time = Date.now();
    const recent = (attempts.get(key) ?? []).filter((at) => time - at < ATTEMPT_WINDOW_MS);
    if (recent.length >= ATTEMPT_LIMIT)
      throw new HttpError(429, 'Слишком много попыток. Подождите минуту.');
    recent.push(time);
    attempts.set(key, recent);
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

  const presenceOf = (patientId: string): { lastSeenAt?: string; online: boolean } => {
    const row = db
      .query<{ at: string | null }, [string]>(
        'SELECT MAX(last_seen_at) AS at FROM devices WHERE patient_id = ? AND revoked_at IS NULL',
      )
      .get(patientId);
    const lastSeenAt = row?.at ?? undefined;
    const online = lastSeenAt !== undefined && Date.now() - Date.parse(lastSeenAt) < onlineWindowMs;
    return lastSeenAt === undefined ? { online } : { lastSeenAt, online };
  };

  const announcePresence = (patientId: string): void => {
    const state = presence.get(patientId);
    if (state) state.sentAt = Date.now();
    hub.send(activeDoctors(patientId), 'presence', { patientId, ...presenceOf(patientId) });
  };

  const touchDevice = (deviceId: string, patientId: string): void => {
    db.query('UPDATE devices SET last_seen_at = ? WHERE id = ?').run(now(), deviceId);
    const state = presence.get(patientId) ?? { online: false, sentAt: 0 };
    clearTimeout(state.timer);
    const cameOnline = !state.online;
    state.online = true;
    // Nobody calls once the diary is closed, so the offline flip is timer-driven.
    state.timer = setTimeout(() => {
      state.online = false;
      announcePresence(patientId);
    }, onlineWindowMs + 100);
    state.timer.unref();
    presence.set(patientId, state);
    if (cameOnline || Date.now() - state.sentAt >= DIARY_PRESENCE_EVENT_INTERVAL_MS) {
      announcePresence(patientId);
    }
  };

  // --- callers ---------------------------------------------------------------------------------

  const caller = async (request: Request, url: URL): Promise<Caller> => {
    const token = bearer(request, url);
    if (!token) throw new HttpError(401, 'Нужен вход.');
    const hash = await sha256(token);
    const session = db
      .query<{ doctor_id: string; expires_at: string }, [string]>(
        'SELECT doctor_id, expires_at FROM sessions WHERE token_hash = ?',
      )
      .get(hash);
    if (session) {
      if (session.expires_at < now()) throw new HttpError(401, 'Сессия истекла.');
      return { kind: 'doctor', id: session.doctor_id };
    }
    const device = db
      .query<{ id: string; patient_id: string }, [string]>(
        'SELECT id, patient_id FROM devices WHERE token_hash = ? AND revoked_at IS NULL',
      )
      .get(hash);
    if (device) {
      touchDevice(device.id, device.patient_id);
      return { kind: 'device', id: device.id, patientId: device.patient_id };
    }
    throw new HttpError(401, 'Нужен вход.');
  };

  const doctorOnly = (who: Caller): string => {
    if (who.kind !== 'doctor') throw new HttpError(403, 'Только для врача.');
    return who.id;
  };

  const patientRow = (id: string): PatientRow => {
    const row = db.query<PatientRow, [string]>('SELECT * FROM patients WHERE id = ?').get(id);
    if (!row) throw new HttpError(404, 'Пациент не найден.');
    return row;
  };

  const membership = (patientId: string, doctorId: string) =>
    db
      .query<{ role: DiaryRole; status: string }, [string, string]>(
        'SELECT role, status FROM members WHERE patient_id = ? AND doctor_id = ?',
      )
      .get(patientId, doctorId);

  /** Read access: an active member or a device of this patient. Returns the role (devices: none). */
  const canRead = (who: Caller, patientId: string): DiaryRole | 'device' => {
    if (who.kind === 'device') {
      if (who.patientId !== patientId) throw new HttpError(403, 'Нет доступа.');
      return 'device';
    }
    const member = membership(patientId, who.id);
    if (!member || member.status !== 'active') throw new HttpError(403, 'Нет доступа.');
    return member.role;
  };

  const requireRole = (who: Caller, patientId: string, roles: readonly DiaryRole[]): string => {
    const id = doctorOnly(who);
    const member = membership(patientId, id);
    if (!member || member.status !== 'active' || !roles.includes(member.role)) {
      throw new HttpError(403, 'Недостаточно прав.');
    }
    return id;
  };

  const activeDoctors = (patientId: string): string[] =>
    db
      .query<{ doctor_id: string }, [string]>(
        "SELECT doctor_id FROM members WHERE patient_id = ? AND status = 'active'",
      )
      .all(patientId)
      .map((row) => row.doctor_id);

  const pushTo = (owners: readonly string[]): void => {
    if (!owners.length) return;
    const placeholders = owners.map(() => '?').join(',');
    const endpoints = db
      .query<{ endpoint: string }, string[]>(
        `SELECT endpoint FROM push_subscriptions WHERE owner IN (${placeholders})`,
      )
      .all(...owners);
    for (const { endpoint } of endpoints) {
      void sendPush(config.vapid, endpoint)
        .then((outcome) => {
          if (outcome === 'gone') {
            db.query('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
          }
        })
        .catch((cause: unknown) =>
          log(`push failed: ${cause instanceof Error ? cause.name : 'error'}`),
        );
    }
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
    db.query('INSERT INTO sessions (token_hash, doctor_id, expires_at) VALUES (?, ?, ?)').run(
      await sha256(token),
      doctorId,
      expires,
    );
    return token;
  };

  const doctorByEmail = (email: string) =>
    db.query<DoctorRow, [string]>('SELECT * FROM doctors WHERE email = ?').get(email);

  const summary = (
    row: PatientRow,
    role: DiaryRole,
    status: string,
    doctorId: string,
  ): DiaryPatientSummary => {
    const keys = db
      .query<{ epoch: number; recipient: string; wrapped: string }, [string, string]>(
        'SELECT epoch, recipient, wrapped FROM patient_keys WHERE patient_id = ? AND recipient = ? ORDER BY epoch',
      )
      .all(row.id, `d:${doctorId}`);
    const last = db
      .query<{ seq: number | null; at: string | null }, [string]>(
        'SELECT MAX(seq) AS seq, MAX(at) AS at FROM records WHERE patient_id = ?',
      )
      .get(row.id);
    const alerts = db
      .query<{ count: number }, [string]>(
        'SELECT COUNT(*) AS count FROM alerts WHERE patient_id = ? AND acked_at IS NULL',
      )
      .get(row.id);
    const devices = db
      .query<{ count: number }, [string]>(
        'SELECT COUNT(*) AS count FROM devices WHERE patient_id = ? AND revoked_at IS NULL',
      )
      .get(row.id);
    return {
      id: row.id,
      role,
      status:
        row.status === 'withdrawn' ? 'withdrawn' : status === 'pending' ? 'pending' : 'active',
      ownerId: row.owner_id,
      keys,
      epoch: row.epoch,
      lastSeq: last?.seq ?? 0,
      lastRecordAt: last?.at ?? null,
      openAlerts: alerts?.count ?? 0,
      devices: devices?.count ?? 0,
      ...presenceOf(row.id),
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

  route('GET', '/api/health', async () => json({ ok: true }));

  route('GET', '/api/push/key', async () => json({ publicKey: config.vapid.publicKey }));

  route('POST', '/api/auth/prelogin', async (request) => {
    const { email } = await body(request, DiaryPreloginRequestSchema);
    limit(`prelogin:${email}`);
    const row = doctorByEmail(email);
    // Unknown e-mail: a stable decoy salt, so the answer does not reveal who has an account.
    const salt = row?.kdf_salt ?? (await sha256(`${config.secret}|${email}`)).slice(0, 22);
    return json({ kdf: { salt, iterations: row?.kdf_iterations ?? 600_000 } });
  });

  route('POST', '/api/auth/register', async (request) => {
    const input = await body(request, DiaryRegisterRequestSchema);
    limit(`register:${input.email}`);
    let inviteCode: string | undefined;
    if (config.signup === 'invite') {
      const invite = input.invite
        ? inviteCandidates(input.invite)
            .map((code) =>
              db
                .query<{ code: string; used_by: string | null }, [string]>(
                  'SELECT code, used_by FROM invites WHERE code = ?',
                )
                .get(code),
            )
            .find(Boolean)
        : undefined;
      if (!invite || invite.used_by) {
        throw new HttpError(403, 'Код приглашения не подошёл или уже использован.');
      }
      inviteCode = invite.code;
    }
    if (doctorByEmail(input.email)) throw new HttpError(409, 'Этот адрес уже зарегистрирован.');
    const id = randomId();
    db.transaction(() => {
      db.query(
        `INSERT INTO doctors (id, email, name, auth_hash, kdf_salt, kdf_iterations, identity_wrap,
          identity_sign, identity_blob, recovery_hash, recovery_blob, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        input.email,
        input.name,
        Bun.password.hashSync(input.authKey, { algorithm: 'argon2id' }),
        input.kdf.salt,
        input.kdf.iterations,
        input.identity.wrap,
        input.identity.sign,
        input.identityBlob,
        Bun.password.hashSync(input.recovery.authKey, { algorithm: 'argon2id' }),
        input.recovery.identityBlob,
        now(),
      );
      if (inviteCode) {
        db.query('UPDATE invites SET used_by = ? WHERE code = ?').run(id, inviteCode);
      }
    })();
    const row = doctorByEmail(input.email) as DoctorRow;
    return json(
      { token: await newSession(id), doctor: profile(row), identityBlob: row.identity_blob },
      201,
    );
  });

  route('POST', '/api/auth/login', async (request) => {
    const { email, authKey } = await body(request, DiaryLoginRequestSchema);
    limit(`login:${email}`);
    const row = doctorByEmail(email);
    if (!row || !(await Bun.password.verify(authKey, row.auth_hash))) {
      throw new HttpError(401, 'Неверный адрес или пароль.');
    }
    return json({
      token: await newSession(row.id),
      doctor: profile(row),
      identityBlob: row.identity_blob,
    });
  });

  route('POST', '/api/auth/logout', async (request, url) => {
    const token = bearer(request, url);
    if (token) db.query('DELETE FROM sessions WHERE token_hash = ?').run(await sha256(token));
    return json({ ok: true });
  });

  route('GET', '/api/auth/me', async (request, url) => {
    const id = doctorOnly(await caller(request, url));
    const row = db
      .query<DoctorRow, [string]>('SELECT * FROM doctors WHERE id = ?')
      .get(id) as DoctorRow;
    return json({ doctor: profile(row), identityBlob: row.identity_blob });
  });

  route('POST', '/api/auth/recover/fetch', async (request) => {
    const input = await body(request, DiaryRecoverFetchRequestSchema);
    limit(`recover:${input.email}`);
    const row = doctorByEmail(input.email);
    if (!row || !(await Bun.password.verify(input.recoveryAuthKey, row.recovery_hash))) {
      throw new HttpError(401, 'Неверный адрес или код восстановления.');
    }
    return json({ identityBlob: row.recovery_blob });
  });

  route('POST', '/api/auth/recover/reset', async (request) => {
    const input = await body(request, DiaryRecoverResetRequestSchema);
    limit(`recover:${input.email}`);
    const row = doctorByEmail(input.email);
    if (!row || !(await Bun.password.verify(input.recoveryAuthKey, row.recovery_hash))) {
      throw new HttpError(401, 'Неверный адрес или код восстановления.');
    }
    db.transaction(() => {
      db.query(
        'UPDATE doctors SET auth_hash = ?, kdf_salt = ?, kdf_iterations = ?, identity_blob = ? WHERE id = ?',
      ).run(
        Bun.password.hashSync(input.authKey, { algorithm: 'argon2id' }),
        input.kdf.salt,
        input.kdf.iterations,
        input.identityBlob,
        row.id,
      );
      db.query('DELETE FROM sessions WHERE doctor_id = ?').run(row.id);
    })();
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
    const row = doctorByEmail(parsed.data);
    if (!row) throw new HttpError(404, 'Врач с таким адресом не найден.');
    return json({ doctor: profile(row) });
  });

  // --- patients --------------------------------------------------------------------------------

  route('GET', '/api/patients', async (request, url) => {
    const id = doctorOnly(await caller(request, url));
    const rows = db
      .query<PatientRow & { role: DiaryRole; member_status: string }, [string]>(
        `SELECT p.*, m.role AS role, m.status AS member_status FROM patients p
         JOIN members m ON m.patient_id = p.id WHERE m.doctor_id = ? ORDER BY p.created_at DESC`,
      )
      .all(id);
    return json({ patients: rows.map((row) => summary(row, row.role, row.member_status, id)) });
  });

  route('POST', '/api/patients', async (request, url) => {
    const doctorId = doctorOnly(await caller(request, url));
    const input = await body(request, DiaryPatientCreateSchema);
    if (input.key.epoch !== 1 || input.key.recipient !== `d:${doctorId}`) {
      throw new HttpError(400, 'Ключ пациента должен быть для владельца, эпоха 1.');
    }
    const time = now();
    try {
      db.transaction(() => {
        db.query(
          'INSERT INTO patients (id, owner_id, epoch, status, created_at) VALUES (?, ?, 1, ?, ?)',
        ).run(input.id, doctorId, 'active', time);
        db.query(
          "INSERT INTO members (patient_id, doctor_id, role, status, added_at) VALUES (?, ?, 'owner', 'active', ?)",
        ).run(input.id, doctorId, time);
        db.query(
          'INSERT INTO patient_keys (patient_id, epoch, recipient, wrapped) VALUES (?, 1, ?, ?)',
        ).run(input.id, input.key.recipient, input.key.wrapped);
      })();
    } catch {
      throw new HttpError(409, 'Такой пациент уже есть.');
    }
    return json({ patient: summary(patientRow(input.id), 'owner', 'active', doctorId) }, 201);
  });

  route('GET', '/api/patients/:id', async (request, url, params) => {
    const id = params['id'] as string;
    canRead(await caller(request, url), id);
    patientRow(id);
    const members = db
      .query<DoctorRow & { role: DiaryRole; status: string; added_at: string }, [string]>(
        `SELECT d.*, m.role AS role, m.status AS status, m.added_at AS added_at FROM members m
         JOIN doctors d ON d.id = m.doctor_id WHERE m.patient_id = ? ORDER BY m.added_at`,
      )
      .all(id);
    const devices = db
      .query<
        {
          id: string;
          identity_wrap: string;
          identity_sign: string;
          created_at: string;
          last_seen_at: string | null;
        },
        [string]
      >(
        'SELECT id, identity_wrap, identity_sign, created_at, last_seen_at FROM devices WHERE patient_id = ? AND revoked_at IS NULL',
      )
      .all(id);
    return json({
      members: members.map((row) => ({
        doctor: profile(row),
        role: row.role,
        status: row.status,
        addedAt: row.added_at,
      })),
      devices: devices.map((row) => ({
        id: row.id,
        identity: { wrap: row.identity_wrap, sign: row.identity_sign },
        createdAt: row.created_at,
        lastSeenAt: row.last_seen_at,
      })),
    });
  });

  /** Signing keys of everyone who ever wrote a record here (removed doctors and old devices too). */
  route('GET', '/api/patients/:id/authors', async (request, url, params) => {
    const id = params['id'] as string;
    canRead(await caller(request, url), id);
    const authors = db
      .query<{ author: string }, [string]>(
        'SELECT DISTINCT author FROM records WHERE patient_id = ?',
      )
      .all(id);
    const result: Record<string, string> = {};
    for (const { author } of authors) {
      const [kind, key] = [author.slice(0, 1), author.slice(2)];
      const sign =
        kind === 'd'
          ? db
              .query<{ identity_sign: string }, [string]>(
                'SELECT identity_sign FROM doctors WHERE id = ?',
              )
              .get(key)
          : db
              .query<{ identity_sign: string }, [string, string]>(
                'SELECT identity_sign FROM devices WHERE id = ? AND patient_id = ?',
              )
              .get(key, id);
      if (sign) result[author] = sign.identity_sign;
    }
    return json({ authors: result });
  });

  route('DELETE', '/api/patients/:id', async (request, url, params) => {
    const id = params['id'] as string;
    requireRole(await caller(request, url), id, ['owner']);
    db.query('DELETE FROM patients WHERE id = ?').run(id);
    return json({ ok: true });
  });

  route('POST', '/api/patients/:id/pairings', async (request, url, params) => {
    const id = params['id'] as string;
    requireRole(await caller(request, url), id, ['owner', 'editor']);
    const input = await body(request, DiaryPairingCreateSchema);
    const expires = new Date(Date.now() + PAIRING_HOURS * 3_600_000).toISOString();
    db.query(
      'INSERT INTO pairings (secret_hash, patient_id, sealed_keys, expires_at) VALUES (?, ?, ?, ?)',
    ).run(input.secretHash, id, input.keys, expires);
    return json({ expiresAt: expires }, 201);
  });

  route('POST', '/api/pair', async (request) => {
    const input = await body(request, DiaryPairRequestSchema);
    limit(`pair:${input.patientId}`);
    const hash = await sha256(input.secret);
    const pairing = db
      .query<{ patient_id: string; sealed_keys: string; expires_at: string }, [string]>(
        'SELECT patient_id, sealed_keys, expires_at FROM pairings WHERE secret_hash = ?',
      )
      .get(hash);
    if (!pairing || pairing.patient_id !== input.patientId || pairing.expires_at < now()) {
      throw new HttpError(404, 'Код недействителен: попросите врача показать новый.');
    }
    const patient = patientRow(input.patientId);
    if (patient.status === 'withdrawn') throw new HttpError(410, 'Наблюдение завершено.');
    const deviceId = randomId();
    const token = toBase64Url(randomBytes(32));
    const tokenHash = await sha256(token);
    db.transaction(() => {
      db.query(
        `INSERT INTO devices (id, patient_id, token_hash, identity_wrap, identity_sign, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(deviceId, input.patientId, tokenHash, input.identity.wrap, input.identity.sign, now());
      // One-time: a photo of the QR code is useless afterwards.
      db.query('DELETE FROM pairings WHERE secret_hash = ?').run(hash);
    })();
    hub.send(activeDoctors(input.patientId), 'device', { patientId: input.patientId, deviceId });
    return json({ deviceId, token, keys: pairing.sealed_keys }, 201);
  });

  route('DELETE', '/api/patients/:id/devices/:device', async (request, url, params) => {
    const id = params['id'] as string;
    requireRole(await caller(request, url), id, ['owner', 'editor']);
    db.query('UPDATE devices SET revoked_at = ? WHERE id = ? AND patient_id = ?').run(
      now(),
      params['device'] as string,
      id,
    );
    return json({ ok: true });
  });

  // --- records ---------------------------------------------------------------------------------

  route('GET', '/api/patients/:id/records', async (request, url, params) => {
    const id = params['id'] as string;
    canRead(await caller(request, url), id);
    const after = Math.max(0, Number(url.searchParams.get('after') ?? 0) || 0);
    const rows = db
      .query<
        {
          seq: number;
          id: string;
          rev: number;
          epoch: number;
          author: string;
          body: string;
          sig: string;
          at: string;
        },
        [string, number, number]
      >(
        'SELECT seq, id, rev, epoch, author, body, sig, at FROM records WHERE patient_id = ? AND seq > ? ORDER BY seq LIMIT ?',
      )
      .all(id, after, PAGE + 1);
    const more = rows.length > PAGE;
    const records = rows.slice(0, PAGE);
    return json({ records, last: records.at(-1)?.seq ?? after, more });
  });

  route('POST', '/api/patients/:id/records', async (request, url, params) => {
    const id = params['id'] as string;
    const who = await caller(request, url);
    const patient = patientRow(id);
    if (patient.status === 'withdrawn') throw new HttpError(410, 'Наблюдение завершено.');
    let author: string;
    if (who.kind === 'device') {
      canRead(who, id);
      author = `p:${who.id}`;
    } else {
      author = `d:${requireRole(who, id, ['owner', 'editor'])}`;
    }
    const input = await body(request, DiaryRecordsPushSchema);
    const time = now();
    const seqs: number[] = [];
    try {
      db.transaction(() => {
        for (const record of input.records) {
          if (record.author !== author) throw new HttpError(403, 'Автор записи не совпадает.');
          if (record.epoch !== patient.epoch)
            throw new HttpError(409, 'Ключ устарел: обновите данные.');
          const result = db
            .query(
              'INSERT INTO records (patient_id, id, rev, epoch, author, body, sig, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            )
            .run(
              id,
              record.id,
              record.rev,
              record.epoch,
              record.author,
              record.body,
              record.sig,
              time,
            );
          seqs.push(Number(result.lastInsertRowid));
        }
      })();
    } catch (cause) {
      if (cause instanceof HttpError) throw cause;
      throw new HttpError(409, 'Такая версия записи уже есть.');
    }
    hub.send(activeDoctors(id), 'records', { patientId: id, seq: seqs.at(-1) });
    if (who.kind === 'doctor') {
      const devices = db
        .query<{ id: string }, [string]>(
          'SELECT id FROM devices WHERE patient_id = ? AND revoked_at IS NULL',
        )
        .all(id)
        .map((row) => `p:${row.id}`);
      hub.send(devices, 'records', { seq: seqs.at(-1) });
      pushTo(devices);
    }
    return json({ seqs }, 201);
  });

  // --- curators --------------------------------------------------------------------------------

  route('POST', '/api/patients/:id/members', async (request, url, params) => {
    const id = params['id'] as string;
    requireRole(await caller(request, url), id, ['owner']);
    const input = await body(request, DiaryMemberInviteSchema);
    const patient = patientRow(id);
    const recipient = `d:${input.doctorId}`;
    if (!db.query('SELECT id FROM doctors WHERE id = ?').get(input.doctorId)) {
      throw new HttpError(404, 'Врач не найден.');
    }
    if (input.keys.some((key) => key.recipient !== recipient || key.epoch > patient.epoch)) {
      throw new HttpError(400, 'Ключи не для этого врача.');
    }
    db.transaction(() => {
      db.query(
        `INSERT INTO members (patient_id, doctor_id, role, status, added_at) VALUES (?, ?, ?, 'pending', ?)
         ON CONFLICT(patient_id, doctor_id) DO UPDATE SET role = excluded.role`,
      ).run(id, input.doctorId, input.role, now());
      for (const key of input.keys) {
        db.query(
          'INSERT OR REPLACE INTO patient_keys (patient_id, epoch, recipient, wrapped) VALUES (?, ?, ?, ?)',
        ).run(id, key.epoch, key.recipient, key.wrapped);
      }
    })();
    hub.send([input.doctorId], 'invite', { patientId: id });
    pushTo([`d:${input.doctorId}`]);
    return json({ ok: true }, 201);
  });

  route('POST', '/api/patients/:id/accept', async (request, url, params) => {
    const id = params['id'] as string;
    const doctorId = doctorOnly(await caller(request, url));
    const member = membership(id, doctorId);
    if (!member) throw new HttpError(404, 'Приглашения нет.');
    db.query("UPDATE members SET status = 'active' WHERE patient_id = ? AND doctor_id = ?").run(
      id,
      doctorId,
    );
    hub.send(activeDoctors(id), 'members', { patientId: id });
    return json({ ok: true });
  });

  route('PATCH', '/api/patients/:id/members/:doctor', async (request, url, params) => {
    const id = params['id'] as string;
    requireRole(await caller(request, url), id, ['owner']);
    const { role } = await body(request, DiaryMemberPatchSchema);
    const target = params['doctor'] as string;
    const member = membership(id, target);
    if (!member || member.role === 'owner') throw new HttpError(400, 'Нельзя изменить эту роль.');
    db.query('UPDATE members SET role = ? WHERE patient_id = ? AND doctor_id = ?').run(
      role,
      id,
      target,
    );
    hub.send(activeDoctors(id), 'members', { patientId: id });
    return json({ ok: true });
  });

  route('DELETE', '/api/patients/:id/members/:doctor', async (request, url, params) => {
    const id = params['id'] as string;
    const who = await caller(request, url);
    const doctorId = doctorOnly(who);
    const target = params['doctor'] as string;
    // The owner removes anyone else; a curator may leave on their own.
    if (target !== doctorId) requireRole(who, id, ['owner']);
    const member = membership(id, target);
    if (!member) throw new HttpError(404, 'Такого куратора нет.');
    if (member.role === 'owner')
      throw new HttpError(400, 'Владельца удалить нельзя: сначала передайте пациента.');
    db.transaction(() => {
      db.query('DELETE FROM members WHERE patient_id = ? AND doctor_id = ?').run(id, target);
      db.query('DELETE FROM patient_keys WHERE patient_id = ? AND recipient = ?').run(
        id,
        `d:${target}`,
      );
    })();
    hub.send([...activeDoctors(id), target], 'members', { patientId: id });
    return json({ ok: true });
  });

  route('POST', '/api/patients/:id/transfer/:doctor', async (request, url, params) => {
    const id = params['id'] as string;
    const ownerId = requireRole(await caller(request, url), id, ['owner']);
    const target = params['doctor'] as string;
    const member = membership(id, target);
    if (!member || member.status !== 'active')
      throw new HttpError(400, 'Передать можно только активному куратору.');
    db.transaction(() => {
      db.query("UPDATE members SET role = 'editor' WHERE patient_id = ? AND doctor_id = ?").run(
        id,
        ownerId,
      );
      db.query("UPDATE members SET role = 'owner' WHERE patient_id = ? AND doctor_id = ?").run(
        id,
        target,
      );
      db.query('UPDATE patients SET owner_id = ? WHERE id = ?').run(target, id);
    })();
    hub.send(activeDoctors(id), 'members', { patientId: id });
    return json({ ok: true });
  });

  /** A new data key after a removal: wrapped for every remaining member and device. */
  route('POST', '/api/patients/:id/epochs', async (request, url, params) => {
    const id = params['id'] as string;
    requireRole(await caller(request, url), id, ['owner']);
    const input = await body(request, DiaryEpochCreateSchema);
    const patient = patientRow(id);
    if (input.epoch !== patient.epoch + 1) throw new HttpError(409, 'Эпоха устарела.');
    const members = new Set(
      db
        .query<{ doctor_id: string }, [string]>(
          'SELECT doctor_id FROM members WHERE patient_id = ?',
        )
        .all(id)
        .map((row) => `d:${row.doctor_id}`),
    );
    const devices = db
      .query<{ id: string }, [string]>(
        'SELECT id FROM devices WHERE patient_id = ? AND revoked_at IS NULL',
      )
      .all(id)
      .map((row) => `p:${row.id}`);
    const allowed = new Set([...members, ...devices]);
    const covered = new Set(input.keys.map((key) => key.recipient));
    if (input.keys.some((key) => key.epoch !== input.epoch || !allowed.has(key.recipient))) {
      throw new HttpError(400, 'Ключи не для участников пациента.');
    }
    if ([...allowed].some((recipient) => !covered.has(recipient))) {
      throw new HttpError(400, 'Новый ключ нужен каждому участнику и устройству.');
    }
    db.transaction(() => {
      for (const key of input.keys) {
        db.query(
          'INSERT INTO patient_keys (patient_id, epoch, recipient, wrapped) VALUES (?, ?, ?, ?)',
        ).run(id, key.epoch, key.recipient, key.wrapped);
      }
      db.query('UPDATE patients SET epoch = ? WHERE id = ?').run(input.epoch, id);
    })();
    hub.send(activeDoctors(id), 'members', { patientId: id });
    return json({ ok: true });
  });

  // --- device ----------------------------------------------------------------------------------

  route('GET', '/api/device/keys', async (request, url) => {
    const who = await caller(request, url);
    if (who.kind !== 'device') throw new HttpError(403, 'Только для устройства пациента.');
    const keys = db
      .query<{ epoch: number; recipient: string; wrapped: string }, [string, string]>(
        'SELECT epoch, recipient, wrapped FROM patient_keys WHERE patient_id = ? AND recipient = ? ORDER BY epoch',
      )
      .all(who.patientId, `p:${who.id}`);
    const patient = patientRow(who.patientId);
    return json({ keys, epoch: patient.epoch, patientId: who.patientId, status: patient.status });
  });

  route('POST', '/api/device/alerts', async (request, url) => {
    const who = await caller(request, url);
    if (who.kind !== 'device') throw new HttpError(403, 'Только для устройства пациента.');
    const result = db
      .query("INSERT INTO alerts (patient_id, kind, at) VALUES (?, 'urgent', ?)")
      .run(who.patientId, now());
    const doctors = activeDoctors(who.patientId);
    hub.send(doctors, 'alert', { id: Number(result.lastInsertRowid), patientId: who.patientId });
    pushTo(doctors.map((id) => `d:${id}`));
    return json({ ok: true }, 201);
  });

  /** Consent withdrawn: the patient's records, keys and devices are deleted; doctors are told. */
  route('DELETE', '/api/device', async (request, url) => {
    const who = await caller(request, url);
    if (who.kind !== 'device') throw new HttpError(403, 'Только для устройства пациента.');
    const doctors = activeDoctors(who.patientId);
    db.transaction(() => {
      db.query('DELETE FROM records WHERE patient_id = ?').run(who.patientId);
      db.query('DELETE FROM pairings WHERE patient_id = ?').run(who.patientId);
      db.query('DELETE FROM patient_keys WHERE patient_id = ? AND recipient LIKE ?').run(
        who.patientId,
        'p:%',
      );
      db.query('UPDATE devices SET revoked_at = ? WHERE patient_id = ? AND revoked_at IS NULL').run(
        now(),
        who.patientId,
      );
      db.query("UPDATE patients SET status = 'withdrawn' WHERE id = ?").run(who.patientId);
      db.query("INSERT INTO alerts (patient_id, kind, at) VALUES (?, 'withdrawn', ?)").run(
        who.patientId,
        now(),
      );
    })();
    hub.send(doctors, 'alert', { patientId: who.patientId, kind: 'withdrawn' });
    pushTo(doctors.map((id) => `d:${id}`));
    return json({ ok: true });
  });

  // --- alerts, push, live ----------------------------------------------------------------------

  route('GET', '/api/alerts', async (request, url) => {
    const id = doctorOnly(await caller(request, url));
    const alerts = db
      .query<{ id: number; patient_id: string; kind: DiaryAlert['kind']; at: string }, [string]>(
        `SELECT a.id, a.patient_id, a.kind, a.at FROM alerts a
         JOIN members m ON m.patient_id = a.patient_id AND m.doctor_id = ? AND m.status = 'active'
         WHERE a.acked_at IS NULL ORDER BY a.at DESC LIMIT 200`,
      )
      .all(id);
    return json({
      alerts: alerts.map((row) => ({
        id: row.id,
        patientId: row.patient_id,
        kind: row.kind,
        at: row.at,
      })),
    });
  });

  route('POST', '/api/alerts/:alert/ack', async (request, url, params) => {
    const id = doctorOnly(await caller(request, url));
    const alert = db
      .query<{ patient_id: string }, [number]>('SELECT patient_id FROM alerts WHERE id = ?')
      .get(Number(params['alert']));
    if (!alert) throw new HttpError(404, 'Отметка не найдена.');
    canRead({ kind: 'doctor', id }, alert.patient_id);
    db.query('UPDATE alerts SET acked_at = ? WHERE id = ?').run(now(), Number(params['alert']));
    hub.send(activeDoctors(alert.patient_id), 'alert', { patientId: alert.patient_id });
    return json({ ok: true });
  });

  route('POST', '/api/push/subscriptions', async (request, url) => {
    const who = await caller(request, url);
    const { endpoint } = await body(request, DiaryPushSubscriptionSchema);
    const owner = who.kind === 'doctor' ? `d:${who.id}` : `p:${who.id}`;
    db.query(
      'INSERT INTO push_subscriptions (endpoint, owner, created_at) VALUES (?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET owner = excluded.owner',
    ).run(endpoint, owner, now());
    return json({ ok: true }, 201);
  });

  // Live stream: a doctor by id, a patient's phone as `p:<device id>` (no colon in doctor ids).
  route('GET', '/api/events', async (request, url) => {
    const who = await caller(request, url);
    return hub.open(who.kind === 'doctor' ? who.id : `p:${who.id}`);
  });

  // --- static app ------------------------------------------------------------------------------

  const serveStatic = async (url: URL): Promise<Response> => {
    if (!config.staticDir) return json({ error: 'Не найдено.' }, 404);
    const path = decodeURIComponent(url.pathname);
    if (path.includes('..')) return json({ error: 'Не найдено.' }, 404);
    const candidates = path.endsWith('/') ? [`${path}index.html`] : [path, `${path}/index.html`];
    for (const candidate of candidates) {
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
    if (!origin || !config.corsOrigins?.includes(origin)) return {};
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE',
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
