import { type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { DownloadProgressMark } from '@/components/DownloadProgressMark';
import { fullDownloadLabel } from './full-download';
import { useFullDownload } from './use-full-download';

import './full-download-offer.css';

/**
 * «Скачать всё» in Settings → Загрузки: every content module plus the meaning-search model, the
 * image packs left out. The same choice the first launch offers; nothing runs until it is tapped.
 */
export function FullDownloadOffer(props: {
  readonly onContentChanged: () => Promise<void>;
}): JSX.Element {
  const download = useFullDownload(
    props.onContentChanged,
    () => true,
    () => true,
  );
  const label = () => fullDownloadLabel(download.plan(), download.active());
  const complete = () => {
    const plan = download.plan();
    return plan !== undefined && plan.pending.length === 0 && plan.modelBytes === 0;
  };
  return (
    <Show when={!download.failed() && !complete()}>
      <section class="full-download-offer paper-card" data-testid="full-download-offer">
        <Button
          class="full-download-offer__button"
          variant="primary"
          disabled={download.plan() === undefined || download.active()}
          icon={
            <Show when={download.active()} fallback={<AppGlyph name="download" />}>
              <DownloadProgressMark state="running" progress={null} />
            </Show>
          }
          onClick={() => void download.start()}
        >
          {label()}
        </Button>
        <p class="full-download-offer__note">Рекомендуем: справочники и поиск по жалобам</p>
      </section>
    </Show>
  );
}
