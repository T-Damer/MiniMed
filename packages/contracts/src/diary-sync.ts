/**
 * Wire contract of the connected diary service (ADR-0026). The server validates every request with
 * these schemas and the clients validate every response. Record bodies are ciphertext: nothing here
 * carries a name, a medicine or a value.
 */
import { z } from 'zod';

const base64Url = z.string().regex(/^[A-Za-z0-9_-]+$/u);
const sealed = z.string().regex(/^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+){1,2}$/u);

export const DiaryIdSchema = z.string().regex(/^[a-z0-9]{12,32}$/u);
export const DiaryAuthorSchema = z.string().regex(/^[dp]:[a-z0-9]{12,32}$/u);
export const DiaryEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(200)
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/u);

export const DiaryPublicIdentitySchema = z.object({
  wrap: base64Url.max(200),
  sign: base64Url.max(200),
});
export type DiaryPublicIdentity = z.infer<typeof DiaryPublicIdentitySchema>;

export const DiaryKdfSchema = z.object({
  salt: base64Url.max(64),
  iterations: z.number().int().min(100_000).max(5_000_000),
});

export const DiaryRegisterRequestSchema = z.object({
  email: DiaryEmailSchema,
  name: z.string().trim().min(1).max(120),
  authKey: base64Url.max(100),
  kdf: DiaryKdfSchema,
  identity: DiaryPublicIdentitySchema,
  identityBlob: sealed.max(8000),
  recovery: z.object({ authKey: base64Url.max(100), identityBlob: sealed.max(8000) }),
  /** The sign-up code as typed: only clients before SEC-AUDIT1 send it. */
  invite: z.string().trim().max(64).optional(),
  /** `inviteProof(code)`: the code itself never reaches the server (SEC-AUDIT1). */
  inviteProof: base64Url.max(100).optional(),
});
export type DiaryRegisterRequest = z.infer<typeof DiaryRegisterRequestSchema>;

export const DiaryPreloginRequestSchema = z.object({ email: DiaryEmailSchema });
export const DiaryPreloginResponseSchema = z.object({ kdf: DiaryKdfSchema });

export const DiaryLoginRequestSchema = z.object({
  email: DiaryEmailSchema,
  authKey: base64Url.max(100),
});

export const DiaryDoctorProfileSchema = z.object({
  id: DiaryIdSchema,
  email: DiaryEmailSchema,
  name: z.string(),
  identity: DiaryPublicIdentitySchema,
});
export type DiaryDoctorProfile = z.infer<typeof DiaryDoctorProfileSchema>;

export const DiarySessionResponseSchema = z.object({
  token: base64Url,
  doctor: DiaryDoctorProfileSchema,
  identityBlob: sealed,
});
export type DiarySessionResponse = z.infer<typeof DiarySessionResponseSchema>;

export const DiaryRecoverFetchRequestSchema = z.object({
  email: DiaryEmailSchema,
  recoveryAuthKey: base64Url.max(100),
});
export const DiaryRecoverFetchResponseSchema = z.object({ identityBlob: sealed });
export const DiaryRecoverResetRequestSchema = z.object({
  email: DiaryEmailSchema,
  recoveryAuthKey: base64Url.max(100),
  authKey: base64Url.max(100),
  kdf: DiaryKdfSchema,
  identityBlob: sealed.max(8000),
});

export const DiaryRoleSchema = z.enum(['owner', 'editor', 'reader']);
export type DiaryRole = z.infer<typeof DiaryRoleSchema>;

/** A patient data key locked for one member: `d:<doctorId>` or `p:<deviceId>`. */
export const DiaryWrappedKeySchema = z.object({
  epoch: z.number().int().min(1),
  recipient: DiaryAuthorSchema,
  wrapped: sealed.max(600),
});
export type DiaryWrappedKey = z.infer<typeof DiaryWrappedKeySchema>;

export const DiaryEnvelopeSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/u),
  rev: z.number().int().min(1).max(1_000_000),
  epoch: z.number().int().min(1),
  author: DiaryAuthorSchema,
  body: sealed.max(256_000),
  sig: base64Url.max(200),
});
export type DiaryEnvelope = z.infer<typeof DiaryEnvelopeSchema>;

