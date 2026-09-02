import { describe, expect, it } from 'vitest';

import {
  ageInYearsOnDate,
  appendEpisode,
  appendEvent,
  appendToolResultIdempotently,
  buildDynamics,
  buildDynamicsGroups,
  calculateAgeOnDate,
  closeClinicalEpisode,
  createClinicalEpisode,
  createLaboratoryEvent,
  createManualMeasurementEvent,
  createPatientProfile,
  createToolResultEvent,
  emptyPatientVaultSnapshot,
  normalizePatientVaultSnapshot,
  type PatientVaultSnapshot,
  patientBindingValue,
  patientContextSnapshot,
  reviseManualObservation,
  selectPatientFromSnapshot,
} from './patient-domain';

describe('patient domain', () => {
  it('creates a separate profile and dated initial measurements', () => {
    const result = createPatientProfile({
      id: 'patient-1',
      displayName: 'Анонимный ребёнок',
      birthDate: '2025-01-01',
      biologicalSex: 'female',
      weightKg: 4.2,
      heightCm: 52,
      createdAt: '2025-02-01T10:00:00.000Z',
    });
    expect(result.profile.id).toBe('patient-1');
    expect(result.initialEvents.map((event) => event.observations[0]?.metricId)).toEqual([
      'body-mass',
      'body-height',
    ]);
  });

  it('adds a second patient without replacing the first patient or its events', () => {
    const first = createPatientProfile({
      id: 'patient-1',
      displayName: 'Первый',
      weightKg: 70,
      createdAt: '2025-01-01T00:00:00.000Z',
    });
    const second = createPatientProfile({
      id: 'patient-2',
      displayName: 'Второй',
      createdAt: '2025-01-02T00:00:00.000Z',
    });
    let snapshot: PatientVaultSnapshot = {
      ...emptyPatientVaultSnapshot(),
      profiles: [first.profile],
    };
    for (const event of first.initialEvents) snapshot = appendEvent(snapshot, event);
    snapshot = { ...snapshot, profiles: [...snapshot.profiles, second.profile] };
    for (const event of second.initialEvents) snapshot = appendEvent(snapshot, event);
    expect(snapshot.profiles.map((profile) => profile.id)).toEqual(['patient-1', 'patient-2']);
    expect(snapshot.events.map((event) => event.patientId)).toEqual(['patient-1']);
    expect(snapshot.observations[0]?.value).toBe(70);
  });

  it('calculates calendar age on the event date', () => {
    expect(calculateAgeOnDate('2020-02-29', '2021-03-01')).toEqual({
      years: 1,
      months: 0,
      days: 0,
    });
    expect(ageInYearsOnDate('2020-01-01', '2021-07-01')).toBeCloseTo(1.5, 2);
    expect(() => calculateAgeOnDate('2021-02-30', '2021-03-01')).toThrow(/некорректн/u);
  });

  it('does not match profiles by display name and uses explicit bindings only', () => {
    const created = createPatientProfile({
      id: 'patient-1',
      displayName: 'Иванов Иван',
      birthDate: '2020-01-01',
      biologicalSex: 'male',
      createdAt: '2025-01-01T00:00:00.000Z',
      weightKg: 20,
    });
    let snapshot = emptyPatientVaultSnapshot();
    snapshot = { ...snapshot, profiles: [created.profile] };
    for (const event of created.initialEvents) snapshot = appendEvent(snapshot, event);
    expect(
      patientBindingValue({ kind: 'biologicalSex' }, created.profile, snapshot, '2025-01-02'),
    ).toBe('male');
    expect(
      patientBindingValue(
        { kind: 'latestObservation', metricId: 'body-mass', unit: 'кг' },
        created.profile,
        snapshot,
        '2025-01-02',
      ),
    ).toBe(20);
    expect(
      patientBindingValue(
        { kind: 'latestObservation', metricId: 'some-name' },
        created.profile,
        snapshot,
        '2025-01-02',
      ),
    ).toBeUndefined();
  });

  it('records a completed result once for an idempotency key and links it to an episode', () => {
    const profile = createPatientProfile({ id: 'patient-1', displayName: 'Тест' }).profile;
    let snapshot: PatientVaultSnapshot = { ...emptyPatientVaultSnapshot(), profiles: [profile] };
    const episode = createClinicalEpisode({
      patientId: profile.id,
      id: 'episode-1',
      startedAt: '2025-01-02T00:00:00.000Z',
    });
    snapshot = appendEpisode(snapshot, episode);
    const input = {
      patientId: profile.id,
      episodeId: episode.id,
      title: 'ИМТ',
      occurredAt: episode.startedAt,
      provenance: {
        toolId: 'bmi',
        toolVersion: '2.0.0',
        definitionVersion: '2.0.0',
        sourceIds: ['source'],
        idempotencyKey: 'result-1',
        normalizedInputs: { weightKg: 20 },
        contextSnapshot: {},
      },
      observations: [
        {
          metricId: 'bmi',
          value: 18,
          unit: 'кг/м²',
          observedAt: episode.startedAt,
          source: { kind: 'tool-result' as const, toolId: 'bmi', toolVersion: '2.0.0' },
        },
      ],
    };
    const first = appendToolResultIdempotently(snapshot, input);
    const second = appendToolResultIdempotently(first.snapshot, input);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.snapshot.events).toHaveLength(1);
    expect(second.snapshot.episodes[0]?.eventIds).toEqual([first.event.id]);
    expect(() =>
      appendToolResultIdempotently(first.snapshot, {
        ...input,
        patientId: 'another-patient',
      }),
    ).toThrow(/другим инструментом или пациентом/u);
  });

  it('keeps revisions and separates incompatible series', () => {
    const profile = createPatientProfile({ id: 'patient-1', displayName: 'Тест' }).profile;
    let snapshot: PatientVaultSnapshot = { ...emptyPatientVaultSnapshot(), profiles: [profile] };
    const event = createManualMeasurementEvent({
      patientId: profile.id,
      id: 'event-1',
      metricId: 'glucose',
      label: 'Глюкоза',
      value: 5,
      unit: 'ммоль/л',
      occurredAt: '2025-01-01T00:00:00.000Z',
    });
    snapshot = appendEvent(snapshot, event);
    const oldObservation = event.observations[0];
    if (!oldObservation) throw new Error('missing observation');
    snapshot = reviseManualObservation(snapshot, oldObservation.id, {
      value: 6,
      unit: 'ммоль/л',
      occurredAt: '2025-01-02T00:00:00.000Z',
    });
    expect(
      snapshot.observations.find((observation) => observation.id === oldObservation.id)
        ?.supersededBy,
    ).toBeDefined();
    expect(snapshot.events.find((candidate) => candidate.id !== event.id)?.revisionOf).toBe(
      event.id,
    );
    expect(() => normalizePatientVaultSnapshot(snapshot)).not.toThrow();
    expect(buildDynamics(snapshot, profile.id)).toHaveLength(1);
  });

  it('preserves the laboratory kind and report range when revising a result', () => {
    const profile = createPatientProfile({ id: 'patient-1', displayName: 'Тест' }).profile;
    const reportRange = { lower: 3.5, upper: 5.5, text: '3,5–5,5 ммоль/л' };
    const event = createLaboratoryEvent({
      patientId: profile.id,
      id: 'lab-event-1',
      metricId: 'glucose',
      label: 'Глюкоза',
      value: 5,
      unit: 'ммоль/л',
      reportRange,
      occurredAt: '2025-01-01T00:00:00.000Z',
    });
    let snapshot: PatientVaultSnapshot = {
      ...emptyPatientVaultSnapshot(),
      profiles: [profile],
    };
    snapshot = appendEvent(snapshot, event);
    const oldObservation = event.observations[0];
    if (!oldObservation) throw new Error('missing observation');

    snapshot = reviseManualObservation(snapshot, oldObservation.id, {
      value: 6,
      occurredAt: '2025-01-02T00:00:00.000Z',
    });

    const revision = snapshot.events.find((candidate) => candidate.revisionOf === event.id);
    const replacement = snapshot.observations.find(
      (observation) => observation.revisionOf === oldObservation.id,
    );
    expect(revision?.kind).toBe('laboratory-result');
    expect(revision?.observations[0]?.source).toEqual({
      kind: 'laboratory',
      label: 'Глюкоза',
      reportRange,
    });
    expect(replacement?.evaluation?.verdict?.title).toBe('Выше диапазона бланка');
    expect(snapshot.events.find((candidate) => candidate.id === event.id)?.supersededBy).toBe(
      revision?.id,
    );
    expect(() => normalizePatientVaultSnapshot(snapshot)).not.toThrow();
  });

  it('revises a manual observation in a closed episode without reopening it', () => {
    const profile = createPatientProfile({ id: 'patient-1', displayName: 'Тест' }).profile;
    let snapshot: PatientVaultSnapshot = { ...emptyPatientVaultSnapshot(), profiles: [profile] };
    const episode = createClinicalEpisode({
      patientId: profile.id,
      id: 'episode-1',
      startedAt: '2025-01-01T00:00:00.000Z',
    });
    snapshot = appendEpisode(snapshot, episode);
    const event = createManualMeasurementEvent({
      patientId: profile.id,
      episodeId: episode.id,
      id: 'event-1',
      metricId: 'glucose',
      label: 'Глюкоза',
      value: 5,
      unit: 'ммоль/л',
      occurredAt: '2025-01-01T00:30:00.000Z',
    });
    snapshot = appendEvent(snapshot, event);
    snapshot = closeClinicalEpisode(snapshot, episode.id, '2025-01-01T01:00:00.000Z');
    const oldObservation = snapshot.observations.find(
      (observation) => observation.eventId === event.id,
    );
    if (!oldObservation) throw new Error('missing observation');

    expect(() =>
      appendEvent(
        snapshot,
        createManualMeasurementEvent({
          patientId: profile.id,
          episodeId: episode.id,
          id: 'event-after-close',
          metricId: 'glucose',
          label: 'Глюкоза',
          value: 6,
          unit: 'ммоль/л',
          occurredAt: '2025-01-01T02:00:00.000Z',
        }),
      ),
    ).toThrow(/закрытый осмотр/u);

    snapshot = reviseManualObservation(snapshot, oldObservation.id, {
      value: 6,
      occurredAt: '2025-01-01T02:00:00.000Z',
    });
    const revision = snapshot.events.find((candidate) => candidate.revisionOf === event.id);
    const closedEpisode = snapshot.episodes.find((candidate) => candidate.id === episode.id);
    expect(closedEpisode?.status).toBe('closed');
    expect(closedEpisode?.closedAt).toBe('2025-01-01T01:00:00.000Z');
    expect(closedEpisode?.eventIds).toEqual([event.id, revision?.id]);
    expect(revision?.episodeId).toBe(episode.id);
    expect(() => normalizePatientVaultSnapshot(snapshot)).not.toThrow();
  });

  it('keeps a completed tool event even when it has no graphable numeric observation', () => {
    const profile = createPatientProfile({ id: 'patient-1', displayName: 'Тест' }).profile;
    const snapshot = appendToolResultIdempotently(
      { ...emptyPatientVaultSnapshot(), profiles: [profile] },
      {
        patientId: profile.id,
        title: 'Конвертер единиц',
        provenance: {
          toolId: 'unit-conversion',
          toolVersion: '2.0.0',
          definitionVersion: '2.0.0',
          sourceIds: [],
          idempotencyKey: 'conversion-1',
          normalizedInputs: { value: 1 },
          contextSnapshot: {},
        },
        observations: [],
      },
    );
    expect(snapshot.created).toBe(true);
    expect(snapshot.event.observations).toEqual([]);
    expect(normalizePatientVaultSnapshot(snapshot.snapshot).events).toHaveLength(1);
  });

  it('keeps immutable source snapshots in both provenance and evaluation', () => {
    const profile = createPatientProfile({ id: 'patient-1', displayName: 'Тест' }).profile;
    const source = {
      id: 'source-1',
      title: 'Primary source',
      documentId: 'document-1',
      url: 'https://example.test/source-1',
    };
    const occurredAt = '2025-01-01T00:00:00.000Z';
    const event = createToolResultEvent({
      id: 'event-source-snapshot',
      patientId: profile.id,
      title: 'Результат инструмента',
      occurredAt,
      provenance: {
        toolId: 'tool-1',
        toolVersion: '1.0.0',
        definitionVersion: '1.0.0',
        sourceIds: [source.id],
        sourceLinks: [source],
        idempotencyKey: 'result-source-snapshot',
        normalizedInputs: { value: 1 },
        contextSnapshot: {},
      },
      observations: [
        {
          metricId: 'metric-1',
          value: 1,
          unit: 'ед.',
          observedAt: occurredAt,
          source: { kind: 'tool-result', toolId: 'tool-1', toolVersion: '1.0.0' },
          evaluation: {
            status: 'unavailable',
            reason: 'Нет заявленного диапазона.',
            missingContext: [],
            sourceIds: [source.id],
            sourceLinks: [source],
            context: {},
            capturedAt: occurredAt,
          },
        },
      ],
    });
    const normalized = normalizePatientVaultSnapshot(
      appendEvent({ ...emptyPatientVaultSnapshot(), profiles: [profile] }, event),
    );
    expect(normalized.events[0]?.provenance?.sourceLinks).toEqual([source]);
    expect(normalized.observations[0]?.evaluation?.sourceLinks).toEqual([source]);
  });

  it('rejects unsafe source URLs at the patient backup normalization boundary', () => {
    const profile = createPatientProfile({ id: 'patient-1', displayName: 'Тест' }).profile;
    const safeSource = {
      id: 'source-1',
      title: 'Primary source',
      documentId: 'document-1',
      url: 'https://example.test/source-1',
    };
    for (const url of ['javascript:alert(1)', 'data:text/html,alert(1)']) {
      const source = { ...safeSource, url };
      const event = createToolResultEvent({
        id: `event-unsafe-${url.startsWith('data:') ? 'data' : 'javascript'}`,
        patientId: profile.id,
        title: 'Результат инструмента',
        provenance: {
          toolId: 'tool-1',
          toolVersion: '1.0.0',
          definitionVersion: '1.0.0',
          sourceIds: [source.id],
          sourceLinks: [source],
          idempotencyKey: `unsafe-${url}`,
          normalizedInputs: { value: 1 },
          contextSnapshot: {},
        },
        observations: [
          {
            metricId: 'metric-1',
            value: 1,
            unit: 'ед.',
            observedAt: '2025-01-01T00:00:00.000Z',
            source: { kind: 'tool-result' as const, toolId: 'tool-1', toolVersion: '1.0.0' },
            evaluation: {
              status: 'unavailable' as const,
              reason: 'Нет заявленного диапазона.',
              sourceIds: [source.id],
              sourceLinks: [source],
              context: {},
              capturedAt: '2025-01-01T00:00:00.000Z',
            },
          },
        ],
      });
      expect(() =>
        normalizePatientVaultSnapshot(
          appendEvent({ ...emptyPatientVaultSnapshot(), profiles: [profile] }, event),
        ),
      ).toThrow(/http или https/u);
    }
  });

  it('does not append a result to a closed or legacy closed episode', () => {
    const profile = createPatientProfile({ id: 'patient-1', displayName: 'Тест' }).profile;
    let snapshot: PatientVaultSnapshot = { ...emptyPatientVaultSnapshot(), profiles: [profile] };
    const episode = createClinicalEpisode({
      patientId: profile.id,
      id: 'episode-1',
      startedAt: '2025-01-02T00:00:00.000Z',
    });
    snapshot = appendEpisode(snapshot, episode);
    snapshot = closeClinicalEpisode(snapshot, episode.id, '2025-01-02T01:00:00.000Z');
    expect(snapshot.episodes[0]?.status).toBe('closed');
    expect(() =>
      appendToolResultIdempotently(snapshot, {
        patientId: profile.id,
        episodeId: episode.id,
        title: 'Результат после закрытия',
        occurredAt: '2025-01-02T02:00:00.000Z',
        provenance: {
          toolId: 'tool',
          toolVersion: '1',
          definitionVersion: '1',
          sourceIds: [],
          idempotencyKey: 'closed-episode-result',
          normalizedInputs: {},
          contextSnapshot: {},
        },
        observations: [],
      }),
    ).toThrow(/закрытый осмотр/u);
    expect(() =>
      normalizePatientVaultSnapshot({
        schemaVersion: 2,
        profiles: [profile],
        episodes: [
          {
            ...episode,
            status: undefined,
          },
        ],
        events: [],
        observations: [],
      }),
    ).not.toThrow();
  });

  it('starts a new manual metric version when its unit changes', () => {
    const profile = createPatientProfile({ id: 'patient-1', displayName: 'Тест' }).profile;
    let snapshot: PatientVaultSnapshot = { ...emptyPatientVaultSnapshot(), profiles: [profile] };
    snapshot = appendEvent(
      snapshot,
      createManualMeasurementEvent({
        patientId: profile.id,
        metricId: 'custom-marker',
        label: 'Показатель',
        value: 1,
        unit: 'единица A',
      }),
    );
    snapshot = appendEvent(
      snapshot,
      createManualMeasurementEvent({
        patientId: profile.id,
        metricId: 'custom-marker',
        label: 'Показатель',
        value: 2,
        unit: 'единица B',
      }),
    );
    const versions = snapshot.observations.map((observation) =>
      observation.source.kind === 'manual' ? observation.source.metricVersion : '',
    );
    expect(versions).toEqual(['1', '2']);
    expect(buildDynamics(snapshot, profile.id)).toHaveLength(2);
    expect(snapshot.metricDefinitions.map((definition) => definition.kind)).toEqual([
      'custom',
      'custom',
    ]);
  });

  it('groups blood pressure together while keeping pulse in its own chart', () => {
    const profile = createPatientProfile({ id: 'patient-1', displayName: 'Тест' }).profile;
    let snapshot: PatientVaultSnapshot = { ...emptyPatientVaultSnapshot(), profiles: [profile] };
    for (const input of [
      {
        metricId: 'blood-pressure-systolic',
        label: 'Давление: систолическое',
        value: 120,
        unit: 'мм рт. ст.',
      },
      {
        metricId: 'blood-pressure-diastolic',
        label: 'Давление: диастолическое',
        value: 80,
        unit: 'мм рт. ст.',
      },
      { metricId: 'pulse', label: 'Пульс', value: 72, unit: 'уд/мин' },
    ]) {
      snapshot = appendEvent(
        snapshot,
        createManualMeasurementEvent({ patientId: profile.id, ...input }),
      );
    }
    const groups = buildDynamicsGroups(snapshot, profile.id);
    expect(groups.find((group) => group.metricId === 'blood-pressure')?.series).toHaveLength(2);
    expect(groups.find((group) => group.metricId === 'pulse')?.series).toHaveLength(1);
  });

  it('keeps compatible sources for one metric in one chart group', () => {
    const profile = createPatientProfile({ id: 'patient-1', displayName: 'Тест' }).profile;
    let snapshot: PatientVaultSnapshot = { ...emptyPatientVaultSnapshot(), profiles: [profile] };
    for (const event of [
      createManualMeasurementEvent({
        patientId: profile.id,
        metricId: 'pulse',
        label: 'Пульс',
        value: 72,
        unit: 'уд/мин',
        occurredAt: '2026-08-29T10:00:00.000Z',
      }),
      createManualMeasurementEvent({
        patientId: profile.id,
        metricId: 'pulse',
        label: 'Пульс',
        value: 76,
        unit: 'уд/мин',
        occurredAt: '2026-08-30T10:00:00.000Z',
      }),
    ]) {
      snapshot = appendEvent(snapshot, event);
    }
    const pulse = buildDynamicsGroups(snapshot, profile.id).find(
      (group) => group.metricId === 'pulse',
    );
    expect(pulse?.series).toHaveLength(1);
    expect(pulse?.series[0]?.observations).toHaveLength(2);
  });

  it('evaluates a laboratory result only against the supplied report range', () => {
    const event = createLaboratoryEvent({
      patientId: 'patient-1',
      metricId: 'glucose',
      label: 'Глюкоза',
      value: 6,
      unit: 'ммоль/л',
      reportRange: { lower: 3.5, upper: 5.5, text: '3,5–5,5 ммоль/л' },
    });
    expect(event.observations[0]?.evaluation?.verdict?.title).toBe('Выше диапазона бланка');
    expect(event.observations[0]?.source).toMatchObject({
      kind: 'laboratory',
      reportRange: { lower: 3.5, upper: 5.5 },
    });
  });

  it('returns a context snapshot with the latest weight and age', () => {
    const created = createPatientProfile({
      id: 'patient-1',
      displayName: 'Тест',
      birthDate: '2020-01-01',
      context: { carePath: 'наблюдение' },
      weightKg: 20,
      createdAt: '2025-01-01T00:00:00.000Z',
    });
    let snapshot: PatientVaultSnapshot = {
      ...emptyPatientVaultSnapshot(),
      profiles: [created.profile],
    };
    for (const event of created.initialEvents) snapshot = appendEvent(snapshot, event);
    expect(patientContextSnapshot(created.profile, snapshot, '2025-01-01')).toMatchObject({
      birthDate: '2020-01-01',
      weightKg: 20,
      carePath: 'наблюдение',
    });
  });

  it('does not use a measurement recorded after the event date', () => {
    const profile = createPatientProfile({ id: 'patient-1', displayName: 'Тест' }).profile;
    let snapshot: PatientVaultSnapshot = { ...emptyPatientVaultSnapshot(), profiles: [profile] };
    snapshot = appendEvent(
      snapshot,
      createManualMeasurementEvent({
        patientId: profile.id,
        metricId: 'body-mass',
        label: 'Масса тела',
        value: 20,
        unit: 'кг',
        occurredAt: '2025-01-01T00:00:00.000Z',
      }),
    );
    snapshot = appendEvent(
      snapshot,
      createManualMeasurementEvent({
        patientId: profile.id,
        metricId: 'body-mass',
        label: 'Масса тела',
        value: 21,
        unit: 'кг',
        occurredAt: '2025-02-01T00:00:00.000Z',
      }),
    );
    expect(patientContextSnapshot(profile, snapshot, '2025-01-15')).toMatchObject({
      weightKg: 20,
    });
  });

  it('exports only the explicitly selected patient', () => {
    const first = createPatientProfile({ id: 'patient-1', displayName: 'Первый' });
    const second = createPatientProfile({ id: 'patient-2', displayName: 'Второй' });
    let snapshot: PatientVaultSnapshot = {
      ...emptyPatientVaultSnapshot(),
      profiles: [first.profile, second.profile],
    };
    const event = createManualMeasurementEvent({
      patientId: first.profile.id,
      metricId: 'pulse',
      label: 'Пульс',
      value: 72,
      unit: 'уд/мин',
      id: 'event-1',
    });
    snapshot = appendEvent(snapshot, event);
    const selected = selectPatientFromSnapshot(snapshot, first.profile.id);
    expect(selected.profiles.map((profile) => profile.id)).toEqual(['patient-1']);
    expect(selected.events.map((candidate) => candidate.id)).toEqual(['event-1']);
    expect(selected.observations[0]?.patientId).toBe('patient-1');
    expect(() => selectPatientFromSnapshot(snapshot, 'missing')).toThrow(/Пациент не найден/u);
    expect(second.profile.id).toBe('patient-2');
  });

  it('rejects an evaluation verdict without a structured verdict and broken event links', () => {
    const profile = createPatientProfile({ id: 'patient-1', displayName: 'Тест' }).profile;
    const event = createManualMeasurementEvent({
      patientId: profile.id,
      metricId: 'pulse',
      label: 'Пульс',
      value: 72,
      unit: 'уд/мин',
      id: 'event-1',
    });
    const observation = event.observations[0];
    if (!observation) throw new Error('missing observation');
    expect(() =>
      normalizePatientVaultSnapshot({
        schemaVersion: 2,
        profiles: [profile],
        episodes: [],
        events: [
          {
            ...event,
            observations: [
              {
                ...observation,
                evaluation: {
                  status: 'verdict',
                  context: {},
                  capturedAt: event.occurredAt,
                },
              },
            ],
          },
        ],
        observations: [
          {
            ...observation,
            evaluation: {
              status: 'verdict',
              context: {},
              capturedAt: event.occurredAt,
            },
          },
        ],
      }),
    ).toThrow(/структурированный вердикт/u);
  });
});
