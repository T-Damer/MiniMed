import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DiaryApiError } from '@/features/diary/connected/diary-api';
import type { DoctorSession } from '@/features/diary/connected/doctor-account';
import { DoctorDiaries } from '@/features/diary/connected/doctor-workspace';

const listPatients = vi.fn();
const listAlerts = vi.fn();
const readCopy = vi.fn();

vi.mock('@/features/diary/connected/diary-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/diary/connected/diary-api')>()),
  diaryPatients: { list: () => listPatients() },
  diaryAlerts: { list: () => listAlerts() },
}));
vi.mock('@/features/diary/connected/doctor-account', () => ({
  doctorApi: () => ({}),
  keepOfflineCopy: () => Promise.resolve(),
  readOfflineCopy: () => readCopy(),
}));

const SESSION = {
  token: 'token',
  doctor: { id: 'doctor000001', name: 'Врач', email: 'a@b.c' },
} as unknown as DoctorSession;

const COPY_AT = '2026-11-02T10:00:00.000Z';
const SNAPSHOT = {
  v: 1,
  alerts: [],
  patients: [
    {
      summary: { id: 'patient00001', status: 'active', openAlerts: 0, online: true },
      refused: 0,
      replica: {
        profile: { label: 'Из копии' },
        entries: [],
        entryAuthors: [],
        tipsRead: [],
        revs: [],
      },
    },
  ],
};

const unreachable = (): DiaryApiError => new DiaryApiError(0, 'нет сети');

function names(diaries: DoctorDiaries): (string | undefined)[] {
  return diaries.patients().map((patient) => patient.replica.profile?.label);
}

beforeEach(() => {
  vi.stubGlobal('window', {
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  });
  listAlerts.mockResolvedValue([]);
  readCopy.mockResolvedValue({ savedAt: COPY_AT, text: JSON.stringify(SNAPSHOT) });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('the first read of a session', () => {
  it('shows the copy kept on this device while the service answers, then the live list', async () => {
    let answer: (list: unknown[]) => void = () => undefined;
    listPatients.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const diaries = new DoctorDiaries(SESSION);
    const emitted: number[] = [];
    diaries.subscribe(() => emitted.push(diaries.patients().length));

    const reading = diaries.refresh();
    await vi.waitFor(() => expect(diaries.isLoaded()).toBe(true));
    expect(names(diaries)).toEqual(['Из копии']);
    // A copy standing in for the answer is not the «no connection» state.
    expect(diaries.offlineSince()).toBeUndefined();

    answer([]);
    await reading;
    expect(diaries.patients()).toEqual([]);
    expect(diaries.offlineSince()).toBeUndefined();
    expect(emitted).toEqual([1, 0]);
  });

  it('keeps the copy and says from when while the service cannot be reached', async () => {
    listPatients.mockRejectedValue(unreachable());
    const diaries = new DoctorDiaries(SESSION);
    await diaries.refresh();
    expect(names(diaries)).toEqual(['Из копии']);
    expect(diaries.offlineSince()).toBe(COPY_AT);
    diaries.disconnect();
  });

  it('fails when the service cannot be reached and no copy was kept', async () => {
    readCopy.mockResolvedValue(undefined);
    listPatients.mockRejectedValue(unreachable());
    await expect(new DoctorDiaries(SESSION).refresh()).rejects.toBeInstanceOf(DiaryApiError);
  });

  it('does not take a copy for a service that refused the session', async () => {
    listPatients.mockRejectedValue(new DiaryApiError(401, 'нет входа'));
    const diaries = new DoctorDiaries(SESSION);
    await expect(diaries.refresh()).rejects.toMatchObject({ status: 401 });
    expect(diaries.offlineSince()).toBeUndefined();
  });

  it('is not replaced by the copy when the live list got there first', async () => {
    let release: (value: unknown) => void = () => undefined;
    readCopy.mockReturnValue(new Promise((resolve) => (release = resolve)));
    listPatients.mockResolvedValue([]);
    const diaries = new DoctorDiaries(SESSION);
    await diaries.refresh();
    release({ savedAt: COPY_AT, text: JSON.stringify(SNAPSHOT) });
    await Promise.resolve();
    expect(diaries.patients()).toEqual([]);
  });
});

describe('reads of the list', () => {
  it('go one after another: a call while a read runs waits for it and reads again', async () => {
    const answers: ((list: unknown[]) => void)[] = [];
    listPatients.mockImplementation(
      () => new Promise((resolve) => answers.push(resolve as (list: unknown[]) => void)),
    );
    readCopy.mockResolvedValue(undefined);
    const diaries = new DoctorDiaries(SESSION);
    const first = diaries.refresh();
    const second = diaries.refresh();
    await vi.waitFor(() => expect(answers).toHaveLength(1));
    // The second read has not started: the first one has not answered.
    await Promise.resolve();
    expect(answers).toHaveLength(1);
    answers[0]?.([]);
    await first;
    await vi.waitFor(() => expect(answers).toHaveLength(2));
    answers[1]?.([]);
    await second;
    expect(listPatients).toHaveBeenCalledTimes(2);
  });
});

describe('coming back to a list that is on screen', () => {
  it('reads again quietly, but not while a read runs or finished moments ago', async () => {
    listPatients.mockResolvedValue([]);
    const diaries = new DoctorDiaries(SESSION);
    await diaries.refresh();
    expect(listPatients).toHaveBeenCalledTimes(1);

    diaries.refreshQuietly();
    expect(listPatients).toHaveBeenCalledTimes(1);

    diaries.refreshQuietly(0);
    diaries.refreshQuietly(0);
    await vi.waitFor(() => expect(listPatients).toHaveBeenCalledTimes(2));
  });

  it('leaves the list as it is when the quiet read fails', async () => {
    listPatients.mockResolvedValueOnce([]).mockRejectedValue(unreachable());
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const diaries = new DoctorDiaries(SESSION);
    await diaries.refresh();
    diaries.refreshQuietly(0);
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    expect(diaries.isLoaded()).toBe(true);
    // A live list does not turn into a stale copy because of one failed read.
    expect(diaries.offlineSince()).toBeUndefined();
    warn.mockRestore();
  });

  it('does nothing before the first list is on screen', () => {
    const diaries = new DoctorDiaries(SESSION);
    diaries.refreshQuietly(0);
    expect(listPatients).not.toHaveBeenCalled();
  });
});