export const DiaryStoredEnvelopeSchema = DiaryEnvelopeSchema.extend({
  seq: z.number().int().min(1),
  at: z.string(),
});
export type DiaryStoredEnvelope = z.infer<typeof DiaryStoredEnvelopeSchema>;

export const DiaryPatientCreateSchema = z.object({
  id: DiaryIdSchema,
  /** The owner's copy of the epoch-1 key. */
  key: DiaryWrappedKeySchema,
});

/**
 * Presence definition. A patient's phone talks to the service on open, when it becomes visible or
 * online again, on every live-event reconnect and every `SYNC_INTERVAL_MS` (60 s) while the diary is
 * visible; each of those authenticated requests stamps the device's `last_seen_at`. A patient is
 * «online» while the newest stamp over her phones is younger than 2.5 sync intervals, so one missed
 * beat does not flicker the indicator and a closed diary turns offline within ~2.5 minutes.
 */
export const DIARY_ONLINE_WINDOW_MS = 150_000;
/** The service tells a patient's doctors at most this often about a changed `lastSeenAt`. */
export const DIARY_PRESENCE_EVENT_INTERVAL_MS = 60_000;

export const DiaryPatientSummarySchema = z.object({
  id: DiaryIdSchema,
  role: DiaryRoleSchema,
  status: z.enum(['active', 'pending', 'withdrawn']),
  ownerId: DiaryIdSchema,
  keys: z.array(DiaryWrappedKeySchema),
  epoch: z.number().int().min(1),
  lastSeq: z.number().int().min(0),
  lastRecordAt: z.string().nullable(),
  openAlerts: z.number().int().min(0),
  /** The patient's own phones (carers' are counted in `carers`). */
  devices: z.number().int().min(0),
  carers: z.number().int().min(0).default(0),
  /** Latest authenticated request of any of the patient's own phones (presence metadata only). */
  lastSeenAt: z.string().optional(),
  /** A phone made a request within `DIARY_ONLINE_WINDOW_MS`. */
  online: z.boolean(),
  createdAt: z.string(),
});
export type DiaryPatientSummary = z.infer<typeof DiaryPatientSummarySchema>;

/** Content-free live event `presence`: a patient went online or offline, or was seen again. */
export const DiaryPresenceEventSchema = z.object({
  patientId: DiaryIdSchema,
  online: z.boolean(),
  lastSeenAt: z.string().optional(),
});
export type DiaryPresenceEvent = z.infer<typeof DiaryPresenceEventSchema>;

/**
 * Who a paired device belongs to: the patient, or a carer (опекун, DIARY25) whom the doctor added
 * with the patient's consent. A carer's phone reads and marks the diary like the patient's; it
 * cannot withdraw the patient's consent, and it is told when a dose goes unmarked.
 */
export const DiaryDeviceKindSchema = z.enum(['patient', 'carer']);
export type DiaryDeviceKind = z.infer<typeof DiaryDeviceKindSchema>;

export const DiaryPairingCreateSchema = z.object({
  secretHash: base64Url.max(100),
  /** The device's key copies for every epoch, sealed with a key derived from the secret. */
  keys: sealed.max(20_000),
  /** Absent: the patient's own phone. */
  kind: DiaryDeviceKindSchema.optional(),
});

export const DiaryPairRequestSchema = z
  .object({
    patientId: DiaryIdSchema,
    /** `pairingProof(secret)` (SEC-AUDIT1); the secret seals the keys and stays on the phone. */
    proof: base64Url.max(100).optional(),
    /** The secret itself: only phones before SEC-AUDIT1 send it. */
    secret: base64Url.max(100).optional(),
    identity: DiaryPublicIdentitySchema,
  })
  .refine((input) => (input.proof === undefined) !== (input.secret === undefined), {
    message: 'proof or secret',
  });
export const DiaryPairResponseSchema = z.object({
  deviceId: DiaryIdSchema,
  token: base64Url,
  keys: sealed,
  kind: DiaryDeviceKindSchema.default('patient'),
});

