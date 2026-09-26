import { describe, expect, it } from 'vitest';

import {
  DIARY_QR_CHUNK,
  DiaryPartCollector,
  decodePayload,
  diaryInvitationLink,
  encodeDiaryResults,
  MAX_DIARY_JSON_BYTES,
  parseDiaryPart,
  readInvitationFragment,
} from '@/features/diary/diary-codec';
import { diaryToFhirBundle } from '@/features/diary/diary-fhir';
import { createDiaryStore } from '@/features/diary/diary-storage';
import { applyDiaryImport, diaryImportEvents } from '@/features/diary/diary-import';
import {
  DiaryFormatError,
  type DiaryInvitation,
  type DiaryResults,
  parseDiaryInvitation,
  parseDiaryResults,
} from '@/features/diary/diary-model';
import {
  appendEpisode,
  createClinicalEpisode,
  createPatientProfile,
  emptyPatientVaultSnapshot,
} from '@/state/patient-domain';

const NOW = Date.parse('2026-09-24T12:00:00Z');

const bpInvitation: DiaryInvitation = {
  v: 1,
  id: 'bpdiary001',
  kind: 'blood-pressure',
  issuedAt: '2026-09-01T09:00:00.000Z',
  doctor: 'Иванова А. А.',
  note: 'Утром и вечером, сидя, после 5 минут отдыха',
};

const medicationInvitation: DiaryInvitation = {
  v: 1,
  id: 'meddiary01',
  kind: 'medication',
  issuedAt: '2026-09-01T09:00:00.000Z',
  medications: [{ name: 'Эналаприл', dose: '5 мг', schedule: '08:00, 20:00' }],
};

function bpResults(count: number): DiaryResults {
  return parseDiaryResults(
    {
      v: 1,
      invitation: bpInvitation,
      entries: Array.from({ length: count }, (_, index) => ({
        id: `e${String(index).padStart(6, '0')}`,
        at: new Date(Date.parse('2026-09-02T07:00:00Z') + index * 8 * 3_600_000).toISOString(),
        systolic: 120 + (index % 30),
        diastolic: 75 + (index % 10),
        ...(index % 3 === 0 ? { pulse: 70 + (index % 20) } : {}),
        ...(index === 1 ? { note: 'Болела голова' } : {}),
      })),
    },
    NOW,
  );
}

