/**
 * Client of the diary service (apps/diary-server). Same origin by default (`/api`); every
 * response is validated with the shared contract before it is used.
 */
import {
  type DiaryAlert,
  DiaryAlertSchema,
  DiaryDeviceKeysSchema,
  type DiaryDeviceKind,
  DiaryDeviceKindSchema,
  type DiaryDoctorProfile,
  DiaryDoctorProfileSchema,
  type DiaryEnvelope,
  DiaryPairResponseSchema,
  type DiaryPatientDetail,
  DiaryPatientDetailSchema,
  type DiaryPatientSummary,
  DiaryPatientSummarySchema,
  DiaryPreloginResponseSchema,
  type DiaryPublicIdentity,
  DiaryPushKeySchema,
  type DiaryRecordsNotice,
  DiaryRecordsPageSchema,
  DiaryRecoverFetchResponseSchema,
  type DiaryRegisterRequest,
  type DiaryRole,
  DiaryServerInfoSchema,
  type DiarySessionResponse,
  DiarySessionResponseSchema,
  type DiaryStoredEnvelope,
  type DiaryWrappedKey,
} from '@localmed/contracts';
import { z } from 'zod';

export class DiaryApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'DiaryApiError';
  }
}

/** The service could not be reached (offline, server down): queued work stays queued. */
export function isOffline(cause: unknown): boolean {
  return cause instanceof DiaryApiError && cause.status === 0;
}

const ErrorBody = z.object({ error: z.string() });

export interface DiaryApi {
  readonly base: string;
  token(): string | undefined;
  call<T extends z.ZodType>(
    method: string,
    path: string,
    schema: T,
    body?: unknown,
  ): Promise<z.infer<T>>;
}

