import { Capacitor } from '@capacitor/core';
import type { MedicalCore } from '@localmed/contracts';
import { createSignal, onCleanup, onMount } from 'solid-js';

import { countPublishedCatalogModules } from '@/app/root-view';
import { createBrowserCore } from '@/composition/create-browser-core';
import { createLocalModelController } from '@/composition/create-local-model-controller';
import {
  type InitializedMedicalCore,
  initializeMedicalCore,
  swapMedicalCore,
} from '@/composition/medical-core-lifecycle';
import { GroundedMedicalCore } from '@/features/models/GroundedMedicalCore';
import { refreshContentModuleCatalog } from '@/features/modules/catalog-service';
import { MODULE_CATALOG } from '@/features/modules/module-catalog';
import {
  getContentModuleRuntime,
  peekContentModuleRuntime,
  subscribeContentModuleRuntime,
} from '@/features/modules/module-runtime-service';
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
import { installAndroidApk } from '@/state/native-update';
import { dueReminderNotes, loadPatientNotes, PATIENT_NOTES_EVENT } from '@/state/patient-notes';
import { installUiFeedback } from '@/state/ui-feedback';
import { ensureUserLibraryIngestRunning } from '@/state/user-library-ingest';

const SLOW_BOOT_DELAY_MS = 10_000;

