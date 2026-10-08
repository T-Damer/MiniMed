import { describe, expect, it } from 'vitest';

import {
  aiStatus,
  appearanceStatus,
  asrReadiness,
  clinicianStatus,
  dataStatus,
  downloadQueueCounts,
  downloadsStatus,
  e5Readiness,
  ecgReadiness,
  formatStorageSize,
  generalStatus,
  ocrReadiness,
  patientStorageDescription,
  referenceImagesStatus,
} from '@/features/settings/settings-status';

const GIB = 1024 ** 3;
const MIB = 1024 ** 2;

describe('settings statuses', () => {
  it('formats sizes with a decimal comma', () => {
    expect(formatStorageSize(1.2 * GIB)).toBe('1,2 ГБ');
    expect(formatStorageSize(462 * MIB)).toBe('462 МБ');
    expect(formatStorageSize(4.8 * MIB)).toBe('4,8 МБ');
  });

  it('puts the update first, then the checker state, then the version', () => {
    const base = {
      version: '0.6.50',
      updateReady: false,
      updating: false,
      checking: false,
      upToDate: false,
    };
    expect(generalStatus({ ...base, updateReady: true })).toEqual({
      label: 'Есть обновление',
      tone: 'attention',
    });
    expect(generalStatus({ ...base, updateReady: true, updating: true }).label).toBe(
      'Обновляется…',
    );
    expect(generalStatus({ ...base, checking: true }).tone).toBe('working');
    expect(generalStatus({ ...base, upToDate: true }).label).toBe('Актуальная версия');
    expect(generalStatus(base).label).toBe('Версия 0.6.50');
  });

  it('counts the filled doctor and organisation fields', () => {
    expect(clinicianStatus({}).label).toBe('Не заполнено');
    expect(clinicianStatus({ organizationName: ' ', ogrn: '' }).label).toBe('Не заполнено');
    expect(clinicianStatus({ organizationName: 'ГКБ', ogrn: '1027700132195' })).toEqual({
      label: 'Заполнено 2 из 5',
      tone: 'attention',
    });
    expect(
      clinicianStatus({
        organizationName: 'ГКБ',
        organizationAddress: 'Москва',
        ogrn: '1027700132195',
        clinicianFullName: 'Иванов И. И.',
        clinicianPosition: 'Терапевт',
      }),
    ).toEqual({ label: 'Заполнено', tone: 'ok' });
  });

  it('shows what is on the device with the right plural of «раздел»', () => {
    const idle = { active: 0, queued: 0, attention: 0 };
    expect(
      downloadsStatus({ ...idle, installedSections: undefined, installedBytes: undefined }),
    ).toEqual({ label: 'Проверяем…', tone: 'neutral' });
    expect(downloadsStatus({ ...idle, installedSections: 0, installedBytes: 0 }).label).toBe(
      'Не скачано',
    );
    expect(
      downloadsStatus({ ...idle, installedSections: 1, installedBytes: 300 * MIB }).label,
    ).toBe('1 раздел · 300 МБ');
    expect(
      downloadsStatus({ ...idle, installedSections: 3, installedBytes: 1.2 * GIB }).label,
    ).toBe('3 раздела · 1,2 ГБ');
    expect(downloadsStatus({ ...idle, installedSections: 5, installedBytes: 2 * GIB }).label).toBe(
      '5 разделов · 2,0 ГБ',
    );
    expect(
      downloadsStatus({ ...idle, installedSections: 11, installedBytes: undefined }).label,
    ).toBe('11 разделов');
  });

  it('prefers running transfers, then the queue, then failures', () => {
    const done = { installedSections: 3, installedBytes: GIB };
    expect(downloadsStatus({ active: 2, queued: 1, attention: 1, ...done })).toEqual({
      label: 'Скачивается · 3',
      tone: 'working',
    });
    expect(downloadsStatus({ active: 0, queued: 2, attention: 1, ...done }).label).toBe(
      'В очереди · 2',
    );
    expect(downloadsStatus({ active: 0, queued: 0, attention: 1, ...done })).toEqual({
      label: '1 требует внимания',
      tone: 'attention',
    });
    expect(downloadsStatus({ active: 0, queued: 0, attention: 3, ...done }).label).toBe(
      '3 требуют внимания',
    );
  });

  it('summarises the three AI features', () => {
    expect(aiStatus(['missing', 'missing', 'missing'])).toEqual({
      label: 'Не скачано',
      tone: 'neutral',
    });
    expect(aiStatus(['ready', 'missing', 'ready']).label).toBe('Готово 2 из 3');
    expect(aiStatus(['ready', 'ready', 'ready'])).toEqual({ label: 'Готово', tone: 'ok' });
    expect(aiStatus(['ready', 'working', 'missing']).tone).toBe('working');
    expect(aiStatus(['ready', 'update', 'ready']).label).toBe('Есть обновление');
    expect(aiStatus(['checking', 'ready', 'ready']).label).toBe('Проверяем…');
  });

  it('reports the reference images from the cache and the queue', () => {
    const none = { files: 0, totalFiles: 9123, totalBytes: 462 * MIB, complete: false };
    expect(
      referenceImagesStatus({ status: undefined, downloading: false, fraction: null }).label,
    ).toBe('Проверяем…');
    expect(referenceImagesStatus({ status: none, downloading: false, fraction: null })).toEqual({
      label: 'Не скачано',
      tone: 'neutral',
    });
    expect(
      referenceImagesStatus({ status: { ...none, files: 120 }, downloading: false, fraction: null })
        .label,
    ).toBe('Скачано 120 из 9\u202f123');
    expect(
      referenceImagesStatus({
        status: { ...none, complete: true },
        downloading: false,
        fraction: null,
      }),
    ).toEqual({ label: 'Готово', tone: 'ok' });
    expect(referenceImagesStatus({ status: none, downloading: true, fraction: 0.456 }).label).toBe(
      'Скачивается · 45%',
    );
    expect(referenceImagesStatus({ status: none, downloading: true, fraction: null }).label).toBe(
      'Скачивается…',
    );
  });

  it('names the chosen theme and the patient storage', () => {
    expect(appearanceStatus('dark').label).toBe('Тёмная');
    expect(appearanceStatus('light').label).toBe('Светлая');
    expect(appearanceStatus('system').label).toBe('Системная');
    expect(dataStatus('empty').label).toBe('Пусто');
    expect(dataStatus('native-keychain')).toEqual({ label: 'Защищено', tone: 'ok' });
    expect(dataStatus('browser-device-key')).toEqual({
      label: 'Зашифровано в браузере',
      tone: 'ok',
    });
    expect(dataStatus('unencrypted').tone).toBe('attention');
    expect(dataStatus('checking').label).toBe('Проверяем…');
  });

  it('groups queue tasks like the download manager', () => {
    expect(
      downloadQueueCounts([
        { state: 'downloading' },
        { state: 'verifying' },
        { state: 'queued' },
        { state: 'retrying' },
        { state: 'failed' },
        { state: 'completed' },
        { state: 'cancelled' },
      ]),
    ).toEqual({ active: 2, queued: 2, attention: 1 });
  });

  it('maps each AI feature onto a readiness', () => {
    expect(e5Readiness(undefined, false)).toBe('checking');
    expect(e5Readiness(true, false)).toBe('ready');
    expect(e5Readiness(false, false)).toBe('missing');
    expect(e5Readiness(true, true)).toBe('working');
    expect(asrReadiness(null, false, false)).toBe('missing');
    expect(asrReadiness('whisper-tiny', false, false)).toBe('missing');
    expect(asrReadiness('whisper-tiny', true, false)).toBe('ready');
    expect(asrReadiness('whisper-tiny', false, true)).toBe('working');
    expect(ecgReadiness('installed', false)).toBe('ready');
    expect(ecgReadiness('outdated', false)).toBe('update');
    expect(ecgReadiness('partial', false)).toBe('missing');
    expect(ecgReadiness('missing', true)).toBe('working');
    expect(ocrReadiness(true, false)).toBe('ready');
    expect(ocrReadiness(false, false)).toBe('missing');
    expect(ocrReadiness(false, true)).toBe('working');
  });

  it('describes the patient storage in plain words', () => {
    expect(patientStorageDescription('native-keychain')).toMatch(/зашифрованы ключом/u);
    expect(patientStorageDescription('browser-device-key')).toMatch(/ключом этого браузера/u);
    expect(patientStorageDescription('unencrypted')).toMatch(/без шифрования/u);
    expect(patientStorageDescription('empty')).toMatch(/пока нет/u);
    expect(patientStorageDescription('checking')).toMatch(/Проверяем/u);
  });
});
