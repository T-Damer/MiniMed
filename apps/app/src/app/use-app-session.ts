import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import type { MedicalCore } from '@localmed/contracts';
import { createSignal, onCleanup, onMount } from 'solid-js';

import { countPublishedCatalogModules } from '@/app/root-view';
import { createBrowserCore } from '@/composition/create-browser-core';
import {
  type InitializedMedicalCore,
  initializeMedicalCore,
  swapMedicalCore,
} from '@/composition/medical-core-lifecycle';
import { WorkerSearchMedicalCore } from '@/features/search/WorkerSearchMedicalCore';
import {
  APP_UPDATE_READY_EVENT,
  type AppUpdateProgress,
  type AppUpdateReadyDetail,
  type AvailableApkUpdate,
  activateAppUpdate,
  appUpdateVersionFromWorker,
  checkNativeApkUpdate,
  checkWebAppUpdate,
} from '@/state/app-update';
import { notifyContentChanged } from '@/state/content-events';
import {
  type ApkTaskStatus,
  cancelAndroidApkDownload,
  getAndroidApkTaskStatus,
  getLatestAndroidApkTaskStatus,
  installAndroidApk,
  startAndroidApkDownload,
  watchAndroidApkTasks,
} from '@/state/native-update';
import { dueReminderNotes, loadPatientNotes, PATIENT_NOTES_EVENT } from '@/state/patient-notes';
import { installUiFeedback } from '@/state/ui-feedback';
import { ensureUserLibraryIngestRunning } from '@/state/user-library-ingest';

const SLOW_BOOT_DELAY_MS = 10_000;
const APP_UPDATE_MIN_CHECK_MS = 650;
const APP_UPDATE_UP_TO_DATE_VISIBLE_MS = 2_800;

type ModuleRuntimeService = typeof import('@/features/modules/module-runtime-service');
type ContentModuleRuntime = ReturnType<ModuleRuntimeService['getContentModuleRuntime']>;

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function scheduleIdle<T>(work: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const run = (): void => {
      void work().then(resolve, reject);
    };
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(run, { timeout: 1000 });
    } else {
      setTimeout(run, 0);
    }
  });
}

function sameApkUpdate(
  left: AvailableApkUpdate | undefined,
  right: AvailableApkUpdate | undefined,
): boolean {
  return (
    left?.version === right?.version &&
    left?.url === right?.url &&
    left?.expectedSha256 === right?.expectedSha256 &&
    left?.expectedBytes === right?.expectedBytes
  );
}

