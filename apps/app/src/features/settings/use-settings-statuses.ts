import { type Accessor, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { asrDownloadId } from '@/features/asr/asr-download-protocol';
import {
  ASR_MODELS,
  isAsrModelCached,
  selectedAsrModelId,
  subscribeAsr,
} from '@/features/asr/asr-models';
import { subscribeEcgModel } from '@/features/calculators/ecg-model';
import { subscribeEcgDiagnosticModel } from '@/features/calculators/ecg-numeric-diagnostic';
import { ECG_DOWNLOAD_ID, ecgPackageStatus } from '@/features/calculators/ecg-package';
import {
  type DownloadTask,
  downloadTaskFraction,
  isDownloadActive,
} from '@/features/downloads/download-queue';
import { getDownloadQueue } from '@/features/downloads/download-service';
import {
  getReferenceImageResolver,
  REFERENCE_IMAGES_DOWNLOAD_ID,
} from '@/features/library/reference-image-assets';
import { isModuleReleased } from '@/features/modules/local-packaged-modules';
import {
  isOcrLanguagePackInstalled,
  OCR_DOWNLOAD_ID,
  subscribeOcrLanguagePack,
} from '@/features/ocr/ocr-language-pack';
import { sectionManifest } from '@/features/sections/section-manifest';
import { buildSections, installState, sectionModules } from '@/features/sections/section-model';
import { useModuleInstaller } from '@/features/sections/use-module-installer';
import { E5_DOWNLOAD_ID } from '@/features/semantic/e5-model';
import { isE5ModelInstalled } from '@/features/semantic/e5-model-cache';
import { subscribeE5Model } from '@/features/semantic/e5-model-store';
import type { SettingsPageId } from '@/features/settings/settings-pages';
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
  generalStatus,
  ocrReadiness,
  type PatientVaultState,
  referenceImagesStatus,
  type SettingsStatus,
  type SettingsStatuses,
} from '@/features/settings/settings-status';
import {
  type ClinicianProfile,
  getClinicianProfile,
  subscribeClinicianProfile,
} from '@/state/clinician-profile';
import { PATIENT_VAULT_EVENT, patientVaultStorageMode } from '@/state/patient-vault';
import { getThemePreference, subscribeTheme, type ThemePreference } from '@/state/theme';
import { RELEASE_VERSION } from '../../../../../release';

export interface SettingsStatusInputs {
  readonly updateReady: Accessor<boolean>;
  readonly updating: Accessor<boolean>;
  readonly checking: Accessor<boolean>;
  readonly upToDate: Accessor<boolean>;
}

function taskActive(task: DownloadTask | undefined): boolean {
  return Boolean(task && isDownloadActive(task));
}

/**
 * Live statuses of the settings list, read from the stores the cards themselves use (download
 * queue, model caches, preferences, patient vault). Only reads: opening Settings never starts a
 * download, a model or a database.
 */
