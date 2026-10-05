import type { JSX } from 'solid-js';

import { ContentDownloadStatus } from '@/features/modules/ContentDownloadStatus';
import { SectionDownloads } from '@/features/sections/SectionDownloads';

/**
 * The body of Settings → «Загрузки и разделы»; the settings frame supplies the heading and the
 * back arrow. The queue is available before core readiness and never constructs a database owner.
 */
export function DownloadsPage(props: {
  /** Connects freshly downloaded packages to the search core; absent: nothing to connect. */
  readonly onContentChanged?: () => Promise<void>;
}): JSX.Element {
  return (
    <>
      <section class="downloads-sections paper-card" aria-labelledby="downloads-sections-title">
        <h2 class="downloads-sections__title" id="downloads-sections-title">
          Скачать по специальности
        </h2>
        <p class="downloads-sections__text">
          Раздел целиком: клинические рекомендации и препараты, которые в них названы. Уже скачанное
          заново не загружается.
        </p>
        <SectionDownloads onContentChanged={props.onContentChanged ?? (() => Promise.resolve())} />
      </section>
      <ContentDownloadStatus />
    </>
  );
}
