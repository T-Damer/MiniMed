import { type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { DownloadProgressMark } from '@/components/DownloadProgressMark';
import {
  MEDICATION_DOWNLOAD_EXPLANATION,
  medicationDownloadDisabled,
  medicationDownloadIsLarge,
  medicationDownloadLabel,
} from '@/features/medications/medication-download-state';
import { useDrugDownload } from '@/features/medications/use-drug-download';

const KNOWLEDGE_BASE_HASH = '#/modules/documents';

/**
 * Shown instead of the empty list while no medication package is installed: the core holds only
 * pointers, so the catalog stays empty until the packages are downloaded.
 */
export function MedicationDownloadState(props: {
  readonly onContentChanged: () => Promise<void>;
}): JSX.Element {
  const { state, failed, problem, active, start } = useDrugDownload(props.onContentChanged);
  const label = () =>
    medicationDownloadLabel({
      state: state(),
      failed: failed(),
      problem: problem(),
      active: active(),
    });

  return (
    <section class="medication-download paper-card" aria-labelledby="medication-download-title">
      <AppGlyph name="pill" class="medication-download__icon" />
      <h3 class="medication-download__title" id="medication-download-title">
        Справочника препаратов пока нет на устройстве
      </h3>
      <p class="medication-download__text">{MEDICATION_DOWNLOAD_EXPLANATION}</p>
      <div class="medication-download__actions">
        <Button
          class="medication-download__action"
          variant="primary"
          disabled={medicationDownloadDisabled({ state: state(), active: active() })}
          icon={
            <Show
              when={active()}
              fallback={<AppGlyph name={state()?.plan.complete ? 'check' : 'download'} />}
            >
              <DownloadProgressMark
                state="running"
                progress={state()?.progress.byteProgress ?? null}
              />
            </Show>
          }
          onClick={() => void start()}
        >
          {label()}
        </Button>
        <Button
          class="medication-download__link"
          variant="quiet"
          onClick={() => {
            window.location.hash = KNOWLEDGE_BASE_HASH;
          }}
        >
          Выбрать группы в базе знаний
        </Button>
      </div>
      <Show when={active()}>
        <p class="medication-download__hint" role="status" aria-live="polite">
          Загрузка идёт в фоне: список появится сам, когда пакеты подключатся.
        </p>
      </Show>
      <Show when={!failed() && !active() && medicationDownloadIsLarge(state())}>
        <p class="medication-download__hint">Файл большой — лучше по Wi‑Fi.</p>
      </Show>
    </section>
  );
}
