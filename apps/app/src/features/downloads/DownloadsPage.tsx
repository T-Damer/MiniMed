import type { JSX } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { NavBack } from '@/components/NavBack';
import { Page } from '@/components/Page';
import { ContentDownloadStatus } from '@/features/modules/ContentDownloadStatus';
import { SETTINGS_ROOT_HASH } from '@/features/settings/settings-routing';

/** The queue is available before core readiness and never constructs a database owner. */
export function DownloadsPage(): JSX.Element {
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
        description="Единая очередь ядра, документов, изображений и моделей."
      />
      <ContentDownloadStatus />
    </section>
  );
}
