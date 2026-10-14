import { type Accessor, createMemo, createSignal, onMount } from 'solid-js';

import { isModuleReleased } from '@/features/modules/local-packaged-modules';
import { useModuleInstaller } from '@/features/sections/use-module-installer';
import { E5_MODEL_TOTAL_BYTES } from '@/features/semantic/e5-model';
import { type FullDownloadPlan, fullDownloadPlan } from './full-download';

export interface FullDownload {
  /** Undefined until the release catalog is read (it loads lazily, never at start-up). */
  readonly plan: Accessor<FullDownloadPlan | undefined>;
  /** The catalog could not be loaded. */
  readonly failed: Accessor<boolean>;
  /** Modules are being queued or are downloading. */
  readonly active: Accessor<boolean>;
  /** Queues every pending module and the meaning-search model; resolves when queued. */
  readonly start: () => Promise<void>;
}

/**
 * The «Скачать всё» choice of the first launch (and of Settings → Загрузки): the plan with its
 * size, and the action that queues it through the module runtime and the shared download queue.
 * Nothing runs until `start` is called.
 */
export function useFullDownload(
  onContentChanged: () => Promise<void>,
  coreInstalled: Accessor<boolean>,
  /** The ~10 MB release catalog is read once this is true (the greeting plays without it). */
  enabled: Accessor<boolean>,
): FullDownload {
  const installer = useModuleInstaller(onContentChanged, 'Не удалось скачать наборы.', enabled);
  const [modelInstalled, setModelInstalled] = createSignal(false);

  onMount(() => {
    void import('@/features/semantic/e5-model-cache')
      .then(({ isE5ModelInstalled }) => isE5ModelInstalled())
      .then(setModelInstalled)
      .catch((cause: unknown) => {
        console.warn('Состояние модели поиска по смыслу не прочитано.', cause);
      });
  });

  const plan = createMemo<FullDownloadPlan | undefined>(() => {
    const snapshot = installer.snapshot();
    if (!snapshot) return undefined;
    return fullDownloadPlan({
      catalog: snapshot.catalog,
      released: isModuleReleased,
      installed: snapshot.isInstalled,
      coreInstalled: coreInstalled(),
      modelInstalled: modelInstalled(),
      modelBytes: E5_MODEL_TOTAL_BYTES,
    });
  });

  const start = async (): Promise<void> => {
    const current = plan();
    if (!current) return;
    if (current.modelBytes > 0) {
      void import('@/features/semantic/e5-model-store').then(({ installE5Model }) =>
        installE5Model().catch((cause: unknown) => {
          if (!(cause instanceof Error && cause.name === 'AbortError')) {
            console.warn('Модель поиска по смыслу не скачалась.', cause);
          }
        }),
      );
    }
    await installer.start(current.pending);
  };

  const active = (): boolean =>
    installer.starting() ||
    (installer
      .snapshot()
      ?.tasks.some((task) => !['completed', 'failed', 'cancelled'].includes(task.state)) ??
      false);

  return { plan, failed: installer.failed, active, start };
}