export function useAppSession() {
  const isNativeShell = Capacitor.getPlatform() !== 'web';
  const [ready, setReady] = createSignal<InitializedMedicalCore>();
  const [error, setError] = createSignal<string>();
  const [coreDownloadRequired, setCoreDownloadRequired] = createSignal(false);
  const [coreDownloading, setCoreDownloading] = createSignal(false);
  const [coreProgress, setCoreProgress] = createSignal<{
    readonly loaded: number;
    readonly total: number;
    readonly phase?: 'downloading' | 'verifying' | 'installing';
  }>();
  let beginCoreDownload: (() => void) | undefined;
  const downloadCore = (): void => {
    setCoreDownloading(true);
    beginCoreDownload?.();
  };
  const [bootSlow, setBootSlow] = createSignal(false);
  const [availableModuleCount, setAvailableModuleCount] = createSignal(0);
  const [downloadedModuleCount, setDownloadedModuleCount] = createSignal(0);
  const [dueReminderCount, setDueReminderCount] = createSignal(0);
  const [appUpdateWorker, setAppUpdateWorker] = createSignal<ServiceWorker>();
  const [availableApk, setAvailableApk] = createSignal<AvailableApkUpdate>();
  const [appUpdating, setAppUpdating] = createSignal(false);
  const [appUpdateChecking, setAppUpdateChecking] = createSignal(false);
  const [appUpdateUpToDate, setAppUpdateUpToDate] = createSignal(false);
  const [appUpdateProgress, setAppUpdateProgress] = createSignal<AppUpdateProgress>();
  const [appUpdateError, setAppUpdateError] = createSignal<string>();
  const [apkTask, setApkTask] = createSignal<ApkTaskStatus>();
  const [searchCore, setSearchCore] = createSignal<WorkerSearchMedicalCore>();

  let coreToClose: MedicalCore | undefined;
  let moduleRuntimeService: ModuleRuntimeService | undefined;
  let unsubscribeInstalledModules: (() => void) | undefined;
  let unsubscribeModuleRuntime: (() => void) | undefined;
  let stopButtonHaptics: (() => void) | undefined;
  let bootTimer: ReturnType<typeof setTimeout> | undefined;
  let reminderTimer: ReturnType<typeof setInterval> | undefined;
  let updateFeedbackTimer: ReturnType<typeof setTimeout> | undefined;
  let apkTaskListener: PluginListenerHandle | undefined;
  let observedApkTaskId: string | undefined;
  let disposed = false;

  const handleAppUpdate = (event: Event): void => {
    setAppUpdateWorker((event as CustomEvent<AppUpdateReadyDetail>).detail.worker);
    setAppUpdateUpToDate(false);
  };

  const describeUpdateError = (cause: unknown, fallback: string): string =>
    cause instanceof Error ? cause.message : fallback;

  const describeApkTaskError = (status: ApkTaskStatus): string => {
    switch (status.errorCode) {
      case 'checksum_mismatch':
        return 'Контрольная сумма обновления не совпала.';
      case 'size_mismatch':
        return 'Размер обновления не совпал с ожидаемым.';
      case 'cancelled':
        return 'Загрузка обновления отменена.';
      case 'interrupted':
      case 'download_failed':
        return 'Загрузка была прервана. Нажмите «Обновить», чтобы продолжить.';
      case 'insufficient_storage':
        return 'Недостаточно места для обновления.';
      default:
        return 'Не удалось загрузить обновление.';
    }
  };

  const applyApkTaskStatus = (status: ApkTaskStatus): void => {
    if (observedApkTaskId && status.taskId !== observedApkTaskId) return;
    setApkTask(status);
    switch (status.state) {
      case 'downloading':
        setAppUpdating(true);
        setAppUpdateProgress({
          phase: 'download',
          loaded: status.downloadedBytes,
          total: status.totalBytes,
        });
        return;
      case 'verifying':
        setAppUpdating(true);
        setAppUpdateProgress({
          phase: 'verifying',
          loaded: status.downloadedBytes,
          total: status.totalBytes,
        });
        return;
      case 'ready':
        setAppUpdating(false);
        setAppUpdateProgress({
          phase: 'ready',
          loaded: status.downloadedBytes,
          total: status.totalBytes,
        });
        return;
      case 'failed':
      case 'cancelled':
        setAppUpdating(false);
        setAppUpdateProgress(undefined);
        setAppUpdateError(describeApkTaskError(status));
    }
  };

  const observeApkTask = async (taskId: string): Promise<void> => {
    observedApkTaskId = taskId;
    await apkTaskListener?.remove();
    apkTaskListener = await watchAndroidApkTasks(applyApkTaskStatus);
    applyApkTaskStatus(await getAndroidApkTaskStatus(taskId));
  };

  const refreshApkTask = (): void => {
    if (document.visibilityState !== 'visible' || !observedApkTaskId) return;
    void getAndroidApkTaskStatus(observedApkTaskId)
      .then(applyApkTaskStatus)
      .catch(() => undefined);
  };

  const recoverApkTask = (update: AvailableApkUpdate): void => {
    if (observedApkTaskId || Capacitor.getPlatform() !== 'android') return;
    void getLatestAndroidApkTaskStatus({
      url: update.url,
      releaseVersion: update.version,
      ...(update.expectedSha256 ? { expectedSha256: update.expectedSha256 } : {}),
      ...(update.expectedBytes ? { expectedBytes: update.expectedBytes } : {}),
    })
      .then((task) => {
        if (disposed || !task || !sameApkUpdate(availableApk(), update)) return;
        return observeApkTask(task.taskId);
      })
      .catch(() => undefined);
  };

  const setNextAvailableApk = (update: AvailableApkUpdate | undefined): void => {
    if (!sameApkUpdate(availableApk(), update)) {
      observedApkTaskId = undefined;
      setApkTask(undefined);
      setAppUpdateProgress(undefined);
      void apkTaskListener?.remove();
      apkTaskListener = undefined;
    }
    setAvailableApk(update);
    if (update) recoverApkTask(update);
  };

  const showUpToDateFeedback = (): void => {
    if (updateFeedbackTimer) clearTimeout(updateFeedbackTimer);
    setAppUpdateUpToDate(true);
    updateFeedbackTimer = setTimeout(() => {
      updateFeedbackTimer = undefined;
      setAppUpdateUpToDate(false);
    }, APP_UPDATE_UP_TO_DATE_VISIBLE_MS);
  };

  const checkAvailableUpdate = (): void => {
    if (appUpdateChecking() || appUpdating()) return;
    const startedAt = performance.now();
    if (updateFeedbackTimer) {
      clearTimeout(updateFeedbackTimer);
      updateFeedbackTimer = undefined;
    }
    setAppUpdateUpToDate(false);
    setAppUpdateChecking(true);
    setAppUpdateError();
    const pending =
      Capacitor.getPlatform() === 'android'
        ? checkNativeApkUpdate().then((update) => {
            setNextAvailableApk(update ?? undefined);
            return Boolean(update);
          })
        : checkWebAppUpdate();
    void pending
      .then((available) => {
        if (!available && !appUpdateWorker() && !availableApk()) showUpToDateFeedback();
      })
      .catch((cause: unknown) => {
        setAppUpdateUpToDate(false);
        setAppUpdateError(describeUpdateError(cause, 'Не удалось проверить обновление.'));
      })
      .finally(async () => {
        await delay(APP_UPDATE_MIN_CHECK_MS - (performance.now() - startedAt));
        setAppUpdateChecking(false);
      });
  };

  const activateAvailableUpdate = (): void => {
    if (appUpdating()) return;
    const task = apkTask();
    if (task?.state === 'downloading' || task?.state === 'verifying') {
      applyApkTaskStatus(task);
      return;
    }
    setAppUpdateUpToDate(false);
    setAppUpdating(true);
    setAppUpdateProgress(undefined);
    setAppUpdateError();
    const apkUrl = availableApk()?.url;
    if (apkUrl) {
      if (task?.state === 'ready') {
        setAppUpdateProgress({ phase: 'install' });
        void installAndroidApk(task.taskId)
          .catch((cause: unknown) => {
            setAppUpdateError(describeUpdateError(cause, 'Не удалось открыть установщик.'));
          })
          .finally(() => {
            setAppUpdating(false);
            setAppUpdateProgress({
              phase: 'ready',
              loaded: task.downloadedBytes,
              total: task.totalBytes,
            });
          });
        return;
      }
      const available = availableApk();
      if (!available) return;
      setAppUpdateProgress({
        phase: 'download',
        loaded: 0,
        total: available.expectedBytes ?? null,
      });
      void startAndroidApkDownload({
        url: apkUrl,
        releaseVersion: available.version,
        ...(available.expectedSha256 ? { expectedSha256: available.expectedSha256 } : {}),
        ...(available.expectedBytes ? { expectedBytes: available.expectedBytes } : {}),
      })
        .then(({ taskId }) => observeApkTask(taskId))
        .catch((cause: unknown) => {
          setAppUpdateError(describeUpdateError(cause, 'Не удалось загрузить обновление.'));
          setAppUpdating(false);
          setAppUpdateProgress(undefined);
        });
      return;
    }
    const worker = appUpdateWorker();
    if (worker) {
      setAppUpdateProgress({ phase: 'activate' });
      activateAppUpdate(worker);
      return;
    }
    setAppUpdating(false);
    setAppUpdateProgress(undefined);
  };

  const cancelAvailableUpdate = (): void => {
    const task = apkTask();
    if (!task || (task.state !== 'downloading' && task.state !== 'verifying')) return;
    void cancelAndroidApkDownload(task.taskId).catch((cause: unknown) => {
      setAppUpdateError(describeUpdateError(cause, 'Не удалось отменить загрузку обновления.'));
    });
  };

  const connectInstalledModules = async (): Promise<void> => {
    const current = ready();
    if (!current) throw new Error('Локальный поиск ещё не готов.');
    const next = await swapMedicalCore(current, createBrowserCore, (core) => {
      const previousSearchCore = searchCore();
      const nextSearchCore = new WorkerSearchMedicalCore(core);
      setSearchCore(nextSearchCore);
      if (previousSearchCore) void previousSearchCore.close();
    });
    coreToClose = next.core;
    setReady(next);
    setDownloadedModuleCount(
      moduleRuntimeService?.peekContentModuleRuntime()?.listInstalled().length ?? 0,
    );
    notifyContentChanged();
  };

  const refreshDueReminders = (): void => {
    setDueReminderCount(dueReminderNotes(loadPatientNotes()).length);
  };

  onMount(async () => {
    stopButtonHaptics = installUiFeedback();
    document.documentElement.classList.toggle(
      'platform-android',
      Capacitor.getPlatform() === 'android',
    );
    if (Capacitor.getPlatform() === 'android') {
      void checkNativeApkUpdate()
        .then((update) => {
          if (update) setNextAvailableApk(update);
        })
        .catch((cause: unknown) => {
          setAppUpdateError(describeUpdateError(cause, 'Не удалось проверить обновление.'));
        });
    }
    window.addEventListener(PATIENT_NOTES_EVENT, refreshDueReminders);
    window.addEventListener(APP_UPDATE_READY_EVENT, handleAppUpdate);
    document.addEventListener('visibilitychange', refreshApkTask);
    refreshDueReminders();
    ensureUserLibraryIngestRunning();
    reminderTimer = setInterval(refreshDueReminders, 30_000);
    const bindModuleRuntime = (runtime: ContentModuleRuntime): void => {
      unsubscribeInstalledModules?.();
      const syncInstalledCount = (): void => {
        setDownloadedModuleCount(runtime.listInstalled().length);
      };
      syncInstalledCount();
      unsubscribeInstalledModules = runtime.subscribe(syncInstalledCount);
    };
    bootTimer = setTimeout(() => setBootSlow(true), SLOW_BOOT_DELAY_MS);
    const initializedPromise = initializeMedicalCore(() =>
      createBrowserCore({
        requestDownload: (resuming) =>
          new Promise<void>((resolve) => {
            setCoreDownloadRequired(true);
            if (resuming) {
              setCoreDownloading(true);
              resolve();
            } else {
              beginCoreDownload = resolve;
            }
          }),
        onProgress: setCoreProgress,
      }),
    );
    try {
      const initialized = await initializedPromise;
      if (disposed) {
        await initialized.core.close();
        return;
      }
      const initializedSearchCore = new WorkerSearchMedicalCore(initialized.core);
      coreToClose = initialized.core;
      setSearchCore(initializedSearchCore);
      setReady(initialized);
      performance.mark('minimed:search-ready');
      const moduleRuntimeLoad = scheduleIdle(() =>
        Promise.all([
          import('@/features/modules/module-catalog'),
          import('@/features/modules/module-runtime-service'),
        ]),
      );
      void moduleRuntimeLoad
        .then(([catalogModule, runtimeService]) => {
          if (disposed) return;
          moduleRuntimeService = runtimeService;
          bindModuleRuntime(runtimeService.getContentModuleRuntime(catalogModule.MODULE_CATALOG));
          unsubscribeModuleRuntime =
            runtimeService.subscribeContentModuleRuntime(bindModuleRuntime);
        })
        .catch((cause: unknown) => {
          console.warn('Optional content module runtime could not be loaded.', cause);
        });
      void import('@/features/modules/catalog-service')
        .then(({ refreshContentModuleCatalog }) => refreshContentModuleCatalog())
        .then((result) => {
          setAvailableModuleCount(countPublishedCatalogModules(result.catalog.modules));
        })
        .catch(() => undefined);
    } catch (cause) {
      const initialized = await initializedPromise.catch(() => undefined);
      if (initialized) await initialized.core.close();
      setError(
        cause instanceof Error ? cause.message : 'Не удалось открыть локальную базу знаний.',
      );
    } finally {
      if (bootTimer) clearTimeout(bootTimer);
      bootTimer = undefined;
    }
  });

  onCleanup(() => {
    disposed = true;
    document.documentElement.classList.remove('platform-android');
    window.removeEventListener(PATIENT_NOTES_EVENT, refreshDueReminders);
    window.removeEventListener(APP_UPDATE_READY_EVENT, handleAppUpdate);
    document.removeEventListener('visibilitychange', refreshApkTask);
    if (reminderTimer) clearInterval(reminderTimer);
    if (bootTimer) clearTimeout(bootTimer);
    if (updateFeedbackTimer) clearTimeout(updateFeedbackTimer);
    void apkTaskListener?.remove();
    unsubscribeInstalledModules?.();
    unsubscribeModuleRuntime?.();
    stopButtonHaptics?.();
    if (coreToClose) void coreToClose.close();
    const activeSearchCore = searchCore();
    if (activeSearchCore) void activeSearchCore.close();
  });

  return {
    isNativeShell,
    coreDownloadRequired,
    coreDownloading,
    coreProgress,
    downloadCore,
    ready,
    error,
    bootSlow,
    availableModuleCount,
    setAvailableModuleCount,
    downloadedModuleCount,
    dueReminderCount,
    appUpdateWorker,
    availableApkUrl: () => availableApk()?.url,
    availableUpdateVersion: () =>
      availableApk()?.version ?? appUpdateVersionFromWorker(appUpdateWorker()),
    appUpdating,
    appUpdateChecking,
    appUpdateUpToDate,
    appUpdateProgress,
    appUpdateError,
    appUpdateCancellable: () => {
      const state = apkTask()?.state;
      return state === 'downloading' || state === 'verifying';
    },
    searchCore,
    activateAvailableUpdate,
    cancelAvailableUpdate,
    checkAvailableUpdate,
    connectInstalledModules,
  };
}
