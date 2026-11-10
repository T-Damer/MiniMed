import { toBase64Url } from '@localmed/diary-sync';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PatientConnection } from '@/features/diary/connected/patient-connection';
import { JOINING_SET_VERSION, joiningDocuments } from '@/features/diary/consent/joining-documents';
import {
  DIARY_FORMAT_VERSION,
  diaryTemplate,
  parseDiaryInvitation,
} from '@/features/diary/diary-model';
import { createDiaryStore } from '@/features/diary/diary-storage';

// DIARY26: a paired phone sends nothing to the doctor before the patient has accepted the joining
// documents; then the consent record carries each document's wording and time.

const pushed: { id: string; payload: unknown }[][] = [];
let pulled: { id: string; author: string; payload: unknown }[] = [];

vi.mock('@/features/diary/connected/diary-session', () => ({
  DiarySession: class {
    pull() {
      return Promise.resolve({ revisions: pulled, refused: 0 });
    }
    push(items: { id: string; payload: unknown }[]) {
      pushed.push(items);
      return Promise.resolve([]);
    }
    snapshot() {
      return { cursor: 0, revs: {} };
    }
  },
}));
vi.mock('@/features/diary/diary-links', () => ({ diaryServiceBase: () => '' }));
// Who has the diary (DIARY25): the service answers with no doctors or carers yet.
vi.mock('@/features/diary/connected/diary-api', async (original) => {
  const actual = await original<typeof import('@/features/diary/connected/diary-api')>();
  return {
    ...actual,
    diaryDevice: { ...actual.diaryDevice, detail: () => Promise.resolve({ devices: [] }) },
  };
});

const ID = 'consentphone1';
const AT = '2026-11-04T08:00:00.000Z';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  };
}

async function pairedPhone() {
  const storage = memoryStorage();
  const store = createDiaryStore(storage);
  const template = diaryTemplate('care');
  store.open(
    parseDiaryInvitation({
      v: DIARY_FORMAT_VERSION,
      id: ID,
      template: 'care',
      title: template?.title,
      issuedAt: AT,
      fields: template?.fields,
      plan: [{ id: 'p1', name: 'Сертралин', dose: '50 мг', times: [{ time: '08:00' }] }],
      planTitle: 'Лекарства',
      consent: true,
    }),
  );
  const wrap = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ]);
  const sign = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
  ]);
  storage.setItem(
    `minimed.diary.connection.v1.${ID}`,
    JSON.stringify({
      v: 1,
      patientId: ID,
      deviceId: 'device000001',
      token: 'token',
      identity: {
        wrap: await crypto.subtle.exportKey('jwk', wrap.privateKey),
        sign: await crypto.subtle.exportKey('jwk', sign.privateKey),
      },
      keys: { '1': toBase64Url(crypto.getRandomValues(new Uint8Array(32))) },
      epoch: 1,
      session: { cursor: 0, revs: {} },
      synced: {},
      pendingAlerts: 0,
    }),
  );
  const connection = await PatientConnection.open(storage, store, ID);
  if (!connection) throw new Error('no connection');
  return { store, connection };
}