/**
 * What a push tells the device, inside the payload encrypted for its browser (RFC 8291): the kind
 * of event and, for a reminder, its moment. Never a name, a medicine or a value (ADR-0026).
 */
export const DIARY_PUSH_KINDS = [
  'plan',
  'tip',
  'correction',
  'reminder',
  'alert',
  'withdrawn',
  'invite',
  /** To a carer: a dose was not marked taken `DIARY_MISSED_AFTER_MS` after its moment `at`. */
  'missed',
  /** To the patient's phones: a carer joined the diary. */
  'carer',
] as const;
export const DiaryPushPayloadSchema = z.object({
  kind: z.enum(DIARY_PUSH_KINDS),
  /** The reminder's (or the missed dose's) moment (ISO). */
  at: z.string().datetime().optional(),
});
export type DiaryPushPayload = z.infer<typeof DiaryPushPayloadSchema>;
/** What a doctor's records change for the patient, so the patient's notification can say it. */
export const DiaryRecordsNoticeSchema = z.enum(['plan', 'tip', 'correction']);
export type DiaryRecordsNotice = z.infer<typeof DiaryRecordsNoticeSchema>;

export const DiaryRecordsPushSchema = z.object({
  records: z.array(DiaryEnvelopeSchema).min(1).max(200),
  notice: DiaryRecordsNoticeSchema.optional(),
});
export const DiaryRecordsPushResponseSchema = z.object({ seqs: z.array(z.number().int()) });
export const DiaryRecordsPageSchema = z.object({
  records: z.array(DiaryStoredEnvelopeSchema),
  last: z.number().int().min(0),
  more: z.boolean(),
});

export const DiaryMemberSchema = z.object({
  doctor: DiaryDoctorProfileSchema,
  role: DiaryRoleSchema,
  status: z.enum(['active', 'pending']),
  addedAt: z.string(),
});
export type DiaryMember = z.infer<typeof DiaryMemberSchema>;

export const DiaryDeviceSchema = z.object({
  id: DiaryIdSchema,
  kind: DiaryDeviceKindSchema.default('patient'),
  identity: DiaryPublicIdentitySchema,
  createdAt: z.string(),
  lastSeenAt: z.string().nullable(),
});
export type DiaryDevice = z.infer<typeof DiaryDeviceSchema>;

export const DiaryPatientDetailSchema = z.object({
  members: z.array(DiaryMemberSchema),
  devices: z.array(DiaryDeviceSchema),
});
export type DiaryPatientDetail = z.infer<typeof DiaryPatientDetailSchema>;

export const DiaryMemberInviteSchema = z.object({
  doctorId: DiaryIdSchema,
  role: z.enum(['editor', 'reader']),
  keys: z.array(DiaryWrappedKeySchema).min(1).max(200),
});
export const DiaryMemberPatchSchema = z.object({ role: z.enum(['editor', 'reader']) });

/** A new epoch after a removal: the new key for every member and device left. */
export const DiaryEpochCreateSchema = z.object({
  epoch: z.number().int().min(2),
  keys: z.array(DiaryWrappedKeySchema).min(1).max(500),
});

export const DiaryDeviceKeysSchema = z.object({ keys: z.array(DiaryWrappedKeySchema) });

/** `GET /api/auth/me`: the signed-in doctor; `admin` is present (true) only for the service owner. */
export const DiaryMeResponseSchema = z.object({
  doctor: DiaryDoctorProfileSchema,
  identityBlob: sealed,
  admin: z.boolean().optional(),
});
export type DiaryMeResponse = z.infer<typeof DiaryMeResponseSchema>;

/** Weeks in the service overview's time series (`DiaryAdminStats.weeks`). */
export const DIARY_ADMIN_WEEKS = 12;

const count = z.number().int().min(0);

/**
 * `GET /api/admin/stats` (super-admin, `DIARY_ADMIN_EMAILS`): aggregates over what the server
 * already sees (ADR-0026 §7): counts and times, doctors' names and e-mails. No patient is
 * identified, no record is read.
 */
