import { createMemo, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { DownloadProgressMark } from '@/components/DownloadProgressMark';
import {
  type InstructionModuleOffer,
  instructionOfferLabel,
} from '@/features/medications/instruction-offer';
import { isModuleReleased } from '@/features/modules/local-packaged-modules';
import { contentModuleTaskProgress } from '@/features/modules/module-display';
import { useModuleInstaller } from '@/features/sections/use-module-installer';

const MODULE_TITLE_PREFIX = 'Инструкции ГРЛС — ';
const FINISHED_TASK_STATES = new Set(['completed', 'failed', 'cancelled']);

/**
 * «Скачать инструкции группы «…»»: queues the instruction module that holds a drug's instruction
 * through the same module runtime as every other download. Mounted only where an instruction is
 * missing, so the module catalog is not loaded for a tool that has everything it needs.
 */
export function InstructionDownloadOffer(props: {
  readonly moduleId: string;
  readonly onContentChanged: () => Promise<void>;
}): JSX.Element {
  const installer = useModuleInstaller(props.onContentChanged, 'Не удалось скачать инструкции.');
  const entry = createMemo(() =>
    installer.snapshot()?.catalog.modules.find((module) => module.id === props.moduleId),
  );
  const offer = createMemo<InstructionModuleOffer | null>(() => {
    const module = entry();
    if (!module) return null;
    return {
      moduleId: module.id,
      groupTitle: module.title.startsWith(MODULE_TITLE_PREFIX)
        ? module.title.slice(MODULE_TITLE_PREFIX.length)
        : module.title,
      downloadBytes: module.sizes.downloadBytes,
    };
  });
  const installed = () => installer.snapshot()?.installedIds.has(props.moduleId) ?? false;
  const active = () =>
    installer.starting() ||
    (installer
      .snapshot()
      ?.tasks.some(
        (task) => task.moduleId === props.moduleId && !FINISHED_TASK_STATES.has(task.state),
      ) ??
      false);
  // The running task of this module: its bytes give a percentage, so the wait is not a bare label.
  const progress = (): number | null => {
    const task = installer
      .snapshot()
      ?.tasks.find(
        (candidate) =>
          candidate.moduleId === props.moduleId && !FINISHED_TASK_STATES.has(candidate.state),
      );
    return task ? contentModuleTaskProgress(task) : null;
  };
  const percent = (): number | null => {
    const value = progress();
    return value === null ? null : Math.min(99, Math.round(value * 100));
  };
  return (
    <Show when={!installed()}>
      <div class="drug-interactions__offer">
        <Show
          when={offer()}
          fallback={
            <p class="drug-interactions__side-note" role="status">
              {installer.failed()
                ? 'Каталог модулей не загрузился.'
                : 'Проверяем, доступна ли инструкция для скачивания…'}
            </p>
          }
        >
          {(current) => (
            <Show
              when={entry() && isModuleReleased(entry() as NonNullable<ReturnType<typeof entry>>)}
              fallback={
                <p class="drug-interactions__side-note">
                  Модуль инструкций пока недоступен для скачивания в этой версии приложения.
                </p>
              }
            >
              <Button
                type="button"
                variant="primary"
                class="drug-interactions__offer-button"
                disabled={active()}
                icon={
                  <Show when={active()} fallback={<AppGlyph name="download" />}>
                    <DownloadProgressMark state="running" progress={progress()} />
                  </Show>
                }
                onClick={() => {
                  const module = entry();
                  if (module) void installer.start([module]);
                }}
              >
                {active()
                  ? percent() === null
                    ? 'Скачиваем…'
                    : `Скачиваем… ${percent()}%`
                  : instructionOfferLabel(current())}
              </Button>
            </Show>
          )}
        </Show>
      </div>
    </Show>
  );
}
