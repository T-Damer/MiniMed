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
  invite: z.string().trim().max(64).optional(),
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
  devices: z.number().int().min(0),
  /** Latest authenticated request of any of the patient's phones (presence metadata only). */
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

export const DiaryPairingCreateSchema = z.object({
  secretHash: base64Url.max(100),
  /** The device's key copies for every epoch, sealed with a key derived from the secret. */
  keys: sealed.max(20_000),
});

export const DiaryPairRequestSchema = z.object({
  patientId: DiaryIdSchema,
  secret: base64Url.max(100),
  identity: DiaryPublicIdentitySchema,
});
export const DiaryPairResponseSchema = z.object({
  deviceId: DiaryIdSchema,
  token: base64Url,
  keys: sealed,
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
] as const;
export const DiaryPushPayloadSchema = z.object({
  kind: z.enum(DIARY_PUSH_KINDS),
  /** The reminder's moment (ISO). */
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

export const DiaryAlertSchema = z.object({
  id: z.number().int(),
  patientId: DiaryIdSchema,
  kind: z.enum(['urgent', 'withdrawn']),
  at: z.string(),
});
export type DiaryAlert = z.infer<typeof DiaryAlertSchema>;

export const DiaryPushSubscriptionSchema = z.object({
  endpoint: z
    .string()
    .url()
    .max(1000)
    .refine((url) => url.startsWith('https://'), 'https only'),
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
export const DiaryRemindersSchema = z.object({
  at: z.array(z.string().datetime()).max(DIARY_REMINDER_MAX),
});

/** What the service tells a client before sign-in. */
export const DiaryServerInfoSchema = z.object({ signup: z.enum(['open', 'invite']) });

export const DiaryPushKeySchema = z.object({ publicKey: base64Url.nullable() });

export const DiaryErrorSchema = z.object({ error: z.string() });
