import type { JSX } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { NavBack } from '@/components/NavBack';
import { Page } from '@/components/Page';
import { ContentDownloadStatus } from '@/features/modules/ContentDownloadStatus';
import { SectionDownloads } from '@/features/sections/SectionDownloads';
import { SETTINGS_ROOT_HASH } from '@/features/settings/settings-routing';

/** The queue is available before core readiness and never constructs a database owner. */
export function DownloadsPage(props: {
  /** Connects freshly downloaded packages to the search core; absent: nothing to connect. */
  readonly onContentChanged?: () => Promise<void>;
}): JSX.Element {
  return (
    <section class="settings-page page-surface page-grain" data-testid="downloads-page">
      <Page
        class="settings-page__heading settings-page__heading--subroute"
        navigation={
          <NavBack
            class="knowledge-back-button"
            aria-label="К настройкам"
            onClick={() => {
              window.location.hash = SETTINGS_ROOT_HASH;
            }}
            icon={<AppGlyph name="arrow-left" class="settings-page__back-icon" />}
          />
        }
        icon={<AppGlyph name="download" class="page__icon-glyph" />}
        title={<h1 class="settings-page__title">Загрузки</h1>}
        description="Всё, что MiniMed скачивает: база, документы, картинки и модели."
      />
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
    </section>
  );
}
