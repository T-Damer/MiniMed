/** Actual schema-2 patient operations on synthetic fixtures; UUIDs are captured, never invented. */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import * as patient from '@localmed/app/state/patient-domain';
import { REPOSITORY_ROOT } from '@localmed/benchmarks/real-corpus';

type FunctionName = Exclude<
  keyof typeof patient,
  'PATIENT_DOMAIN_SCHEMA_VERSION' | 'PATIENT_METRIC_REGISTRY'
>;
type Row = {
  name: string;
  operation: FunctionName;
  args: unknown[];
  uuids: string[];
  clockValues: string[];
  result: unknown;
  error: string | null;
};
const rows: Row[] = [];
const at = '2025-01-02T00:00:00.000Z';
const originalUuid = crypto.randomUUID.bind(crypto);
let uuidStream: string[] = [];
crypto.randomUUID = () => {
  const value = originalUuid();
  uuidStream.push(value);
  return value;
};
function encoded(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, entry: unknown) =>
      typeof entry === 'number' && !Number.isFinite(entry)
        ? { $number: String(entry) }
        : entry === undefined
          ? { $undefined: true }
          : entry,
    ),
  );
}
function capture<T>(
  name: string,
  operation: FunctionName,
  args: unknown[],
  run: () => T,
  clock?: (value: T) => string[],
): T | undefined {
  uuidStream = [];
  let result: T | undefined;
  let error: string | null = null;
  try {
    result = run();
  } catch (cause) {
    if (!(cause instanceof Error)) throw cause;
    error = cause.message;
  }
  rows.push({
    name,
    operation,
    args: encoded(args) as unknown[],
    uuids: [...uuidStream],
    clockValues: result === undefined ? [] : (clock?.(result) ?? []),
    result: encoded(result),
    error,
  });
  return result;
}
function success<T>(
  name: string,
  operation: FunctionName,
  args: unknown[],
  run: () => T,
  clock?: (value: T) => string[],
): T {
  const result = capture(name, operation, args, run, clock);
  if (result === undefined) throw new Error(`Fixture failed: ${name}`);
  return result;
}
function normalize(name: string, value: unknown) {
  return capture(name, 'normalizePatientVaultSnapshot', [value], () =>
    patient.normalizePatientVaultSnapshot(value),
  );
}
function clone<T>(value: T): T {
  return structuredClone(value);
}
try {
  let snapshot = success(
    'empty',
    'emptyPatientVaultSnapshot',
    [],
    patient.emptyPatientVaultSnapshot,
  );
  const input = {
    id: 'patient-1',
    displayName: ' Анонимный ребёнок ',
    birthDate: '2020-02-29',
    biologicalSex: 'female' as const,
    weightKg: 20,
    heightCm: 110,
    createdAt: at,
    context: { custom: 'снимок', score: 3 },
    avatar: { kind: 'symbol' as const, value: ' 👩‍⚕️ ' },
  };
  const first = success('profile-initial-measurements', 'createPatientProfile', [input], () =>
    patient.createPatientProfile(input),
  );
  const secondInput = { id: 'patient-2', displayName: input.displayName, createdAt: at };
  const second = success('same-name-separate-id', 'createPatientProfile', [secondInput], () =>
    patient.createPatientProfile(secondInput),
  );
  snapshot = { ...snapshot, profiles: [first.profile, second.profile] };
  for (const event of first.initialEvents)
    snapshot = success(
      `append-${event.observations[0]?.metricId}`,
      'appendEvent',
      [snapshot, event],
      () => patient.appendEvent(snapshot, event),
    );
  for (const value of [
    '2024-02-29',
    '2023-02-29',
    '0099-01-01',
    '0000-01-01',
    '2025-01-01T23:30:00+03:00',
    '2025-01-01T24:00:00Z',
    '2025-01-01T24:01:00Z',
    '+010000-01-01T00:00:00Z',
    '-000001-01-01T00:00:00Z',
    '2025-13-01',
    '2025-01-00',
    '2025-01-32',
    '2025-01',
    '2025',
    '01/02/2025',
    'Thu, 02 Jan 2025 00:00:00 GMT',
    'January 2, 2025',
    'not a date',
  ]) {
    const dateInput = { id: 'date-probe', displayName: 'Синтетическая дата', createdAt: value };
    capture(`date-parser-${value}`, 'createPatientProfile', [dateInput], () =>
      patient.createPatientProfile(dateInput),
    );
  }
  const generatedInput = { displayName: 'Тестовый профиль' };
  success(
    'generated-profile-id-clock',
    'createPatientProfile',
    [generatedInput],
    () => patient.createPatientProfile(generatedInput),
    (value) => [value.profile.createdAt],
  );
  for (const [birth, event] of [
    ['2020-02-29', '2021-03-01'],
    ['2020-01-31', '2020-03-01'],
    ['2000-02-29', '2024-02-29'],
    ['2020-01-01', '2021-07-15'],
    ['2021-02-30', '2021-03-01'],
    ['2025-01-01', '2024-01-01'],
    ['0099-01-01', '2025-01-01'],
    ['2020-01-01T23:00:00-03:00', '2025-01-01T00:00:00Z'],
  ] as const) {
    capture(`calendar-age-${birth}-${event}`, 'calculateAgeOnDate', [birth, event], () =>
      patient.calculateAgeOnDate(birth, event),
    );
    capture(`fractional-age-${birth}-${event}`, 'ageInYearsOnDate', [birth, event], () =>
      patient.ageInYearsOnDate(birth, event),
    );
  }
  const episodeInput = {
    id: 'episode-1',
    patientId: first.profile.id,
    title: ' ',
    text: ' Контекст осмотра ',
    startedAt: at,
  };
  const episode = success('episode', 'createClinicalEpisode', [episodeInput], () =>
    patient.createClinicalEpisode(episodeInput),
  );
  snapshot = success('append-episode', 'appendEpisode', [snapshot, episode], () =>
    patient.appendEpisode(snapshot, episode),
  );
  capture('append-episode-idempotent', 'appendEpisode', [snapshot, episode], () =>
    patient.appendEpisode(snapshot, episode),
  );
  capture(
    'episode-foreign-patient',
    'appendEpisode',
    [snapshot, { ...episode, id: 'foreign', patientId: 'missing' }],
    () => patient.appendEpisode(snapshot, { ...episode, id: 'foreign', patientId: 'missing' }),
  );
  const measurement = {
    id: 'manual-1',
    patientId: first.profile.id,
    episodeId: episode.id,
    metricId: 'glucose',
    label: 'Глюкоза',
    value: 5,
    unit: 'ммоль/л',
    method: 'натощак',
    occurredAt: at,
  };
  const manual = success('manual', 'createManualMeasurementEvent', [measurement], () =>
    patient.createManualMeasurementEvent(measurement),
  );
  snapshot = success('append-manual', 'appendEvent', [snapshot, manual], () =>
    patient.appendEvent(snapshot, manual),
  );
  capture('append-event-idempotent', 'appendEvent', [snapshot, manual], () =>
    patient.appendEvent(snapshot, manual),
  );
  const observationId = manual.observations[0]?.id;
  if (!observationId) throw new Error('Fixture observation missing');
  const revisedInput = { value: 6, occurredAt: '2025-01-03T00:00:00.000Z' };
  snapshot = success(
    'manual-revision',
    'reviseManualObservation',
    [snapshot, observationId, revisedInput],
    () => patient.reviseManualObservation(snapshot, observationId, revisedInput),
  );
  capture(
    'already-revised',
    'reviseManualObservation',
    [snapshot, observationId, revisedInput],
    () => patient.reviseManualObservation(snapshot, observationId, revisedInput),
  );
  capture('missing-revision', 'reviseManualObservation', [snapshot, 'missing', revisedInput], () =>
    patient.reviseManualObservation(snapshot, 'missing', revisedInput),
  );
  for (const [index, unit, value, method] of [
    [0, 'мг/дл', 90, 'натощак'],
    [1, 'ммоль/л', 4, 'после еды'],
  ] as const) {
    const entry = { ...measurement, id: `manual-split-${index}`, unit, value, method };
    const event = success(`unit-method-${index}`, 'createManualMeasurementEvent', [entry], () =>
      patient.createManualMeasurementEvent(entry),
    );
    snapshot = success(`append-unit-method-${index}`, 'appendEvent', [snapshot, event], () =>
      patient.appendEvent(snapshot, event),
    );
  }
  const provenance: patient.ToolResultProvenance = {
    toolId: 'bmi',
    toolVersion: '2.0.0',
    definitionVersion: '2.0.0',
    sourceIds: ['source'],
    sourceLinks: [
      {
        id: 'source',
        title: 'Исходный источник',
        moduleId: 'module',
        documentId: 'doc',
        url: 'https://example.test/source',
      },
    ],
    idempotencyKey: 'result-1',
    normalizedInputs: { weightKg: 20 },
    contextSnapshot: { ageYears: 4, biologicalSex: 'female' },
  };
  const toolInput = {
    patientId: first.profile.id,
    episodeId: episode.id,
    title: 'ИМТ',
    occurredAt: at,
    provenance,
    observations: [
      {
        metricId: 'bmi',
        value: 18,
        unit: 'кг/м²',
        observedAt: at,
        source: { kind: 'tool-result' as const, toolId: 'bmi', toolVersion: '2.0.0' },
        evaluation: {
          status: 'missing-context' as const,
          missingContext: ['ageMonths'],
          context: { ageYears: 4 },
          capturedAt: at,
          ...(provenance.sourceLinks ? { sourceLinks: provenance.sourceLinks } : {}),
        },
      },
    ],
  };
  const appended = success(
    'tool-result-once',
    'appendToolResultIdempotently',
    [snapshot, toolInput],
    () => patient.appendToolResultIdempotently(snapshot, toolInput),
  );
  snapshot = appended.snapshot;
  capture('tool-result-repeat', 'appendToolResultIdempotently', [snapshot, toolInput], () =>
    patient.appendToolResultIdempotently(snapshot, toolInput),
  );
  for (const [key, value] of [
    ['patientId', 'patient-2'],
    ['toolId', 'other'],
    ['toolVersion', '3'],
    ['definitionVersion', '3'],
  ] as const) {
    const changed =
      key === 'patientId'
        ? { ...toolInput, patientId: value }
        : { ...toolInput, provenance: { ...provenance, [key]: value } };
    capture(
      `idempotency-conflict-${key}`,
      'appendToolResultIdempotently',
      [snapshot, changed],
      () => patient.appendToolResultIdempotently(snapshot, changed),
    );
  }
  const immutableId = appended.event.observations[0]?.id;
  if (!immutableId) throw new Error('Tool observation missing');
  capture(
    'immutable-tool-revision',
    'reviseManualObservation',
    [snapshot, immutableId, revisedInput],
    () => patient.reviseManualObservation(snapshot, immutableId, revisedInput),
  );
  const textOnly = {
    ...toolInput,
    id: 'text-only',
    provenance: { ...provenance, idempotencyKey: 'text-only' },
    observations: [],
  };
  const textEvent = success(
    'tool-without-numeric-output',
    'createToolResultEvent',
    [textOnly],
    () => patient.createToolResultEvent(textOnly),
  );
  snapshot = success('append-text-only-result', 'appendEvent', [snapshot, textEvent], () =>
    patient.appendEvent(snapshot, textEvent),
  );
  const secondVersion = {
    ...toolInput,
    id: 'tool-version-3',
    provenance: { ...provenance, toolVersion: '3', idempotencyKey: 'version3' },
    observations: toolInput.observations.map((o) => ({
      ...o,
      source: { ...o.source, toolVersion: '3' },
    })),
  };
  const versionEvent = success('tool-version-split', 'createToolResultEvent', [secondVersion], () =>
    patient.createToolResultEvent(secondVersion),
  );
  snapshot = success('append-tool-version-split', 'appendEvent', [snapshot, versionEvent], () =>
    patient.appendEvent(snapshot, versionEvent),
  );
  for (const [index, range] of [
    undefined,
    { text: 'Качественное описание' },
    { lower: 4, upper: 6 },
    { lower: 5, upper: 6, lowerInclusive: false, text: 'Диапазон бланка' },
  ].entries()) {
    const entry = {
      ...measurement,
      id: `lab-${index}`,
      label: 'Лабораторная глюкоза',
      ...(range ? { reportRange: range } : {}),
    };
    const event = success(`lab-report-${index}`, 'createLaboratoryEvent', [entry], () =>
      patient.createLaboratoryEvent(entry),
    );
    snapshot = success(`append-lab-${index}`, 'appendEvent', [snapshot, event], () =>
      patient.appendEvent(snapshot, event),
    );
    if (index === 2) {
      const id = event.observations[0]?.id;
      if (!id) throw new Error('Lab observation missing');
      snapshot = success(
        'lab-revision-preserves-range',
        'reviseManualObservation',
        [snapshot, id, revisedInput],
        () => patient.reviseManualObservation(snapshot, id, revisedInput),
      );
    }
  }
  for (const kind of ['start', 'take', 'dose-change', 'stop'] as const) {
    const input = {
      id: `medication-${kind}`,
      patientId: first.profile.id,
      episodeId: episode.id,
      occurredAt: at,
      title: ' Назначение из записи ',
      text: ' Исходная запись ',
      medicationKind: kind,
    };
    const event = success(`medication-${kind}`, 'createMedicationEvent', [input], () =>
      patient.createMedicationEvent(input),
    );
    snapshot = success(`append-medication-${kind}`, 'appendEvent', [snapshot, event], () =>
      patient.appendEvent(snapshot, event),
    );
  }
  for (const metricId of ['blood-pressure-systolic', 'blood-pressure-diastolic', 'pulse']) {
    const entry = {
      ...measurement,
      id: metricId,
      metricId,
      label: metricId,
      value: 80,
      unit: metricId === 'pulse' ? 'уд/мин' : 'мм рт. ст.',
    };
    const event = success(`pressure-${metricId}`, 'createManualMeasurementEvent', [entry], () =>
      patient.createManualMeasurementEvent(entry),
    );
    snapshot = success(`append-pressure-${metricId}`, 'appendEvent', [snapshot, event], () =>
      patient.appendEvent(snapshot, event),
    );
  }
  success('normalize-complete', 'normalizePatientVaultSnapshot', [snapshot], () =>
    patient.normalizePatientVaultSnapshot(snapshot),
  );
  success(
    'dynamics-source-unit-method-version',
    'buildDynamics',
    [snapshot, first.profile.id],
    () => patient.buildDynamics(snapshot, first.profile.id),
  );
  success('dynamics-pressure-groups', 'buildDynamicsGroups', [snapshot, first.profile.id], () =>
    patient.buildDynamicsGroups(snapshot, first.profile.id),
  );
  for (const observation of snapshot.observations)
    success(`series-${observation.id}`, 'observationSeriesKey', [observation], () =>
      patient.observationSeriesKey(observation),
    );
  for (const date of [undefined, at, '2024-01-01', 'invalid'])
    capture(
      `latest-as-of-${date}`,
      'latestObservation',
      [snapshot, first.profile.id, 'body-mass', 'кг', date],
      () => patient.latestObservation(snapshot, first.profile.id, 'body-mass', 'кг', date),
    );
  success(
    'patient-context',
    'patientContextSnapshot',
    [first.profile, snapshot, '2025-01-03'],
    () => patient.patientContextSnapshot(first.profile, snapshot, '2025-01-03'),
  );
  for (const binding of [
    { kind: 'birthDate' },
    { kind: 'dateOfBirth' },
    { kind: 'biologicalSex' },
    { kind: 'ageAtEvent' },
    { kind: 'latestObservation', metricId: 'body-mass', unit: 'кг' },
    { kind: 'latestObservation', metricId: 'body-mass', unit: 'г' },
    { kind: 'latestObservation', metricId: 'body-mass', unit: 'кг', maxAgeDays: 0 },
    { kind: 'latestObservation', metricId: 'body-mass', unit: 'кг', maxAgeDays: 1 },
    { kind: 'latestObservation', metricId: 'missing' },
    { kind: 'latestObservation' },
  ] as const)
    capture(
      `binding-${JSON.stringify(binding)}`,
      'patientBindingValue',
      [binding, first.profile, snapshot, '2025-01-03'],
      () => patient.patientBindingValue(binding, first.profile, snapshot, '2025-01-03'),
    );
  capture(
    'binding-missing-birth',
    'patientBindingValue',
    [{ kind: 'ageAtEvent' }, second.profile, snapshot, at],
    () => patient.patientBindingValue({ kind: 'ageAtEvent' }, second.profile, snapshot, at),
  );
  success('select-one-patient', 'selectPatientFromSnapshot', [snapshot, first.profile.id], () =>
    patient.selectPatientFromSnapshot(snapshot, first.profile.id),
  );
  success('remove-one-patient', 'removePatientFromSnapshot', [snapshot, first.profile.id], () =>
    patient.removePatientFromSnapshot(snapshot, first.profile.id),
  );
  capture('select-missing', 'selectPatientFromSnapshot', [snapshot, 'missing'], () =>
    patient.selectPatientFromSnapshot(snapshot, 'missing'),
  );
  capture('remove-missing', 'removePatientFromSnapshot', [snapshot, 'missing'], () =>
    patient.removePatientFromSnapshot(snapshot, 'missing'),
  );
  for (const [name, changed] of [
    ['unknown-patient', { ...manual, id: 'foreign-patient-event', patientId: 'missing' }],
    ['foreign-episode-patient', { ...manual, id: 'foreign-episode-event', patientId: 'patient-2' }],
    [
      'duplicate-observation-id',
      {
        ...manual,
        id: 'duplicate-observation-event',
        observations: manual.observations.map((o) => ({
          ...o,
          eventId: 'duplicate-observation-event',
        })),
      },
    ],
    [
      'wrong-observation-owner',
      {
        ...manual,
        id: 'wrong-owner',
        observations: manual.observations.map((o) => ({
          ...o,
          id: 'other-observation',
          eventId: 'wrong-owner',
          patientId: 'patient-2',
        })),
      },
    ],
  ] as const)
    capture(name, 'appendEvent', [snapshot, changed], () => patient.appendEvent(snapshot, changed));
  for (const label of ['Показатель 🧪', '\ud800']) {
    const entry = { ...measurement, id: 'unicode-event', label, unit: 'µg/м²' };
    const event = success(`unicode-create-${label}`, 'createManualMeasurementEvent', [entry], () =>
      patient.createManualMeasurementEvent(entry),
    );
    capture(`unicode-append-${label}`, 'appendEvent', [snapshot, event], () =>
      patient.appendEvent(snapshot, event),
    );
  }
  const radixVersionState = {
    ...snapshot,
    metricDefinitions: [
      {
        id: 'synthetic-definition',
        metricId: 'glucose',
        label: 'Глюкоза',
        unit: 'unused',
        metricVersion: '0x2',
        kind: 'custom' as const,
        createdAt: at,
      },
    ],
  };
  const versionInput = { ...measurement, id: 'radix-version-event', unit: 'g/L' };
  const radixEvent = success(
    'create-next-version-radix',
    'createManualMeasurementEvent',
    [versionInput],
    () => patient.createManualMeasurementEvent(versionInput),
  );
  success('next-version-js-number', 'appendEvent', [radixVersionState, radixEvent], () =>
    patient.appendEvent(radixVersionState, radixEvent),
  );
  for (const range of [
    { lower: 6, upper: 4 },
    { lower: NaN },
    { upper: Infinity },
    { lowerInclusive: 'yes' },
    { text: '' },
  ]) {
    const changed = clone(snapshot);
    const o = changed.observations.find((o) => o.source.kind === 'laboratory');
    if (!o) throw new Error('Synthetic lab missing');
    const replacement = {
      ...o,
      source: { kind: 'laboratory', label: 'Лабораторная глюкоза', reportRange: range },
    };
    normalize(`invalid-report-range-${JSON.stringify(encoded(range))}`, {
      ...changed,
      observations: changed.observations.map((item) => (item.id === o.id ? replacement : item)),
      events: changed.events.map((e) => ({
        ...e,
        observations: e.observations.map((item) => (item.id === o.id ? replacement : item)),
      })),
    });
  }
  {
    const changed = clone(snapshot);
    const o = changed.observations.find((o) => o.evaluation?.status === 'verdict');
    if (!o?.evaluation?.verdict) throw new Error('Synthetic verdict missing');
    const replacement = {
      ...o,
      evaluation: {
        ...o.evaluation,
        verdict: {
          ...o.evaluation.verdict,
          originalSourceClaim: 'синтетическое исходное поле',
          sourceCoordinates: { page: 3 },
        },
      },
    };
    normalize('verdict-preserves-unrecognised-original-fields', {
      ...changed,
      observations: changed.observations.map((item) => (item.id === o.id ? replacement : item)),
      events: changed.events.map((e) => ({
        ...e,
        observations: e.observations.map((item) => (item.id === o.id ? replacement : item)),
      })),
    });
  }
  const closed = success(
    'close-episode',
    'closeClinicalEpisode',
    [snapshot, episode.id, '2025-01-04'],
    () => patient.closeClinicalEpisode(snapshot, episode.id, '2025-01-04'),
  );
  capture('close-missing', 'closeClinicalEpisode', [snapshot, 'missing', at], () =>
    patient.closeClinicalEpisode(snapshot, 'missing', at),
  );
  capture(
    'closed-rejects-new-event',
    'appendEvent',
    [closed, { ...manual, id: 'new-closed' }],
    () => patient.appendEvent(closed, { ...manual, id: 'new-closed' }),
  );
  const current = closed.observations.find(
    (o) =>
      o.source.kind === 'manual' &&
      !o.supersededBy &&
      closed.events.find((e) => e.id === o.eventId)?.episodeId === episode.id,
  );
  if (!current) throw new Error('Current manual missing');
  success(
    'closed-manual-revision-keeps-closed',
    'reviseManualObservation',
    [closed, current.id, { value: 7, occurredAt: '2025-01-05' }],
    () =>
      patient.reviseManualObservation(closed, current.id, { value: 7, occurredAt: '2025-01-05' }),
  );
  for (const [name, mutate] of [
    [
      'duplicate-profile',
      (s: patient.PatientVaultSnapshot) => ({ ...s, profiles: [...s.profiles, s.profiles[0]] }),
    ],
    [
      'duplicate-event',
      (s: patient.PatientVaultSnapshot) => ({ ...s, events: [...s.events, s.events[0]] }),
    ],
    [
      'duplicate-observation',
      (s: patient.PatientVaultSnapshot) => ({
        ...s,
        observations: [...s.observations, s.observations[0]],
      }),
    ],
    [
      'foreign-episode',
      (s: patient.PatientVaultSnapshot) => ({
        ...s,
        episodes: s.episodes.map((e) => ({ ...e, patientId: 'patient-2' })),
      }),
    ],
    [
      'unlinked-observation',
      (s: patient.PatientVaultSnapshot) => ({
        ...s,
        events: s.events.map((e) => ({ ...e, observations: [] })),
      }),
    ],
    [
      'changed-duplicated-observation',
      (s: patient.PatientVaultSnapshot) => ({
        ...s,
        observations: s.observations.map((o, i) => (i === 0 ? { ...o, value: 999 } : o)),
      }),
    ],
    [
      'self-event-revision',
      (s: patient.PatientVaultSnapshot) => ({
        ...s,
        events: s.events.map((e, i) => (i === 0 ? { ...e, revisionOf: e.id } : e)),
      }),
    ],
    ['unknown-schema', (s: patient.PatientVaultSnapshot) => ({ ...s, schemaVersion: 1 })],
  ] as const)
    normalize(name, mutate(snapshot));
  for (const invalid of [NaN, Infinity, -Infinity])
    capture(
      `nonfinite-${String(invalid)}`,
      'createManualMeasurementEvent',
      [{ ...measurement, value: invalid }],
      () => patient.createManualMeasurementEvent({ ...measurement, value: invalid }),
    );
  for (const invalid of [0, -1, NaN])
    capture(
      `invalid-initial-weight-${String(invalid)}`,
      'createPatientProfile',
      [{ ...input, weightKg: invalid }],
      () => patient.createPatientProfile({ ...input, weightKg: invalid }),
    );
  for (const context of [{ ' ': 3 }, { bad: NaN }, { bad: true }, []])
    capture(
      `invalid-profile-context-${JSON.stringify(encoded(context))}`,
      'createPatientProfile',
      [{ ...input, context }],
      () =>
        patient.createPatientProfile({
          ...input,
          context: context as Record<string, string | number>,
        }),
    );
  for (const avatar of [
    { kind: 'symbol', value: 'AB' },
    { kind: 'symbol', value: '🇷🇺' },
    { kind: 'symbol', value: 'е\u0301' },
    { kind: 'symbol', value: '👍🏽' },
    { kind: 'symbol', value: '👨‍👩‍👧‍👦' },
    { kind: 'photo', value: 'data:image/jpeg;base64,/9j/2Q==' },
    { kind: 'photo', value: 'https://example.test/avatar.jpg' },
    { kind: 'photo', value: 'data:image/svg+xml;base64,AAAA' },
  ])
    normalize(`avatar-${avatar.kind}-${avatar.value}`, {
      ...snapshot,
      profiles: [{ ...first.profile, avatar }, second.profile],
    });
  for (const url of [
    'https://example.test/source',
    'http://example.test/source',
    'javascript:alert(1)',
    'data:text/plain,source',
    'file:///private/source',
    '//example.test/source',
    'https:example.test/source',
  ]) {
    const changed = clone(snapshot);
    const e = changed.events.find((e) => e.provenance);
    if (!e?.provenance) throw new Error('Fixture provenance missing');
    const events = changed.events.map((entry) =>
      entry.id === e.id
        ? {
            ...entry,
            provenance: {
              ...e.provenance,
              sourceLinks: [{ id: 'source', title: 'Источник', url }],
            },
          }
        : entry,
    );
    normalize(`source-url-${url}`, { ...changed, events });
  }
  for (const [name, evaluation] of [
    ['missing-verdict', { status: 'verdict', context: {}, capturedAt: at }],
    [
      'unexpected-verdict',
      {
        status: 'unavailable',
        verdict: { rangeId: 'r', title: 't', explanation: 'e', attentionLevel: 'none' },
        context: {},
        capturedAt: at,
      },
    ],
    ['nonfinite-context', { status: 'missing-context', context: { x: NaN }, capturedAt: at }],
    ['non-string-context', { status: 'missing-context', context: { x: true }, capturedAt: at }],
  ] as const) {
    const changed = clone(snapshot);
    const observation = changed.observations[0];
    if (!observation) throw new Error('Fixture missing');
    const replacement = { ...observation, evaluation };
    normalize(name, {
      ...changed,
      observations: changed.observations.map((o) => (o.id === observation.id ? replacement : o)),
      events: changed.events.map((e) => ({
        ...e,
        observations: e.observations.map((o) => (o.id === observation.id ? replacement : o)),
      })),
    });
  }
} finally {
  crypto.randomUUID = originalUuid;
}
const dateSamples = [
  '2024-02-29',
  '2023-02-29',
  '0099-01-01',
  '0000-01-01',
  '2025-01-01T23:30:00+03:00',
  '2025-01-01T24:00:00Z',
  '2025-01-01T24:01:00Z',
  '+010000-01-01T00:00:00Z',
  '-000001-01-01T00:00:00Z',
  '2025-13-01',
  '2025-01-00',
  '2025-01-32',
  '2025-01',
  '2025',
  '01/02/2025',
  'Thu, 02 Jan 2025 00:00:00 GMT',
  'January 2, 2025',
  'not a date',
];
const collationSamples = [
  'е',
  'ё',
  'Е',
  'Ё',
  'А',
  'а',
  'я',
  'Я',
  'a',
  'A',
  'bmi@2',
  'bmi@10',
  'bmi@2.0',
  'bmi@2-0',
  'ммоль/л',
  'мг/дл',
  'кг/м²',
  '%',
  '°C',
  'мм рт. ст.',
  'µg',
  'ug',
  'pulse',
  'blood-pressure',
];
const sourcePaths = [
  'apps/app/src/state/patient-domain.ts',
  'apps/app/src/state/patientAvatar.ts',
  'packages/contracts/src/clinical-observations.ts',
];
const outputArg = process.argv.find((value) => value.startsWith('--output='));
const output = resolve(
  REPOSITORY_ROOT,
  outputArg?.slice('--output='.length) ??
    'native/shared/src/commonTest/resources/native-patient-golden.json',
);
mkdirSync(dirname(output), { recursive: true });
writeFileSync(
  output,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      domainSchemaVersion: 2,
      metricRegistry: patient.PATIENT_METRIC_REGISTRY,
      dateProbes: dateSamples.map((value) => ({
        value,
        epochMilliseconds: encoded(Date.parse(value)),
      })),
      collationProbes: {
        locale: new Intl.Collator().resolvedOptions().locale,
        options: new Intl.Collator().resolvedOptions(),
        values: collationSamples,
        sorted: collationSamples.toSorted((a, b) => a.localeCompare(b)),
      },
      // biome-ignore lint/complexity/useLiteralKeys: TS4111 requires bracket access to Node's index-signature extension.
      runtime: process.versions['bun'],
      dateContext: Intl.DateTimeFormat().resolvedOptions().timeZone,
      sources: sourcePaths.map((path) => ({
        path,
        sha256: createHash('sha256')
          .update(readFileSync(resolve(REPOSITORY_ROOT, path)))
          .digest('hex'),
      })),
      operations: [...new Set(rows.map((row) => row.operation))],
      cases: rows,
    },
    null,
    2,
  )}\n`,
);
console.log(
  JSON.stringify({
    output,
    cases: rows.length,
    operations: new Set(rows.map((row) => row.operation)).size,
    errors: rows.filter((row) => row.error !== null).length,
  }),
);