export function createDiaryApi(token: () => string | undefined, base = ''): DiaryApi {
  return {
    base,
    token,
    async call(method, path, schema, body) {
      let response: Response;
      const current = token();
      try {
        response = await fetch(`${base}${path}`, {
          method,
          headers: {
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
            ...(current ? { Authorization: `Bearer ${current}` } : {}),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          cache: 'no-store',
        });
      } catch (cause) {
        throw new DiaryApiError(
          0,
          `Нет связи с сервером дневников. ${cause instanceof Error ? cause.message : ''}`.trim(),
        );
      }
      const value: unknown = await response.json().catch(() => undefined);
      if (!response.ok) {
        const parsed = ErrorBody.safeParse(value);
        throw new DiaryApiError(
          response.status,
          parsed.success ? parsed.data.error : `Сервер ответил ${response.status}.`,
        );
      }
      const parsed = schema.safeParse(value);
      if (!parsed.success) throw new DiaryApiError(502, 'Сервер дневников ответил непонятно.');
      return parsed.data;
    },
  };
}

const Ok = z.object({ ok: z.literal(true) }).passthrough();
const Seqs = z.object({ seqs: z.array(z.number()) });
const Patients = z.object({ patients: z.array(DiaryPatientSummarySchema) });
const PatientOne = z.object({ patient: DiaryPatientSummarySchema });
const Authors = z.object({ authors: z.record(z.string(), z.string()) });
const Lookup = z.object({ doctor: DiaryDoctorProfileSchema });
const Me = z.object({ doctor: DiaryDoctorProfileSchema, identityBlob: z.string() });
const Alerts = z.object({ alerts: z.array(DiaryAlertSchema) });
const DeviceKeys = DiaryDeviceKeysSchema.extend({
  epoch: z.number().int(),
  patientId: z.string(),
  status: z.string(),
});

export const diaryAuth = {
  prelogin: (api: DiaryApi, email: string) =>
    api.call('POST', '/api/auth/prelogin', DiaryPreloginResponseSchema, { email }),
  register: (api: DiaryApi, request: DiaryRegisterRequest): Promise<DiarySessionResponse> =>
    api.call('POST', '/api/auth/register', DiarySessionResponseSchema, request),
  login: (api: DiaryApi, email: string, authKey: string): Promise<DiarySessionResponse> =>
    api.call('POST', '/api/auth/login', DiarySessionResponseSchema, { email, authKey }),
  logout: (api: DiaryApi) => api.call('POST', '/api/auth/logout', Ok, {}),
  me: (api: DiaryApi) => api.call('GET', '/api/auth/me', Me),
  recoverFetch: (api: DiaryApi, email: string, recoveryAuthKey: string) =>
    api.call('POST', '/api/auth/recover/fetch', DiaryRecoverFetchResponseSchema, {
      email,
      recoveryAuthKey,
    }),
  recoverReset: (
    api: DiaryApi,
    request: {
      email: string;
      recoveryAuthKey: string;
      authKey: string;
      kdf: { salt: string; iterations: number };
      identityBlob: string;
    },
  ): Promise<DiarySessionResponse> =>
    api.call('POST', '/api/auth/recover/reset', DiarySessionResponseSchema, request),
};

export const diaryDoctors = {
  lookup: async (api: DiaryApi, email: string): Promise<DiaryDoctorProfile> =>
    (await api.call('GET', `/api/doctors/lookup?email=${encodeURIComponent(email)}`, Lookup))
      .doctor,
};

export const diaryPatients = {
  list: async (api: DiaryApi): Promise<readonly DiaryPatientSummary[]> =>
    (await api.call('GET', '/api/patients', Patients)).patients,
  create: async (api: DiaryApi, id: string, key: DiaryWrappedKey): Promise<DiaryPatientSummary> =>
    (await api.call('POST', '/api/patients', PatientOne, { id, key })).patient,
  detail: (api: DiaryApi, id: string): Promise<DiaryPatientDetail> =>
    api.call('GET', `/api/patients/${id}`, DiaryPatientDetailSchema),
  remove: (api: DiaryApi, id: string) => api.call('DELETE', `/api/patients/${id}`, Ok),
  authors: async (api: DiaryApi, id: string): Promise<Readonly<Record<string, string>>> =>
    (await api.call('GET', `/api/patients/${id}/authors`, Authors)).authors,
  /** A one-time code for the patient's phone, or (`kind: 'carer'`) for a carer's (DIARY25). */
  pairing: (
    api: DiaryApi,
    id: string,
    secretHash: string,
    keys: string,
    kind: DiaryDeviceKind = 'patient',
  ) =>
    api.call(
      'POST',
      `/api/patients/${id}/pairings`,
      // Servers before DIARY25 answer without a kind (and pair everyone as the patient).
      z.object({ expiresAt: z.string(), kind: DiaryDeviceKindSchema.optional() }),
      {
        secretHash,
        keys,
        ...(kind === 'carer' ? { kind } : {}),
      },
    ),
  revokeDevice: (api: DiaryApi, id: string, deviceId: string) =>
    api.call('DELETE', `/api/patients/${id}/devices/${deviceId}`, Ok),
  invite: (
    api: DiaryApi,
    id: string,
    doctorId: string,
    role: Exclude<DiaryRole, 'owner'>,
    keys: readonly DiaryWrappedKey[],
  ) => api.call('POST', `/api/patients/${id}/members`, Ok, { doctorId, role, keys }),
  accept: (api: DiaryApi, id: string) => api.call('POST', `/api/patients/${id}/accept`, Ok, {}),
  setRole: (api: DiaryApi, id: string, doctorId: string, role: Exclude<DiaryRole, 'owner'>) =>
    api.call('PATCH', `/api/patients/${id}/members/${doctorId}`, Ok, { role }),
  removeMember: (api: DiaryApi, id: string, doctorId: string) =>
    api.call('DELETE', `/api/patients/${id}/members/${doctorId}`, Ok),
  transfer: (api: DiaryApi, id: string, doctorId: string) =>
    api.call('POST', `/api/patients/${id}/transfer/${doctorId}`, Ok, {}),
  rotate: (api: DiaryApi, id: string, epoch: number, keys: readonly DiaryWrappedKey[]) =>
    api.call('POST', `/api/patients/${id}/epochs`, Ok, { epoch, keys }),
};

export const diaryRecords = {
  page: (api: DiaryApi, patientId: string, after: number) =>
    api.call('GET', `/api/patients/${patientId}/records?after=${after}`, DiaryRecordsPageSchema),
  push: (
    api: DiaryApi,
    patientId: string,
    records: readonly DiaryEnvelope[],
    notice?: DiaryRecordsNotice,
  ) =>
    api.call('POST', `/api/patients/${patientId}/records`, Seqs, {
      records,
      ...(notice ? { notice } : {}),
    }),
};

export const diaryDevice = {
  /** `proof`: `pairingProof(secret)`; the secret itself never leaves the phone (SEC-AUDIT1). */
  pair: (api: DiaryApi, patientId: string, proof: string, identity: DiaryPublicIdentity) =>
    api.call('POST', '/api/pair', DiaryPairResponseSchema, { patientId, proof, identity }),
  keys: (api: DiaryApi) => api.call('GET', '/api/device/keys', DeviceKeys),
  alert: (api: DiaryApi) => api.call('POST', '/api/device/alerts', Ok, {}),
  withdraw: (api: DiaryApi) => api.call('DELETE', '/api/device', Ok),
  /** Who has the diary: its doctors and phones (the device reads its own patient). */
  detail: (api: DiaryApi, patientId: string): Promise<DiaryPatientDetail> =>
    api.call('GET', `/api/patients/${patientId}`, DiaryPatientDetailSchema),
  /** The patient's phone removes a carer, or a carer's phone leaves (DIARY25). */
  removeCarer: (api: DiaryApi, deviceId: string) =>
    api.call('DELETE', `/api/device/carers/${deviceId}`, Ok),
  /** The patient's phone's new data key after removing a carer. */
  rotate: (api: DiaryApi, patientId: string, epoch: number, keys: readonly DiaryWrappedKey[]) =>
    api.call('POST', `/api/patients/${patientId}/epochs`, Ok, { epoch, keys }),
};

export const diaryAlerts = {
  list: async (api: DiaryApi): Promise<readonly DiaryAlert[]> =>
    (await api.call('GET', '/api/alerts', Alerts)).alerts,
  ack: (api: DiaryApi, id: number) => api.call('POST', `/api/alerts/${id}/ack`, Ok, {}),
};

export const diaryPush = {
  key: (api: DiaryApi) => api.call('GET', '/api/push/key', DiaryPushKeySchema),
  /** The subscription with its payload keys, so pushes can say what happened (still no content). */
  subscribe: (api: DiaryApi, subscription: PushSubscription) => {
    const keys = subscription.toJSON().keys;
    return api.call('POST', '/api/push/subscriptions', Ok, {
      endpoint: subscription.endpoint,
      ...(keys?.['p256dh'] && keys['auth']
        ? { keys: { p256dh: keys['p256dh'], auth: keys['auth'] } }
        : {}),
    });
  },
  /**
   * The phone's next reminder moments (ISO), replacing its earlier list; with a carer, the dose
   * moments for the missed-dose notice too (`DiaryRemindersSchema`).
   */
  reminders: (
    api: DiaryApi,
    at: readonly string[],
    doses?: { readonly checks?: readonly string[]; readonly taken: readonly string[] },
  ) =>
    api.call('PUT', '/api/device/reminders', z.object({ count: z.number().int() }), {
      at,
      ...(doses?.checks ? { checks: doses.checks } : {}),
      ...(doses ? { taken: doses.taken } : {}),
    }),
};

/** Sign-up mode of the service, before an account exists. */
export const diaryInfo = (api: DiaryApi) => api.call('GET', '/api/info', DiaryServerInfoSchema);

/** `live`: absent on servers older than ADR-0027, which all stream. */
const Health = z.object({ ok: z.literal(true), live: z.enum(['sse', 'poll']).optional() });
const Changes = z.object({ n: z.number().int() });
const liveModes = new Map<string, Promise<'sse' | 'poll'>>();

/**
 * How the service delivers changes (ADR-0027): `sse`, a live stream to open; `poll`, a counter to
 * read with `diaryChanges` now and then. Asked once per service.
 */
export function diaryLiveMode(api: DiaryApi): Promise<'sse' | 'poll'> {
  let mode = liveModes.get(api.base);
  if (!mode) {
    mode = api.call('GET', '/api/health', Health).then((health) => health.live ?? 'sse');
    // A failed answer (offline) is not remembered: the next caller asks again.
    mode.catch(() => liveModes.delete(api.base));
    liveModes.set(api.base, mode);
  }
  return mode;
}

/** The caller's change counter in `poll` mode; it moves whenever something for the caller changed. */
export const diaryChanges = (api: DiaryApi): Promise<number> =>
  api.call('GET', '/api/changes', Changes).then((body) => body.n);

export type { DiaryStoredEnvelope };