export function useAppSession() {
  const isNativeShell = Capacitor.getPlatform() !== 'web';
  const [ready, setReady] = createSignal<InitializedMedicalCore>();
  const [error, setError] = createSignal<string>();
  const [bootSlow, setBootSlow] = createSignal(false);
  const [availableModuleCount, setAvailableModuleCount] = createSignal(0);
  const [downloadedModuleCount, setDownloadedModuleCount] = createSignal(0);
  const [dueReminderCount, setDueReminderCount] = createSignal(0);
  const [appUpdateWorker, setAppUpdateWorker] = createSignal<ServiceWorker>();
  const [availableApk, setAvailableApk] = createSignal<AvailableApkUpdate>();
  const [appUpdating, setAppUpdating] = createSignal(false);
  const [appUpdateChecking, setAppUpdateChecking] = createSignal(false);
  const [appUpdateProgress, setAppUpdateProgress] = createSignal<AppUpdateProgress>();
  const [appUpdateError, setAppUpdateError] = createSignal<string>();
  const modelController = createLocalModelController();
  const [assistantCore, setAssistantCore] = createSignal<GroundedMedicalCore>();
  const [searchCore, setSearchCore] = createSignal<WorkerSearchMedicalCore>();

  let coreToClose: MedicalCore | undefined;
  let unsubscribeInstalledModules: (() => void) | undefined;
  let unsubscribeModuleRuntime: (() => void) | undefined;
  let stopButtonHaptics: (() => void) | undefined;
  let bootTimer: ReturnType<typeof setTimeout> | undefined;
  let reminderTimer: ReturnType<typeof setInterval> | undefined;

  const handleAppUpdate = (event: Event): void => {
    setAppUpdateWorker((event as CustomEvent<AppUpdateReadyDetail>).detail.worker);
  };

  const describeUpdateError = (cause: unknown, fallback: string): string =>
    cause instanceof Error ? cause.message : fallback;

  const checkAvailableUpdate = (): void => {
    if (appUpdateChecking() || appUpdating()) return;
    setAppUpdateChecking(true);
    setAppUpdateError();
    const pending =
      Capacitor.getPlatform() === 'android'
        ? checkNativeApkUpdate().then((update) => {
            setAvailableApk(update ?? undefined);
            return Boolean(update);
          })
        : checkWebAppUpdate();
    void pending
      .catch((cause: unknown) => {
        setAppUpdateError(describeUpdateError(cause, 'Не удалось проверить обновление.'));
      })
      .finally(() => {
        setAppUpdateChecking(false);
      });
  };

  const activateAvailableUpdate = (): void => {
    if (appUpdating()) return;
    setAppUpdating(true);
    setAppUpdateProgress(undefined);
    setAppUpdateError();
    const apkUrl = availableApk()?.url;
    if (apkUrl) {
      void installAndroidApk(apkUrl, (progress) => {
        setAppUpdateProgress({
          phase: 'download',
          loaded: progress.loaded,
          total: progress.total,
        });
      })
        .catch((cause: unknown) => {
          setAppUpdateError(describeUpdateError(cause, 'Не удалось загрузить обновление.'));
        })
        .finally(() => {
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

  const connectInstalledModules = async (): Promise<void> => {
    const current = ready();
    if (!current) throw new Error('Локальный поиск ещё не готов.');
    const next = await swapMedicalCore(current, createBrowserCore, (core) => {
      const previousSearchCore = searchCore();
      const nextSearchCore = new WorkerSearchMedicalCore(core);
      setSearchCore(nextSearchCore);
      if (previousSearchCore) void previousSearchCore.close();
      const assistant = assistantCore();
      if (assistant) assistant.setBase(nextSearchCore);
      else setAssistantCore(new GroundedMedicalCore(nextSearchCore, modelController));
    });
    coreToClose = next.core;
    setReady(next);
    setDownloadedModuleCount(peekContentModuleRuntime()?.listInstalled().length ?? 0);
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
          if (update) setAvailableApk(update);
        })
        .catch((cause: unknown) => {
          setAppUpdateError(describeUpdateError(cause, 'Не удалось проверить обновление.'));
        });
    }
    window.addEventListener(PATIENT_NOTES_EVENT, refreshDueReminders);
    window.addEventListener(APP_UPDATE_READY_EVENT, handleAppUpdate);
    refreshDueReminders();
    ensureUserLibraryIngestRunning();
    reminderTimer = setInterval(refreshDueReminders, 30_000);
    const bindModuleRuntime = (runtime: ReturnType<typeof getContentModuleRuntime>): void => {
      unsubscribeInstalledModules?.();
      const syncInstalledCount = (): void => {
        setDownloadedModuleCount(runtime.listInstalled().length);
      };
      syncInstalledCount();
      unsubscribeInstalledModules = runtime.subscribe(syncInstalledCount);
    };
    bindModuleRuntime(getContentModuleRuntime(MODULE_CATALOG));
    unsubscribeModuleRuntime = subscribeContentModuleRuntime(bindModuleRuntime);
    bootTimer = setTimeout(() => setBootSlow(true), SLOW_BOOT_DELAY_MS);
    try {
      const initialized = await initializeMedicalCore(createBrowserCore);
      const initializedSearchCore = new WorkerSearchMedicalCore(initialized.core);
      coreToClose = initialized.core;
      setSearchCore(initializedSearchCore);
      setAssistantCore(new GroundedMedicalCore(initializedSearchCore, modelController));
      setReady(initialized);
      void refreshContentModuleCatalog()
        .then((result) => {
          setAvailableModuleCount(countPublishedCatalogModules(result.catalog.modules));
        })
        .catch(() => undefined);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Не удалось открыть локальную базу знаний.',
      );
    } finally {
      if (bootTimer) clearTimeout(bootTimer);
      bootTimer = undefined;
    }
  });

  onCleanup(() => {
    document.documentElement.classList.remove('platform-android');
    window.removeEventListener(PATIENT_NOTES_EVENT, refreshDueReminders);
    window.removeEventListener(APP_UPDATE_READY_EVENT, handleAppUpdate);
    if (reminderTimer) clearInterval(reminderTimer);
    if (bootTimer) clearTimeout(bootTimer);
    unsubscribeInstalledModules?.();
    unsubscribeModuleRuntime?.();
    stopButtonHaptics?.();
    if (coreToClose) void coreToClose.close();
    const activeSearchCore = searchCore();
    if (activeSearchCore) void activeSearchCore.close();
    void modelController.dispose();
  });

  return {
    isNativeShell,
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
    appUpdateProgress,
    appUpdateError,
    modelController,
    assistantCore,
    searchCore,
    activateAvailableUpdate,
    checkAvailableUpdate,
    connectInstalledModules,
  };
}
