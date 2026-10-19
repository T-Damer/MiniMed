import type { ContentModuleCatalogEntry } from '@localmed/contracts';
import { createMemo, createSignal, type JSX, onCleanup, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { DownloadProgressMark } from '@/components/DownloadProgressMark';
import {
  canPrioritizeModules,
  prioritizeModuleDownloads,
} from '@/features/downloads/download-priority';
import {
  isModuleDownloadBusy,
  moduleDownloadStatusLabel,
} from '@/features/downloads/module-download-view';
import { claimOffer } from '@/features/downloads/offer-claim';
import { useModuleDownloadView } from '@/features/downloads/use-module-download-view';
import { isModuleReleased } from '@/features/modules/local-packaged-modules';
import { formatModuleBytes } from '@/features/modules/module-display';
import { useModuleInstaller } from '@/features/sections/use-module-installer';

import './module-download-offer.css';

export interface ModuleDownloadOfferProps {
  readonly moduleId: string;
  readonly onContentChanged: () => Promise<void>;
  /** The small line under the button: what the module holds (a group, a label set). */
  readonly subtitle: (module: ContentModuleCatalogEntry) => string;
  /** The verb on the button; default «Скачать». */
  readonly action?: string;
  readonly failureMessage?: string;
  readonly variant?: 'primary' | 'secondary';
  readonly class?: string;
  readonly buttonClass?: string;
  readonly testId?: string;
  readonly buttonTestId?: string;
  readonly ariaLabel?: string;
  /** What to say when the release has no downloadable module for this id. */
  readonly unavailableText?: string;
}

/**
 * The one download offer for a content module: a compact «Скачать · 37 МБ» button with what the
 * module holds as a small line under it. Its state comes from the shared download state (queue,
 * runtime, durable intents), so a download started earlier or elsewhere shows at once with its
 * progress, and a screen shows a single offer per module however many places ask for it.
 */
export function ModuleDownloadOffer(props: ModuleDownloadOfferProps): JSX.Element {
  const installer = useModuleInstaller(
    props.onContentChanged,
    props.failureMessage ?? 'Не удалось скачать инструкции.',
  );
  const view = useModuleDownloadView(() => props.moduleId, installer);
  const [owner, setOwner] = createSignal(true);
  const claim = claimOffer(props.moduleId, setOwner);
  setOwner(claim.isOwner());
  onCleanup(claim.release);

  const entry = createMemo(() =>
    installer.snapshot()?.catalog.modules.find((module) => module.id === props.moduleId),
  );
  const released = () => {
    const module = entry();
    return module !== undefined && isModuleReleased(module);
  };
  const busy = () => isModuleDownloadBusy(view());
  // Re-read on every phase change: a waiting download can be moved ahead of the others.
  const canRunNow = () =>
    (view().phase === 'queued' || view().phase === 'paused') &&
    canPrioritizeModules([props.moduleId]);
  const size = (): string => {
    const bytes = entry()?.sizes.downloadBytes;
    return typeof bytes === 'number' ? formatModuleBytes(bytes) : '';
  };
  const label = (): string => {
    const state = view();
    if (busy()) return moduleDownloadStatusLabel(state);
    const verb = state.phase === 'failed' ? 'Повторить' : (props.action ?? 'Скачать');
    return size() === '' ? verb : `${verb} · ${size()}`;
  };
  const subtitle = (): string => {
    const module = entry();
    return module ? props.subtitle(module) : '';
  };

  return (
    <Show when={owner() && view().phase !== 'installed'}>
      <div
        class="module-offer"
        classList={{ [props.class ?? '']: Boolean(props.class) }}
        data-testid={props.testId}
        data-module-id={props.moduleId}
        data-download-phase={view().phase}
      >
        <Show
          when={busy() || installer.snapshot() !== undefined || installer.failed()}
          fallback={
            <p class="module-offer__note" role="status">
              Проверяем, что можно скачать…
            </p>
          }
        >
          <Show
            when={busy() || installer.failed() || released()}
            fallback={
              <p class="module-offer__note">
                {props.unavailableText ?? 'Пока недоступно для скачивания в этой версии.'}
              </p>
            }
          >
            <Show
              when={busy() || !installer.failed()}
              fallback={<p class="module-offer__note">Каталог модулей не загрузился.</p>}
            >
              <div class="module-offer__actions">
                <Button
                  type="button"
                  variant={props.variant ?? 'primary'}
                  class={`module-offer__button ${props.buttonClass ?? ''}`.trim()}
                  disabled={busy() || entry() === undefined}
                  data-testid={props.buttonTestId}
                  aria-label={props.ariaLabel}
                  icon={
                    <Show
                      when={busy()}
                      fallback={
                        <AppGlyph
                          name={view().phase === 'failed' ? 'arrow-counter-clockwise' : 'download'}
                        />
                      }
                    >
                      <DownloadProgressMark
                        state={
                          view().phase === 'queued' || view().phase === 'paused'
                            ? 'queued'
                            : 'running'
                        }
                        progress={view().fraction}
                        busy={view().fraction === null}
                      />
                    </Show>
                  }
                  onClick={() => {
                    const module = entry();
                    if (module && !busy()) void installer.start([module]);
                  }}
                >
                  {label()}
                </Button>
                <Show when={canRunNow()}>
                  <Button
                    type="button"
                    variant="secondary"
                    class="module-offer__now"
                    data-testid="module-offer-now"
                    icon={<AppGlyph name="lightning" />}
                    onClick={() => prioritizeModuleDownloads([props.moduleId])}
                  >
                    Скачать сейчас
                  </Button>
                </Show>
              </div>
              <Show when={subtitle() !== ''}>
                <span class="module-offer__subtitle">{subtitle()}</span>
              </Show>
            </Show>
          </Show>
        </Show>
      </div>
    </Show>
  );
}
