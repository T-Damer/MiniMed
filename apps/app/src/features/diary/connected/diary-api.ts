/**
 * Client of the diary service (apps/diary-server). Same origin by default (`/api`); every
 * response is validated with the shared contract before it is used.
 */
import {
  type DiaryAlert,
  DiaryAlertSchema,
  DiaryDeviceKeysSchema,
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
  DiaryRecordsPageSchema,
  DiaryRecoverFetchResponseSchema,
  type DiaryRegisterRequest,
  type DiaryRole,
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
  pairing: (api: DiaryApi, id: string, secretHash: string, keys: string) =>
    api.call('POST', `/api/patients/${id}/pairings`, z.object({ expiresAt: z.string() }), {
      secretHash,
      keys,
    }),
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
  push: (api: DiaryApi, patientId: string, records: readonly DiaryEnvelope[]) =>
    api.call('POST', `/api/patients/${patientId}/records`, Seqs, { records }),
};

export const diaryDevice = {
  pair: (api: DiaryApi, patientId: string, secret: string, identity: DiaryPublicIdentity) =>
    api.call('POST', '/api/pair', DiaryPairResponseSchema, { patientId, secret, identity }),
  keys: (api: DiaryApi) => api.call('GET', '/api/device/keys', DeviceKeys),
  alert: (api: DiaryApi) => api.call('POST', '/api/device/alerts', Ok, {}),
  withdraw: (api: DiaryApi) => api.call('DELETE', '/api/device', Ok),
};

export const diaryAlerts = {
  list: async (api: DiaryApi): Promise<readonly DiaryAlert[]> =>
    (await api.call('GET', '/api/alerts', Alerts)).alerts,
  ack: (api: DiaryApi, id: number) => api.call('POST', `/api/alerts/${id}/ack`, Ok, {}),
};

export const diaryPush = {
  key: (api: DiaryApi) => api.call('GET', '/api/push/key', DiaryPushKeySchema),
  subscribe: (api: DiaryApi, endpoint: string) =>
    api.call('POST', '/api/push/subscriptions', Ok, { endpoint }),
};

export type { DiaryStoredEnvelope };
