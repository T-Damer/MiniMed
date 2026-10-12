import { hasLocalModuleArtifacts } from '@localmed/contracts';
import { createMemo, createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';
import { toast } from 'solid-sonner';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { ConfirmationDialog } from '@/components/ConfirmationDialog';
import { DownloadProgressMark } from '@/components/DownloadProgressMark';
import type { BrowserContentModuleRuntime } from '@/features/modules/browser-module-runtime';
import { loadModuleCatalog } from '@/features/modules/module-catalog-state';
import { formatModuleBytes } from '@/features/modules/module-display';
import { MODULE_BUNDLE_ACCEPT, ModuleFileImportError } from '@/features/modules/module-file-import';
import {
  installModuleFromFile,
  type ModuleFileInstallProgress,
} from '@/features/modules/module-file-install';
import { getContentModuleRuntime } from '@/features/modules/module-runtime-service';

import '@/features/modules/module-file-import.css';

/**
 * Settings → «Загрузки»: install a module from a `.minimed-module.zip` on the device, and the
 * modules installed that way, each with a delete button. No remote catalog lists them.
 */
export function ModuleFileImport(props: {
  /** Connects a freshly installed or removed module to the search core. */
  readonly onContentChanged?: () => Promise<void>;
}): JSX.Element {
  const [runtime, setRuntime] = createSignal<BrowserContentModuleRuntime>();
  const [revision, setRevision] = createSignal(0);
  const [progress, setProgress] = createSignal<ModuleFileInstallProgress | null>(null);
  const [removalId, setRemovalId] = createSignal<string | null>(null);
  let input: HTMLInputElement | undefined;

  onMount(() => {
    let disposed = false;
    const unsubscribers: Array<() => void> = [];
    onCleanup(() => {
      disposed = true;
      for (const unsubscribe of unsubscribers) unsubscribe();
    });
    loadModuleCatalog()
      .then((catalog) => {
        if (disposed) return;
        const current = getContentModuleRuntime(catalog);
        const bump = (): void => {
          setRevision((value) => value + 1);
        };
        unsubscribers.push(current.subscribe(bump), current.subscribeCatalog(bump));
        setRuntime(current);
      })
      .catch((cause: unknown) => {
        console.warn('Модули из файлов не удалось перечислить.', cause);
      });
  });

  const installedLocal = createMemo(() => {
    revision();
    const active = runtime();
    if (!active) return [];
    const installedIds = new Set(active.listInstalled().map((module) => module.moduleId));
    const sizes = new Map(
      active.listInstalled().map((module) => [module.moduleId, module.installedSizeBytes]),
    );
    return active
      .getCatalog()
      .modules.filter((module) => hasLocalModuleArtifacts(module) && installedIds.has(module.id))
      .map((module) => ({
        id: module.id,
        title: module.title,
        version: module.version,
        size: formatModuleBytes(sizes.get(module.id) ?? null),
      }));
  });

  const busy = (): boolean => progress() !== null;
  const progressPercent = (): string => {
    const fraction = progress()?.fraction;
    return fraction === null || fraction === undefined ? '' : ` ${Math.round(fraction * 100)}%`;
  };

  const reconnect = async (): Promise<void> => {
    try {
      await props.onContentChanged?.();
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : 'Модуль сохранён, но пока не подключён к поиску.',
      );
    }
  };

  const importFile = async (file: File): Promise<void> => {
    if (busy()) return;
    setProgress({ title: file.name, state: 'queued', fraction: null });
    try {
      const entry = await installModuleFromFile(file, setProgress);
      toast.success(`Установлен «${entry.title}».`);
      await reconnect();
    } catch (cause) {
      toast.error(
        cause instanceof ModuleFileImportError
          ? cause.message
          : 'Не удалось установить модуль из файла.',
      );
      if (!(cause instanceof ModuleFileImportError)) console.warn(cause);
    } finally {
      setProgress(null);
    }
  };

  const remove = async (moduleId: string): Promise<void> => {
    const active = runtime();
    if (!active) return;
    try {
      await active.remove(moduleId);
      await reconnect();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Не удалось удалить модуль.');
    }
  };

  const removalTitle = (): string =>
    installedLocal().find((module) => module.id === removalId())?.title ?? '';

  return (
    <section class="module-file-import paper-card" aria-labelledby="module-file-import-title">
      <div class="module-file-import__head">
        <h2 class="module-file-import__title" id="module-file-import-title">
          Модули из файла
        </h2>
        <Button
          variant="icon"
          class="module-file-import__pick"
          aria-label="Установить модуль из файла"
          title="Установить модуль из файла"
          aria-busy={busy()}
          disabled={busy()}
          icon={
            <Show
              when={busy()}
              fallback={<AppGlyph name="file-plus" class="module-file-import__glyph" />}
            >
              <DownloadProgressMark
                class="module-file-import__mark"
                state="running"
                progress={progress()?.fraction ?? null}
                busy={progress()?.fraction === null}
              />
            </Show>
          }
          onClick={() => input?.click()}
        />
        <input
          ref={(element) => {
            input = element;
          }}
          class="module-file-import__input"
          type="file"
          accept={MODULE_BUNDLE_ACCEPT}
          aria-label="Файл модуля"
          tabIndex={-1}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (file) void importFile(file);
          }}
        />
      </div>
      <Show when={progress()}>
        {(current) => (
          <p class="module-file-import__status" role="status">
            {current().state === 'queued' ? 'Читаем файл…' : `Устанавливаем «${current().title}»`}
            {progressPercent()}
          </p>
        )}
      </Show>
      <Show when={installedLocal().length > 0}>
        <ul class="module-file-import__list">
          <For each={installedLocal()}>
            {(module) => (
              <li class="module-file-import__item">
                <span class="module-file-import__copy">
                  <span class="module-file-import__name">{module.title}</span>
                  <span class="module-file-import__meta">
                    {module.version} · {module.size}
                  </span>
                </span>
                <Button
                  variant="icon"
                  class="module-file-import__remove"
                  aria-label={`Удалить «${module.title}»`}
                  title="Удалить"
                  disabled={busy()}
                  icon={<AppGlyph name="trash" class="module-file-import__glyph" />}
                  onClick={() => setRemovalId(module.id)}
                />
              </li>
            )}
          </For>
        </ul>
      </Show>
      <ConfirmationDialog
        open={removalId() !== null}
        title="Удалить с устройства?"
        description={`«${removalTitle()}» будет удалён. Чтобы вернуть модуль, выберите его файл снова.`}
        confirmLabel="Удалить"
        danger
        onConfirm={() => {
          const id = removalId();
          setRemovalId(null);
          if (id) void remove(id);
        }}
        onOpenChange={(open) => {
          if (!open) setRemovalId(null);
        }}
      />
    </section>
  );
}