function memoryStorage(seed: Readonly<Record<string, string>> = {}): Storage {
  const values = new Map(Object.entries(seed));
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

describe('diary validation', () => {
  it.each([
    [{ ...bpInvitation, v: 2 }, 'версия'],
    [{ ...bpInvitation, kind: 'weight' }, 'тип'],
    [{ ...bpInvitation, id: '../x' }, 'идентификатор'],
    [{ ...bpInvitation, issuedAt: '2099-01-01T00:00:00Z' }, 'диапазона'],
    [{ ...medicationInvitation, medications: [] }, 'препарат'],
    [{ ...bpInvitation, note: 'a\u0000b' }, 'текст'],
  ])('rejects an unsafe invitation %#', (value, message) => {
    expect(() => parseDiaryInvitation(value, NOW)).toThrow(message);
  });

  it('rejects impossible readings and entries for unknown medicines', () => {
    const entry = { id: 'entry01', at: '2026-09-10T08:00:00Z' };
    expect(() =>
      parseDiaryResults(
        { v: 1, invitation: bpInvitation, entries: [{ ...entry, systolic: 80, diastolic: 90 }] },
        NOW,
      ),
    ).toThrow('меньше верхнего');
    expect(() =>
      parseDiaryResults(
        { v: 1, invitation: bpInvitation, entries: [{ ...entry, systolic: 400, diastolic: 90 }] },
        NOW,
      ),
    ).toThrow(DiaryFormatError);
    expect(() =>
      parseDiaryResults(
        {
          v: 1,
          invitation: medicationInvitation,
          entries: [{ ...entry, medication: 3, taken: true }],
        },
        NOW,
      ),
    ).toThrow('неизвестный препарат');
  });
});

describe('diary local storage', () => {
  it('rebuilds a damaged index from valid diary records', () => {
    const results = bpResults(2);
    const storage = memoryStorage({
      'minimed.diary.v1.index': '{broken-json',
      [`minimed.diary.v1.${results.invitation.id}`]: JSON.stringify(results),
    });
    const store = createDiaryStore(storage, () => NOW);

    expect(store.list()).toEqual([results.invitation]);
    expect(JSON.parse(storage.getItem('minimed.diary.v1.index') ?? '[]')).toEqual([
      results.invitation.id,
    ]);
  });

  it('recovers a saved diary when the compact index write fails once', () => {
    const base = memoryStorage({ 'minimed.diary.v1.index': '[]' });
    let failIndexWrite = true;
    const storage: Storage = {
      get length() {
        return base.length;
      },
      clear: () => base.clear(),
      getItem: (key) => base.getItem(key),
      key: (index) => base.key(index),
      removeItem: (key) => base.removeItem(key),
      setItem(key, value) {
        if (key === 'minimed.diary.v1.index' && failIndexWrite) {
          failIndexWrite = false;
          throw new DOMException('quota', 'QuotaExceededError');
        }
        base.setItem(key, value);
      },
    };
    const results = bpResults(1);
    const store = createDiaryStore(storage, () => NOW);

    expect(() => store.save(results)).not.toThrow();
    expect(store.list()).toEqual([results.invitation]);
    expect(JSON.parse(storage.getItem('minimed.diary.v1.index') ?? '[]')).toEqual([
      results.invitation.id,
    ]);
  });

  it('keeps valid diaries visible when another local diary record is corrupt', () => {
    const results = bpResults(1);
    const storage = memoryStorage({
      'minimed.diary.v1.index': JSON.stringify([results.invitation.id, 'broken01']),
      [`minimed.diary.v1.${results.invitation.id}`]: JSON.stringify(results),
      'minimed.diary.v1.broken01': '{"v":1,"invitation":',
    });
    const store = createDiaryStore(storage, () => NOW);

    expect(store.list()).toEqual([results.invitation]);
    expect(store.load(results.invitation)).toEqual(results);
  });
});

describe('diary transport', () => {
  it('round-trips an invitation through the link fragment only', async () => {
    const link = await diaryInvitationLink(bpInvitation, 'https://example.org/app/diary/');
    const url = new URL(link);
    expect(url.search).toBe('');
    expect(url.pathname).toBe('/app/diary/');
    expect(await readInvitationFragment(url.hash, NOW)).toEqual(bpInvitation);
    expect(await readInvitationFragment('#other', NOW)).toBeNull();
  });

  it('splits a month of readings into QR parts and reassembles them in any order', async () => {
    const results = bpResults(60);
    const parts = await encodeDiaryResults(results);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((part) => part.length <= DIARY_QR_CHUNK + 32)).toBe(true);

    const collector = new DiaryPartCollector();
    for (const part of [...parts].reverse()) expect(collector.add(part)).toBe(true);
    expect(collector.add(parts[0] ?? '')).toBe(true);
    expect(collector.complete).toBe(true);
    const decoded = await collector.results(NOW);
    expect(decoded.invitation).toEqual(bpInvitation);
    expect(decoded.entries).toEqual(results.entries);
  });

  it('rejects a compressed payload that expands beyond the diary JSON budget', async () => {
    expect(typeof CompressionStream).toBe('function');
    const oversizedJson = JSON.stringify({ text: 'a'.repeat(MAX_DIARY_JSON_BYTES + 1) });
    const compressed = new Blob([new TextEncoder().encode(oversizedJson)])
      .stream()
      .pipeThrough(new CompressionStream('deflate-raw'));
    const bytes = new Uint8Array(await new Response(compressed).arrayBuffer());
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const payload =
      'z' + btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
    expect(payload.length).toBeLessThan(DIARY_QR_CHUNK * 40);

    await expect(decodePayload(payload)).rejects.toThrow('Распакованные данные дневника слишком велики');
  });

  it('rejects an individual QR part larger than the advertised chunk size', () => {
    const oversizedChunk = 'a'.repeat(DIARY_QR_CHUNK + 1);
    expect(parseDiaryPart(`MMD1.ABCDEFGH.1.1.${oversizedChunk}`)).toBeNull();
    const collector = new DiaryPartCollector();
    expect(collector.add(`MMD1.ABCDEFGH.1.1.${oversizedChunk}`)).toBe(false);
  });

  it('ignores codes from another transfer and detects a corrupted part', async () => {
    const first = await encodeDiaryResults(bpResults(60));
    const second = await encodeDiaryResults(bpResults(61));
    const collector = new DiaryPartCollector();
    expect(collector.add('https://example.org')).toBe(false);
    expect(collector.add(first[0] ?? '')).toBe(true);
    expect(collector.add(second[1] ?? '')).toBe(false);
    expect(collector.complete).toBe(false);

    const tampered = new DiaryPartCollector();
    for (const [index, part] of first.entries()) {
      tampered.add(
        index === 0 ? part.slice(0, -4) + (part.endsWith('AAAA') ? 'BBBB' : 'AAAA') : part,
      );
    }
    await expect(tampered.results(NOW)).rejects.toThrow('Контрольная сумма');
  });
});