export function useSettingsStatuses(inputs: SettingsStatusInputs): Accessor<SettingsStatuses> {
  const queue = getDownloadQueue();
  // The release catalog loads once here; it gives the sections and sizes on the device.
  const installer = useModuleInstaller(() => Promise.resolve());

  const [profile, setProfile] = createSignal<ClinicianProfile>(getClinicianProfile());
  const [tasks, setTasks] = createSignal<readonly DownloadTask[]>(queue.list());
  const [e5Installed, setE5Installed] = createSignal<boolean>();
  const [asrSelected, setAsrSelected] = createSignal<string | null>(selectedAsrModelId());
  const [asrCached, setAsrCached] = createSignal(false);
  const [ecgState, setEcgState] = createSignal(ecgPackageStatus().state);
  const [ocrInstalled, setOcrInstalled] = createSignal(isOcrLanguagePackInstalled());
  const [theme, setTheme] = createSignal<ThemePreference>('system');
  const [vault, setVault] = createSignal<PatientVaultState>('checking');

  onMount(() => {
    let disposed = false;
    const guard = <T>(promise: Promise<T>, apply: (value: T) => void): void => {
      promise.then(
        (value) => {
          if (!disposed) apply(value);
        },
        (cause: unknown) => {
          console.warn('Состояние раздела настроек не прочитано.', cause);
        },
      );
    };
    const syncE5 = () => guard(isE5ModelInstalled(), setE5Installed);
    const syncAsr = () => {
      const selected = selectedAsrModelId();
      setAsrSelected(selected);
      if (selected === null) setAsrCached(false);
      else guard(isAsrModelCached(selected), setAsrCached);
    };
    const syncVault = () => guard(patientVaultStorageMode(), (mode) => setVault(mode ?? 'empty'));

    const onQueue = () => setTasks(queue.list());
    const syncEcg = () => setEcgState(ecgPackageStatus().state);
    const syncOcr = () => setOcrInstalled(isOcrLanguagePackInstalled());

    setTheme(getThemePreference());
    const stopTheme = subscribeTheme(() => setTheme(getThemePreference()));
    window.addEventListener(PATIENT_VAULT_EVENT, syncVault);

    syncE5();
    syncAsr();
    syncVault();
    const unsubscribers = [
      subscribeClinicianProfile(setProfile),
      queue.subscribe(onQueue),
      subscribeE5Model(syncE5),
      subscribeAsr(syncAsr),
      subscribeEcgModel(syncEcg),
      subscribeEcgDiagnosticModel(syncEcg),
      subscribeOcrLanguagePack(syncOcr),
    ];
    onCleanup(() => {
      disposed = true;
      stopTheme();
      window.removeEventListener(PATIENT_VAULT_EVENT, syncVault);
      for (const unsubscribe of unsubscribers) unsubscribe();
    });
  });

  const downloadTask = (id: string) => tasks().find((task) => task.id === id);

  const sectionsOnDevice = createMemo(() => {
    const snapshot = installer.snapshot();
    if (!snapshot) return undefined;
    const sections = buildSections(snapshot.catalog, sectionManifest(), isModuleReleased);
    const noSkips: ReadonlySet<string> = new Set();
    const count = sections.filter(
      (section) => installState(sectionModules(section, noSkips), snapshot.isInstalled) !== 'none',
    ).length;
    const bytes = snapshot.catalog.modules
      .filter((module) => snapshot.isInstalled(module))
      .reduce((sum, module) => sum + (module.sizes.installedBytes ?? 0), 0);
    return { count, bytes };
  });

  const imagesBase = useReferenceImagesStatus();

  return createMemo((): SettingsStatuses => {
    const counts = downloadQueueCounts(tasks());
    const sections = sectionsOnDevice();
    const statuses: Record<SettingsPageId, SettingsStatus> = {
      general: generalStatus({
        version: RELEASE_VERSION,
        updateReady: inputs.updateReady(),
        updating: inputs.updating(),
        checking: inputs.checking(),
        upToDate: inputs.upToDate(),
      }),
      clinician: clinicianStatus(profile()),
      downloads: downloadsStatus({
        ...counts,
        installedSections: sections?.count,
        installedBytes: sections?.bytes,
      }),
      ai: aiStatus([
        e5Readiness(e5Installed(), taskActive(downloadTask(E5_DOWNLOAD_ID))),
        asrReadiness(
          asrSelected(),
          asrCached(),
          ASR_MODELS.some((model) => taskActive(downloadTask(asrDownloadId(model.id)))),
        ),
        ecgReadiness(ecgState(), taskActive(downloadTask(ECG_DOWNLOAD_ID))),
        ocrReadiness(ocrInstalled(), taskActive(downloadTask(OCR_DOWNLOAD_ID))),
      ]),
      images: imagesBase(),
      appearance: appearanceStatus(theme()),
      data: dataStatus(vault()),
    };
    return statuses;
  });
}

/** The reference-images status alone, for the row on the «Изображения» page. */
export function useReferenceImagesStatus(): Accessor<SettingsStatus> {
  const queue = getDownloadQueue();
  const resolver = getReferenceImageResolver();
  const [cache, setCache] = createSignal<Awaited<ReturnType<typeof resolver.downloadStatus>>>();
  const [task, setTask] = createSignal(queue.get(REFERENCE_IMAGES_DOWNLOAD_ID));
  onMount(() => {
    let disposed = false;
    const sync = () => {
      resolver.downloadStatus().then(
        (value) => {
          if (!disposed) setCache(value);
        },
        (cause: unknown) => {
          console.warn('Состояние иллюстраций не прочитано.', cause);
        },
      );
    };
    let previous = queue.get(REFERENCE_IMAGES_DOWNLOAD_ID)?.state;
    sync();
    const unsubscribe = queue.subscribe(() => {
      const current = queue.get(REFERENCE_IMAGES_DOWNLOAD_ID);
      setTask(current);
      if (current?.state !== previous && current && !isDownloadActive(current)) sync();
      previous = current?.state;
    });
    const unsubscribeRemoved = resolver.subscribeRemoved(sync);
    onCleanup(() => {
      disposed = true;
      unsubscribe();
      unsubscribeRemoved();
    });
  });
  return () => {
    const current = task();
    return referenceImagesStatus({
      status: cache(),
      downloading: taskActive(current),
      fraction: current ? downloadTaskFraction(current) : null,
    });
  };
}