export const DiaryAdminStatsSchema = z.object({
  generatedAt: z.string(),
  doctors: z.object({
    total: count,
    /** Doctors who have at least one active diary. */
    withPatients: count,
    new7: count,
    new30: count,
  }),
  patients: z.object({
    /** Diaries not withdrawn. */
    total: count,
    withdrawn: count,
    /** With at least one paired patient phone. */
    withPhone: count,
    /** With at least one paired carer phone. */
    withCarer: count,
    /** A record in the last 7 / 30 days. */
    active7: count,
    active30: count,
    new7: count,
    new30: count,
  }),
  /** Paired phones that are not revoked. */
  phones: z.object({ patient: count, carer: count }),
  records: z.object({ total: count, last7: count, last30: count }),
  alerts: z.object({ total: count, open: count }),
  /** Oldest first; `start` is the Monday (UTC, YYYY-MM-DD) of a week. */
  weeks: z.array(z.object({ start: z.string(), newDoctors: count, newPatients: count })),
  /** Newest activity first. */
  doctorRows: z.array(
    z.object({
      name: z.string(),
      email: z.string(),
      patients: count,
      activePatients: count,
      /** Time of the newest record in the doctor's diaries. */
      lastActivityAt: z.string().nullable(),
    }),
  ),
});
export type DiaryAdminStats = z.infer<typeof DiaryAdminStatsSchema>;

export const DiaryAlertSchema = z.object({
  id: z.number().int(),
  patientId: DiaryIdSchema,
  kind: z.enum(['urgent', 'withdrawn']),
  at: z.string(),
});
export type DiaryAlert = z.infer<typeof DiaryAlertSchema>;

/**
 * A push service address the server may POST to (SEC-AUDIT1): https on the default port, a public
 * host name, no credentials. Push services (FCM, Mozilla, Apple, Microsoft, browser vendors) all
 * look like that; loopback, private and metadata addresses, IP literals and local names do not, so
 * a subscription cannot point the server at its own network.
 */
export function isPushEndpoint(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  if (url.port !== '' && url.port !== '443') return false;
  const host = url.hostname.toLowerCase().replace(/\.$/u, '');
  if (!host.includes('.') || host.startsWith('[')) return false;
  if (/^[\d.]+$/u.test(host) || /^0x/u.test(host)) return false;
  return !/(^|\.)(localhost|local|internal|intranet|lan|home\.arpa|test)$/u.test(host);
}

export const DiaryPushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(1000).refine(isPushEndpoint, 'https push service only'),
  /** The browser's payload keys (`PushSubscription.toJSON().keys`); without them pushes are empty. */
  keys: z.object({ p256dh: base64Url.max(120), auth: base64Url.max(40) }).optional(),
});

/**
 * Dose and checkpoint reminders of a patient's phone: only the moments, computed on the phone for
 * the next days (the server never sees the plan). Each `PUT` replaces the phone's list.
 */
export const DIARY_REMINDER_DAYS = 14;
export const DIARY_REMINDER_MAX = 400;
/** A reminder the server could not send this long after its moment is dropped. */
export const DIARY_REMINDER_GRACE_MS = 20 * 60_000;
/** A carer hears of a dose that is still not marked taken this long after its moment. */
export const DIARY_MISSED_AFTER_MS = 30 * 60_000;
export const DiaryRemindersSchema = z.object({
  at: z.array(z.string().datetime()).max(DIARY_REMINDER_MAX),
  /**
   * Only while the diary has a carer (DIARY25). From the patient's phone: the dose moments of the
   * coming days not all marked taken, kept for the missed-dose notice (this list replaces the
   * earlier one). From any phone: the moments whose doses are all marked taken.
   */
  checks: z.array(z.string().datetime()).max(DIARY_REMINDER_MAX).optional(),
  taken: z.array(z.string().datetime()).max(DIARY_REMINDER_MAX).optional(),
});

/** What the service tells a client before sign-in. */
export const DiaryServerInfoSchema = z.object({ signup: z.enum(['open', 'invite']) });

export const DiaryPushKeySchema = z.object({ publicKey: base64Url.nullable() });

export const DiaryErrorSchema = z.object({ error: z.string() });