describe('diary export and import', () => {
  it('exports LOINC-coded, patient-reported FHIR resources', () => {
    const bundle = diaryToFhirBundle(bpResults(1), new Date(NOW)) as {
      resourceType: string;
      type: string;
      entry: { resource: Record<string, unknown> }[];
    };
    expect(bundle).toMatchObject({ resourceType: 'Bundle', type: 'collection' });
    const [pressure, pulse] = bundle.entry.map((entry) => entry.resource);
    expect(pressure).toMatchObject({
      resourceType: 'Observation',
      code: { coding: [{ code: '85354-9' }] },
      component: [
        { code: { coding: [{ code: '8480-6' }] }, valueQuantity: { value: 120, code: 'mm[Hg]' } },
        { code: { coding: [{ code: '8462-4' }] }, valueQuantity: { value: 75 } },
      ],
      meta: { tag: [{ code: 'patient-reported' }] },
    });
    expect(pulse).toMatchObject({ code: { coding: [{ code: '8867-4' }] } });
    expect(pressure).not.toHaveProperty('subject');
  });

  it('records readings once, as patient-reported events, in the chosen open visit', () => {
    const { snapshot: withPatient, profile } = (() => {
      const created = createPatientProfile({ displayName: 'Тестовый пациент' });
      return {
        snapshot: {
          ...emptyPatientVaultSnapshot(),
          profiles: [created.profile],
          events: created.initialEvents,
          observations: created.initialEvents.flatMap((event) => event.observations),
        },
        profile: created.profile,
      };
    })();
    const episode = createClinicalEpisode({ patientId: profile.id, title: 'Приём' });
    const snapshot = appendEpisode(withPatient, episode);
    const results = bpResults(3);
    const events = diaryImportEvents(results, profile.id, episode.id);
    const first = applyDiaryImport(snapshot, events);
    expect(first).toMatchObject({ added: 3, alreadyPresent: 0 });
    const imported = first.snapshot.events.filter((event) => event.id.startsWith('diary-'));
    expect(imported.every((event) => event.episodeId === episode.id)).toBe(true);
    expect(
      imported
        .flatMap((event) => event.observations)
        .every((item) => item.method === 'Дневник пациента'),
    ).toBe(true);
    expect(imported[0]?.observations.map((item) => item.metricId)).toEqual([
      'blood-pressure-systolic',
      'blood-pressure-diastolic',
      'pulse',
    ]);

    const again = applyDiaryImport(
      first.snapshot,
      diaryImportEvents(results, profile.id, episode.id),
    );
    expect(again).toMatchObject({ added: 0, alreadyPresent: 3 });
    expect(again.snapshot).toBe(first.snapshot);
  });

  it('keeps a missed dose as a note instead of an intake', () => {
    const results = parseDiaryResults(
      {
        v: 1,
        invitation: medicationInvitation,
        entries: [
          { id: 'take0001', at: '2026-09-02T08:00:00Z', medication: 0, taken: true },
          { id: 'miss0001', at: '2026-09-02T20:00:00Z', medication: 0, taken: false },
        ],
      },
      NOW,
    );
    const [taken, missed] = diaryImportEvents(results, 'patient-1');
    expect(taken).toMatchObject({ kind: 'medication', medicationKind: 'take', title: 'Эналаприл' });
    expect(missed).toMatchObject({ kind: 'note', title: 'Пропущен приём: Эналаприл' });
  });
});