beforeEach(() => {
  pushed.length = 0;
  pulled = [];
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('before the joining documents are accepted', () => {
  it('sends nothing, not even a mark that is already on the phone', async () => {
    const { store, connection } = await pairedPhone();
    const results = store.read(ID);
    if (!results) throw new Error('no diary');
    store.save({
      ...results,
      entries: [
        {
          id: 'entry0000001',
          at: AT,
          values: { medication: { item: 'p1', done: true, slot: '08:00' } },
        },
      ],
    });
    store.setMeta(ID, { tipsRead: ['tip1'] });
    const status = await connection.sync();
    expect(status.phase).toBe('idle');
    expect(pushed).toEqual([[]]);
  });
});

describe('once every document is accepted', () => {
  it('sends the consent with each document’s wording and time, then the marks', async () => {
    const { store, connection } = await pairedPhone();
    const consents = joiningDocuments(true).map((document, index) => ({
      document: document.id,
      version: document.version,
      at: `2026-11-04T08:0${index + 1}:00.000Z`,
    }));
    store.setMeta(ID, { consentAt: '2026-11-04T08:03:00.000Z', consents });
    await connection.sync();
    const consent = pushed[0]?.find((item) => item.id === 'consent');
    expect(consent?.payload).toEqual({
      kind: 'consent',
      at: '2026-11-04T08:03:00.000Z',
      version: JOINING_SET_VERSION,
      documents: consents,
    });
    // Sent once: the next sync has nothing new.
    await connection.sync();
    expect(pushed[1]).toEqual([]);
  });

  it('takes the documents accepted on another phone of the same patient', async () => {
    const { store, connection } = await pairedPhone();
    const consents = joiningDocuments(true).map((document) => ({
      document: document.id,
      version: document.version,
      at: AT,
    }));
    pulled = [
      {
        id: 'consent',
        author: 'p:device000002',
        payload: { kind: 'consent', at: AT, version: JOINING_SET_VERSION, documents: consents },
      },
    ];
    await connection.sync();
    expect(store.meta(ID).consentAt).toBe(AT);
    expect(store.meta(ID).consents).toEqual(consents);
    // Already on the server: this phone does not send it again.
    expect(pushed[0]?.some((item) => item.id === 'consent')).toBe(false);
  });
});

describe('the answer about a study', () => {
  const study = { study: 'studyabc123', version: '2', status: 'accepted' as const, at: AT };

  function accepted(store: ReturnType<typeof createDiaryStore>) {
    const consents = joiningDocuments(true).map((document) => ({
      document: document.id,
      version: document.version,
      at: AT,
    }));
    store.setMeta(ID, { consentAt: AT, consents });
    return consents;
  }

  it('travels in the consent record and is sent again only when the answer changes', async () => {
    const { store, connection } = await pairedPhone();
    const consents = accepted(store);
    store.setMeta(ID, { study });
    await connection.sync();
    expect(pushed[0]?.find((item) => item.id === 'consent')?.payload).toEqual({
      kind: 'consent',
      at: AT,
      version: JOINING_SET_VERSION,
      documents: consents,
      study,
    });
    await connection.sync();
    expect(pushed[1]).toEqual([]);
    const withdrawn = { ...study, status: 'withdrawn' as const, at: '2026-11-05T08:00:00.000Z' };
    store.setMeta(ID, { study: withdrawn });
    await connection.sync();
    const again = pushed[2]?.find((item) => item.id === 'consent')?.payload as {
      study: unknown;
      documents: unknown;
    };
    expect(again.study).toEqual(withdrawn);
    expect(again.documents).toEqual(consents);
  });

  it('takes the later answer when another phone of the patient answered', async () => {
    const { store, connection } = await pairedPhone();
    accepted(store);
    store.setMeta(ID, { study });
    const later = { ...study, status: 'withdrawn' as const, at: '2026-11-06T08:00:00.000Z' };
    pulled = [
      {
        id: 'consent',
        author: 'p:device000002',
        payload: { kind: 'consent', at: AT, version: JOINING_SET_VERSION, study: later },
      },
    ];
    await connection.sync();
    expect(store.meta(ID).study).toEqual(later);
    expect(pushed[0]?.some((item) => item.id === 'consent')).toBe(false);
  });

  it('keeps its own later answer and sends it over an older one on the server', async () => {
    const { store, connection } = await pairedPhone();
    accepted(store);
    const mine = { ...study, status: 'declined' as const, at: '2026-11-07T08:00:00.000Z' };
    store.setMeta(ID, { study: mine });
    pulled = [
      {
        id: 'consent',
        author: 'p:device000002',
        payload: { kind: 'consent', at: AT, version: JOINING_SET_VERSION, study },
      },
    ];
    await connection.sync();
    expect(store.meta(ID).study).toEqual(mine);
    expect(pushed[0]?.some((item) => item.id === 'consent')).toBe(true);
  });
});

describe('the doctor’s visit ratings on the patient’s phone', () => {
  it('are never taken into the diary, from a v- record or an e- record', async () => {
    const { store, connection } = await pairedPhone();
    const consents = joiningDocuments(true).map((document) => ({
      document: document.id,
      version: document.version,
      at: AT,
    }));
    store.setMeta(ID, { consentAt: AT, consents });
    const rating = {
      id: 'rating000001',
      at: AT,
      values: {},
      answers: { 'hamilton-depression-rating-scale-01': 1 },
      visitScale: 'hamilton-depression-rating-scale',
    };
    pulled = [
      {
        id: 'v-rating000001',
        author: 'd:doctor0000001',
        payload: { kind: 'visit-scale', entry: rating },
      },
      {
        id: 'e-rating000001',
        author: 'd:doctor0000001',
        payload: { kind: 'entry', entry: rating },
      },
    ];
    await connection.sync();
    expect(store.read(ID)?.entries).toEqual([]);
    // Nothing is sent back about them either (no delete for a record that was never local).
    expect(pushed[0]?.some((item) => item.id.includes('rating000001'))).toBe(false);
  });
});
